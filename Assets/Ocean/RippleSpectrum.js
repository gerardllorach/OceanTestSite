// Surface ripples: the short waves (from where the FFT sea stops, ~4 m, down to a few cm) on a second FFT cascade
// (Assets/Ocean/FFTOcean.js), a small tile next to the tile of the sea. The GPU computes their displacement, slopes
// and Jacobian; the shader adds them to the sea, displaces the geometry with them where the mesh is fine enough and
// draws their normals down to the pixel. Finer than that, the mipmaps keep their slope variance as roughness.
//
// Each grid point is a trochoidal (Gerstner) component, like the FFT sea: height a sin(k.x - w t + phi), horizontal
// (k / |k|) a cos(...), deep-water dispersion w^2 = g k (g = 9.8, the capillary term below ~5 cm is left out to keep
// a single wave model). The sea state analysis adds them at the rest position, like the FFT sea.
//
// Spectrum: F(k) = B(k) k^-3, with B the saturation (slope variance per unit log k), and a directional spreading around
// the wind that narrows as the wind strengthens (spreadForWind). In the wavevector plane
//   Psi(kx, kz) = F(k) D(theta) / k = B(k) k^-4 D(theta)     (the 1/k is the Jacobian from polar to Cartesian)
// B(k) (settings.spectrum):
//  - 'sea' (strict, the digital twin's "Follow the sea spectrum"): the ripples continue the spectrum of the FFT sea (JONSWAP, Pierson-Moskowitz,
//    TMA or Elfouhaily: its S(f), Assets/Ocean/SeaSpectrum.js) with its directional spreading, in absolute units: no
//    Cox & Munk budget. The grid carries all it resolves; only the slope finer than the grid (up to k = 370 rad/m for
//    the gravity-wave spectra, whose f^-5 tail has no end of its own, and to 4000 rad/m for Elfouhaily) is the tail
//  - 'elfouhaily': the unified spectrum of Elfouhaily et al. (1997), B = B_l + B_h. B_l is the tail of the
//    wind sea, which leaves the ripple band as the peak moves to longer waves; B_h the short waves, which grow with the
//    friction velocity and rise towards the gravity-capillary peak (1.7 cm). In light wind the 1-4 m waves carry most
//    of the ripple slope; in strong wind the short sharp ripples do, and the mid-sized waves are few (Jahne & Riemer
//    1990: the decimetre waves barely grow with the wind, the centimetre ones grow strongly). The split of the slope
//    between the grid and the tail (roughness, the ripples finer than the grid) follows B
//  - 'saturation' (default without the twin): B constant (Phillips 1958, F ~ k^-3: the same slope per octave at any
//    wind), EXPLICIT_FRACTION of the slope on the grid
// 'elfouhaily' and 'saturation' are scaled to the Cox & Munk slopes (below).
// Amplitudes: Rayleigh distributed with randomAmplitudes (default; as the FFT sea), else the expected one.
// It is scaled so that the mean square slope of the whole surface (discrete waves + FFT sea + ripples + tail) matches
// Cox & Munk (1954). The tail (the part of the slope budget finer than the ripple grid) is roughness only (Bruneton et
// al. 2010, "Real-time realistic ocean lighting using seamless transitions from geometry to BRDF").
// With spreadMode 'sea', D is the spreading of the FFT sea, D(f, theta) around its mean direction (Assets/Ocean/
// DirectionalSpreading.js), continued into the ripple band: a narrow sea (e.g. Goda s_max 100) has narrow ripples too.

import { elfouhailyParams, elfouhailyB, ELF_K_END } from '/OceanTestSite/Assets/Ocean/Elfouhaily.js';

const G = 9.8; // Same gravity as the shader and gerstner.js
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const TWO_PI = 2 * Math.PI;

