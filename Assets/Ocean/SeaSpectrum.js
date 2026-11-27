// Sea state from a wave spectrum: the discrete (Gerstner) waves are a random realisation of a JONSWAP spectrum
// (Hasselmann et al. 1973; gamma = 1 is the Pierson-Moskowitz spectrum of a fully developed sea) with a directional
// spreading: a constant cos^2s (Longuet-Higgins et al. 1963), or one that changes with the frequency after the
// measurements of Mitsuyasu et al. 1975, Hasselmann et al. 1980, Donelan et al. 1985 (+ Banner 1990) or Goda & Suzuki
// 1975 (Assets/Ocean/DirectionalSpreading.js). Pure module (no three.js): also used by the analysis and in node.
//
// Discretisation ("random frequency, single direction per component"): the frequency range is split into log-spaced
// bins, each component gets a random frequency inside its bin, an amplitude a = sqrt(2 S(f) df) from the bin width df,
// a random direction drawn from the spreading function and a random phase. Every component has its own frequency and
// direction, so the sea is short-crested and does not repeat. Seeded: the same settings give the same waves.
//
// The components stop where the surface ripples (Assets/Ocean/RippleSpectrum.js) start, at RIPPLE_K_MIN.
//
// Spectrum (settings.spectrum):
//  - 'jonswap' (default): JONSWAP of height Hm0 and peak Tp (gamma 1: Pierson-Moskowitz)
//  - 'elfouhaily': the unified spectrum of Elfouhaily et al. 1997 (Assets/Ocean/Elfouhaily.js) for the wind
//    spectrumWind and inverse wave age Omega: Hm0 and Tp follow from it (the Hm0 and Tp settings are ignored)
// Depth (settings.depth, m; null: deep water): TMA (Bouws et al. 1985; Horvath 2015, "Empirical Directional Wave
// Spectra for Computer Graphics"): the spectrum times the Kitaigorodskii depth attenuation Phi(omega_h),
// omega_h = omega sqrt(h / g), in the approximation of Thompson & Vincent (1983), < 4% error:
//   Phi = omega_h^2 / 2 (omega_h <= 1),  1 - (2 - omega_h)^2 / 2 (1 < omega_h < 2),  1 above
// With a depth the FFT sea uses the finite-depth dispersion w^2 = g k tanh(k h) (the discrete waves, the ripples and
// the shader stay in deep water: the ripples are deep at any depth, Phi = 1 there).

import { RIPPLE_K_MIN } from '/OceanTestSite/Assets/Ocean/RippleSpectrum.js';
import { elfouhailyParams, elfouhailyS } from '/OceanTestSite/Assets/Ocean/Elfouhaily.js';
import { spreadingExponent, createSpreading, windOfSea, SPREAD_MODEL_IDS } from '/OceanTestSite/Assets/Ocean/DirectionalSpreading.js';
export { spreadingExponent };

export const G = 9.8; // Same gravity as the shader and the analysis
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// How the spectrum is rendered: 'fft' (Tessendorf, Assets/Ocean/FFTOcean.js), 'gerstner' (discrete Gerstner
// components, generateSea), 'none' (only the waves of the discrete waves list)
export const SEA_METHODS = ['fft', 'gerstner', 'none'];

export const DEFAULT_SEA_SETTINGS = {
  method: 'fft',
  Hm0: 1.0,     // Significant wave height (m)
  Tp: null,     // Peak period (s). null: fully developed sea for Hm0 (Pierson-Moskowitz)
  gamma: 3.3,   // JONSWAP peak enhancement (1 = Pierson-Moskowitz, 3.3 = mean JONSWAP)
  Mdir: 0,      // Mean direction, where the waves come FROM (deg clockwise from north)
  spread: 30,   // Directional spread sigma1 (deg, Kuik et al. 1988), spreadModel 'constant'
  spreadModel: 'constant', // Directional spreading, see DirectionalSpreading.js SPREAD_MODELS
  spreadWind: null,        // U10 (m/s) of the wind-dependent spreadings. null: the wind of a JONSWAP sea with this Hm0, Tp
  spreadSmax: 10,          // Peak s of the Goda & Suzuki spreading
  count: 40,    // Number of components (Gerstner waves)
  seed: 1,
  choppiness: 1, // FFT: horizontal displacement factor (Tessendorf's lambda). 1: every component is a trochoid
  spectrum: 'jonswap',   // 'jonswap' or 'elfouhaily' (see above)
  spectrumWind: 10,      // 'elfouhaily': U10 (m/s)
  Omega: null,           // 'elfouhaily': inverse wave age U10 / cp (null: 0.84, fully developed)
  depth: null,           // m, null: deep water. With a depth: TMA (depth attenuation) and finite-depth dispersion
  // FFT: Rayleigh-distributed amplitudes (Tessendorf 2001, Horvath 2015: Gaussian complex amplitudes) instead of the
  // expected one: wave groups and occasional steeper, sharper crests
  randomAmplitudes: true,
};
export const SEA_SPECTRA = ['jonswap', 'elfouhaily'];

