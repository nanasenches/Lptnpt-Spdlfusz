export type RocketField = {
  id: string;
  rotulo: string;
  unidade: string;
  tipo: 'number';
  valor_inicial: number;
  minimo?: number;
  maximo?: number;
};

export type RocketManifest = {
  schema_version: 1;
  id: string;
  nome: string;
  versao_dados: string;
  descricao?: string;
  rocketpy_version: string;
  ambiente: {
    latitude: number;
    longitude: number;
    elevacao_m: number;
    referencial: string;
    altura_maxima_m: number;
  };
  arquivos: Record<string, string>;
  foguete: Record<string, unknown>;
  campos_formulario: RocketField[];
  casos_voo: string[];
};

export type RocketCatalogEntry = {
  id: string;
  nome: string;
  versao_dados: string;
  manifesto: string;
};

export type RocketCatalog = { schema_version: 1; foguetes: RocketCatalogEntry[] };
export type InstalledRocket = {
  manifest: RocketManifest;
  files: Record<string, Blob>;
  installedAt: string;
};

const DATABASE_NAME = 'mari-rocket-packages';
const DATABASE_VERSION = 1;
const STORE_NAME = 'packages';
const GITHUB_DATA_ROOT = 'https://raw.githubusercontent.com/nanasenches/Lptnpt-Spdlfusz/main/foguetes/';
const REQUIRED_FILES = ['motor', 'arrasto_ligado', 'arrasto_desligado'];
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const SUPPORTED_ROCKETPY_VERSION = '1.13.0';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'manifest.id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o armazenamento local.'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha no armazenamento local.'));
  });
}

