// Real-world data of Generation > Digital twin: the sea and the wind anywhere in the world, right now.
//
// - Significant wave height (H_m0): Copernicus Marine (CMEMS) global ocean waves analysis and forecast
//   (GLOBAL_ANALYSISFORECAST_WAV_001_027, 1/12°, every 3 h), through its WMTS (open to any website, no key):
//   * the map: tiles in a grayscale colormap with a known range, turned back into metres with the colormap of the
//     legend (GetLegend, JSON) and painted with the wave colours of VISOC (WAVE_LEGEND) by GlobeMap.js. The tiles are
//     in EPSG:4326 (equirectangular), as the texture of the globe.
//   * the value at a point: GetFeatureInfo (JSON), exact (the grid cell), null on land.
// - Wind at 10 m: Open-Meteo (open to any website, no key): current conditions (every 15 min), from the best model at
//   the place (a global one in the open ocean).
// - Names of the seas: Natural Earth 1:50m (public domain), ./ne_50m_marine.json (coordinates rounded to 0.01°, only
//   the names kept). The land of the map: GlobeMap.js (OpenStreetMap, through NASA GIBS).

const WMTS = 'https://wmts.marine.copernicus.eu/teroWmts';
const WAVE_PRODUCT = 'GLOBAL_ANALYSISFORECAST_WAV_001_027';
export const WAVE_LAYER = WAVE_PRODUCT + '/cmems_mod_glo_wav_anfc_0.083deg_PT3H-i_202411/VHM0';
const WAVE_STEP_MS = 3 * 3600 * 1000; // The product has a field every 3 hours
// Grayscale of the map tiles: black is GRAY_RANGE[0], white GRAY_RANGE[1] (m); higher waves clamp to white
const GRAY_STYLE_RANGE = [0, 10];
const GRAY_STYLE = `cmap:gray,range:${GRAY_STYLE_RANGE[0]}/${GRAY_STYLE_RANGE[1]}`;
// Tile matrix of the value at a point: fine enough (0.02°/px) to hit the grid cell (1/12°) that was clicked
const POINT_TILE_MATRIX = 5;
const TILE_PX = 256;

const DATA_DIR = new URL('./', import.meta.url).href;


// COLOURS OF THE WAVES (VISOC styles/colorLegends.js, LEGENDS.WAVES over VARIABLE_RANGES.VHM0): [t, [r, g, b]], t
// from 0 to 1 over WAVE_RANGE. Higher waves clamp to the last colour
export const WAVE_RANGE = [0, 4]; // m
export const WAVE_LEGEND = [
  [0.00, [255, 255, 255]], // 0 m
  [0.15, [200, 240, 255]], // 0.6 m
  [0.30, [114, 200, 255]], // 1.2 m
  [0.60, [80, 140, 255]],  // 2.4 m
  [1.00, [255, 0, 255]],   // 4 m
];
export function waveColor(Hm0) {
  const t = Math.min(1, Math.max(0, (Hm0 - WAVE_RANGE[0]) / (WAVE_RANGE[1] - WAVE_RANGE[0])));
  let i = 1;
  while (i < WAVE_LEGEND.length - 1 && WAVE_LEGEND[i][0] < t) i++;
  const [t0, c0] = WAVE_LEGEND[i - 1], [t1, c1] = WAVE_LEGEND[i];
  const s = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
  return [0, 1, 2].map(k => Math.round(c0[k] + (c1[k] - c0[k]) * s));
}

// Units of a wave height (as the wind units, WindSea.WIND_UNITS): a click on the unit goes to the next one
export const HEIGHT_UNITS = [
  { unit: 'm', decimals: 2, toDisplay: v => v },
  { unit: 'ft', decimals: 1, toDisplay: v => v / 0.3048 },
];


