# Cesium Terrain Server

Simple server for [Cesium](https://cesiumjs.org) [Quantized Mesh](https://github.com/CesiumGS/quantized-mesh).
Does pretty much the same as [geo-data/cesium-terrain-server](https://github.com/geo-data/cesium-terrain-server) but does not require Go and is way simpler to setup in general.

This app is intended for local development.
If you need a production terrain server, you will certainly need to modify the code.

## install

Create a directory (or a symlink) called `terrain` within the source directory and add some terrain there.

Then, run `npm install`

## start

Run `npm start`

Then, go to [localhost:8084](http://localhost:8084) and pick a terrain you want to preview in Sandcastle.

## configuration

If you need to run the server on a different port, set the `PORT` environment.
For example: `PORT=8080 npm start`

If you need something more sophisticated, just edit the source code.