// Frequency where the ripples take over (deep water: f = sqrt(g k) / 2 pi): ~0.61 Hz, 1.6 s, 4.2 m
export const SPLIT_FREQUENCY = Math.sqrt(G * RIPPLE_K_MIN) / (2 * Math.PI);


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

const wrap360 = deg => ((deg % 360) + 360) % 360;

// Peak period of a fully developed sea (Pierson-Moskowitz): Hm0 = 0.21 U^2 / g and w_p = 0.877 g / U  ->  Tp ~ 5 sqrt(Hm0)
export function fullyDevelopedPeakPeriod(Hm0) {
  const U = Math.sqrt(Math.max(Hm0, 1e-3) * G / 0.21);
  return 2 * Math.PI * U / (0.877 * G);
}

// JONSWAP shape (no scale): f^-5 exp(-5/4 (fp/f)^4) gamma^r
function jonswapShape(f, fp, gamma) {
  if (!(f > 0)) return 0;
  const sigma = f <= fp ? 0.07 : 0.09;
  const r = Math.exp(-Math.pow(f - fp, 2) / (2 * sigma * sigma * fp * fp));
  return Math.pow(f, -5) * Math.exp(-1.25 * Math.pow(fp / f, 4)) * Math.pow(gamma, r);
}

// Integral of the shape for fp = 1 (it scales as fp^-4), per gamma
const shapeIntegralCache = new Map();
function shapeIntegral(gamma) {
  if (!shapeIntegralCache.has(gamma)) {
    const n = 4000, lo = Math.log(0.3), hi = Math.log(50);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x0 = Math.exp(lo + (hi - lo) * i / n), x1 = Math.exp(lo + (hi - lo) * (i + 1) / n);
      sum += 0.5 * (jonswapShape(x0, 1, gamma) + jonswapShape(x1, 1, gamma)) * (x1 - x0);
    }
    shapeIntegralCache.set(gamma, sum);
  }
  return shapeIntegralCache.get(gamma);
}

// Kitaigorodskii depth attenuation (TMA), Thompson & Vincent (1983) approximation; 1 in deep water (depth null)
export function depthAttenuation(f, depth) {
  if (!(depth > 0)) return 1;
  const wh = 2 * Math.PI * f * Math.sqrt(depth / G);
  return wh <= 1 ? 0.5 * wh * wh : wh < 2 ? 1 - 0.5 * (2 - wh) * (2 - wh) : 1;
}

// Dispersion: angular frequency of wavenumber k, and dw/dk, in water of depth `depth` (null: deep)
export function dispersion(k, depth = null) {
  if (!(depth > 0) || k * depth > 20) { const w = Math.sqrt(G * k); return { w, dwdk: 0.5 * w / k }; }
  const t = Math.tanh(k * depth), w = Math.sqrt(G * k * t), sech = 1 / Math.cosh(k * depth);
  return { w, dwdk: G * (t + k * depth * sech * sech) / (2 * w) };
}

// Elfouhaily variance density in frequency (deep water): S(f) = S(k) dk/df, k = (2 pi f)^2 / g, dk/df = 8 pi^2 f / g
function elfouhailyDensity(f, params) {
  const k = Math.pow(2 * Math.PI * f, 2) / G;
  return elfouhailyS(k, params) * 8 * Math.PI * Math.PI * f / G;
}

// Variance of a density over (0.2 fp .. 40 fp), log-spaced trapezoids
function integrateDensity(density, fp) {
  const n = 3000, lo = Math.log(0.2 * fp), hi = Math.log(40 * fp);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const f0 = Math.exp(lo + (hi - lo) * i / n), f1 = Math.exp(lo + (hi - lo) * (i + 1) / n);
    sum += 0.5 * (density(f0) + density(f1)) * (f1 - f0);
  }
  return sum;
}

