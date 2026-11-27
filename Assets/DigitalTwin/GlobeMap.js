// Map of the globe of Generation > Digital twin: any window of longitude and latitude drawn on a canvas, at any
// resolution, in equirectangular projection (as the texture of the globe and the tiles below):
//  - the ocean, dark gray, under
//  - the significant wave height of Copernicus Marine (DigitalTwinData.waveTileUrl), painted with VISOC's colours,
//    grown a few pixels into the gaps between its coast (1/12°) and the land drawn above
//  - the land: the land mask of OpenStreetMap (OSM_Land_Mask, NASA GIBS, open to any website, no key, down to 250 m),
//    dark gray, with a light coastline
//  - a graticule every 30°.
// The whole world once (BASE: the texture of the globe), and the part in view at 2 or 4 times its resolution when the
// camera comes close (Globe.js).

import { waveTileUrl, WAVE_TILE_PX, grayToMetres, waveColor, waveTimeOf } from './DigitalTwinData.js';

export const MAP_COLORS = {
  ocean: '#2a2d32',                  // Without wave data (sea ice, or not loaded)
  land: '#3d4045',
  coast: 'rgba(255, 255, 255, 0.45)',
  graticule: 'rgba(255, 255, 255, 0.10)',
};
const COAST_PX = 1.4;     // Width of the coastline, in pixels of the map
const GRATICULE_DEG = 30;

// Land mask: EPSG:4326 tiles of 512 px; level z: 288 / 2^z degrees each, from 180° W, 90° N (level 3: 36°, 14 px/°)
const GIBS_LAND = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/OSM_Land_Mask/default/250m/';
const LAND_TILE_PX = 512;
const LAND_LEVELS = [3, 8];
const landTileDeg = z => 288 / 2 ** z;
const waveTileDeg = z => 180 / 2 ** z;

// The whole world: 4096 x 2048 (11.4 px/°), waves of level 2 (5.7 px/°: smooth, 32 tiles), land of level 3
export const BASE_WIDTH = 4096;
export const BASE_PX_PER_DEG = BASE_WIDTH / 360;
const BASE_WAVE_LEVEL = 2;
// Closer: waves of level 3 (11.4 px/°, about the grid of the model, 1/12°: more would only show its cells)
export const DETAIL_WAVE_LEVEL = 3;

// Lowest land level with at least this resolution (px/°)
export function landLevelFor(pxPerDeg) {
  for (let z = LAND_LEVELS[0]; z <= LAND_LEVELS[1]; z++) if (LAND_TILE_PX / landTileDeg(z) >= pxPerDeg * 0.9) return z;
  return LAND_LEVELS[1];
}


// RENDER A REGION: {west, north, lonSpan, latSpan (degrees; west may pass 180° E: the map wraps round), pxPerDeg}.
// Returns at once {canvas, region, ready, done, cancel()}: the canvas is drawn as the tiles come (onUpdate(canvas),
// at most every UPDATE_MS); ready: once the land is in (a detail is not shown before), done: once everything is.
const UPDATE_MS = 150;
export function renderRegion(region, { time = waveTimeOf(), waveLevel = DETAIL_WAVE_LEVEL, landLevel = landLevelFor(region.pxPerDeg),
  onUpdate = null } = {}) {
  const W = Math.max(1, Math.round(region.lonSpan * region.pxPerDeg)), H = Math.max(1, Math.round(region.latSpan * region.pxPerDeg));
  const canvas = newCanvas(W, H);
  const state = { cancelled: false, land: null, waves: null, timer: null };

  const draw = () => {
    clearTimeout(state.timer); state.timer = null;
    if (state.cancelled) return;
    compose(canvas, region, state.waves, state.land);
    if (onUpdate) onUpdate(canvas);
  };
  const drawSoon = () => { if (!state.timer && !state.cancelled) state.timer = setTimeout(draw, UPDATE_MS); };

  state.waves = waveLayer(region, waveLevel, time, state, drawSoon);
  const land = landLayer(region, W, H, landLevel, state).then(layer => { state.land = layer; draw(); });
  compose(canvas, region, null, null); // The ocean, at once (no onUpdate: the caller has not got the job yet)

  const ready = land.catch(e => { console.warn(e); draw(); });
  const done = Promise.allSettled([land, state.waves.done]).then(([l, w]) => {
    draw();
    if (l.status == 'rejected' && w.status == 'rejected') throw new Error('Could not load the map (wave heights and land)');
    if (w.status == 'rejected') throw w.reason;
    return canvas;
  });
  return { canvas, region, ready, done, cancel() { state.cancelled = true; clearTimeout(state.timer); } };
}

