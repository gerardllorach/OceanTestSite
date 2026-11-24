// Sea state from a wave spectrum: the discrete (Gerstner) waves are a random realisation of a JONSWAP spectrum
// (Hasselmann et al. 1973; gamma = 1 is the Pierson-Moskowitz spectrum of a fully developed sea) with a cos^2s
// directional spreading (Longuet-Higgins et al. 1963). Pure module (no three.js): also used by the analysis and in node.
//
// Discretisation ("random frequency, single direction per component"): the frequency range is split into log-spaced
// bins, each component gets a random frequency inside its bin, an amplitude a = sqrt(2 S(f) df) from the bin width df,
// a random direction drawn from the spreading function and a random phase. Every component has its own frequency and
// direction, so the sea is short-crested and does not repeat. Seeded: the same settings give the same waves.
//
// The components stop where the surface ripples (Assets/Ocean/RippleSpectrum.js) start, at RIPPLE_K_MIN.

import { RIPPLE_K_MIN } from '/OceanTestSite/Assets/Ocean/RippleSpectrum.js';

export const G = 9.8; // Same gravity as the shader and the analysis
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export const DEFAULT_SEA_SETTINGS = {
  Hm0: 1.0,     // Significant wave height (m)
  Tp: null,     // Peak period (s). null: fully developed sea for Hm0 (Pierson-Moskowitz)
  gamma: 3.3,   // JONSWAP peak enhancement (1 = Pierson-Moskowitz, 3.3 = mean JONSWAP)
  Mdir: 0,      // Mean direction, where the waves come FROM (deg clockwise from north)
  spread: 30,   // Directional spread sigma1 (deg, Kuik et al. 1988)
  count: 40,    // Number of components (Gerstner waves)
  seed: 1,
};

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

// Resolved settings: defaults, and the peak period of a fully developed sea when Tp is not given
export function resolveSeaSettings(settings = {}) {
  const s = { ...DEFAULT_SEA_SETTINGS, ...settings };
  s.Hm0 = Math.max(0.01, Number(s.Hm0) || 0.01);
  s.TpAuto = !(s.Tp > 0);
  if (s.TpAuto) s.Tp = fullyDevelopedPeakPeriod(s.Hm0);
  s.gamma = Math.max(1, Number(s.gamma) || 1);
  s.count = Math.max(1, Math.round(s.count));
  return s;
}

// Variance density S(f) (m^2/Hz) of the target spectrum: integrates to (Hm0 / 4)^2
export function spectralDensity(f, settings) {
  const s = settings.TpAuto === undefined ? resolveSeaSettings(settings) : settings;
  const fp = 1 / s.Tp;
  const m0 = Math.pow(s.Hm0 / 4, 2);
  return m0 * jonswapShape(f, fp, s.gamma) / (shapeIntegral(s.gamma) * Math.pow(fp, -4));
}

// cos^2s((theta - mean) / 2) spreading. sigma1 = sqrt(2 / (1 + s)) rad, so s = 2 / sigma1^2 - 1 (0: uniform)
export function spreadingExponent(spreadDeg) {
  const sigma = Math.max(1, spreadDeg) * DEG2RAD;
  return Math.min(400, Math.max(0, 2 / (sigma * sigma) - 1));
}

// Inverse cumulative distribution of the spreading function, to draw directions with a single random number
function directionSampler(s) {
  const n = 1440;
  const theta = new Float64Array(n + 1), cdf = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) theta[i] = -Math.PI + 2 * Math.PI * i / n;
  for (let i = 1; i <= n; i++) {
    const p0 = Math.pow(Math.cos(theta[i - 1] / 2), 2 * s), p1 = Math.pow(Math.cos(theta[i] / 2), 2 * s);
    cdf[i] = cdf[i - 1] + 0.5 * (p0 + p1);
  }
  return u => {
    const target = u * cdf[n];
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cdf[mid] < target) lo = mid; else hi = mid; }
    const t = (target - cdf[lo]) / Math.max(1e-300, cdf[hi] - cdf[lo]);
    return (theta[lo] + t * (theta[hi] - theta[lo])) * RAD2DEG;
  };
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
  const drawDirection = directionSampler(spreadingExponent(s.spread));

  const waves = [], bins = [];
  let variance = 0, steepnessSum = 0;
  const ratio = fHi / fLo;
  for (let i = 0; i < s.count; i++) {
    const e0 = fLo * Math.pow(ratio, i / s.count), e1 = fLo * Math.pow(ratio, (i + 1) / s.count);
    const f = e0 * Math.pow(e1 / e0, 0.1 + 0.8 * randF()); // Random frequency inside the bin (away from its edges)
    const df = e1 - e0; // Bin width: the Jacobian between the component index and the frequency
    const a = Math.sqrt(2 * spectralDensity(f, s) * df);
    const dir = wrap360(s.Mdir + drawDirection(randDir()));
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
    realizedHm0: 4 * Math.sqrt(variance), // Slightly below Hm0: the tail above fHi belongs to the ripples
    // Sum of a k: Gerstner crests can loop where the waves add up if it is over 1
    steepnessSum,
  };
}
