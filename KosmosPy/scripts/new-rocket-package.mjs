import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogRoot = path.resolve(projectRoot, 'foguetes');
const [id, ...rest] = process.argv.slice(2);
const fromArgument = rest.find((arg) => arg.startsWith('--from='));
const sourceId = fromArgument?.slice('--from='.length) ?? 'deimos-ii';
const name = rest.filter((arg) => !arg.startsWith('--from='))[0];

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id ?? '')) {
  throw new Error('Uso: pnpm rocket:new -- <id-em-minusculas> "Nome do foguete" [--from=atlas|deimos-ii]');
}
if (!name?.trim()) throw new Error('Informe o nome que aparecerá no aplicativo.');
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sourceId)) throw new Error('O modelo base precisa ser o id de uma pasta de foguete existente.');

const destination = path.join(catalogRoot, id);
const source = path.join(catalogRoot, sourceId);
if (id === sourceId) throw new Error('O id novo deve ser diferente do foguete usado como modelo.');
try {
  await readFile(path.join(destination, 'manifest.json'));
  throw new Error(`A pasta foguetes/${id} já existe.`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

await cp(source, destination, { recursive: true, errorOnExist: true });
const manifestPath = path.join(destination, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.id = id;
manifest.nome = name.trim();
manifest.versao_dados = '0.1.0';
manifest.descricao = 'PREENCHER: descreva a configuração e a origem dos dados.';
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const catalogPath = path.join(catalogRoot, 'catalogo.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
catalog.foguetes = [...catalog.foguetes, {
  id,
  nome: manifest.nome,
  versao_dados: manifest.versao_dados,
  manifesto: `${id}/manifest.json`,
}].sort((a, b) => a.id.localeCompare(b.id));
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

console.log(`Pasta criada em foguetes/${id}.`);
console.log(`Ela herdou parâmetros e arquivos de '${sourceId}'. Atualize todos os dados físicos, campos do formulário e arquivos antes de usar em uma simulação.`);
console.log('Quando terminar, execute: pnpm rocket:validate');