export const RIPPLE_K_MIN = 1.5; // rad/m (wavelength ~4.2 m): where the ripples start without an FFT sea
// Grid of the ripple cascade. 256: ripples down to ~9 cm, the shorter ones go to the tail (roughness). 512 resolves
// them down to ~4.5 cm but costs ~4x the GPU time (the FFT runs every frame), only visible very close to the surface
export const RIPPLE_N = 256;
// Components up to this fraction of the Nyquist wavenumber (~2.9 texels per wavelength or more). A bit closer to the
// limit than the sea (0.5): the shortest ripples only show in the normals, where the interpolation matters less
export const RIPPLE_K_FRACTION = 0.7;
export const EXPLICIT_FRACTION = 0.7; // Part of the ripple slope budget given to the ripple grid (the rest: tail)
export const MAX_WIND_SPEED = 25; // m/s
export const RIPPLE_SPECTRA = ['sea', 'elfouhaily', 'saturation'];
export const STRICT_K_END = 370; // rad/m: end of the tail of a gravity-wave spectrum (JONSWAP, PM, TMA) in strict mode

export const DEFAULT_RIPPLE_SETTINGS = {
  mode: 'seaState', // 'wind': windSpeed / windDir below. 'seaState': derived from the waves
  windSpeed: 7,     // U10, m/s
  windDir: 0,       // Where the wind comes FROM, deg clockwise from north
  enabled: true,    // false: no ripple grid, only roughness (the tail carries the whole budget)
  seed: 20261124,   // Fixed seed: the same settings always give the same ripples (reproducible renders)
  // Directionality
  directionMode: 'wind', // 'wind': the ripples come from the wind direction (or the mean wave direction). 'custom'
  direction: 0,          // Custom direction the ripples come FROM (deg clockwise from north)
  spreadMode: 'wind',    // 'wind' (default): narrower with more wind (spreadForWind: 60 deg at 7 kn, 15 deg from 30 kn).
                         // 'auto': from the Cox-Munk cross/up slope ratio. 'custom'. 'sea': the spreading of the FFT sea
                         // continued to the ripples ('wind' without an FFT sea)
  spread: 30,            // Custom directional spread (deg, width of the wrapped normal distribution), the same for all
  strength: 1,           // Custom only: fraction of the slope budget given to the ripples and the tail (0: glassy surface)
  // Light wind: 'coxMunk' keeps the Cox-Munk slopes at any wind (their fit has slopes even at 0 m/s); 'onset' keeps
  // LIGHT_WIND_FLOOR of them up to LIGHT_WIND[0] and the full Cox-Munk slopes from LIGHT_WIND[1] on (lightWindFactor)
  lightWind: 'coxMunk',
  // Rendering only (no new spectrum): ripples strained by the long waves, steeper on the crests and smoother in the
  // troughs (Longuet-Higgins & Stewart 1960). 0: off, 1: physical, up to 10: exaggerated
  strain: 1,
  // Shape of the ripple spectrum (see above): 'sea' (strict: the spectrum of the sea, no Cox & Munk), 'elfouhaily'
  // (changes with the wind) or 'saturation' (the same at any wind)
  spectrum: 'saturation',
  randomAmplitudes: true, // Rayleigh-distributed amplitudes (as the FFT sea)
  detail: true,           // Centimetre ripples finer than the grid drawn as a normal texture (where the quality has it)
};


// Saturation B(k) of the shape `spectrum` ({shape, params, density}): Elfouhaily, the sea's (k^3 F(k), F(k) = S(f)
// df/dk, deep water), or 1 for 'saturation'
export function rippleSaturation(k, spectrum) {
  if (!spectrum) return 1;
  if (spectrum.shape == 'elfouhaily') return elfouhailyB(k, spectrum.params);
  if (spectrum.shape == 'sea' && spectrum.density) {
    const f = Math.sqrt(G * k) / TWO_PI;
    return Math.pow(k, 3) * spectrum.density(f) * Math.sqrt(G / k) / (4 * Math.PI);
  }
  return 1;
}

// Integral of B(k) d(ln k) over [k0, k1]: the slope variance there (up to a constant)
function saturationIntegral(k0, k1, spectrum, n = 400) {
  if (!(k1 > k0)) return 0;
  const lo = Math.log(k0), hi = Math.log(k1), h = (hi - lo) / n;
  let sum = 0;
  for (let i = 0; i <= n; i++) sum += (i == 0 || i == n ? 0.5 : 1) * rippleSaturation(Math.exp(lo + i * h), spectrum);
  return sum * h;
}


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

