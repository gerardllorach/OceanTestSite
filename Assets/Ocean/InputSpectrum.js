// Input spectrum of the generated sea: what the three layers put into the surface, before any measurement.
//   - Sea: the JONSWAP x spreading spectrum that the FFT grid samples (Assets/Ocean/SeaSpectrum.js generateFFTSea), from
//     its longest grid wave to where its grid stops (fCut). Without an FFT (fallback), the band of the Gerstner sea.
//   - Swell: the discrete Gerstner waves. Each one is a line: all its variance at one frequency and one direction.
//   - Ripples: the saturation-range spectrum that the ripple grid samples (Assets/Ocean/RippleSpectrum.js), from fCut
//     to the shortest ripple of the grid.
// The sea and the ripples are the continuous spectra their grids sample, not the grid points themselves: the FFT grid
// has only a few wavevectors around the peak (spacing 2 pi / L), which would leave holes in a polar plot.
// The sea state analysis (Assets/Scripts/OceanAnalysis) measures the same surface with a virtual buoy.
//
// state = {fft (generateFFTSea output or null), sea (generateSea output or null), swell ([{hm0, T, dir}]),
//          ripples (generateRipples output or null)}

import { G, spectralDensity, seaSpreading } from '/OceanTestSite/Assets/Ocean/SeaSpectrum.js';
import { wrappedNormal } from '/OceanTestSite/Assets/Ocean/RippleSpectrum.js';

const DEG2RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const wrap360 = deg => ((deg % 360) + 360) % 360;
const kOf = f => Math.pow(TWO_PI * f, 2) / G; // Deep water
const fOf = k => Math.sqrt(G * k) / TWO_PI;

// Frequency band of each layer (Hz), or null
export function seaBand(state) {
  if (state.fft) return [fOf(0.5 * state.fft.dk), state.fft.fCut];
  if (state.sea) return [state.sea.fLo, state.sea.fHi];
  return null;
}
export function rippleBand(state) {
  const r = state.ripples;
  return r && r.enabled && r.spectrum ? [fOf(r.kMin), fOf(r.kCut)] : null;
}

// Variance of a discrete wave (m^2)
const lineVariance = w => Math.pow(Math.abs(w.hm0) / 2, 2) / 2;

// SEA: E(f, theta) = S(f) D(f, theta), m^2/Hz/rad. theta: direction the waves come from (rad, clockwise from north).
// D: the directional spreading of the sea (DirectionalSpreading.js), which may change with the frequency
function seaDensity(state, f, theta, band) {
  if (!band || f < band[0] || f > band[1]) return 0;
  const sea = state.fft || state.sea, s = sea.settings;
  const spreading = sea.spreading || seaSpreading(s);
  return spectralDensity(f, s) * spreading.D(f, wrapPi(theta - s.Mdir * DEG2RAD));
}

// RIPPLES: E(f, theta) = Psi(k, theta) k dk/df, m^2/Hz/rad, with Psi = scale^2 k^-4 D(theta; sigma(k)) (per unit area of
// the wavevector plane, see generateRipples) and dk/df = 4 pi sqrt(k / g).
// The grid carries a bit more variance than this integral over [kMin, kCut] (~30%): its first ring of wavevectors,
// at kMin, also stands for the cells just below it, where k^-4 is largest. The spectrum is scaled to the variance of
// the grid, the one rendered and analysed.
function rippleS(r, f) {
  const sp = r.spectrum, k = kOf(f);
  return sp.scale * sp.scale * Math.pow(k, -3) * 4 * Math.PI * Math.sqrt(k / G);
}
const rippleNormCache = new WeakMap();
function rippleNorm(r, band) {
  if (!rippleNormCache.has(r)) {
    const analytic = integrateLog(band, f => rippleS(r, f));
    rippleNormCache.set(r, analytic > 0 && r.heightVariance > 0 ? r.heightVariance / analytic : 1);
  }
  return rippleNormCache.get(r);
}
function rippleDensity(state, f, theta, band) {
  if (!band || f < band[0] || f > band[1]) return 0;
  const r = state.ripples, sp = r.spectrum;
  const k = kOf(f);
  const sigma = r.autoSpread ? Math.min(1.6, sp.sigmaTheta * (1 + sp.spreadGrowth * Math.log(k / r.kMin) / sp.logRange)) : sp.sigmaTheta;
  const D = wrappedNormal(wrapPi(theta - r.windDir * DEG2RAD), sigma);
  return rippleNorm(r, band) * rippleS(r, f) * D;
}