// Resolved settings: defaults, and the peak period of a fully developed sea when Tp is not given
export function resolveSeaSettings(settings = {}) {
  const s = { ...DEFAULT_SEA_SETTINGS, ...settings };
  if (!SEA_SPECTRA.includes(s.spectrum)) s.spectrum = 'jonswap';
  s.depth = Number(s.depth) > 0 ? Number(s.depth) : null;
  s.randomAmplitudes = s.randomAmplitudes !== false;
  if (s.spectrum == 'elfouhaily') {
    // Hm0 and Tp from the spectrum
    s.elfouhaily = elfouhailyParams(s.spectrumWind, s.Omega);
    s.Tp = s.elfouhaily.Tp;
    s.Hm0 = 4 * Math.sqrt(integrateDensity(f => elfouhailyDensity(f, s.elfouhaily), 1 / s.Tp));
  }
  s.Hm0 = Math.max(0.01, Number(s.Hm0) || 0.01);
  s.TpAuto = !(s.Tp > 0);
  if (s.TpAuto) s.Tp = fullyDevelopedPeakPeriod(s.Hm0);
  s.gamma = Math.max(1, Number(s.gamma) || 1);
  // Hm0 of the spectrum drawn (below Hm0 in shallow water: the depth attenuation)
  s.Hm0Spectrum = s.depth ? 4 * Math.sqrt(integrateDensity(f => spectralDensity(f, s), 1 / s.Tp)) : s.Hm0;
  s.count = Math.max(1, Math.round(s.count));
  s.choppiness = Math.max(0, Number(s.choppiness ?? 1));
  if (!SEA_METHODS.includes(s.method)) s.method = 'fft';
  if (!SPREAD_MODEL_IDS.includes(s.spreadModel)) s.spreadModel = 'constant';
  s.spreadWindAuto = !(s.spreadWind > 0);
  s.spreadWindResolved = s.spreadWindAuto ? windOfSea(s.Hm0, s.Tp) : Number(s.spreadWind);
  s.spreadSmax = Math.max(1, Number(s.spreadSmax) || 10);
  return s;
}

// Directional spreading of the sea (DirectionalSpreading.createSpreading): D(f, theta), sigma1(f), draw(f, u)
export function seaSpreading(settings) {
  const s = settings.TpAuto === undefined ? resolveSeaSettings(settings) : settings;
  return createSpreading({ model: s.spreadModel, spread: s.spread, windSpeed: s.spreadWindResolved, smax: s.spreadSmax }, 1 / s.Tp);
}

// Variance density S(f) (m^2/Hz) of the target spectrum: integrates to (Hm0 / 4)^2 in deep water (less with a depth)
export function spectralDensity(f, settings) {
  const s = settings.TpAuto === undefined ? resolveSeaSettings(settings) : settings;
  if (!(f > 0)) return 0;
  let S;
  if (s.spectrum == 'elfouhaily' && s.elfouhaily) S = elfouhailyDensity(f, s.elfouhaily);
  else {
    const fp = 1 / s.Tp;
    const m0 = Math.pow(s.Hm0 / 4, 2);
    S = m0 * jonswapShape(f, fp, s.gamma) / (shapeIntegral(s.gamma) * Math.pow(fp, -4));
  }
  return S * depthAttenuation(f, s.depth);
}


