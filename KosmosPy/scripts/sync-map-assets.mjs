import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cesiumSource = path.join(projectRoot, 'node_modules', 'cesium', 'Build', 'Cesium');
const cesiumTarget = path.join(projectRoot, 'public', 'cesium');
const manifestTarget = path.join(projectRoot, 'public', 'map-offline-assets.json');

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(`/cesium/${relativePath}`);
    }
  }
  return files;
}

await rm(cesiumTarget, { recursive: true, force: true });
await mkdir(path.dirname(cesiumTarget), { recursive: true });
await cp(cesiumSource, cesiumTarget, { recursive: true });

const assets = (await listFiles(cesiumTarget)).sort();
await writeFile(manifestTarget, `${JSON.stringify({ assets }, null, 2)}\n`);

console.log(`Cesium preparado para uso offline: ${assets.length} arquivos.`);