// Integral of density(f) df over band = [f0, f1] (log-spaced trapezoids)
function integrateLog(band, density, n = 2000) {
  if (!band) return 0;
  const lo = Math.log(band[0]), hi = Math.log(band[1]);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const f0 = Math.exp(lo + (hi - lo) * i / n), f1 = Math.exp(lo + (hi - lo) * (i + 1) / n);
    sum += 0.5 * (density(f0) + density(f1)) * (f1 - f0);
  }
  return sum;
}

// Frequency spectra S(f) (m^2/Hz) of the sea and the ripples at `freqs`, and the swell lines
export function frequencySpectrum(state, freqs) {
  const sb = seaBand(state), rb = rippleBand(state);
  const sea = Array.from(freqs, f => sb && f >= sb[0] && f <= sb[1] ? spectralDensity(f, (state.fft || state.sea).settings) : 0);
  // The directional distribution of the ripples integrates to 1
  const ripples = Array.from(freqs, f => !rb || f < rb[0] || f > rb[1] ? 0 : rippleNorm(state.ripples, rb) * rippleS(state.ripples, f));
  const swell = (state.swell || []).filter(w => w.T > 0).map(w => ({ f: 1 / w.T, T: w.T, dir: wrap360(w.dir || 0), variance: lineVariance(w) }));
  return { sea, ripples, swell, seaBand: sb, rippleBand: rb };
}

// Variance of each layer (m^2)
export function layerVariances(state) {
  const sb = seaBand(state), rb = rippleBand(state);
  return {
    sea: integrateLog(sb, f => spectralDensity(f, (state.fft || state.sea).settings)),
    swell: (state.swell || []).reduce((m, w) => m + lineVariance(w), 0),
    ripples: rb ? state.ripples.heightVariance : 0,
  };
}

// Directional spectrum on a polar grid, in the format of OceanAnalysis.polarSpectrum (for AnalysisCharts.polarChart):
// numFreqs rings between fmin and fmax, numDirections direction bins centred on 0, binWidth, 2 binWidth... (deg).
// Energy in m^2/Hz/deg: the continuous layers averaged over each cell (sub x sub samples), each swell line spread over
// the cell that holds it (variance / (df binWidth)).
export function directionalSpectrum(state, { fmin, fmax, numFreqs = 60, numDirections = 72, sub = 4 } = {}) {
  const df = (fmax - fmin) / numFreqs;
  const binWidth = 360 / numDirections;
  const freq = Float64Array.from({ length: numFreqs }, (_, i) => fmin + (i + 0.5) * df);
  const dirs = Array.from({ length: numDirections }, (_, d) => d * binWidth);
  const sb = seaBand(state), rb = rippleBand(state);
  const energy = [];
  let max = 0, peak = { f: NaN, dir: NaN, E: 0 };
  for (let i = 0; i < numFreqs; i++) {
    const row = new Float64Array(numDirections);
    for (let d = 0; d < numDirections; d++) {
      let sum = 0;
      for (let a = 0; a < sub; a++) {
        const f = freq[i] + ((a + 0.5) / sub - 0.5) * df;
        for (let b = 0; b < sub; b++) {
          const theta = (dirs[d] + ((b + 0.5) / sub - 0.5) * binWidth) * DEG2RAD;
          sum += seaDensity(state, f, theta, sb) + rippleDensity(state, f, theta, rb);
        }
      }
      row[d] = sum / (sub * sub) * DEG2RAD; // per rad -> per deg
    }
    energy.push(row);
  }
  (state.swell || []).forEach(w => {
    if (!(w.T > 0)) return;
    const f = 1 / w.T;
    if (f < fmin || f >= fmax) return;
    const i = Math.min(numFreqs - 1, Math.floor((f - fmin) / df));
    const d = Math.round(wrap360(w.dir || 0) / binWidth) % numDirections;
    energy[i][d] += lineVariance(w) / (df * binWidth);
  });
  energy.forEach((row, i) => row.forEach((E, d) => {
    if (E > max) { max = E; peak = { f: freq[i], dir: dirs[d], E }; }
  }));
  return { freq, df, dirs, binWidth, energy, max, peak };
}
