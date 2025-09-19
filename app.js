// app.js
const cors = require('cors');
const express = require('express');
const fsp = require('fs').promises;
const path = require('path');

const baseDir = path.resolve(__dirname, 'terrain'); // serve tiles from ./terrain
const port = process.env.PORT || 8084;

const app = express();
app.use(cors());

// --- helpers ---------------------------------------------------------------

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return 'application/json';
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

// --- routes ----------------------------------------------------------------

// Simple HTML status page with Sandcastle links
app.get('/', async (req, res, next) => {
  try {
    function formatTerrain(dirent) {
      const code = `const rand = Math.round(Math.random() * 10000); // kill browser cache
const viewer = new Cesium.Viewer("cesiumContainer", {
  requestRenderMode: true,
  terrainProvider: new Cesium.CesiumTerrainProvider({
    url: 'http://localhost:${port}/${dirent.name}?v=' + rand,
    requestVertexNormals: true
  }),
  shadows: true
});
viewer.extend(Cesium.viewerCesiumInspectorMixin);`;

      const html = `<style>
@import url(../templates/bucket.css);
</style>
<div id="cesiumContainer" class="fullSize"></div>
<div id="loadingOverlay"><h1>Loading...</h1></div>
<div id="toolbar"></div>`;

      const data = Buffer.from(JSON.stringify({ code, html })).toString('base64');
      return `<li><a href="https://sandcastle.cesium.com/?code=${data}">${dirent.name}</a></li>`;
    }

    const dirents = await fsp.readdir(baseDir, { withFileTypes: true });
    const subdirs = dirents.filter((it) => it.isDirectory());
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

// JSON API for your axios client
app.get('/api/terrains', async (req, res, next) => {
  try {
    const dirents = await fsp.readdir(baseDir, { withFileTypes: true });
    const data = dirents
      .filter((it) => it.isDirectory())
      .map((it) => ({
        name: it.name,
        url: `http://localhost:${port}/${it.name}`,
      }));
    const terrains = { data }

    console.log(terrains)
    res.json(terrains);

  } catch (err) {
    console.error(err)
    next(err);
  }
});

app.get('/favicon.ico', (req, res) => {
  res.status(404).send();
});

// Serve terrain files (supports nested paths like z/x/y.terrain)
app.get('/:path(*)', async (req, res, next) => {
  try {
    // Build a safe absolute path under baseDir (Windows & POSIX friendly)
    const rel = String(req.params.path || '').split('/').join(path.sep);
    const filename = path.resolve(baseDir, rel);

    // Prevent "../" traversal outside of baseDir
    const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
    if (!filename.startsWith(baseWithSep) && filename !== baseDir) {
      return res.status(400).send('Invalid path');
    }

    // Check existence
    await fsp.access(filename);

    // Detect gzip via magic number (0x1f 0x8b)
    const isGzip = await readMagic(filename, [0x1f, 0x8b]);

    if (isGzip) {
      const buffer = await fsp.readFile(filename);
      res.set({
        'Content-Length': buffer.length,
        'Content-Type': contentTypeFor(filename),
        'Content-Encoding': 'gzip',
      });
      return res.status(200).send(buffer);
    }

    // Not gzipped: still set appropriate content-type
    return res.sendFile(filename, {
      headers: { 'Content-Type': contentTypeFor(filename) },
    });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).send('Not found');
    return next(e);
  }
});

// Basic error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (!res.headersSent) {
    res.status(500).send('Server error');
  }
});

// Start server
app.listen(port, () => {
  console.log(`Terrain server running on http://localhost:${port}`);
});
