import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The repository-root catalog is canonical; public/foguetes is its bundled offline copy.
const catalogRoot = path.resolve(projectRoot, 'foguetes');
const catalogPath = path.join(catalogRoot, 'catalogo.json');
const issues = [];

function fail(where, message) {
  issues.push(`${where}: ${message}`);
}

function safeChildPath(parent, child) {
  if (typeof child !== 'string' || child.trim() === '' || path.isAbsolute(child)) return null;
  const resolved = path.resolve(parent, child);
  const relative = path.relative(parent, resolved);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    ? resolved
    : null;
}

function isPositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

async function validateManifest(manifest, folder, source) {
  if (manifest.schema_version !== 1) fail(source, 'schema_version deve ser 1.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id ?? '')) fail(source, 'id deve usar letras minúsculas, números e hífens.');
  if (typeof manifest.nome !== 'string' || !manifest.nome.trim()) fail(source, 'nome é obrigatório.');
  if (typeof manifest.descricao !== 'string' || !manifest.descricao.trim() || manifest.descricao.includes('PREENCHER')) fail(source, 'descricao deve ser revisada antes da publicação.');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.versao_dados ?? '')) fail(source, 'versao_dados deve seguir o formato X.Y.Z.');
  if (manifest.rocketpy_version !== '1.13.0') fail(source, 'rocketpy_version deve ser 1.13.0, versão incluída no APK atual.');

  for (const key of ['motor', 'arrasto_ligado', 'arrasto_desligado']) {
    const asset = safeChildPath(folder, manifest.arquivos?.[key]);
    if (!asset) {
      fail(source, `arquivos.${key} deve ser um caminho relativo dentro da pasta do foguete.`);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await access(asset);
    } catch {
      fail(source, `arquivo obrigatório não encontrado: ${manifest.arquivos[key]}`);
    }
  }

  const env = manifest.ambiente ?? {};
  if (!Number.isFinite(env.latitude) || env.latitude < -90 || env.latitude > 90) fail(source, 'ambiente.latitude deve estar entre -90 e 90.');
  if (!Number.isFinite(env.longitude) || env.longitude < -180 || env.longitude > 180) fail(source, 'ambiente.longitude deve estar entre -180 e 180.');
  if (!isPositive(env.altura_maxima_m)) fail(source, 'ambiente.altura_maxima_m deve ser positiva.');
  if (typeof env.referencial !== 'string' || !env.referencial.trim()) fail(source, 'ambiente.referencial é obrigatório.');

  const rocket = manifest.foguete ?? {};
  if (!isPositive(rocket.raio_m) || !isPositive(rocket.massa_kg)) fail(source, 'foguete.raio_m e foguete.massa_kg devem ser positivos.');
  if (!Array.isArray(rocket.inercia_kg_m2) || rocket.inercia_kg_m2.length !== 3 || !rocket.inercia_kg_m2.every(isPositive)) fail(source, 'foguete.inercia_kg_m2 deve conter três valores positivos.');
  if (!Number.isFinite(rocket.centro_massa_sem_motor_m)) fail(source, 'foguete.centro_massa_sem_motor_m é obrigatório.');
  if (!['tail_to_nose', 'nose_to_tail'].includes(rocket.orientacao)) fail(source, 'foguete.orientacao deve ser tail_to_nose ou nose_to_tail.');
  const motorNumbers = [
    'posicao_m', 'massa_seca_kg', 'tempo_queima_s', 'centro_massa_seco_m', 'numero_graos',
    'densidade_graos_kg_m3', 'raio_externo_grao_m', 'raio_interno_inicial_grao_m',
    'altura_inicial_grao_m', 'separacao_graos_m', 'centro_massa_graos_m', 'posicao_bocal_m',
    'raio_bocal_m', 'raio_garganta_m',
  ];
  if (!rocket.motor || motorNumbers.some((key) => !Number.isFinite(rocket.motor[key])) ||
      !Array.isArray(rocket.motor.inercia_seca_kg_m2) || rocket.motor.inercia_seca_kg_m2.length !== 3 ||
      !rocket.motor.inercia_seca_kg_m2.every(Number.isFinite) || !rocket.motor.orientacao_coordenadas || !rocket.motor.interpolacao) {
    fail(source, 'foguete.motor precisa declarar os parâmetros do motor sólido e três inércias secas.');
  }
  if (!Array.isArray(rocket.componentes) || rocket.componentes.length === 0) fail(source, 'foguete.componentes deve listar ao menos um componente.');
  if (!Array.isArray(rocket.recuperacao)) fail(source, 'foguete.recuperacao deve ser uma lista, mesmo que vazia.');
  if (!Array.isArray(manifest.campos_formulario)) fail(source, 'campos_formulario deve ser uma lista.');
  const supportedCases = new Set(['nominal', 'ballistic', 'main_apogee', 'drogue_only', 'custom']);
  if (!Array.isArray(manifest.casos_voo) || manifest.casos_voo.length === 0 || manifest.casos_voo.some((flightCase) => !supportedCases.has(flightCase))) fail(source, 'casos_voo deve listar casos suportados: nominal, ballistic, main_apogee, drogue_only, custom.');

  const componentKeys = {
    nose: ['nome', 'comprimento_m', 'formato', 'posicao_m'],
    trapezoidal_fins: ['numero', 'corda_raiz_m', 'corda_ponta_m', 'envergadura_m', 'posicao_m', 'comprimento_enflechamento_m'],
    tail: ['nome', 'raio_superior_m', 'raio_inferior_m', 'comprimento_m', 'posicao_m'],
    rail_buttons: ['posicao_superior_m', 'posicao_inferior_m', 'angulo_deg'],
  };
  for (const component of rocket.componentes ?? []) {
    const required = componentKeys[component.tipo];
    if (!required) {
      fail(source, `componente RocketPy não suportado: ${component.tipo}.`);
      continue;
    }
    for (const key of required) {
      if (typeof component[key] === 'number' ? !Number.isFinite(component[key]) : typeof component[key] !== 'string' || !component[key].trim()) {
        fail(source, `componente ${component.tipo} precisa declarar ${key}.`);
      }
    }
  }
  for (const parachute of rocket.recuperacao ?? []) {
    if (!parachute.nome || !['main', 'drogue'].includes(parachute.tipo) || !isPositive(parachute.cd_area_m2) ||
        !(parachute.gatilho === 'apogee' || Number.isFinite(parachute.gatilho))) {
      fail(source, 'cada item de foguete.recuperacao precisa de nome, tipo, cd_area_m2 positivo e gatilho válido.');
    }
  }

  const fieldIds = new Set();
  const supportedFieldIds = new Set([
    'rocket_mass_kg',
    'cg_from_tail_m',
    'cg_reference_m',
    'inertia_xx_kg_m2',
    'inertia_zz_kg_m2',
    'grain_density_kg_m3',
    'grain_separation_m',
  ]);
  for (const field of manifest.campos_formulario ?? []) {
    if (!/^[a-z][a-z0-9_]*$/.test(field.id ?? '')) fail(source, `id de campo inválido: ${field.id ?? '(vazio)'}.`);
    if (fieldIds.has(field.id)) fail(source, `id de campo duplicado: ${field.id}.`);
    fieldIds.add(field.id);
    if (!supportedFieldIds.has(field.id)) fail(source, `campo ${field.id} ainda não possui vínculo com o construtor RocketPy v1.`);
    if (!field.rotulo || !field.unidade || field.tipo !== 'number' || !Number.isFinite(field.valor_inicial)) {
      fail(source, `campo ${field.id || '(sem id)'} requer rotulo, unidade, tipo number e valor_inicial numérico.`);
    }
    if (field.minimo !== undefined && !Number.isFinite(field.minimo)) fail(source, `mínimo inválido no campo ${field.id}.`);
    if (field.maximo !== undefined && !Number.isFinite(field.maximo)) fail(source, `máximo inválido no campo ${field.id}.`);
    if (field.minimo !== undefined && field.maximo !== undefined && field.minimo > field.maximo) fail(source, `limites invertidos no campo ${field.id}.`);
    if (field.minimo !== undefined && field.valor_inicial < field.minimo) fail(source, `valor inicial abaixo do mínimo no campo ${field.id}.`);
    if (field.maximo !== undefined && field.valor_inicial > field.maximo) fail(source, `valor inicial acima do máximo no campo ${field.id}.`);
  }
  if (!fieldIds.has('rocket_mass_kg')) fail(source, 'campos_formulario deve incluir rocket_mass_kg.');
  if (!fieldIds.has('cg_from_tail_m') && !fieldIds.has('cg_reference_m')) fail(source, 'campos_formulario deve incluir cg_from_tail_m ou cg_reference_m.');
  if (rocket.orientacao === 'nose_to_tail' && !fieldIds.has('cg_reference_m')) fail(source, 'foguete com orientacao nose_to_tail deve expor cg_reference_m.');
  if (rocket.orientacao === 'tail_to_nose' && !fieldIds.has('cg_from_tail_m')) fail(source, 'foguete com orientacao tail_to_nose deve expor cg_from_tail_m.');

  for (const [key, relativePath] of Object.entries(manifest.arquivos ?? {})) {
    if (!relativePath) continue;
    const asset = safeChildPath(folder, relativePath);
    if (!asset) {
      fail(source, `arquivos.${key} deve ser relativo e permanecer dentro da pasta do foguete.`);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await access(asset);
    } catch {
      fail(source, `arquivo opcional declarado não encontrado: ${relativePath}`);
    }
  }
}

