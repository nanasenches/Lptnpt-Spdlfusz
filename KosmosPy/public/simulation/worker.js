import { loadPyodide } from '/pyodide/pyodide.mjs';

const PYODIDE_INDEX = '/pyodide/';
const ROCKETPY_WHEELS = [
  '/pyodide/dill-0.4.1-py3-none-any.whl',
  '/pyodide/simplekml-1.3.5-py3-none-any.whl',
  '/pyodide/rocketpy-1.13.0-py3-none-any.whl',
];
const ASSETS = [
  'deimos_core.py',
  'FAISCABATES.eng',
  'CD_Off_RASAero.csv',
  'CD_On_RASAero.csv',
  'Mission7Motor.eng',
  'Atlas_CD_OR_off.csv',
  'Atlas_CD_OR_on.csv',
];

let runtimePromise;

function update(phase, message, progress) {
  self.postMessage({ type: 'status', phase, message, progress });
}

async function writeAssets(pyodide) {
  try {
    pyodide.FS.mkdir('/home/pyodide/simulation');
  } catch {
    // The directory already exists after the first simulation.
  }

  await Promise.all(
    ASSETS.map(async (name) => {
      const response = await fetch(`/simulation/${name}`);
      if (!response.ok) {
        throw new Error(`Não foi possível carregar o arquivo ${name}.`);
      }
      const content = new Uint8Array(await response.arrayBuffer());
      pyodide.FS.writeFile(`/home/pyodide/simulation/${name}`, content);
    }),
  );
}

async function initializeRuntime() {
  update('runtime', 'Preparando o motor de cálculo no celular…', 8);
  const pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX });
  update('packages', 'Carregando bibliotecas científicas locais…', 22);
  await pyodide.loadPackage([
    'micropip',
    'numpy',
    'scipy',
    'matplotlib',
    'netcdf4',
    'requests',
    'pytz',
  ]);
  pyodide.globals.set('rocketpy_wheels_json', JSON.stringify(ROCKETPY_WHEELS));
  await pyodide.runPythonAsync(`
import json
import micropip
await micropip.install(json.loads(rocketpy_wheels_json), deps=False)
`);
  pyodide.globals.delete('rocketpy_wheels_json');
  update('assets', 'Carregando os modelos do Atlas e do DEIMOS II…', 72);
  await writeAssets(pyodide);
  const core = pyodide.FS.readFile('/home/pyodide/simulation/deimos_core.py', {
    encoding: 'utf8',
  });
  await pyodide.runPythonAsync(core);
  update('ready', 'Motor de cálculo pronto.', 100);
  self.postMessage({ type: 'ready' });
  return pyodide;
}

function getRuntime() {
  runtimePromise ??= initializeRuntime();
  return runtimePromise;
}

self.onmessage = async (event) => {
  if (event.data?.type === 'initialize') {
    try {
      await getRuntime();
    } catch (error) {
      runtimePromise = undefined;
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (event.data?.type !== 'simulate') return;

  try {
    const pyodide = await getRuntime();
    let rocketConfigJson = null;
    if (event.data.rocketPackage?.manifest) {
      const manifest = event.data.rocketPackage.manifest;
      const packageDirectory = `/home/pyodide/simulation/${manifest.id}`;
      pyodide.FS.mkdirTree(packageDirectory);
      for (const [key, arrayBuffer] of Object.entries(event.data.rocketPackage.files ?? {})) {
        const relativePath = manifest.arquivos?.[key];
        if (!relativePath || relativePath.startsWith('/') || relativePath.includes('..') || relativePath.includes('\\')) {
          throw new Error(`Caminho de arquivo inseguro no pacote ${manifest.id}: ${relativePath ?? key}`);
        }
        const filePath = `${packageDirectory}/${relativePath}`;
        const directory = filePath.slice(0, filePath.lastIndexOf('/'));
        pyodide.FS.mkdirTree(directory);
        pyodide.FS.writeFile(filePath, new Uint8Array(arrayBuffer));
      }
      rocketConfigJson = JSON.stringify(manifest);
    }
    if (event.data.packageFiles) {
      const aliases = event.data.params.vehicle === 'atlas'
        ? {
            motor: 'Mission7Motor.eng',
            arrasto_ligado: 'Atlas_CD_OR_on.csv',
            arrasto_desligado: 'Atlas_CD_OR_off.csv',
          }
        : {
            motor: 'FAISCABATES.eng',
            arrasto_ligado: 'CD_On_RASAero.csv',
            arrasto_desligado: 'CD_Off_RASAero.csv',
          };
      for (const [key, fileName] of Object.entries(aliases)) {
        const bytes = event.data.packageFiles[key];
        if (bytes) pyodide.FS.writeFile(`/home/pyodide/simulation/${fileName}`, new Uint8Array(bytes));
      }
    }
    update('atmosphere', 'Obtendo a atmosfera e montando o voo…', 5);
    const openMeteoResponse = event.data.openMeteoResponse ?? null;
    if (event.data.params.atmosphere_mode === 'forecast' && !openMeteoResponse && event.data.cachedAtmosphere) {
      update('atmosphere-cache', 'Open-Meteo indisponível. Usando a última atmosfera salva…', 12);
    }
    pyodide.globals.set('params_json', JSON.stringify(event.data.params));
    pyodide.globals.set('rocket_config_json', rocketConfigJson);
    pyodide.globals.set(
      'cached_snapshot_json',
      event.data.cachedAtmosphere
        ? JSON.stringify(event.data.cachedAtmosphere)
        : null,
    );
    pyodide.globals.set(
      'open_meteo_response_json',
      openMeteoResponse ? JSON.stringify(openMeteoResponse) : null,
    );
    pyodide.globals.set('progress_callback', (done, total) => {
      const progress = 20 + Math.round((Number(done) / Number(total)) * 75);
      update(
        'monte-carlo',
        `Executando Monte Carlo: ${done} de ${total}…`,
        progress,
      );
    });
    pyodide.globals.set('plot_progress_callback', () => {
      update(
        'plots',
        'Gerando os gráficos detalhados do RocketPy…',
        96,
      );
    });
    pyodide.globals.set('animation_progress_callback', () => {
      update(
        'animation',
        'Calculando a atitude e preparando a animação 3D…',
        98,
      );
    });

    const rawResult = await pyodide.runPythonAsync(
      'run_deimos(params_json, cached_snapshot_json, open_meteo_response_json, rocket_config_json)',
    );
    const parsedResult = JSON.parse(String(rawResult));
    update('done', 'Simulação concluída.', 100);
    self.postMessage({ type: 'result', result: parsedResult });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    try {
      const pyodide = await getRuntime();
      pyodide.globals.delete('params_json');
      pyodide.globals.delete('rocket_config_json');
      pyodide.globals.delete('cached_snapshot_json');
      pyodide.globals.delete('open_meteo_response_json');
      pyodide.globals.delete('progress_callback');
      pyodide.globals.delete('plot_progress_callback');
      pyodide.globals.delete('animation_progress_callback');
    } catch {
      // Runtime initialization errors are already reported above.
    }
  }
};
