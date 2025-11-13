// app.js
const cors = require('cors');
const express = require('express');
const fsp = require('fs').promises;
const path = require('path');
const zlib = require('zlib');

const baseDir = path.resolve(process.env.TERRAIN_DIR || __dirname, 'terrain'); // change if needed
const port = process.env.PORT || 8084;

const app = express();
app.use(cors());

// ------------------------- helpers -----------------------------------------

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json' || ext === '.geojson') return 'application/json';
  if (ext === '.terrain') return 'application/vnd.quantized-mesh';
  return 'application/octet-stream';
}

async function readMagic(filename, patternToCheck) {
  const length = patternToCheck ? patternToCheck.length : 4;
  const buffer = Buffer.alloc(length);

  const fd = await fsp.open(filename);
  try {
    await fd.read({ buffer, length, position: 0 });
  } finally {
    await fd.close();
  }

  if (patternToCheck) {
    return patternToCheck.every((c, i) => buffer[i] === c);
  }
  return buffer;
}

function getBaseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${port}`)
    .split(',')[0].trim();
  return `${proto}://${host}`;
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function readLayerJson(dirPath) {
  const jsonPath = path.join(dirPath, 'layer.json');
  const gzPath   = path.join(dirPath, 'layer.json.gz');

  if (await exists(jsonPath)) {
    const buf = await fsp.readFile(jsonPath);
    return JSON.parse(buf.toString('utf8'));
  }
  if (await exists(gzPath)) {
    const gz = await fsp.readFile(gzPath);
    const raw = await new Promise((resolve, reject) =>
      zlib.gunzip(gz, (err, out) => (err ? reject(err) : resolve(out)))
    );
    return JSON.parse(raw.toString('utf8'));
  }
  return null;
}

function extractAvailableLevels(meta) {
  if (!meta) return [];
  const a = meta.available;

  // [0,1,2,...]
  if (Array.isArray(a) && (a.length === 0 || typeof a[0] === 'number')) return a;

  // [{level:0}, {level:1}, ...]
  if (Array.isArray(a) && a.length && typeof a[0] === 'object' && 'level' in a[0]) {
    return [...new Set(a.map(x => x.level))].sort((x, y) => x - y);
  }

  // Fallbacks
  if (typeof meta.maxzoom === 'number') {
    return Array.from({ length: meta.maxzoom + 1 }, (_, i) => i);
  }
  if (typeof meta.maxZoom === 'number') {
    return Array.from({ length: meta.maxZoom + 1 }, (_, i) => i);
  }
  return [];
}

// -------------------------- routes -----------------------------------------

// Index: list available terrain folders with Sandcastle links
app.get('/', async (req, res, next) => {
  try {
    const base = getBaseUrl(req);
    function formatTerrain(dirent) {
      const code = `const rand = Math.round(Math.random() * 10000);
const viewer = new Cesium.Viewer("cesiumContainer", {
  requestRenderMode: true,
  terrainProvider: new Cesium.CesiumTerrainProvider({
    url: '${base}/${dirent.name}?v=' + rand,
    requestVertexNormals: true
  }),
  shadows: true
});
viewer.extend(Cesium.viewerCesiumInspectorMixin);`;

      const html = `<style>@import url(../templates/bucket.css);</style>
<div id="cesiumContainer" class="fullSize"></div>
<div id="loadingOverlay"><h1>Loading...</h1></div>
<div id="toolbar"></div>`;

      const data = Buffer.from(JSON.stringify({ code, html })).toString('base64');
      return `<li><a href="https://sandcastle.cesium.com/?code=${data}">${dirent.name}</a></li>`;
    }

    const dirents = await fsp.readdir(baseDir, { withFileTypes: true });
    const subdirs = dirents.filter(d => d.isDirectory());

    res.send(`<!doctype html>
<h1>Status</h1>
<h2>Available terrain</h2>
Base directory: <code>${baseDir}</code>
<ul>
${subdirs.map(formatTerrain).join('\n')}
</ul>`);
  } catch (err) {
    next(err);
  }
});

// JSON API: list terrains with metadata from layer.json
app.get('/api/terrains', async (req, res, next) => {
  try {
    const base = getBaseUrl(req);
    const dirents = await fsp.readdir(baseDir, { withFileTypes: true });

    const items = [];
    for (const d of dirents) {
      if (!d.isDirectory()) continue;
      const dirPath = path.join(baseDir, d.name);
      const meta = (await readLayerJson(dirPath)) || {};

      items.push({
        name: d.name,
        url: `${base}/${d.name}`,
        format: meta.format || 'quantized-mesh-1.0',
        version: meta.version || meta.tilejson || '',
        available: extractAvailableLevels(meta), // array (safe for your formatter)
      });
    }

    // Optional server-side filter by ?county= substring
    const { county } = req.query;
    const out = county ? items.filter(t => t.url.includes(county)) : items;

    res.json(out);
  } catch (err) {
    console.error('[GET /api/terrains]', err);
    res.status(500).json([]); // safe shape for client
  }
});

app.get('/favicon.ico', (req, res) => res.status(404).send());

// Serve terrain files (supports nested paths like folder/z/x/y.terrain)
app.get('/:path(*)', async (req, res, next) => {
  try {
    const rel = String(req.params.path || '').split('/').join(path.sep);
    const filename = path.resolve(baseDir, rel);

    // Prevent traversal
    const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
    if (!filename.startsWith(baseWithSep) && filename !== baseDir) {
      return res.status(400).send('Invalid path');
    }

    await fsp.access(filename);

    // If file is gzipped (magic 0x1f,0x8b), set Content-Encoding
    const isGzip = await readMagic(filename, [0x1f, 0x8b]);
    if (isGzip) {
      const buffer = await fsp.readFile(filename);
      res.set({
        'Content-Length': buffer.length,
        'Content-Type': contentTypeFor(filename.replace(/\.gz$/i, '')),
        'Content-Encoding': 'gzip',
      });
      return res.status(200).send(buffer);
    }

    // Not gz: still set a sensible content-type
    return res.sendFile(filename, {
      headers: { 'Content-Type': contentTypeFor(filename) },
    });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).send('Not found');
    return next(e);
  }
});

// -------------------------- errors & start ---------------------------------

app.use((err, req, res, next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).send('Server error');
});

app.listen(port, () => {
  console.log(`Terrain server running on http://localhost:${port}`);
});