// Generate the discrete waves of a sea state. Returns {settings, waves: [{hm0, T, dir, phase}], bins, ...}
export function generateSea(settings = {}) {
  const s = resolveSeaSettings(settings);
  const fp = 1 / s.Tp;
  // From 0.7 fp (below it there is almost no energy) to where the ripples start (or 3 fp for very short seas)
  const fLo = 0.7 * fp;
  const fHi = Math.max(SPLIT_FREQUENCY, 3 * fp);
  // Independent random streams, so that changing one setting does not reshuffle everything else
  const randF = mulberry32(s.seed), randDir = mulberry32(s.seed + 7919), randPhase = mulberry32(s.seed + 104729);
  const spreading = seaSpreading(s); // Each component draws its direction from the spreading at its frequency

  const waves = [], bins = [];
  let variance = 0, steepnessSum = 0;
  const ratio = fHi / fLo;
  for (let i = 0; i < s.count; i++) {
    const e0 = fLo * Math.pow(ratio, i / s.count), e1 = fLo * Math.pow(ratio, (i + 1) / s.count);
    const f = e0 * Math.pow(e1 / e0, 0.1 + 0.8 * randF()); // Random frequency inside the bin (away from its edges)
    const df = e1 - e0; // Bin width: the Jacobian between the component index and the frequency
    const a = Math.sqrt(2 * spectralDensity(f, s) * df);
    const dir = wrap360(s.Mdir + spreading.draw(f, randDir()));
    const phase = randPhase() * 360;
    const k = Math.pow(2 * Math.PI * f, 2) / G;
    waves.push({ hm0: 2 * a, T: 1 / f, dir, phase });
    bins.push({ f, df, f0: e0, f1: e1 });
    variance += a * a / 2;
    steepnessSum += a * k;
  }

  return {
    settings: s,
    fp, fLo, fHi,
    waves, bins,
    spreading,
    realizedHm0: 4 * Math.sqrt(variance), // Slightly below Hm0: the tail above fHi belongs to the ripples
    // Sum of a k: Gerstner crests can loop where the waves add up if it is over 1
    steepnessSum,
  };
}



// ---------------------------------------------------------------------------------------------
// FFT sea (Tessendorf 2001, "Simulating Ocean Water")
// ---------------------------------------------------------------------------------------------
// The same spectrum, sampled on a regular grid of wavevectors (kx, kz) = 2 pi (n, m) / L, n, m in [-N/2, N/2).
// Each grid point is one component: a deep-water wave of wavevector k, amplitude a and random phase phi.
// With Tessendorf's horizontal displacement D = lambda * (k / |k|) * a cos(...), every component is a trochoidal
// (Gerstner) wave, like the discrete waves:
//   height = a sin(k.x - w t + phi),   horizontal = lambda * (k / |k|) * a cos(k.x - w t + phi)
// The difference with the discrete waves is how they are combined: the FFT adds all the components at the rest
// position x (linear superposition of trochoids), while the shader chains the discrete waves (each one evaluated at
// the position displaced by the previous ones). The sea state analysis follows the same rules.
//
// Amplitude: the variance of a grid cell is Psi(kx, kz) dk^2 = a^2 / 2, with the wavenumber spectrum
//   Psi(kx, kz) = E(f, theta) * cg / (2 pi k)        (m^4)
// E(f, theta) = S(f) D(theta) is the directional spectrum (m^2/Hz/rad), cg / (2 pi) = df/dk the Jacobian from f to k
// and 1 / k the Jacobian from polar (k, theta) to Cartesian (kx, kz).
// Amplitudes: with randomAmplitudes (default) Rayleigh distributed, a sqrt(-ln u) (the modulus of Tessendorf's
// Gaussian complex amplitude, the same mean variance): wave groups and occasional steeper crests, as in the sea.
// Without, deterministic (sqrt of the expected variance): the realisation follows the target spectrum closely.
// With a depth, the finite-depth dispersion: f and cg = dw/dk from w^2 = g k tanh(k h).

export const FFT_N = 512;          // Grid size (texture size)
export const FFT_MIN_SIZE = 512;   // Minimum tile size (m)
// Components are kept up to this fraction of the Nyquist wavenumber pi N / L (4 texels per wavelength or more):
// shorter ones would be distorted by the interpolation between texels. The ripples take over from there.
export const FFT_K_FRACTION = 0.5;

// Tile size: at least 4 peak wavelengths, so that the longest waves fit and the peak is well sampled
export function fftTileSize(Tp) {
  const peakWavelength = G * Tp * Tp / (2 * Math.PI);
  return Math.max(FFT_MIN_SIZE, 4 * peakWavelength);
}

// Variance of the target spectrum below fCut (numerical integral)
function bandVariance(settings, fCut) {
  const n = 4000, lo = Math.log(0.2 / settings.Tp), hi = Math.log(fCut);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const f0 = Math.exp(lo + (hi - lo) * i / n), f1 = Math.exp(lo + (hi - lo) * (i + 1) / n);
    sum += 0.5 * (spectralDensity(f0, settings) + spectralDensity(f1, settings)) * (f1 - f0);
  }
  return sum;
}

