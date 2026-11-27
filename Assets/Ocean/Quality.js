// Rendering quality presets. Phones and tablets start in 'low', desktops in 'high'. The choice can be changed in
// Scene > Quality (remembered in this browser) or forced with ?quality=low|medium|high
//
//   high     FFT sea 512, ripple FFT 256, float32 FFT, 1M-vertex grid, ripple foam 1024^2 over 96 m, 262k spray droplets and a 1024^2 spray foam texture
//   medium   FFT sea 256 (shortest sea wave 8 m instead of 4 m), ripple FFT 256, half-float FFT, 500k-vertex grid,
//            ripple foam 512^2 over 64 m, 65k spray droplets and a 512^2 spray foam texture
//   low      no FFT: the pipeline of the first version, 10 Gerstner components and simple shading (SIMPLE_SHADING in
//            OceanProjectedGridShader.js: Schlick Fresnel against a sky gradient, Phong sun highlight, mediump),
//            ripples from the looping field, 300k-vertex grid. Options add realism back step by step on phones
//
// Half-float FFT: half the memory traffic of float32, and more phones can render to it. Its precision (~3 digits) is
// enough for the display (the sea state analysis uses the spectrum on the CPU, not the textures).

// From cheapest to most realistic (the panel lists them in this order)
// gerstnerCount: number of Gerstner components of the sea without FFT (the count can still be changed in the panel)
// rippleLoop: ripples from a precomputed looping field (Assets/Ocean/RippleLoop.js) instead of the ripple FFT
// opaque: draw the ocean opaque and front faces only. Where the waves fold over in screen space (oblique views, ~45°),
//   the hidden back slopes are then culled, and mobile GPUs can skip hidden fragments (Apple HSR, Mali FPK, Adreno
//   LRZ only work on opaque geometry). The shader always writes alpha 1, so the image does not change. Front faces
//   are enough above and below the water: the projected grid is built along the camera rays, so the undisplaced
//   surface always faces the camera and only the folds turn away
export const QUALITY_PRESETS = {
  low: { label: 'Low', fft: false, simpleShading: true, gerstnerCount: 10, gridVertices: 300000, opaque: true, rippleLoop: true },
  medium: { label: 'Medium', fft: true, seaN: 256, rippleN: 256, halfFloat: true, gridVertices: 500000, sprayN: 256, sprayFoamN: 512, rippleFoamN: 512, rippleFoamExtent: 64 },
  high: { label: 'High', fft: true, seaN: 512, rippleN: 256, halfFloat: false, gridVertices: 1000000, sprayN: 512, sprayFoamN: 1024, rippleFoamN: 1024, rippleFoamExtent: 96 },
};

// Options of the simple shading ('low'), switched on one by one to add realism on phones. Each one is a shader
// define (OceanProjectedGridShader.js), remembered in this browser
export const SHADING_OPTIONS = {
  skyCube: { label: 'Sky reflection (cube map)', define: 'SKY_CUBEMAP', default: true },
  roughFresnel: { label: 'Fresnel with roughness', define: 'ROUGH_FRESNEL', default: true },
};

const STORAGE_KEY = 'OceanTestSite_quality';
const OPTIONS_KEY = 'OceanTestSite_shadingOptions';

// Phones and tablets (iPadOS reports a Mac user agent: told apart by its touch screen)
export function isMobileDevice() {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

export function defaultQuality() {
  return isMobileDevice() ? 'low' : 'high';
}

// Former names of the presets: 'verylow' is now 'low'
const RENAMED = { verylow: 'low' };
const presetName = name => QUALITY_PRESETS[RENAMED[name] || name] ? (RENAMED[name] || name) : null;

// URL parameter, then the choice saved in this browser, then the default for the device
export function initialQuality() {
  const fromUrl = presetName(new URLSearchParams(window.location.search).get('quality'));
  if (fromUrl) return fromUrl;
  try {
    const saved = presetName(window.localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch (e) { /* Storage blocked (private mode): use the default */ }
  return defaultQuality();
}

// {skyCube: bool, ...}: saved values over the defaults
export function loadShadingOptions() {
  const options = {};
  Object.keys(SHADING_OPTIONS).forEach(key => options[key] = SHADING_OPTIONS[key].default);
  try {
    const saved = JSON.parse(window.localStorage.getItem(OPTIONS_KEY) || '{}');
    Object.keys(options).forEach(key => { if (typeof saved[key] == 'boolean') options[key] = saved[key]; });
  } catch (e) { /* Storage blocked or invalid: defaults */ }
  return options;
}

export function saveShadingOptions(options) {
  try { window.localStorage.setItem(OPTIONS_KEY, JSON.stringify(options)); } catch (e) { /* Not remembered */ }
}

export function saveQuality(name) {
  try { window.localStorage.setItem(STORAGE_KEY, name); } catch (e) { /* Not remembered */ }
}