// TIME: the field of the product closest to the date (every 3 h, on the hour, UTC)
export function waveTimeOf(date = new Date()) {
  return new Date(Math.round(date.getTime() / WAVE_STEP_MS) * WAVE_STEP_MS);
}
const isoTime = date => date.toISOString().replace('.000Z', 'Z');


// MAP TILES OF H_M0: EPSG:4326 tile matrix z has 2^(z+1) x 2^z tiles of WAVE_TILE_PX, of 180 / 2^z degrees, from
// 180° W, 90° N. Grey, see grayToMetres (Assets/DigitalTwin/GlobeMap.js paints them)
export const WAVE_TILE_PX = TILE_PX;
export function waveTileUrl(z, row, col, time) {
  return WMTS + '?' + new URLSearchParams({
    SERVICE: 'WMTS', REQUEST: 'GetTile', VERSION: '1.0.0', LAYER: WAVE_LAYER, STYLE: GRAY_STYLE, FORMAT: 'image/png',
    TILEMATRIXSET: 'EPSG:4326', TILEMATRIX: z, TILEROW: row, TILECOL: col, TIME: isoTime(time),
  });
}

// Grey level (the red channel, 0..255) -> metres. The colormap of the legend has 256 colours from
// GRAY_RANGE[0] to [1]; it is not linear in RGB, and some neighbouring colours share a grey level: those take the
// mean of their values, the levels the colormap skips are interpolated. Without the legend: linear.
let grayToMetresPromise = null;
export function grayToMetres() {
  if (!grayToMetresPromise) grayToMetresPromise = (async () => {
    const [lo, hi] = GRAY_STYLE_RANGE;
    const lut = new Float32Array(256);
    try {
      const url = WMTS + '?' + new URLSearchParams({ SERVICE: 'WMTS', REQUEST: 'GetLegend', LAYER: WAVE_LAYER,
        STYLE: GRAY_STYLE, FORMAT: 'application/json' });
      const json = await fetch(url).then(r => r.json());
      const map = json.continuous.cmap.colorMap, n = map.length;
      const sum = new Float64Array(256), count = new Uint16Array(256);
      map.forEach(([r], i) => { sum[r] += lo + (hi - lo) * i / (n - 1); count[r]++; });
      let prev = -1;
      for (let g = 0; g < 256; g++) {
        if (!count[g]) continue;
        lut[g] = sum[g] / count[g];
        for (let k = prev + 1; k < g; k++) // Levels skipped since the previous one: interpolated
          lut[k] = prev < 0 ? lut[g] : lut[prev] + (lut[g] - lut[prev]) * (k - prev) / (g - prev);
        prev = g;
      }
      for (let k = prev + 1; k < 256; k++) lut[k] = hi;
    } catch (e) {
      console.warn('Could not load the colormap of the wave heights: grey read as linear', e);
      for (let g = 0; g < 256; g++) lut[g] = lo + (hi - lo) * g / 255;
    }
    return lut;
  })();
  return grayToMetresPromise;
}


