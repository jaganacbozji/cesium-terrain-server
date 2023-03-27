const cors = require('cors')
const express = require('express')
const fsp = require('fs').promises
const path = require('path')

const baseDir = `${__dirname}/terrain`
const port = process.env.PORT || 8084

const app = express()
app.use(cors())

readMagic = async(filename, patternToCheck) =>{
  const length = patternToCheck ? patternToCheck.length : 4
  const buffer = Buffer.alloc(length)
  const fd = await fsp.open(filename)
  await fd.read({ buffer, length })
  await fd.close()
  if (patternToCheck) {
    return patternToCheck.every((c, i) => buffer[i] == c)
  }
  return buffer
}

app.get('/', async (req, res) => {
  formatTerrain = (dirent) => {
    const code = `const rand = Math.round(Math.random() * 10000); // kill browser cache
    const viewer = new Cesium.Viewer("cesiumContainer", {
    requestRenderMode : true,
    terrainProvider : new Cesium.CesiumTerrainProvider({
      url : 'http://localhost:${port}/${dirent.name}?v=' + rand,
      requestVertexNormals : true
    }),
    shadows: true,
    });
    viewer.extend(Cesium.viewerCesiumInspectorMixin);`
    const html = `<style>
    @import url(../templates/bucket.css);
    </style>
    <div id="cesiumContainer" class="fullSize"></div>
    <div id="loadingOverlay"><h1>Loading...</h1></div>
    <div id="toolbar"></div>`
    const data = btoa(JSON.stringify({ code, html }))
    return `<li><a href="https://sandcastle.cesium.com/?code=${data}">${dirent.name}</a></li>`
  }
  const subdirs = (await fsp.readdir(baseDir, { 'withFileTypes': true })).filter(it => it.isDirectory())
  res.send(`<!doctype html><h1>Status</h1>
  <h2>Available terrain</h2>
  Base directory: <code>${baseDir}</code>
  <ul>
  ${subdirs.map(formatTerrain).join('\n')}
  </ul>
  `)
});

app.get('/favicon.ico', (req, res) => {
  res.status(404).send()
})

app.get('/:path(*)', async (req, res, next) => {
  const filename = (`${baseDir}/${req.params.path}`.replaceAll('/', path.sep))
  try {
    if (await readMagic(filename, [0x1f, 0x8b])) {
      // is gzipped already
      const buffer = await fsp.readFile(filename)
      res.set({
        'Content-Length': buffer.length,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'gzip',
      })
      res.status(200).send(buffer)
    } else {
      res.sendFile(filename)
    }
  } catch (e) {
    next(e)
  }
});

app.listen(port)
console.log(`Terrain server running on http://localhost:${port}`)