function safeRelativePath(value: string): string {
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Caminho de arquivo inválido no pacote: ${value || '(vazio)'}`);
  }
  return value;
}

function validateManifest(value: unknown, expectedId: string): RocketManifest {
  const manifest = value as RocketManifest;
  if (!manifest || manifest.schema_version !== 1 || manifest.id !== expectedId) {
    throw new Error('O manifesto tem versão de formato incompatível ou id diferente do catálogo.');
  }
  if (!manifest.nome || !manifest.versao_dados || !manifest.foguete || !manifest.foguete.motor || !manifest.ambiente || !Array.isArray(manifest.campos_formulario)) {
    throw new Error(`O manifesto de ${expectedId} está incompleto.`);
  }
  if (!manifest.descricao?.trim() || manifest.descricao.includes('PREENCHER')) throw new Error(`A descrição do pacote ${expectedId} ainda não foi preenchida.`);
  if (manifest.rocketpy_version !== SUPPORTED_ROCKETPY_VERSION) throw new Error(`O pacote ${expectedId} pede RocketPy ${manifest.rocketpy_version}; este APK inclui ${SUPPORTED_ROCKETPY_VERSION}.`);
  for (const key of REQUIRED_FILES) {
    if (!manifest.arquivos?.[key]) throw new Error(`O manifesto de ${expectedId} não declara o arquivo ${key}.`);
  }
  const environment = manifest.ambiente;
  if (!Number.isFinite(environment.latitude) || environment.latitude < -90 || environment.latitude > 90 ||
      !Number.isFinite(environment.longitude) || environment.longitude < -180 || environment.longitude > 180 ||
      !Number.isFinite(environment.elevacao_m) || !Number.isFinite(environment.altura_maxima_m) || environment.altura_maxima_m <= 0 || !environment.referencial) {
    throw new Error(`Os parâmetros do local de lançamento de ${expectedId} estão inválidos.`);
  }
  const rocket = manifest.foguete;
  if (!Number.isFinite(Number(rocket.raio_m)) || Number(rocket.raio_m) <= 0 || !Number.isFinite(Number(rocket.massa_kg)) || Number(rocket.massa_kg) <= 0 ||
      !Array.isArray(rocket.inercia_kg_m2) || rocket.inercia_kg_m2.length !== 3 || !rocket.inercia_kg_m2.every((item) => Number.isFinite(Number(item))) ||
      !Number.isFinite(Number(rocket.centro_massa_sem_motor_m))) {
    throw new Error(`A geometria ou as propriedades de massa de ${expectedId} estão incompletas.`);
  }
  const supportedFields = new Set(['rocket_mass_kg', 'cg_from_tail_m', 'cg_reference_m', 'inertia_xx_kg_m2', 'inertia_zz_kg_m2', 'grain_density_kg_m3', 'grain_separation_m']);
  const fieldIds = manifest.campos_formulario.map((field) => field.id);
  if (!fieldIds.includes('rocket_mass_kg') || (!fieldIds.includes('cg_from_tail_m') && !fieldIds.includes('cg_reference_m'))) {
    throw new Error(`O manifesto de ${expectedId} precisa declarar massa e centro de gravidade editáveis.`);
  }
  if (rocket.orientacao === 'nose_to_tail' && !fieldIds.includes('cg_reference_m')) throw new Error(`O foguete ${expectedId} deve permitir editar cg_reference_m.`);
  if (rocket.orientacao === 'tail_to_nose' && !fieldIds.includes('cg_from_tail_m')) throw new Error(`O foguete ${expectedId} deve permitir editar cg_from_tail_m.`);
  if (manifest.campos_formulario.some((field) => !supportedFields.has(field.id) || !field.rotulo || !field.unidade || !Number.isFinite(field.valor_inicial))) {
    throw new Error(`O manifesto de ${expectedId} declara um campo de formulário não suportado ou incompleto.`);
  }
  if (!['tail_to_nose', 'nose_to_tail'].includes(String(manifest.foguete.orientacao))) throw new Error(`A orientação do foguete ${expectedId} não é suportada.`);
  const components = rocket.componentes as Array<{ tipo?: string }> | undefined;
  const supportedComponents = new Set(['nose', 'trapezoidal_fins', 'tail', 'rail_buttons']);
  if (!Array.isArray(components) || components.some((component) => !supportedComponents.has(component.tipo ?? ''))) {
    throw new Error(`O manifesto de ${expectedId} contém um componente RocketPy não suportado.`);
  }
  const requiredMotorNumbers = [
    'posicao_m', 'massa_seca_kg', 'tempo_queima_s', 'centro_massa_seco_m', 'numero_graos',
    'densidade_graos_kg_m3', 'raio_externo_grao_m', 'raio_interno_inicial_grao_m',
    'altura_inicial_grao_m', 'separacao_graos_m', 'centro_massa_graos_m', 'posicao_bocal_m',
    'raio_bocal_m', 'raio_garganta_m',
  ];
  const motor = rocket.motor as Record<string, unknown>;
  if (requiredMotorNumbers.some((key) => !Number.isFinite(Number(motor[key])))) throw new Error(`Os parâmetros do motor de ${expectedId} estão incompletos.`);
  if (!Array.isArray(motor.inercia_seca_kg_m2) || motor.inercia_seca_kg_m2.length !== 3 || !motor.inercia_seca_kg_m2.every((item) => Number.isFinite(Number(item)))) {
    throw new Error(`A inércia seca do motor de ${expectedId} precisa ter três valores numéricos.`);
  }
  if (components.some((component) => {
    const numericKeys = component.tipo === 'nose'
      ? ['comprimento_m', 'posicao_m']
      : component.tipo === 'trapezoidal_fins'
        ? ['numero', 'corda_raiz_m', 'corda_ponta_m', 'envergadura_m', 'posicao_m', 'comprimento_enflechamento_m']
        : component.tipo === 'tail'
          ? ['raio_superior_m', 'raio_inferior_m', 'comprimento_m', 'posicao_m']
          : ['posicao_superior_m', 'posicao_inferior_m', 'angulo_deg'];
    return numericKeys.some((key) => !Number.isFinite(Number((component as Record<string, unknown>)[key])));
  })) throw new Error(`Um componente de ${expectedId} tem parâmetros numéricos incompletos.`);
  const recovery = rocket.recuperacao as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(recovery) || recovery.some((item) => !item.nome || !['main', 'drogue'].includes(String(item.tipo)) ||
      !Number.isFinite(Number(item.cd_area_m2)) || Number(item.cd_area_m2) <= 0 || !(item.gatilho === 'apogee' || Number.isFinite(Number(item.gatilho))))) {
    throw new Error(`Os dados de recuperação de ${expectedId} estão incompletos.`);
  }
  if (!Array.isArray(manifest.casos_voo) || manifest.casos_voo.some((flightCase) => !['nominal', 'ballistic', 'main_apogee', 'drogue_only', 'custom'].includes(flightCase))) {
    throw new Error(`O manifesto de ${expectedId} declara casos de voo não suportados.`);
  }
  return manifest;
}

export async function getInstalledRockets(): Promise<InstalledRocket[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    return await requestResult(transaction.objectStore(STORE_NAME).getAll()) as InstalledRocket[];
  } finally {
    database.close();
  }
}

export async function getInstalledRocket(id: string): Promise<InstalledRocket | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    return await requestResult(transaction.objectStore(STORE_NAME).get(id)) as InstalledRocket | undefined ?? null;
  } finally {
    database.close();
  }
}

export async function saveInstalledRocket(rocket: InstalledRocket): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(rocket);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível gravar o pacote.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('O armazenamento do pacote foi cancelado.'));
    });
  } finally {
    database.close();
  }
}

export async function fetchRocketCatalog(): Promise<RocketCatalog> {
  const response = await fetch(`${GITHUB_DATA_ROOT}catalogo.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`GitHub respondeu com HTTP ${response.status} ao consultar o catálogo.`);
  const catalog = await response.json() as RocketCatalog;
  if (catalog.schema_version !== 1 || !Array.isArray(catalog.foguetes)) throw new Error('O catálogo remoto tem formato inválido.');
  const ids = new Set<string>();
  for (const entry of catalog.foguetes) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id) || ids.has(entry.id)) throw new Error(`Id inválido ou duplicado no catálogo: ${entry.id}`);
    ids.add(entry.id);
    safeRelativePath(entry.manifesto);
  }
  return catalog;
}