// The whole world for the time of now, once for every globe that asks (the panel can close and open again):
// {job (renderRegion), time, off()}. onUpdate(canvas) as it is drawn, at once with what is already there. Again when the
// 3-hourly field of now changes, or after a failure.
let base = null;
export function baseMapNow(onUpdate) {
  const time = waveTimeOf();
  if (!base || base.failed || (+base.time != +time && !base.loading)) {
    const b = base = { time, listeners: new Set(), drawn: false, loading: true, failed: false };
    b.job = renderRegion({ west: -180, north: 90, lonSpan: 360, latSpan: 180, pxPerDeg: BASE_PX_PER_DEG },
      { time, waveLevel: BASE_WAVE_LEVEL, landLevel: LAND_LEVELS[0], onUpdate: canvas => {
        b.drawn = true;
        b.listeners.forEach(f => f(canvas));
      } });
    b.job.done.then(() => { b.loading = false; }, () => { b.loading = false; b.failed = true; });
  }
  const b = base;
  if (onUpdate) {
    b.listeners.add(onUpdate);
    if (b.drawn) onUpdate(b.job.canvas);
  }
  return { job: b.job, time: b.time, off: () => b.listeners.delete(onUpdate) };
}


// TILES of a grid over a region: [{row, col, west, north}], west in the frame of the region (may pass 180° E: col wraps)
function tilesOver(region, tileDeg, cols, rows) {
  const tiles = [];
  const south = region.north - region.latSpan;
  const r0 = Math.max(0, Math.floor((90 - region.north) / tileDeg)), r1 = Math.min(rows - 1, Math.ceil((90 - south) / tileDeg) - 1);
  const k0 = Math.floor((region.west + 180) / tileDeg), k1 = Math.ceil((region.west + region.lonSpan + 180) / tileDeg) - 1;
  for (let row = r0; row <= r1; row++) for (let k = k0; k <= k1; k++)
    tiles.push({ row, col: ((k % cols) + cols) % cols, k, west: k * tileDeg - 180, north: 90 - row * tileDeg });
  return tiles;
}

// LAND: the mask of every tile, scaled to the region, then a coastline (the mask grown by COAST_PX) under the land
async function landLayer(region, W, H, z, state) {
  const deg = landTileDeg(z), cols = Math.round(360 / deg), rows = Math.ceil(180 / deg), p = region.pxPerDeg;
  const mask = newCanvas(W, H), mc = mask.getContext('2d');
  mc.imageSmoothingQuality = 'high';
  const tiles = tilesOver(region, deg, cols, rows);
  const results = await Promise.allSettled(tiles.map(t => loadImage(`${GIBS_LAND}${z}/${t.row}/${t.col}.png`).then(img => {
    if (state.cancelled) return;
    // Whole pixels at both edges, so that neighbouring tiles meet without a seam
    const x0 = Math.round((t.west - region.west) * p), x1 = Math.round((t.west + deg - region.west) * p);
    const y0 = Math.round((region.north - t.north) * p), y1 = Math.round((region.north - t.north + deg) * p);
    mc.drawImage(img, x0, y0, x1 - x0, y1 - y0);
  })));
  if (state.cancelled) throw new Error('cancelled');
  const failed = results.filter(r => r.status == 'rejected').length;
  if (failed == tiles.length) throw new Error('Could not load the land of the map (NASA GIBS)');
  if (failed) console.warn(failed + ' of ' + tiles.length + ' land tiles could not be loaded');

  const layer = newCanvas(W, H), lc = layer.getContext('2d');
  for (const [dx, dy] of OFFSETS_8) lc.drawImage(mask, dx * COAST_PX, dy * COAST_PX);
  lc.globalCompositeOperation = 'source-in';
  lc.fillStyle = MAP_COLORS.coast; lc.fillRect(0, 0, W, H);
  mc.globalCompositeOperation = 'source-in';
  mc.fillStyle = MAP_COLORS.land; mc.fillRect(0, 0, W, H);
  lc.globalCompositeOperation = 'source-over';
  lc.drawImage(mask, 0, 0);
  mask.width = mask.height = 0; // Free it
  return layer;
}

