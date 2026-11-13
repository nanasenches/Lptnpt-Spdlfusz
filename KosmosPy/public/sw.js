const CACHE_NAME = 'rocket-console-offline-v15';
const READY_MARKER = '/__rocket_console_offline_ready__';
const MAP_ASSET_MANIFEST = '/map-offline-assets.json';
const SATELLITE_ORIGIN = 'https://tiles.maps.eox.at';
const SATELLITE_PATH_PREFIX = '/wmts/1.0.0/s2cloudless-2025_3857/';
const TERRAIN_ORIGIN = 'https://s3.amazonaws.com';
const TERRAIN_PATH_PREFIX = '/elevation-tiles-prod/terrarium/';
const OFFLINE_MAP_RADIUS_KM = 10;

const OFFLINE_ASSETS = [
  '/',
  '/favicon.png',
  '/branding/kosmos-logo.png',
  '/icons/mari-192.png',
  '/icons/mari-512.png',
  '/manifest.webmanifest',
  '/app-version.json',
  '/sw.js',
  '/trajectory-map.html',
  '/models/deimos-ii.glb',
  '/models/deimos-ii-body.glb',
  '/models/deimos-ii-nose.glb',
  '/models/atlas.glb',
  '/models/atlas-body.glb',
  '/models/atlas-nose.glb',
  MAP_ASSET_MANIFEST,
  '/simulation/worker.js',
  '/simulation/deimos_core.py',
  '/simulation/FAISCABATES.eng',
  '/simulation/CD_Off_RASAero.csv',
  '/simulation/CD_On_RASAero.csv',
  '/simulation/Mission7Motor.eng',
  '/simulation/Atlas_CD_OR_off.csv',
  '/simulation/Atlas_CD_OR_on.csv',
  '/foguetes/catalogo.json',
  '/foguetes/atlas/manifest.json',
  '/foguetes/atlas/empuxo.eng',
  '/foguetes/atlas/arrasto_on.csv',
  '/foguetes/atlas/arrasto_off.csv',
  '/foguetes/deimos-ii/manifest.json',
  '/foguetes/deimos-ii/empuxo.eng',
  '/foguetes/deimos-ii/arrasto_on.csv',
  '/foguetes/deimos-ii/arrasto_off.csv',
  '/pyodide/certifi-2026.4.22-py3-none-any.whl',
  '/pyodide/cftime-1.6.5-cp314-cp314-pyemscripten_2026_0_wasm32.whl',
  '/pyodide/charset_normalizer-3.4.7-py3-none-any.whl',
  '/pyodide/contourpy-1.3.3-cp314-cp314-pyemscripten_2026_0_wasm32.whl',
  '/pyodide/cycler-0.12.1-py3-none-any.whl',
  '/pyodide/dill-0.4.1-py3-none-any.whl',
  '/pyodide/fonttools-4.62.1-py3-none-any.whl',
  '/pyodide/idna-3.11-py3-none-any.whl',
  '/pyodide/kiwisolver-1.5.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl',
  '/pyodide/matplotlib-3.10.8-cp314-cp314-pyemscripten_2026_0_wasm32.whl',
  '/pyodide/micropip-0.11.1-py3-none-any.whl',
  '/pyodide/netcdf4-1.7.4-cp314-cp314-pyemscripten_2026_0_wasm32.whl',
  '/pyodide/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl',
  '/pyodide/packaging-26.1-py3-none-any.whl',
  '/pyodide/pillow-12.2.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl',
  '/pyodide/pyodide-lock.json',
  '/pyodide/pyodide.asm.mjs',
  '/pyodide/pyodide.asm.wasm',
  '/pyodide/pyodide.mjs',
  '/pyodide/pyparsing-3.3.2-py3-none-any.whl',
  '/pyodide/python_dateutil-2.9.0.post0-py2.py3-none-any.whl',
  '/pyodide/python_stdlib.zip',
  '/pyodide/pytz-2026.1.post1-py2.py3-none-any.whl',
  '/pyodide/requests-2.33.1-py3-none-any.whl',
  '/pyodide/rocketpy-1.13.0-py3-none-any.whl',
  '/pyodide/scipy-1.18.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl',
  '/pyodide/simplekml-1.3.5-py3-none-any.whl',
  '/pyodide/six-1.17.0-py2.py3-none-any.whl',
  '/pyodide/urllib3-2.6.3-py3-none-any.whl',
];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith('rocket-console-offline-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

async function broadcast(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) client.postMessage(message);
}

