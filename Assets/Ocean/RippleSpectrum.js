// Surface ripples: the short waves (~4 m to ~2 cm) that the projected grid cannot resolve.
// They are rendered in the fragment shader as slopes only (Assets/Ocean/OceanProjectedGridShader.js) and are
// measured by the virtual buoy of the sea state analysis (Assets/Scripts/OceanAnalysis), so both use this set.
//
// Each ripple is a small deep-water Gerstner wave in the same format as the discrete waves:
//   {hm0: 2 * amplitude (m), T (s), dir (deg, where it comes FROM, clockwise from north), phase (deg), chop}
// where chop (<= 1) scales its horizontal displacement. They displace the geometry where the mesh is fine enough
// (vertex shader) and the normals down to the pixel (fragment shader).
// with the same dispersion relation as the Gerstner waves (k = w^2 / g, g = 9.8), so the analysis can evaluate them
// with Assets/Scripts/OceanAnalysis/gerstner.js. The capillary term of the dispersion relation (only relevant below
// ~5 cm) is left out on purpose to keep a single wave model.
//
// Amplitudes follow the saturation range of the wavenumber spectrum, F(k) ~ k^-3 (Phillips 1958), scaled so that the
// total mean square slope of the surface (Gerstner waves + ripples + unresolved tail) matches Cox & Munk (1954).
// Ripples finer than a pixel are not drawn as normals: their slope variance becomes roughness (Bruneton et al. 2010,
// "Real-time realistic ocean lighting using seamless transitions from geometry to BRDF"). The part of the slope
// budget that is not given to explicit ripples is the "tail": roughness only.

const G = 9.8; // Same gravity as the shader and gerstner.js
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const TWO_PI = 2 * Math.PI;

export const MAX_RIPPLES = 64;  // Size of the uniform arrays in the shader
export const RIPPLE_K_MIN = 1.5; // rad/m (wavelength ~4.2 m)
export const RIPPLE_K_MAX = 300; // rad/m (wavelength ~2.1 cm, period 0.116 s: above the 0.1 s floor of gerstner.js)
export const EXPLICIT_FRACTION = 0.7; // Part of the ripple slope budget given to the explicit ripples (the rest: tail)
export const MAX_WIND_SPEED = 25; // m/s
// Gerstner crests loop where the waves add up when the sum of (horizontal factor x a k) exceeds 1. The horizontal
// displacement of the ripples (their choppiness) is scaled so that their sum stays below this value
export const MAX_RIPPLE_CHOP_SUM = 0.6;

export const DEFAULT_RIPPLE_SETTINGS = {
  mode: 'seaState', // 'wind': windSpeed / windDir below. 'seaState': derived from the discrete waves
  windSpeed: 7,     // U10, m/s
  windDir: 0,       // Where the wind comes FROM, deg clockwise from north
  count: 48,
  seed: 20261124,   // Fixed seed: the same settings always give the same ripples (reproducible renders)
};


// Deterministic pseudo-random numbers (mulberry32)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal sample (Box-Muller)
function gaussian(rand) {
  let u = 0;
  while (u == 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * rand());
}

const wrap360 = deg => ((deg % 360) + 360) % 360;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Deep-water wavenumber of a wave of period T (as in the shader)
export function wavenumber(T) {
  return 4 * Math.PI * Math.PI / (T * T * G);
}

// Direction in which a wave coming FROM `dirDeg` travels, in the scene's xz plane (x = east, z = south).
// Same mapping as the shader: (sin(-dir), cos(-dir)).
export function travelVector(dirDeg) {
  const r = dirDeg * DEG2RAD;
  return [Math.sin(-r), Math.cos(-r)];
}


// Mean square slope of a clean sea surface (Cox & Munk 1954), upwind and crosswind components, for wind speed U (m/s)
export function coxMunk(U) {
  return { up: 0.00316 * U, cross: 0.003 + 0.00192 * U };
}