// FFT sea for the settings. Returns:
//   amp, phase, omega: Float64Array N*N, per texel (n, m) at m * N + n -> FFTOcean.setSpectrum()
//   components: the components that carry 99.95% of the variance, in the discrete-wave format
//     {hm0: 2a, T, dir (from), phase (deg), chop}, for the sea state analysis
//   slopeTensor: {xx, zz, xz}, mean square slopes of all the components (for the ripples' slope budget)
export function generateFFTSea(settings = {}, N = FFT_N) {
  const s = resolveSeaSettings(settings);
  const L = fftTileSize(s.Tp);
  const dk = 2 * Math.PI / L;
  const kCut = FFT_K_FRACTION * Math.PI * N / L;
  const fCut = dispersion(kCut, s.depth).w / (2 * Math.PI);
  const spreading = seaSpreading(s);
  const meanDir = s.Mdir * DEG2RAD;
  const rand = mulberry32(s.seed + 31337);
  const randAmp = mulberry32(s.seed + 4241); // Own stream: the toggle changes only the amplitudes

  const amp = new Float64Array(N * N), phases = new Float64Array(N * N), omega = new Float64Array(N * N);
  let variance = 0;
  for (let m = 0; m < N; m++) {
    for (let n = 0; n < N; n++) {
      const phase = rand() * 2 * Math.PI; // Drawn for every texel: the phases do not depend on the cut
      const rayleigh = Math.sqrt(-Math.log(1 - randAmp())); // Mean square 1
      const nn = n < N / 2 ? n : n - N, mm = m < N / 2 ? m : m - N;
      const kx = nn * dk, kz = mm * dk, k = Math.hypot(kx, kz);
      if (k == 0 || k > kCut) continue;
      const disp = dispersion(k, s.depth);
      const f = disp.w / (2 * Math.PI);
      // Direction the component comes FROM (clockwise from north), from its travel direction (kx, kz) / k
      const from = Math.atan2(-kx / k, kz / k);
      let rel = from - meanDir;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const D = spreading.D(f, rel);                                          // 1/rad
      const E = spectralDensity(f, s) * D;                                    // m^2/Hz/rad
      const cg = disp.dwdk;
      const psi = E * cg / (2 * Math.PI * k);                                 // m^4
      const a = Math.sqrt(2 * psi * dk * dk) * (s.randomAmplitudes ? rayleigh : 1);
      amp[m * N + n] = a;
      phases[m * N + n] = phase;
      variance += a * a / 2;
    }
  }
  // The grid samples the spectrum coarsely around the peak: scale to the exact variance of the band below kCut
  const target = bandVariance(s, fCut);
  const scale = variance > 0 ? Math.sqrt(target / variance) : 0;

  const all = [];
  const slopeTensor = { xx: 0, zz: 0, xz: 0 };
  for (let m = 0; m < N; m++) {
    for (let n = 0; n < N; n++) {
      const i = m * N + n;
      const a = amp[i] * scale;
      amp[i] = a;
      if (!(a > 0)) continue;
      const nn = n < N / 2 ? n : n - N, mm = m < N / 2 ? m : m - N;
      const kx = nn * dk, kz = mm * dk, k = Math.hypot(kx, kz);
      const w = dispersion(k, s.depth).w;
      omega[i] = w;
      const v = 0.5 * a * a;
      slopeTensor.xx += v * kx * kx; slopeTensor.zz += v * kz * kz; slopeTensor.xz += v * kx * kz;
      all.push({ a, kx, kz, k, w, phase: phases[i] });
    }
  }

  // Components for the analysis: the largest ones, up to 99.95% of the variance
  all.sort((p, q) => q.a - p.a);
  const totalVariance = all.reduce((sum, c) => sum + c.a * c.a / 2, 0);
  const components = [];
  let acc = 0;
  for (const c of all) {
    if (acc >= 0.9995 * totalVariance) break;
    acc += c.a * c.a / 2;
    components.push({ hm0: 2 * c.a, T: 2 * Math.PI / c.w, dir: wrap360(Math.atan2(-c.kx / c.k, c.kz / c.k) * RAD2DEG),
      phase: wrap360(c.phase * RAD2DEG), chop: s.choppiness, k: c.k });
  }

  return {
    settings: s, N, L, dk, kCut, fCut, spreading,
    density: f => spectralDensity(f, s), // S(f) of the spectrum (m^2/Hz), continued by the strict ripples
    amp, phase: phases, omega, choppiness: s.choppiness, components, slopeTensor,
    numComponents: all.length,
    realizedHm0: 4 * Math.sqrt(totalVariance),
    componentsHm0: 4 * Math.sqrt(acc),
  };
}