function appAssetsFromHtml(html) {
  const assets = new Set();
  const attributePattern = /(?:src|href)=["']([^"']+)["']/g;
  for (const match of html.matchAll(attributePattern)) {
    try {
      const url = new URL(match[1], self.location.origin);
      if (url.origin === self.location.origin && !url.pathname.startsWith('/api/')) {
        assets.add(`${url.pathname}${url.search}`);
      }
    } catch {
      // Ignore malformed or non-URL attributes.
    }
  }
  return [...assets];
}

async function fetchAndCache(cache, asset) {
  const url = new URL(asset, self.location.origin);
  const response = await fetch(url, {
    cache: 'reload',
    credentials: url.origin === self.location.origin ? 'same-origin' : 'omit',
  });
  if (!response.ok) throw new Error(`${url.pathname} respondeu com HTTP ${response.status}`);
  await cache.put(url.toString(), response.clone());
  return response;
}

function isCacheableMapUrl(url) {
  return (
    (url.origin === SATELLITE_ORIGIN && url.pathname.startsWith(SATELLITE_PATH_PREFIX)) ||
    (url.origin === TERRAIN_ORIGIN && url.pathname.startsWith(TERRAIN_PATH_PREFIX))
  );
}

function tileAt(longitude, latitude, level) {
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const count = 2 ** level;
  const x = Math.floor(((longitude + 180) / 360) * count);
  const latitudeRadians = boundedLatitude * Math.PI / 180;
  const y = Math.floor(
    ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * count,
  );
  return {
    x: Math.max(0, Math.min(count - 1, x)),
    y: Math.max(0, Math.min(count - 1, y)),
  };
}

function addTileArea(target, center, minimumLevel, maximumLevel, urlForTile) {
  const latitudeRadians = center.latitude * Math.PI / 180;
  for (let level = 0; level <= maximumLevel; level += 1) {
    const tile = tileAt(center.longitude, center.latitude, level);
    if (level < minimumLevel) {
      target.add(urlForTile(level, tile.x, tile.y));
      continue;
    }

    const tileWidthKm = (40075.016686 * Math.cos(latitudeRadians)) / (2 ** level);
    const radiusInTiles = Math.max(1, Math.ceil(OFFLINE_MAP_RADIUS_KM / tileWidthKm));
    const count = 2 ** level;
    for (let offsetX = -radiusInTiles; offsetX <= radiusInTiles; offsetX += 1) {
      for (let offsetY = -radiusInTiles; offsetY <= radiusInTiles; offsetY += 1) {
        const x = tile.x + offsetX;
        const y = tile.y + offsetY;
        if (x < 0 || x >= count || y < 0 || y >= count) continue;
        target.add(urlForTile(level, x, y));
      }
    }
  }
}

function offlineMapAssets(centers = []) {
  const assets = new Set();
  for (const center of centers) {
    if (!Number.isFinite(center?.latitude) || !Number.isFinite(center?.longitude)) continue;
    addTileArea(
      assets,
      center,
      10,
      14,
      (level, x, y) =>
        `${SATELLITE_ORIGIN}${SATELLITE_PATH_PREFIX}default/g/${level}/${y}/${x}.jpg`,
    );
    addTileArea(
      assets,
      center,
      9,
      13,
      (level, x, y) =>
        `${TERRAIN_ORIGIN}${TERRAIN_PATH_PREFIX}${level}/${x}/${y}.png`,
    );
  }
  return [...assets];
}