// Wind that would produce the sea state of the discrete waves: Hm0 from their variance, and the fully developed
// Pierson-Moskowitz relation Hm0 = 0.21 U^2 / g. Direction: energy-weighted circular mean of the wave directions.
export function seaStateWind(waves) {
  let m0 = 0, sx = 0, sy = 0;
  waves.forEach(w => {
    const v = Math.pow(Math.abs(w.hm0) / 2, 2) / 2;
    m0 += v;
    sx += v * Math.cos((w.dir || 0) * DEG2RAD);
    sy += v * Math.sin((w.dir || 0) * DEG2RAD);
  });
  const Hm0 = 4 * Math.sqrt(m0);
  return {
    Hm0,
    windSpeed: clamp(Math.sqrt(Hm0 * G / 0.21), 0, MAX_WIND_SPEED),
    windDir: m0 > 0 ? wrap360(Math.atan2(sy, sx) * RAD2DEG) : 0,
  };
}


// Mean square slope of a set of waves, along (up) and across (cross) the direction `dirDeg`.
// A wave of amplitude a and wavenumber k has slope variance (a k)^2 / 2, all of it along its own direction.
export function slopeVariance(waves, dirDeg) {
  let up = 0, cross = 0;
  waves.forEach(w => {
    if (!(w.T > 0)) return;
    const a = Math.abs(w.hm0) / 2, k = wavenumber(w.T);
    const v = 0.5 * (a * k) * (a * k);
    const d = ((w.dir || 0) - dirDeg) * DEG2RAD;
    up += v * Math.cos(d) * Math.cos(d);
    cross += v * Math.sin(d) * Math.sin(d);
  });
  return { up, cross };
}


// Generate the ripples for the discrete waves `waves` ([{hm0, T, dir, phase}]) and the settings.
export function generateRipples(waves, settings = {}) {
  const s = { ...DEFAULT_RIPPLE_SETTINGS, ...settings };
  waves = (waves || []).filter(w => w && w.T > 0 && isFinite(w.hm0));

  // Wind
  const fromSeaState = s.mode == 'seaState';
  const seaState = seaStateWind(waves);
  const windSpeed = fromSeaState ? seaState.windSpeed : clamp(Number(s.windSpeed) || 0, 0, MAX_WIND_SPEED);
  const windDir = wrap360(fromSeaState ? seaState.windDir : (Number(s.windDir) || 0));

  // Slope budget: Cox-Munk minus what the Gerstner waves already carry
  const target = coxMunk(windSpeed);
  const gerstner = slopeVariance(waves, windDir);
  const budget = { up: Math.max(0, target.up - gerstner.up), cross: Math.max(0, target.cross - gerstner.cross) };

  // Wavenumbers: log-spaced bins, from just above the shortest Gerstner wave (at least RIPPLE_K_MIN) to RIPPLE_K_MAX.
  // With a spectral sea (Assets/Ocean/SeaSpectrum.js) the Gerstner waves stop at RIPPLE_K_MIN, so the two connect.
  const n = clamp(Math.round(s.count), 0, MAX_RIPPLES);
  const kMaxGerstner = waves.reduce((m, w) => Math.max(m, wavenumber(w.T)), 0);
  const kMin = Math.min(RIPPLE_K_MAX / 2, Math.max(RIPPLE_K_MIN, 1.2 * kMaxGerstner));

  // Directional spread around the wind: wrapped normal of width sigmaTheta, chosen so that the cross / up ratio of
  // the slopes, <sin^2> / <cos^2> = (1 - e) / (1 + e) with e = exp(-2 sigma^2), matches the budget.
  // Shorter ripples spread more (towards +60% at the shortest), as observed for short wind waves.
  const ratio = budget.up > 0 ? Math.min(0.98, budget.cross / budget.up) : 0.98;
  const sigmaTheta = Math.sqrt(-0.5 * Math.log((1 - ratio) / (1 + ratio)));

  // Spectrum F(k) = k^-3 (any scale). The variance in a bin is F(k) dk = a^2 / 2, so a = sqrt(2 F(k) dk), where dk is the
  // width of the (log-spaced) bin: the Jacobian between the bin index and k. With log bins dk = k dln(k), so every
  // ripple ends up with about the same slope variance (a k)^2 / 2 = dln(k): equal slope per octave (saturation range).
  // One ripple per bin, each with a random wavenumber inside its bin and its own direction: neighbouring ripples have
  // similar lengths and different directions, so they form short-crested patches instead of long parallel stripes.
  const rand = mulberry32(s.seed);
  const ripples = [];
  const logRange = Math.log(RIPPLE_K_MAX / kMin);
  for (let i = 0; i < n; i++) { // Longest first: the shader stops at the first ripple too short for the pixel
    const e0 = kMin * Math.exp(logRange * i / n), e1 = kMin * Math.exp(logRange * (i + 1) / n);
    const k = e0 * Math.pow(e1 / e0, 0.1 + 0.8 * rand()), dk = e1 - e0;
    const a = Math.sqrt(2 * Math.pow(k, -3) * dk);
    const spreadI = Math.min(1.6, sigmaTheta * (1 + 0.6 * i / Math.max(1, n - 1)));
    const dir = wrap360(windDir + spreadI * gaussian(rand) * RAD2DEG);
    const phase = rand() * 360;
    ripples.push({ a, k, dir, phase });
  }

  // Scale the amplitudes so the explicit ripples carry EXPLICIT_FRACTION of the slope budget
  const rawSlope = ripples.reduce((sum, r) => sum + 0.5 * Math.pow(r.a * r.k, 2), 0);
  const explicitSlope = EXPLICIT_FRACTION * (budget.up + budget.cross);
  const scale = rawSlope > 0 ? Math.sqrt(explicitSlope / rawSlope) : 0;
  // Choppiness: horizontal (Gerstner) displacement of the ripples, scaled so that crests do not loop
  const akSum = ripples.reduce((sum, r) => sum + r.a * scale * r.k, 0);
  const chop = akSum > 0 ? Math.min(1, MAX_RIPPLE_CHOP_SUM / akSum) : 1;
  const out = ripples.map(r => {
    const a = r.a * scale;
    const omega = Math.sqrt(G * r.k);
    return { hm0: 2 * a, T: TWO_PI / omega, dir: r.dir, phase: r.phase, chop, k: r.k, wavelength: TWO_PI / r.k };
  });

  // Tail: the rest of the budget along each axis (roughness only)
  const explicit = slopeVariance(out, windDir);
  const tail = { up: Math.max(0, budget.up - explicit.up), cross: Math.max(0, budget.cross - explicit.cross) };
  const total = { up: gerstner.up + explicit.up + tail.up, cross: gerstner.cross + explicit.cross + tail.cross };

  return {
    settings: { ...s, count: n },
    windSpeed, windDir,
    seaStateHm0: seaState.Hm0,
    kMin, kMax: RIPPLE_K_MAX,
    ripples: out,
    chop, // Horizontal displacement factor of all the ripples (1 = Gerstner)
    tailSigma2: tail, // Upwind / crosswind slope variance of the tail
    slopes: { coxMunk: target, gerstner, ripples: explicit, tail, total },
    heightVariance: out.reduce((sum, r) => sum + Math.pow(r.hm0 / 2, 2) / 2, 0), // m^2
  };
}