export async function downloadRocketPackage(entry: RocketCatalogEntry, onProgress?: (done: number, total: number) => void): Promise<InstalledRocket> {
  const manifestPath = safeRelativePath(entry.manifesto);
  const manifestResponse = await fetch(new URL(manifestPath, GITHUB_DATA_ROOT), { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`Não foi possível baixar o manifesto de ${entry.nome} (HTTP ${manifestResponse.status}).`);
  const manifest = validateManifest(await manifestResponse.json(), entry.id);
  if (manifest.versao_dados !== entry.versao_dados || manifest.nome !== entry.nome) {
    throw new Error(`A entrada de ${entry.nome} no catálogo não corresponde ao manifesto. Atualize o catálogo no GitHub.`);
  }

  const filesToDownload = Object.entries(manifest.arquivos)
    .filter(([, filePath]) => Boolean(filePath))
    .map(([key, filePath]) => [key, safeRelativePath(filePath)] as const);
  for (const key of REQUIRED_FILES) {
    if (!filesToDownload.some(([fileKey]) => fileKey === key)) throw new Error(`Arquivo obrigatório ausente no pacote: ${key}`);
  }

  const files: Record<string, Blob> = {};
  let completed = 0;
  for (const [key, filePath] of filesToDownload) {
    const fileUrl = new URL(filePath, manifestResponse.url || new URL(manifestPath, GITHUB_DATA_ROOT));
    const response = await fetch(fileUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Falha ao baixar ${filePath} (HTTP ${response.status}).`);
    const blob = await response.blob();
    if (blob.size > MAX_FILE_BYTES) throw new Error(`${filePath} excede o limite de ${MAX_FILE_BYTES / 1024 / 1024} MB por arquivo.`);
    files[key] = blob;
    completed += 1;
    onProgress?.(completed, filesToDownload.length);
  }

  const installed = { manifest, files, installedAt: new Date().toISOString() };
  await saveInstalledRocket(installed);
  return installed;
}

export function getPackageAsset(packageData: InstalledRocket, key: string): Promise<ArrayBuffer> {
  const file = packageData.files[key];
  if (!file) return Promise.reject(new Error(`O pacote ${packageData.manifest.nome} não contém o arquivo ${key}.`));
  return file.arrayBuffer();
}

export function githubCatalogUrl(): string {
  return `${GITHUB_DATA_ROOT}catalogo.json`;
}