// H_M0 AT A POINT (m), null on land or outside the model (north of 90°, south of 80° S)
export async function fetchWaveHeight(lat, lon, date = new Date()) {
  const time = waveTimeOf(date);
  const span = 180 / 2 ** POINT_TILE_MATRIX; // degrees per tile
  const x = (wrapLon(lon) + 180) / span, y = (90 - lat) / span;
  const col = Math.min(2 ** (POINT_TILE_MATRIX + 1) - 1, Math.floor(x)), row = Math.min(2 ** POINT_TILE_MATRIX - 1, Math.floor(y));
  const url = WMTS + '?' + new URLSearchParams({
    SERVICE: 'WMTS', REQUEST: 'GetFeatureInfo', VERSION: '1.0.0', LAYER: WAVE_LAYER, STYLE: 'cmap:amp',
    INFOFORMAT: 'application/json', TILEMATRIXSET: 'EPSG:4326', TILEMATRIX: POINT_TILE_MATRIX, TILEROW: row, TILECOL: col,
    I: Math.min(TILE_PX - 1, Math.floor((x - col) * TILE_PX)), J: Math.min(TILE_PX - 1, Math.floor((y - row) * TILE_PX)),
    TIME: isoTime(time),
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error('Copernicus Marine: ' + res.status + ' ' + res.statusText);
  const json = await res.json();
  const value = json.features?.[0]?.properties?.value;
  return { Hm0: value == null || !isFinite(value) ? null : value, time };
}


// WIND AT 10 M, NOW: {speed (m/s), dir (deg, where it comes FROM, clockwise from north), time}. Over the sea when
// the point is on a coast (cell_selection=sea)
export async function fetchWind(lat, lon) {
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: lat.toFixed(4), longitude: wrapLon(lon).toFixed(4), current: 'wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'ms', timezone: 'UTC', cell_selection: 'sea',
  });
  const json = await fetch(url).then(r => r.json());
  if (json.error) throw new Error('Open-Meteo: ' + json.reason);
  const c = json.current;
  return { speed: c.wind_speed_10m, dir: c.wind_direction_10m, time: new Date(c.time + 'Z') };
}


// NATURAL EARTH: named seas (to name a point)
// Its polygons are wound counter-clockwise (GeoJSON); d3 reads them clockwise (else a polygon is the rest of the
// sphere): any polygon larger than a hemisphere is turned round.
let marinePromise = null;
function loadMarine() {
  if (!marinePromise) marinePromise = fetchGeoJSON('ne_50m_marine.json').then(fc => {
    fc.features.forEach(f => { f.area = window.d3.geoArea(f); });
    fc.features.sort((a, b) => a.area - b.area); // Smallest first: the most precise name
    return fc;
  });
  return marinePromise;
}
async function fetchGeoJSON(file) {
  const fc = await fetch(DATA_DIR + file).then(r => r.json());
  fc.features.forEach(rewind);
  return fc;
}
function rewind(feature) {
  const g = feature.geometry;
  const polygons = g.type == 'Polygon' ? [g.coordinates] : g.type == 'MultiPolygon' ? g.coordinates : [];
  polygons.forEach(rings => {
    if (window.d3.geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI) rings.forEach(ring => ring.reverse());
  });
}

// Names of the sea at a point, the most precise first (e.g. ['Balearic Sea'], ['North Pacific Ocean']): {names,
// exact}. When the point is in none (Natural Earth leaves gaps between them, and the point may be on land), the
// closest within ~5° (exact: false)
export async function seaNamesAt(lat, lon) {
  const marine = await loadMarine();
  const d3 = window.d3;
  const at = p => marine.features.filter(f => d3.geoContains(f, p)).map(f => niceName(f.properties.name));
  let names = at([lon, lat]);
  const exact = names.length > 0;
  for (const r of [0.5, 1, 2, 3, 5]) {
    if (names.length) break;
    for (let k = 0; k < 16 && !names.length; k++) {
      const a = k * Math.PI / 8;
      names = at([lon + r * Math.sin(a) / Math.max(0.2, Math.cos(lat * Math.PI / 180)), Math.max(-89.9, Math.min(89.9, lat + r * Math.cos(a)))]);
    }
  }
  return { names: [...new Set(names)], exact };
}
// 'INDIAN OCEAN' -> 'Indian Ocean'
const niceName = name => name == name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : name;


// FORMATS
export const wrapLon = lon => ((lon + 180) % 360 + 360) % 360 - 180;
// 41.2°N, 1.6°E
export function formatLatLon(lat, lon, decimals = 2) {
  lon = wrapLon(lon);
  return Math.abs(lat).toFixed(decimals) + '° ' + (lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(lon).toFixed(decimals) + '° ' + (lon >= 0 ? 'E' : 'W');
}
// Eight points of the compass: N, NE, E...
const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const cardinal = deg => COMPASS_8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