// Shader uniforms for the ripples at time `time` (s), written into the arrays of THREE.Vector4 / plain objects:
//   ripples[i] = (kx, kz, amplitude, phase now)   info[i] = (wavelength, suffix slope variance up, cross, 0)
// The phase now is phase - w t, wrapped to [0, 2 pi) here in double precision: in the shader (float32) w t would
// lose precision as the time grows. The suffix sums are the slope variance of ripples i..n-1, which the shader turns
// into roughness when it stops at the first ripple that is too short for the pixel.
export function writeRippleUniforms(result, time, ripplesOut, infoOut) {
  const list = result.ripples;
  const [ux, uz] = travelVector(result.windDir);
  let suffixUp = 0, suffixCross = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    const [dx, dz] = travelVector(r.dir);
    const a = r.hm0 / 2;
    const kx = r.k * dx, kz = r.k * dz;
    const kUp = kx * ux + kz * uz, kCross = -kx * uz + kz * ux;
    suffixUp += 0.5 * a * a * kUp * kUp;
    suffixCross += 0.5 * a * a * kCross * kCross;
    const omega = TWO_PI / r.T;
    let phase = (r.phase * DEG2RAD - omega * time) % TWO_PI;
    if (phase < 0) phase += TWO_PI;
    if (ripplesOut) set4(ripplesOut[i], kx, kz, a, phase);
    if (infoOut) set4(infoOut[i], r.wavelength, suffixUp, suffixCross, 0);
  }
  return { windDirection: [ux, uz] };
}

function set4(v, x, y, z, w) {
  if (v.set) v.set(x, y, z, w);
  else { v.x = x; v.y = y; v.z = z; v.w = w; }
}
