import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogRoot = path.resolve(projectRoot, 'foguetes');
const previousCatalogPath = path.join(catalogRoot, 'catalogo.json');
const previousCatalog = JSON.parse(await readFile(previousCatalogPath, 'utf8'));
const previousVersions = new Map((previousCatalog.foguetes ?? []).map((entry) => [entry.id, entry.versao_dados]));
const entries = [];

for (const folder of await readdir(catalogRoot, { withFileTypes: true })) {
  if (!folder.isDirectory()) continue;
  const manifestPath = path.join(catalogRoot, folder.name, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw new Error(`${folder.name}/manifest.json não contém JSON válido: ${error.message}`);
  }
  if (manifest.id !== folder.name) throw new Error(`${folder.name}/manifest.json: o campo id deve ser '${folder.name}'.`);
  if (!manifest.nome || !manifest.versao_dados) throw new Error(`${folder.name}/manifest.json: nome e versao_dados são obrigatórios.`);
  if (previousVersions.has(folder.name) && previousVersions.get(folder.name) !== manifest.versao_dados) {
    console.warn(`${folder.name}: versão dos dados alterada de ${previousVersions.get(folder.name)} para ${manifest.versao_dados}.`);
  }
  entries.push({
    id: manifest.id,
    nome: manifest.nome,
    versao_dados: manifest.versao_dados,
    manifesto: `${folder.name}/manifest.json`,
  });
}

entries.sort((a, b) => a.id.localeCompare(b.id));
if (!entries.length) throw new Error('Nenhum manifesto válido foi encontrado em foguetes/.');

await writeFile(previousCatalogPath, `${JSON.stringify({ schema_version: 1, foguetes: entries }, null, 2)}\n`, 'utf8');
console.log(`Catálogo oficial atualizado com ${entries.length} foguetes: ${previousCatalogPath}`);

