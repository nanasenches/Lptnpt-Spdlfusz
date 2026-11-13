import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publishedCatalog = path.join(projectRoot, 'foguetes');
const bundledCatalog = path.join(projectRoot, 'public', 'foguetes');

await mkdir(bundledCatalog, { recursive: true });
await cp(publishedCatalog, bundledCatalog, { recursive: true, force: true });
console.log('Catálogo público sincronizado com os dados offline do aplicativo.');