let catalog;
try {
  catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
} catch (error) {
  console.error(`Não foi possível abrir foguetes/catalogo.json: ${error.message}`);
  process.exit(1);
}

if (catalog.schema_version !== 1) fail('catalogo.json', 'schema_version deve ser 1.');
if (!Array.isArray(catalog.foguetes) || catalog.foguetes.length === 0) fail('catalogo.json', 'foguetes deve conter ao menos uma entrada.');

const ids = new Set();
for (const entry of catalog.foguetes ?? []) {
  if (ids.has(entry.id)) fail('catalogo.json', `id duplicado: ${entry.id}.`);
  ids.add(entry.id);
  const manifestPath = safeChildPath(catalogRoot, entry.manifesto);
  if (!manifestPath) {
    fail('catalogo.json', `manifesto inválido para ${entry.id}.`);
    continue;
  }
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.id !== entry.id) fail(entry.manifesto, `id do manifesto (${manifest.id}) não corresponde ao catálogo (${entry.id}).`);
    if (manifest.nome !== entry.nome) fail(entry.manifesto, 'nome não corresponde ao catálogo.');
    if (manifest.versao_dados !== entry.versao_dados) fail(entry.manifesto, 'versao_dados não corresponde ao catálogo.');
    await validateManifest(manifest, path.dirname(manifestPath), entry.manifesto);
  } catch (error) {
    fail(entry.manifesto, `não foi possível ler o manifesto: ${error.message}`);
  }
}

const folders = (await readdir(catalogRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
for (const id of ids) {
  if (!folders.includes(id)) fail('catalogo.json', `pasta do foguete '${id}' não existe.`);
}

if (issues.length) {
  console.error(`Catálogo inválido (${issues.length} problema(s)):`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`Catálogo válido: ${catalog.foguetes.length} foguetes.`);