// Wrapped normal distribution of width sigma (rad), per radian. sigma is kept above 1e-3 rad (0/0 at sigma = 0)
export function wrappedNormal(theta, sigma) {
  sigma = Math.max(1e-3, sigma);
  let sum = 0;
  for (let m = -2; m <= 2; m++) sum += Math.exp(-Math.pow(theta + TWO_PI * m, 2) / (2 * sigma * sigma));
  return sum / (Math.sqrt(TWO_PI) * sigma);
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
// (12.5 m above the sea in their measurements, ~U10 here). A linear fit of sun glitter photographs between ~1 and 14 m/s,
// +-0.004: the 0.003 crosswind intercept is a slope at no wind, from the waves (swell, the longer wind waves), not a
// statement that ripples exist without wind.
export function coxMunk(U) {
  return { up: 0.00316 * U, cross: 0.003 + 0.00192 * U };
}

// Light wind ('onset'): the ripples need wind to grow. On clean water waves start at a friction velocity of ~5 cm/s,
// ~1.3 m/s (Kahma & Donelan 1988, theory for aerodynamically smooth flow; their flume needed a bit more): only a
// trace of ripples below (LIGHT_WIND_FLOOR: the sea is never a perfect mirror, there are always some puffs). From 3 m/s the wind sea has left the ripple band (Pierson-Moskowitz Tp ~ 2.2 s, longer than the shortest FFT
// wave ~1.6 s) and the Cox-Munk slopes apply in full. Smooth step between the two
export const LIGHT_WIND = [1.3, 3]; // m/s
export const LIGHT_WIND_FLOOR = 0.05; // Share of the Cox-Munk slopes kept at no wind
export function lightWindFactor(U, mode = 'onset') {
  if (mode != 'onset') return 1;
  const t = clamp((U - LIGHT_WIND[0]) / (LIGHT_WIND[1] - LIGHT_WIND[0]), 0, 1);
  return LIGHT_WIND_FLOOR + (1 - LIGHT_WIND_FLOOR) * t * t * (3 - 2 * t);
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


// Slope variance of the FFT sea along / across the direction `dirDeg` (from), from its slope tensor {xx, zz, xz}
function fftSlopeVariance(fft, dirDeg) {
  if (!fft) return { up: 0, cross: 0 };
  const [ux, uz] = travelVector(dirDeg);
  const t = fft.slopeTensor;
  return {
    up: ux * ux * t.xx + 2 * ux * uz * t.xz + uz * uz * t.zz,
    cross: uz * uz * t.xx - 2 * ux * uz * t.xz + ux * ux * t.zz,
  };
}

// Strict tail: the slope of the sea's spectrum finer than the grid, from kCut to its end (Elfouhaily: ELF_K_END,
// gravity-wave spectra: STRICT_K_END), split along / across the ripple direction with the ripples' directional
// distribution at kCut (`directional(k, from)`)
function strictTail(saturation, kCut, fft, windDir, directional) {
  const isElf = fft.settings.spectrum == 'elfouhaily';
  const kEnd = Math.max(kCut, isElf ? ELF_K_END : STRICT_K_END);
  // Slope variance = integral of B(k) d(ln k)
  const n = 400, lo = Math.log(kCut), hi = Math.log(kEnd), h = (hi - lo) / n;
  let total = 0;
  for (let i = 0; i <= n; i++) total += (i == 0 || i == n ? 0.5 : 1) * rippleSaturation(Math.exp(lo + i * h), saturation);
  total *= h;
  if (!(total > 0)) return { up: 0, cross: 0 };
  const share = upwindShare(directional, kCut, windDir);
  return { up: total * share, cross: total * (1 - share) };
}

// Upwind share <cos^2> of the slope of the ripples of wavenumber k about the ripple direction (deg, from)
function upwindShare(directional, k, windDir) {
  const w = windDir * DEG2RAD;
  let sum = 0, up = 0;
  for (let i = 0; i < 360; i++) {
    const th = (i + 0.5) / 360 * TWO_PI - Math.PI;
    const d = directional(k, w + th);
    sum += d; up += d * Math.cos(th) * Math.cos(th);
  }
  return sum > 0 ? up / sum : 0.5;
}

// Directional spread of the ripples for the wind U10 (m/s), spreadMode 'wind': the stronger the wind, the more the
// ripples align with it. Linear in knots between WIND_SPREAD_KNOTS (60 deg at 7 kn, 15 deg at 30 kn), constant outside
export const WIND_SPREAD_KNOTS = [7, 30];
export const WIND_SPREAD_DEG = [60, 15];
export function spreadForWind(U) {
  const kn = (Number(U) || 0) * 1.94384;
  const t = clamp((kn - WIND_SPREAD_KNOTS[0]) / (WIND_SPREAD_KNOTS[1] - WIND_SPREAD_KNOTS[0]), 0, 1);
  return WIND_SPREAD_DEG[0] + (WIND_SPREAD_DEG[1] - WIND_SPREAD_DEG[0]) * t;
}

// Generate the ripple cascade for the discrete waves `waves` ([{hm0, T, dir, phase}]), the settings and the FFT sea
// `fft` (generateFFTSea in Assets/Ocean/SeaSpectrum.js, or null). The ripples start where its grid ends.
// Returns the grid for FFTOcean.setSpectrum() (L, amp, phase, omega, choppiness), the components that carry 99.95% of
// the ripple variance (discrete-wave format, for the analysis), and the slope bookkeeping.
export function generateRipples(waves, settings = {}, fft = null, N = RIPPLE_N) {
  const s = { ...DEFAULT_RIPPLE_SETTINGS, ...settings };
  waves = (waves || []).filter(w => w && w.T > 0 && isFinite(w.hm0));

  // Wind
  const fromSeaState = s.mode == 'seaState';
  const seaState = seaStateWind(fft ? waves.concat(fft.components) : waves);
  const windSpeed = fromSeaState ? seaState.windSpeed : clamp(Number(s.windSpeed) || 0, 0, MAX_WIND_SPEED);
  const sourceWindDir = wrap360(fromSeaState ? seaState.windDir : (Number(s.windDir) || 0));
  // Direction of the ripples: the wind, or a custom one. The slopes are split into upwind / crosswind components
  // along this direction (Cox-Munk, the shader's roughness frame)
  const windDir = s.directionMode == 'custom' ? wrap360(Number(s.direction) || 0) : sourceWindDir;

  // Slope budget: Cox-Munk minus what the Gerstner waves and the FFT sea already carry.
  // Without Auto (spreadMode 'custom'), the strength scales it (ripples and tail together): below 1 the surface is
  // smoother than Cox-Munk, as calm water or a slick, where surface films damp the short waves
  const target = coxMunk(windSpeed);
  const gerstner = slopeVariance(waves, windDir);
  const fftSlopes = fftSlopeVariance(fft, windDir);
  // Light wind ('onset'): fewer ripples below 3 m/s, 5% of Cox-Munk up to 1.3 m/s, in both Auto and custom
  const onset = lightWindFactor(windSpeed, s.lightWind);
  const strength = onset * (s.spreadMode == 'custom' ? clamp(Number(s.strength ?? 1), 0, 1) : 1);
  const budget = { up: strength * Math.max(0, target.up - gerstner.up - fftSlopes.up),
    cross: strength * Math.max(0, target.cross - gerstner.cross - fftSlopes.cross) };

  // Grid: the ripples start just above the shortest wave of the other layers (where the FFT grid ends, or
  // RIPPLE_K_MIN, or 1.2 x the shortest discrete wave). The grid spacing is kMin / 2, so that there are wavevectors
  // from kMin on in every direction (kMin, 1.12 kMin, 1.41 kMin, 1.5 kMin...); it then covers a factor
  // RIPPLE_K_FRACTION * N / 4 in wavenumber (~4 m down to ~9 cm with N = 256).
  const kMaxGerstner = waves.reduce((m, w) => Math.max(m, wavenumber(w.T)), 0);
  const kStart = fft ? fft.kCut : RIPPLE_K_MIN;
  const kMin = Math.max(kStart, 1.2 * kMaxGerstner);
  const L = 2 * TWO_PI / kMin;
  const dk = TWO_PI / L;
  const kCut = RIPPLE_K_FRACTION * Math.PI * N / L;

  // Directional spread around the ripple direction: wrapped normal of width sigmaTheta.
  //  - wind (default): spreadForWind(U10), the same for all the ripples: broad in light wind, aligned with a strong wind.
  //    As custom, the total slope stays the Cox-Munk one and its split follows the spread
  //  - auto: chosen so that the cross / up ratio of the slopes, <sin^2> / <cos^2> = (1 - e) / (1 + e) with
  //    e = exp(-2 sigma^2), matches the budget. The tail then completes Cox-Munk along both axes.
  //  - custom: the same width for all the ripples. The total slope stays the Cox-Munk one, but its split between
  //    upwind and crosswind follows the chosen spread (a narrow spread gives long-crested ripples)
  //  The ratio is kept within 0.02..0.98 (sigma ~8 to ~87 deg): when the waves already carry the whole crosswind
  //  budget (a light wind across, or under, a broad sea) the ripples are narrow instead of a single direction (sigma 0)
  //  - sea: the spreading of the FFT sea at the frequency of each ripple, around the mean direction of the sea. Like
  //    custom, the total slope stays the Cox-Munk one and its split follows the spreading. sigmaTheta: sigma1 of the
  //    longest ripples (a single width for the analysis, InputSpectrum.rippleDensity)
  const ratio = budget.up > 0 ? clamp(budget.cross / budget.up, 0.02, 0.98) : 0.98;
  const seaSpreading = s.spreadMode == 'sea' && fft && fft.spreading ? fft.spreading : null;
  const spreadMode = seaSpreading ? 'sea' : ['custom', 'auto'].includes(s.spreadMode) ? s.spreadMode : 'wind';
  const autoSpread = spreadMode == 'auto';
  const fOfK = k => Math.sqrt(G * k) / TWO_PI;
  const sigmaTheta = spreadMode == 'sea' ? seaSpreading.sigma1(fOfK(kMin)) * DEG2RAD
    : autoSpread ? Math.sqrt(-0.5 * Math.log((1 - ratio) / (1 + ratio)))
    : spreadMode == 'wind' ? spreadForWind(windSpeed) * DEG2RAD
    : clamp(Number(s.spread) || 30, 1, 180) * DEG2RAD;
  const seaDirRad = seaSpreading ? (Number(fft.settings.Mdir) || 0) * DEG2RAD : 0;

  // Shape of the spectrum, and the share of the slope budget on the grid (the rest: the tail, roughness)
  // 'sea' needs an FFT sea; without one, 'saturation'
  let shape = RIPPLE_SPECTRA.includes(s.spectrum) ? s.spectrum : 'saturation';
  if (shape == 'sea' && !(fft && fft.density)) shape = 'saturation';
  const strict = shape == 'sea';
  // Elfouhaily scaled to Cox & Munk: Omega from the peak of the FFT sea (fully developed without one)
  const elfOmega = fft && fft.settings.Tp > 0 ? windSpeed / (G * fft.settings.Tp / TWO_PI) : null;
  const saturation = { shape, params: shape == 'elfouhaily' ? elfouhailyParams(windSpeed, elfOmega) : null,
    density: strict ? fft.density : null };
  let explicitFraction = EXPLICIT_FRACTION;
  if (shape == 'elfouhaily') {
    const kEnd = Math.max(kCut * 1.01, ELF_K_END);
    const grid = saturationIntegral(kMin, kCut, saturation), all = grid + saturationIntegral(kCut, kEnd, saturation);
    explicitFraction = all > 0 ? clamp(grid / all, 0.05, 0.95) : EXPLICIT_FRACTION;
  }

  // Directional distribution (1/rad) of a ripple of wavenumber k coming from `from` (rad, clockwise from north)
  const windRadD = windDir * DEG2RAD;
  const directional = (k, from) => {
    if (seaSpreading) {
      const relSea = Math.atan2(Math.sin(from - seaDirRad), Math.cos(from - seaDirRad));
      return seaSpreading.D(fOfK(k), relSea);
    }
    const rel = Math.atan2(Math.sin(from - windRadD), Math.cos(from - windRadD));
    return wrappedNormal(rel, sigmaTheta);
  };

  const amp = new Float64Array(N * N), phase = new Float64Array(N * N), omega = new Float64Array(N * N);
  const rand = mulberry32(s.seed);
  const randAmp = mulberry32(s.seed + 4241); // Own stream: the toggle changes only the amplitudes
  const randomAmplitudes = s.randomAmplitudes !== false;
  let rawSlope = 0;
  const windRad = windDir * DEG2RAD;
  for (let m = 0; m < N; m++) {
    for (let n = 0; n < N; n++) {
      const ph = rand() * TWO_PI; // Drawn for every texel: the phases do not depend on the range
      const rayleigh = randomAmplitudes ? Math.sqrt(-Math.log(1 - randAmp())) : 1; // Mean square 1
      if (!s.enabled) continue;
      const nn = n < N / 2 ? n : n - N, mm = m < N / 2 ? m : m - N;
      const kx = nn * dk, kz = mm * dk, k = Math.hypot(kx, kz);
      if (k < kMin * (1 - 1e-9) || k > kCut) continue;
      const from = Math.atan2(-kx / k, kz / k); // Direction the component comes from
      let rel = from - windRad;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const D = directional(k, from);
      const psi = rippleSaturation(k, saturation) * Math.pow(k, -4) * D;
      const a = Math.sqrt(2 * psi * dk * dk) * rayleigh;
      const i = m * N + n;
      amp[i] = a; phase[i] = ph; omega[i] = Math.sqrt(G * k);
      rawSlope += 0.5 * a * a * k * k;
    }
  }

  // Scale so that the grid carries its share of the slope budget; strict: the spectrum as it is
  const scale = strict ? 1 : rawSlope > 0 ? Math.sqrt(explicitFraction * (budget.up + budget.cross) / rawSlope) : 0;
  const slopeTensor = { xx: 0, zz: 0, xz: 0 };
  const all = [];
  for (let m = 0; m < N; m++) {
    for (let n = 0; n < N; n++) {
      const i = m * N + n;
      if (!(amp[i] > 0)) continue;
      const a = amp[i] * scale;
      amp[i] = a;
      const nn = n < N / 2 ? n : n - N, mm = m < N / 2 ? m : m - N;
      const kx = nn * dk, kz = mm * dk, k = Math.hypot(kx, kz);
      const v = 0.5 * a * a;
      slopeTensor.xx += v * kx * kx; slopeTensor.zz += v * kz * kz; slopeTensor.xz += v * kx * kz;
      all.push({ a, kx, kz, k, w: omega[i], phase: phase[i] });
    }
  }
  const ripplesSlopes = fftSlopeVariance({ slopeTensor }, windDir);

  // Components for the analysis: the largest ones, up to 99.95% of the variance
  all.sort((p, q) => q.a - p.a);
  const variance = all.reduce((sum, c) => sum + c.a * c.a / 2, 0);
  const components = [];
  let acc = 0;
  for (const c of all) {
    if (acc >= 0.9995 * variance) break;
    acc += c.a * c.a / 2;
    components.push({ hm0: 2 * c.a, T: TWO_PI / c.w, dir: wrap360(Math.atan2(-c.kx / c.k, c.kz / c.k) * RAD2DEG),
      phase: wrap360(c.phase * RAD2DEG), chop: 1, k: c.k, wavelength: TWO_PI / c.k });
  }

  // Tail: the rest of the budget (roughness only).
  //  - auto: along each axis, so that the total is Cox-Munk along both
  //  - wind, custom, sea: the rest of the total budget, split with the spread of the shortest ripples (the roughness
  //    continues them: aligned with a strong wind too). The total slope stays Cox-Munk, its split follows the spread
  //  - strict: the sea's spectrum finer than the grid, split the same way
  let tail = { up: Math.max(0, budget.up - ripplesSlopes.up), cross: Math.max(0, budget.cross - ripplesSlopes.cross) };
  let excess = 0;
  if (strict) tail = strictTail(saturation, kCut, fft, windDir, directional);
  else if (!autoSpread) {
    const rest = Math.max(0, budget.up + budget.cross - ripplesSlopes.up - ripplesSlopes.cross);
    const share = upwindShare(directional, kCut, windDir);
    tail = { up: rest * share, cross: rest * (1 - share) };
  } else excess = Math.max(0, ripplesSlopes.up - budget.up) + Math.max(0, ripplesSlopes.cross - budget.cross);
  if (excess > 0) {
    const t = tail.up + tail.cross;
    const keep = t > 0 ? Math.max(0, t - excess) / t : 0;
    tail = { up: tail.up * keep, cross: tail.cross * keep };
  }
  const total = { up: gerstner.up + fftSlopes.up + ripplesSlopes.up + tail.up,
    cross: gerstner.cross + fftSlopes.cross + ripplesSlopes.cross + tail.cross };

  return {
    settings: s,
    enabled: s.enabled && all.length > 0,
    windSpeed,
    lightWindFactor: strict ? 1 : onset, // Share of the Cox-Munk budget left by the light-wind onset (1 with 'coxMunk')
    windDir,       // Direction of the ripples (from): the wind, or the custom direction
    sourceWindDir, // Wind direction (or mean wave direction in 'seaState' mode)
    spread: sigmaTheta * RAD2DEG, // Directional spread of the longest ripples (deg)
    autoSpread,
    spreadMode, // Resolved: 'auto', 'custom' or 'sea' (the spreading of the FFT sea, 'auto' without one)
    seaStateHm0: seaState.Hm0,
    // Grid (FFTOcean.setSpectrum)
    N, L, dk, kMin, kMax: kCut, kCut, amp, phase, omega, choppiness: 1,
    // For the detail band (generateDetailRipples): the directional distribution, and where the spectrum ends (the tail
    // of a gravity-wave spectrum in strict mode, Elfouhaily's end; Infinity for 'saturation')
    directional, tailEnd: strict ? (fft.settings.spectrum == 'elfouhaily' ? ELF_K_END : STRICT_K_END)
      : shape == 'elfouhaily' ? ELF_K_END : Infinity,
    numComponents: all.length,
    // Continuous spectrum the grid samples (rippleDirectionalDensity in Assets/Ocean/InputSpectrum.js):
    // Psi(kx, kz) = scale^2 B(k) k^-4 D(theta; sigma(k)) for kMin <= k <= kCut, B = rippleSaturation(k, spectrum)
    // (strict 'sea': scale 1; spreadMode 'sea': D the sea's spreading)
    spectrum: { scale, sigmaTheta, shape, params: saturation.params, density: saturation.density },
    // Share of the ripple slope on the grid (the rest: the tail)
    explicitFraction: strict ? (ripplesSlopes.up + ripplesSlopes.cross) / Math.max(1e-12, ripplesSlopes.up + ripplesSlopes.cross + tail.up + tail.cross) : explicitFraction,
    strict,
    components,
    ripples: components, // Same list (older name)
    chop: 1, // Horizontal displacement factor (1: trochoids)
    slopeTensor,
    tailSigma2: tail, // Upwind / crosswind slope variance of the tail
    slopes: { coxMunk: target, gerstner, fft: fftSlopes, ripples: ripplesSlopes, tail, total },
    heightVariance: variance, // m^2
  };
}


// DETAIL RIPPLES: the ripples finer than the ripple grid (the tail, ~9 cm down to ~4 mm), drawn as a looping normal
// texture near the camera (Assets/Ocean/RippleLoop.js) instead of roughness only. The band continues the spectrum of the
// ripples (the same B(k), scale and directional distribution) from their kCut, on a tile of two longest wavelengths
// (the convention of the ripple grid), up to RIPPLE_K_FRACTION of its Nyquist wavenumber or the end of the spectrum.
// Capillary-gravity dispersion w^2 = g k + (sigma / rho) k^3: centimetre ripples travel at their real speed (0.23 m/s
// at the 1.7 cm minimum). Their slope is taken from the tail (the total stays the same); if the band would carry more
// than the tail along either axis (the 'saturation' spectrum has no end of its own), it is scaled down to it.
// The grid is in pattern space, rotated by DETAIL_ROTATION from the world so that its repeat is not aligned with the
// axes: the shader samples it at R x (R: rotation by DETAIL_ROTATION), and a world wavevector k is the pattern one
// R^T k_p. Its slopes are stored along / across R w (w: direction the ripples travel), so the shader decodes them with
// w as usual.
// Returns {N, L, amp, phase, omega, windU (pattern frame), slopes {up, cross}, kMin, kMax, rotation} or null.
export const DETAIL_N = 128;
export const DETAIL_ROTATION = 37 * DEG2RAD;
const SURFACE_TENSION = 7.4e-5; // sigma / rho (m^3/s^2)
export function generateDetailRipples(ripples, N = DETAIL_N) {
  if (!ripples || !ripples.enabled || !ripples.directional || !ripples.spectrum) return null;
  const sp = ripples.spectrum, kMin = ripples.kCut;
  const L = 2 * TWO_PI / kMin, dk = TWO_PI / L;
  const kMax = Math.min(RIPPLE_K_FRACTION * Math.PI * N / L, ripples.tailEnd ?? Infinity);
  if (!(kMax > kMin * 1.05)) return null;
  const cr = Math.cos(DETAIL_ROTATION), sr = Math.sin(DETAIL_ROTATION);
  const rand = mulberry32((ripples.settings.seed ?? 1) + 7717), randAmp = mulberry32((ripples.settings.seed ?? 1) + 9241);
  const random = ripples.settings.randomAmplitudes !== false;
  const [wx, wz] = travelVector(ripples.windDir);
  const amp = new Float64Array(N * N), phase = new Float64Array(N * N), omega = new Float64Array(N * N);
  let up = 0, cross = 0;
  for (let m = 0; m < N; m++) {
    for (let n = 0; n < N; n++) {
      const ph = rand() * TWO_PI, rayleigh = random ? Math.sqrt(-Math.log(1 - randAmp())) : 1;
      const nn = n < N / 2 ? n : n - N, mm = m < N / 2 ? m : m - N;
      const px = nn * dk, pz = mm * dk, k = Math.hypot(px, pz);
      if (k < kMin * (1 - 1e-9) || k > kMax) continue;
      // World wavevector R^T k_p (R: (x, z) -> (c x - s z, s x + c z))
      const kx = cr * px + sr * pz, kz = -sr * px + cr * pz;
      const from = Math.atan2(-kx / k, kz / k);
      const psi = sp.scale * sp.scale * rippleSaturation(k, sp) * Math.pow(k, -4) * ripples.directional(k, from);
      const a = Math.sqrt(2 * psi * dk * dk) * rayleigh;
      const i = m * N + n;
      amp[i] = a; phase[i] = ph; omega[i] = Math.sqrt(G * k + SURFACE_TENSION * k * k * k);
      const ku = wx * kx + wz * kz, kc = -wz * kx + wx * kz;
      up += 0.5 * a * a * ku * ku; cross += 0.5 * a * a * kc * kc;
    }
  }
  // Not more than the tail, along each axis (the tail keeps its own upwind / crosswind split, e.g. Cox & Munk's): the
  // slope the detail band does not take stays roughness, so the total is unchanged
  const tail = ripples.tailSigma2;
  if (!(up + cross > 0) || !(tail.up + tail.cross > 0)) return null;
  const f = Math.min(1, up > 0 ? tail.up / up : 1, cross > 0 ? tail.cross / cross : 1);
  if (f < 1) { for (let i = 0; i < N * N; i++) amp[i] *= Math.sqrt(f); up *= f; cross *= f; }
  // Pattern frame of the slopes: R w
  const windU = [cr * wx - sr * wz, sr * wx + cr * wz];
  return { N, L, amp, phase, omega, windU, slopes: { up, cross }, kMin, kMax, rotation: DETAIL_ROTATION };
}