// WAVES: the painted tiles at their own resolution, on a canvas over the tiles: {canvas, filled, west, north, lonSpan,
// latSpan, done}. filled: the same grown into the gaps along the coast (dilate)
function waveLayer(region, z, time, state, onTile) {
  const deg = waveTileDeg(z), cols = 2 ** (z + 1), rows = 2 ** z, px = WAVE_TILE_PX;
  const tiles = tilesOver(region, deg, cols, rows);
  const kMin = Math.min(...tiles.map(t => t.k)), rMin = Math.min(...tiles.map(t => t.row));
  const nk = Math.max(...tiles.map(t => t.k)) - kMin + 1, nr = Math.max(...tiles.map(t => t.row)) - rMin + 1;
  const layer = { canvas: newCanvas(nk * px, nr * px), filled: newCanvas(nk * px, nr * px),
    west: kMin * deg - 180, north: 90 - rMin * deg, lonSpan: nk * deg, latSpan: nr * deg, dirty: false };
  const ctx = layer.canvas.getContext('2d');
  const jobs = tiles.map(t => paintedWaveTile(z, t.row, t.col, time).then(tile => {
    if (state.cancelled) return;
    ctx.drawImage(tile, (t.k - kMin) * px, (t.row - rMin) * px);
    layer.dirty = true;
    onTile();
  }));
  layer.done = Promise.allSettled(jobs).then(results => {
    const failed = results.filter(r => r.status == 'rejected').length;
    if (failed == jobs.length) throw new Error('Could not load the wave heights from Copernicus Marine');
    if (failed) console.warn(failed + ' of ' + jobs.length + ' wave height tiles could not be loaded');
  });
  return layer;
}

// A grey tile turned into metres and painted; transparent on land
async function paintedWaveTile(z, row, col, time) {
  const [img, toMetres] = await Promise.all([loadImage(waveTileUrl(z, row, col, time)), grayToMetres()]);
  const c = newCanvas(WAVE_TILE_PX, WAVE_TILE_PX), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, WAVE_TILE_PX, WAVE_TILE_PX), px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) { px[i + 3] = 0; continue; } // Land (or no data)
    const [r, g, b] = waveColor(toMetres[px[i]]);
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

// Each pixel without data takes the colour of the closest one with data, up to 2 pixels away (one grid cell at the
// detail level, two at the base): the coast of the model is coarser than the land drawn over it
function dilate(src, dst) {
  const ctx = dst.getContext('2d');
  ctx.clearRect(0, 0, dst.width, dst.height);
  for (const r of [2, 1]) for (const [dx, dy] of OFFSETS_8) ctx.drawImage(src, dx * r, dy * r);
  ctx.drawImage(src, 0, 0);
}

// The layers on the canvas of the region
function compose(canvas, region, waves, land) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, p = region.pxPerDeg;
  ctx.fillStyle = MAP_COLORS.ocean;
  ctx.fillRect(0, 0, W, H);
  if (waves) {
    if (waves.dirty) { dilate(waves.canvas, waves.filled); waves.dirty = false; }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(waves.filled, (waves.west - region.west) * p, (region.north - waves.north) * p, waves.lonSpan * p, waves.latSpan * p);
  }
  if (land) ctx.drawImage(land, 0, 0);
  // Graticule: straight lines in this projection
  ctx.strokeStyle = MAP_COLORS.graticule;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let lon = Math.ceil(region.west / GRATICULE_DEG) * GRATICULE_DEG; lon <= region.west + region.lonSpan; lon += GRATICULE_DEG) {
    const x = (lon - region.west) * p; ctx.moveTo(x, 0); ctx.lineTo(x, H);
  }
  for (let lat = Math.floor(region.north / GRATICULE_DEG) * GRATICULE_DEG; lat >= region.north - region.latSpan; lat -= GRATICULE_DEG) {
    const y = (region.north - lat) * p; ctx.moveTo(0, y); ctx.lineTo(W, y);
  }
  ctx.stroke();
}


const OFFSETS_8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load ' + url));
    img.src = url;
  });
}
