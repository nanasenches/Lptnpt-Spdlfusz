import { access, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const serviceWorker = await readFile(resolve(root, 'public', 'sw.js'), 'utf8');
const manifest = serviceWorker.match(/const OFFLINE_ASSETS = \[([\s\S]*?)\];/);
if (!manifest) throw new Error('A lista OFFLINE_ASSETS não foi encontrada.');

const assets = [...manifest[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
const fileAssets = assets.filter((asset) => asset !== '/');
let totalBytes = 0;
for (const asset of fileAssets) {
  const path = resolve(root, 'public', asset.replace(/^\//, ''));
  await access(path);
  totalBytes += (await stat(path)).size;
}

console.log(JSON.stringify({
  asset_count: assets.length,
  local_file_count: fileAssets.length,
  package_size_mb: Number((totalBytes / 1024 / 1024).toFixed(2)),
}, null, 2));