async function cacheAssetBatch(cache, assets, initialCompleted, total) {
  let cursor = 0;
  let completed = initialCompleted;
  const workers = Array.from({ length: 6 }, async () => {
    while (cursor < assets.length) {
      const assetIndex = cursor;
      cursor += 1;
      const asset = assets[assetIndex];
      await fetchAndCache(cache, asset);
      completed += 1;
      await broadcast({
        type: 'OFFLINE_PROGRESS',
        completed,
        total,
        message: asset.includes('/s2cloudless-')
          ? 'Salvando imagens de satélite da área...'
          : asset.includes('/terrarium/')
            ? 'Salvando o relevo 3D da área...'
            : asset.startsWith('/pyodide/')
              ? 'Salvando o motor científico...'
              : asset.startsWith('/cesium/')
                ? 'Salvando o visualizador 3D...'
                : 'Salvando arquivos do aplicativo...',
      });
    }
  });
  await Promise.all(workers);
  return completed;
}

async function prepareOffline(runtimeAssets = [], mapCenters = []) {
  const cache = await caches.open(CACHE_NAME);
  const assets = new Set([
    ...OFFLINE_ASSETS,
    ...runtimeAssets.filter((asset) => {
      try {
        const url = new URL(asset, self.location.origin);
        return url.origin === self.location.origin && !url.pathname.startsWith('/api/');
      } catch {
        return false;
      }
    }),
  ]);

  const rootResponse = await fetchAndCache(cache, '/');
  const rootHtml = await rootResponse.text();
  for (const asset of appAssetsFromHtml(rootHtml)) assets.add(asset);
  assets.delete('/');

  const mapManifestResponse = await fetchAndCache(cache, MAP_ASSET_MANIFEST);
  const mapManifest = await mapManifestResponse.json();
  for (const asset of mapManifest.assets ?? []) assets.add(asset);
  assets.delete(MAP_ASSET_MANIFEST);

  const mapAssets = offlineMapAssets(mapCenters);
  for (const asset of mapAssets) assets.add(asset);

  const assetList = [...assets];
  let completed = 2;
  const total = assetList.length + completed;
  await broadcast({
    type: 'OFFLINE_PROGRESS',
    completed,
    total,
    message: 'Salvando o aplicativo...',
  });

  completed = await cacheAssetBatch(cache, assetList, completed, total);

  await cache.put(
    new Request(new URL(READY_MARKER, self.location.origin).toString()),
    new Response(JSON.stringify({
      preparedAt: new Date().toISOString(),
      mapCenters,
      mapRadiusKm: OFFLINE_MAP_RADIUS_KM,
      cachedAssets: completed,
    }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  await broadcast({ type: 'OFFLINE_READY', preparedAt: new Date().toISOString() });
}

async function reportStatus() {
  const cache = await caches.open(CACHE_NAME);
  const marker = await cache.match(new URL(READY_MARKER, self.location.origin).toString());
  await broadcast({ type: 'OFFLINE_STATUS', ready: Boolean(marker) });
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CHECK_OFFLINE_STATUS') {
    event.waitUntil(reportStatus());
  }
  if (event.data?.type === 'PREPARE_OFFLINE') {
    event.waitUntil(
      prepareOffline(event.data.runtimeAssets ?? [], event.data.mapCenters ?? []).catch(async (error) => {
        await broadcast({
          type: 'OFFLINE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        });
      }),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const mapRequest = isCacheableMapUrl(url);
  if (url.origin !== self.location.origin && !mapRequest) return;

  event.respondWith((async () => {
    const networkFirst =
      request.mode === 'navigate' ||
      url.pathname === '/simulation/worker.js' ||
      url.pathname === '/simulation/deimos_core.py';

    if (!networkFirst || mapRequest) {
      const cached = await caches.match(request);
      if (cached) return cached;
    }

    try {
      const response = await fetch(request, { cache: networkFirst ? 'no-cache' : 'default' });
      if (response.ok || response.type === 'opaque') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const cache = await caches.open(CACHE_NAME);
        const shell = await cache.match('/');
        if (shell) return shell;
      }
      throw error;
    }
  })());
});
