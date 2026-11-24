// Sea state analysis of the simulated ocean, following what a directional wave buoy
// (Datawell Waverider, as used by CDIP) does with its heave / north / west displacements:
//   1. Record the displacements of the surface particle at rest position (0,0) -> simulateBuoy()
//   2. Welch cross-spectra between heave, north and east           -> crossSpectra()
//   3. Directional Fourier coefficients a1 b1 a2 b2 per frequency  -> directionalMoments()
//   4. Directional distribution with the Maximum Entropy Method    -> memDistribution()
//   5. Bulk parameters from spectral moments and zero-crossings    -> bulkParameters(), zeroCrossing()
//
// Direction convention (CDIP, CF): degrees clockwise from true north, direction waves come FROM.
// a1 = <cos(theta)>, b1 = <sin(theta)>, a2 = <cos(2 theta)>, b2 = <sin(2 theta)> over the directional
// distribution, so the mean direction is atan2(b1, a1).

import * as Gerstner from './gerstner.js'
import { FFT } from './fft.js'

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;


// ---------------------------------------------------------------------------------------------
// 1. Buoy displacements
// ---------------------------------------------------------------------------------------------
// Returns heave (up +), north (+) and west (+) excursions from the mean position, as Datawell does.
export function simulateBuoy(waves, samplingRate, durationSeconds, x0 = 0, z0 = 0) {
  const n = Math.max(2, Math.round(samplingRate * durationSeconds));
  const heave = new Float64Array(n), north = new Float64Array(n), west = new Float64Array(n);
  const p = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    Gerstner.getParticlePosition(p, waves, i / samplingRate, x0, z0);
    heave[i] = p[1];
    north[i] = -(p[2] - z0); // north is -z
    west[i] = -(p[0] - x0);  // east is +x
  }
  removeMean(heave); removeMean(north); removeMean(west);
  return { samplingRate, duration: n / samplingRate, heave, north, west };
}

function removeMean(arr) {
  let mean = 0;
  for (let i = 0; i < arr.length; i++) mean += arr[i];
  mean /= arr.length;
  for (let i = 0; i < arr.length; i++) arr[i] -= mean;
  return arr;
}


// ---------------------------------------------------------------------------------------------
// 2. Cross-spectra (Welch: Hann window, 50% overlap)
// ---------------------------------------------------------------------------------------------
// One-sided densities in m^2/Hz. C = co-spectrum (real part), Q = quad-spectrum (imag part of conj(X)*Y).
export function crossSpectra(z, n, e, samplingRate, segmentSeconds = 256) {
  const N = z.length;
  let nseg = Math.pow(2, Math.round(Math.log2(segmentSeconds * samplingRate)));
  nseg = Math.max(8, Math.min(nseg, Math.pow(2, Math.floor(Math.log2(N)))));
  const hop = nseg / 2;
  const numSegments = Math.floor((N - nseg) / hop) + 1;

  const window = new Float64Array(nseg);
  let windowPower = 0;
  for (let i = 0; i < nseg; i++) {
    window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / nseg);
    windowPower += window[i] * window[i];
  }

  const nf = nseg / 2 + 1;
  const S = { Czz: new Float64Array(nf), Cnn: new Float64Array(nf), Cee: new Float64Array(nf),
    Cne: new Float64Array(nf), Qzn: new Float64Array(nf), Qze: new Float64Array(nf) };

  const fft = new FFT(nseg);
  const Z = fft.createComplexArray(), Nn = fft.createComplexArray(), E = fft.createComplexArray();
  const buffer = fft.createComplexArray();
  const transformSegment = (signal, start, out) => {
    let mean = 0;
    for (let i = 0; i < nseg; i++) mean += signal[start + i];
    mean /= nseg;
    for (let i = 0; i < nseg; i++) {
      buffer[2 * i] = (signal[start + i] - mean) * window[i];
      buffer[2 * i + 1] = 0;
    }
    fft.transform(out, buffer);
  };

  for (let s = 0; s < numSegments; s++) {
    const start = s * hop;
    transformSegment(z, start, Z);
    transformSegment(n, start, Nn);
    transformSegment(e, start, E);
    for (let k = 0; k < nf; k++) {
      const zr = Z[2 * k], zi = Z[2 * k + 1];
      const nr = Nn[2 * k], ni = Nn[2 * k + 1];
      const er = E[2 * k], ei = E[2 * k + 1];
      S.Czz[k] += zr * zr + zi * zi;
      S.Cnn[k] += nr * nr + ni * ni;
      S.Cee[k] += er * er + ei * ei;
      S.Cne[k] += nr * er + ni * ei;
      S.Qzn[k] += zr * ni - zi * nr;
      S.Qze[k] += zr * ei - zi * er;
    }
  }

  const freq = new Float64Array(nf);
  for (let k = 0; k < nf; k++) {
    freq[k] = k * samplingRate / nseg;
    const scale = (k == 0 || k == nf - 1 ? 1 : 2) / (samplingRate * windowPower * numSegments);
    for (const key in S) S[key][k] *= scale;
  }

  return { freq, df: samplingRate / nseg, segmentLength: nseg, numSegments,
    degreesOfFreedom: 2 * numSegments, ...S };
}


// Average the cross-spectra over groups of `factor` adjacent bins (excluding DC), e.g. into the
// 0.01 Hz bands CDIP uses for its polar spectra. Densities stay in m^2/Hz.
export function mergeBands(spec, factor) {
  if (factor <= 1) return spec;
  const keys = ['Czz', 'Cnn', 'Cee', 'Cne', 'Qzn', 'Qze'];
  const nb = Math.floor((spec.freq.length - 1) / factor);
  const out = { freq: new Float64Array(nb), df: spec.df * factor, segmentLength: spec.segmentLength,
    numSegments: spec.numSegments, degreesOfFreedom: spec.degreesOfFreedom * factor };
  keys.forEach(key => out[key] = new Float64Array(nb));
  for (let b = 0; b < nb; b++) {
    for (let j = 0; j < factor; j++) {
      const k = 1 + b * factor + j;
      out.freq[b] += spec.freq[k] / factor;
      keys.forEach(key => out[key][b] += spec[key][k] / factor);
    }
  }
  return out;
}


// ---------------------------------------------------------------------------------------------
// 3. Directional moments per frequency (Longuet-Higgins et al. 1963; Kuik et al. 1988)
// ---------------------------------------------------------------------------------------------
export function directionalMoments(spec) {
  const nf = spec.freq.length;
  const out = { a1: new Float64Array(nf), b1: new Float64Array(nf), a2: new Float64Array(nf), b2: new Float64Array(nf),
    meanDir: new Float64Array(nf), spread: new Float64Array(nf), spread2: new Float64Array(nf), checkFactor: new Float64Array(nf) };
  for (let k = 0; k < nf; k++) {
    const horiz = spec.Cnn[k] + spec.Cee[k];
    const norm = Math.sqrt(spec.Czz[k] * horiz);
    if (!(norm > 0)) {
      out.a1[k] = out.b1[k] = out.a2[k] = out.b2[k] = out.meanDir[k] = out.spread[k] = out.spread2[k] = out.checkFactor[k] = NaN;
      continue;
    }
    const a1 = spec.Qzn[k] / norm, b1 = spec.Qze[k] / norm;
    const a2 = (spec.Cnn[k] - spec.Cee[k]) / horiz, b2 = 2 * spec.Cne[k] / horiz;
    out.a1[k] = a1; out.b1[k] = b1; out.a2[k] = a2; out.b2[k] = b2;
    out.meanDir[k] = wrap360(Math.atan2(b1, a1) * RAD2DEG);
    const r1 = Math.min(1, Math.hypot(a1, b1));
    out.spread[k] = Math.sqrt(2 * (1 - r1)) * RAD2DEG;
    const th1 = Math.atan2(b1, a1);
    const m2 = Math.min(1, a2 * Math.cos(2 * th1) + b2 * Math.sin(2 * th1));
    out.spread2[k] = Math.sqrt(Math.max(0, (1 - m2) / 2)) * RAD2DEG;
    // Horizontal / vertical displacement ratio. Equals 1 for linear deep-water waves (Gerstner waves are deep water).
    out.checkFactor[k] = Math.sqrt(horiz / spec.Czz[k]);
  }
  return out;
}

function wrap360(deg) { return ((deg % 360) + 360) % 360; }


// ---------------------------------------------------------------------------------------------
// 4. Maximum Entropy Method (Lygre & Krogstad 1986), as used for CDIP polar spectra
// ---------------------------------------------------------------------------------------------
// Returns D(theta) in 1/deg on the given bin centres (deg, from, clockwise from north); sums to 1 over the bins.
export function memDistribution(a1, b1, a2, b2, binCentersDeg) {
  const binWidth = 360 / binCentersDeg.length;
  const out = new Float64Array(binCentersDeg.length);
  // Keep the problem well posed: a perfectly unidirectional sea (r1 = 1) makes MEM singular
  let r1 = Math.hypot(a1, b1);
  if (r1 > 0.995) { a1 *= 0.995 / r1; b1 *= 0.995 / r1; }
  // c1 = (d1 - d2 conj(d1)) / (1 - |d1|^2), c2 = d2 - c1 d1
  const d1r = a1, d1i = b1, d2r = a2, d2i = b2;
  const den = 1 - (d1r * d1r + d1i * d1i);
  const c1r = (d1r - (d2r * d1r + d2i * d1i)) / den;
  const c1i = (d1i - (d2i * d1r - d2r * d1i)) / den;
  const c2r = d2r - (c1r * d1r - c1i * d1i);
  const c2i = d2i - (c1r * d1i + c1i * d1r);
  // Numerator 1 - c1 conj(d1) - c2 conj(d2) (real)
  const num = 1 - (c1r * d1r + c1i * d1i) - (c2r * d2r + c2i * d2i);

  // Integrate on a 1-degree sub-grid so narrow peaks are not missed between bin centres
  const sub = Math.max(1, Math.round(binWidth));
  let total = 0;
  for (let b = 0; b < binCentersDeg.length; b++) {
    let acc = 0;
    for (let s = 0; s < sub; s++) {
      const th = (binCentersDeg[b] - binWidth / 2 + (s + 0.5) * binWidth / sub) * DEG2RAD;
      const re = 1 - c1r * Math.cos(th) - c1i * Math.sin(th) - c2r * Math.cos(2 * th) - c2i * Math.sin(2 * th);
      const im = c1r * Math.sin(th) - c1i * Math.cos(th) + c2r * Math.sin(2 * th) - c2i * Math.cos(2 * th);
      acc += num / (re * re + im * im);
    }
    out[b] = acc / sub;
    total += out[b];
  }

  // Fallback to the (clipped) truncated Fourier series if MEM is ill-conditioned
  if (!(num > 0) || !isFinite(total) || total <= 0) {
    total = 0;
    for (let b = 0; b < binCentersDeg.length; b++) {
      const th = binCentersDeg[b] * DEG2RAD;
      out[b] = Math.max(0, 0.5 + a1 * Math.cos(th) + b1 * Math.sin(th) + a2 * Math.cos(2 * th) + b2 * Math.sin(2 * th));
      total += out[b];
    }
  }
  for (let b = 0; b < out.length; b++) out[b] /= total * binWidth;
  return out;
}


// ---------------------------------------------------------------------------------------------
// 5a. Zero-crossing (time domain) wave-by-wave analysis
// ---------------------------------------------------------------------------------------------
// Zero up-crossing method. Each wave is the record between two successive up-crossings.
export function zeroCrossing(z, samplingRate) {
  const crossings = [];
  for (let i = 1; i < z.length; i++) {
    if (z[i - 1] < 0 && z[i] >= 0)
      crossings.push(i - 1 + (-z[i - 1]) / (z[i] - z[i - 1])); // Interpolated sample index
  }
  const waves = [];
  for (let w = 0; w < crossings.length - 1; w++) {
    const i0 = Math.ceil(crossings[w]), i1 = Math.floor(crossings[w + 1]);
    let crest = -Infinity, trough = Infinity;
    for (let i = i0; i <= i1; i++) {
      if (z[i] > crest) crest = z[i];
      if (z[i] < trough) trough = z[i];
    }
    waves.push({ H: crest - trough, T: (crossings[w + 1] - crossings[w]) / samplingRate,
      crest, trough, time: crossings[w] / samplingRate });
  }

  const result = { waves, numWaves: waves.length };
  if (waves.length == 0) return result;

  const sorted = waves.slice().sort((a, b) => b.H - a.H);
  const meanOf = (arr, key) => arr.reduce((acc, w) => acc + w[key], 0) / arr.length;
  const top = fraction => sorted.slice(0, Math.max(1, Math.round(sorted.length * fraction)));
  result.Hmax = sorted[0].H;
  result.Tmax = sorted[0].T;
  result.H3 = meanOf(top(1 / 3), 'H');
  result.T3 = meanOf(top(1 / 3), 'T');
  result.H10 = meanOf(top(1 / 10), 'H');
  result.T10 = meanOf(top(1 / 10), 'T');
  result.Hmean = meanOf(waves, 'H');
  result.Hrms = Math.sqrt(waves.reduce((acc, w) => acc + w.H * w.H, 0) / waves.length);
  result.Tz = meanOf(waves, 'T');
  let maxCrest = -Infinity, minTrough = Infinity;
  for (let i = 0; i < z.length; i++) { maxCrest = Math.max(maxCrest, z[i]); minTrough = Math.min(minTrough, z[i]); }
  result.maxCrest = maxCrest;
  result.minTrough = minTrough;
  return result;
}


// ---------------------------------------------------------------------------------------------
// 5b. Spectral (frequency domain) parameters
// ---------------------------------------------------------------------------------------------
export function bulkParameters(spec, dir) {
  const f = spec.freq, S = spec.Czz, df = spec.df;
  const moment = n => { let m = 0; for (let k = 1; k < f.length; k++) m += Math.pow(f[k], n) * S[k] * df; return m; };
  const m_1 = moment(-1), m0 = moment(0), m1 = moment(1), m2 = moment(2), m4 = moment(4);

  // Peak: band maximum, refined by fitting a parabola through the three highest bands
  let kp = 1;
  for (let k = 1; k < f.length; k++) if (S[k] > S[kp]) kp = k;
  let fp = f[kp];
  if (kp > 1 && kp < f.length - 1) {
    const yl = S[kp - 1], yc = S[kp], yr = S[kp + 1];
    const denom = yl - 2 * yc + yr;
    if (denom < 0) fp = f[kp] + 0.5 * (yl - yr) / denom * df;
  }

  // Energy-weighted directional parameters
  let sa1 = 0, sb1 = 0, sa2 = 0, sb2 = 0, sE = 0;
  for (let k = 1; k < f.length; k++) {
    if (!isFinite(dir.a1[k])) continue;
    const e = S[k] * df;
    sa1 += e * dir.a1[k]; sb1 += e * dir.b1[k]; sa2 += e * dir.a2[k]; sb2 += e * dir.b2[k]; sE += e;
  }
  const A1 = sa1 / sE, B1 = sb1 / sE, A2 = sa2 / sE, B2 = sb2 / sE;
  const R1 = Math.min(1, Math.hypot(A1, B1));

  // Goda's peakedness parameter
  let qp = 0;
  for (let k = 1; k < f.length; k++) qp += f[k] * S[k] * S[k] * df;
  qp *= 2 / (m0 * m0);

  const Hm0 = 4 * Math.sqrt(m0);
  const Tp = 1 / fp;
  return {
    m0, m1, m2, m4, m_1,
    Hm0, Tp, fp, kp,
    Tm01: m0 / m1, Tm02: Math.sqrt(m0 / m2), Tm_10: m_1 / m0,
    Dp: dir.meanDir[kp], spreadPeak: dir.spread[kp],
    a1p: dir.a1[kp], b1p: dir.b1[kp], a2p: dir.a2[kp], b2p: dir.b2[kp],
    Mdir: wrap360(Math.atan2(B1, A1) * RAD2DEG),
    spreadMean: Math.sqrt(2 * (1 - R1)) * RAD2DEG,
    a1: A1, b1: B1, a2: A2, b2: B2,
    bandwidthEpsilon: Math.sqrt(Math.max(0, 1 - m2 * m2 / (m0 * m4))),
    bandwidthNu: Math.sqrt(Math.max(0, m0 * m2 / (m1 * m1) - 1)),
    peakedness: qp,
    steepness: 2 * Math.PI * Hm0 / (Gerstner.G * Tp * Tp),
    checkFactorPeak: dir.checkFactor[kp],
  };
}


// ---------------------------------------------------------------------------------------------
// 6. Theoretical parameters from the discrete input waves (linear theory)
// ---------------------------------------------------------------------------------------------
// Each wave is a sinusoid of amplitude a = hm0/2 and frequency 1/T, coming from `dir`. At the buoy it produces
//   heave = a sin(phase - w t),  north = -a cos(dir) cos(phase - w t),  east = -a sin(dir) cos(phase - w t).
// Waves with different periods add their variances. Waves with exactly the same period interfere, so they are
// added as complex amplitudes and their phases matter. Each period is one spectral line with its own
// co- and quad-spectra, which go through the same formulas as the measured spectrum.
// Only the linear motion is included: the sequential evaluation of the Gerstner waves (as in the shader) adds
// small non-linear interactions that the buoy measures but this calculation leaves out.
// Time-domain (zero-crossing) statistics have no exact equivalent for a deterministic sum of a few waves.
export function theoreticalParameters(waves) {
  const lines = new Map();
  let largest = null;
  waves.forEach(w => {
    const a = Math.abs(w.hm0) / 2, f = 1 / w.T;
    const th = (w.dir || 0) * DEG2RAD, ph = (w.phase || 0) * DEG2RAD;
    const key = f.toPrecision(12);
    if (!lines.has(key)) lines.set(key, { f, numWaves: 0, Zr: 0, Zi: 0, Nr: 0, Ni: 0, Er: 0, Ei: 0 });
    const L = lines.get(key);
    // Complex amplitudes A of Re(A exp(-i w t)): heave A = -i a e^{i phase}, horizontal A = -dir a e^{i phase}
    const cr = a * Math.cos(ph), ci = a * Math.sin(ph);
    L.numWaves++;
    L.Zr += ci; L.Zi -= cr;
    L.Nr -= Math.cos(th) * cr; L.Ni -= Math.cos(th) * ci;
    L.Er -= Math.sin(th) * cr; L.Ei -= Math.sin(th) * ci;
    if (!largest || a > largest.a) largest = { a, T: w.T, dir: wrap360((w.dir || 0)) };
  });

  // Variances and cross-variances of each line (m^2), same sign conventions as crossSpectra()
  const arr = [...lines.values()].map(L => ({ ...L,
    Czz: (L.Zr * L.Zr + L.Zi * L.Zi) / 2,
    Cnn: (L.Nr * L.Nr + L.Ni * L.Ni) / 2,
    Cee: (L.Er * L.Er + L.Ei * L.Ei) / 2,
    Cne: (L.Nr * L.Er + L.Ni * L.Ei) / 2,
    Qzn: (L.Zi * L.Nr - L.Zr * L.Ni) / 2,
    Qze: (L.Zi * L.Er - L.Zr * L.Ei) / 2,
  })).filter(L => L.Czz > 1e-12).sort((p, q) => p.f - q.f);
  if (arr.length == 0) return null;

  const spec = {};
  ['Czz', 'Cnn', 'Cee', 'Cne', 'Qzn', 'Qze', 'f'].forEach(key => spec[key] = Float64Array.from(arr, L => L[key]));
  spec.freq = spec.f;
  const dir = directionalMoments(spec);

  const moment = n => arr.reduce((m, L) => m + Math.pow(L.f, n) * L.Czz, 0);
  const m_1 = moment(-1), m0 = moment(0), m1 = moment(1), m2 = moment(2), m4 = moment(4);
  let kp = 0;
  arr.forEach((L, k) => { if (L.Czz > arr[kp].Czz) kp = k; });
  let sa1 = 0, sb1 = 0, sa2 = 0, sb2 = 0;
  arr.forEach((L, k) => {
    sa1 += L.Czz * dir.a1[k]; sb1 += L.Czz * dir.b1[k]; sa2 += L.Czz * dir.a2[k]; sb2 += L.Czz * dir.b2[k];
  });
  const A1 = sa1 / m0, B1 = sb1 / m0;
  const Hm0 = 4 * Math.sqrt(m0), fp = arr[kp].f, Tp = 1 / fp;

  return {
    m0, m1, m2, m4, m_1,
    Hm0, Tp, fp,
    Tm01: m0 / m1, Tm02: Math.sqrt(m0 / m2), Tm_10: m_1 / m0,
    Dp: dir.meanDir[kp], spreadPeak: dir.spread[kp],
    a1p: dir.a1[kp], b1p: dir.b1[kp], a2p: dir.a2[kp], b2p: dir.b2[kp],
    Mdir: wrap360(Math.atan2(B1, A1) * RAD2DEG),
    spreadMean: Math.sqrt(2 * (1 - Math.min(1, Math.hypot(A1, B1)))) * RAD2DEG,
    a1: A1, b1: B1, a2: sa2 / m0, b2: sb2 / m0,
    bandwidthEpsilon: Math.sqrt(Math.max(0, 1 - m2 * m2 / (m0 * m4))),
    bandwidthNu: Math.sqrt(Math.max(0, m0 * m2 / (m1 * m1) - 1)),
    steepness: 2 * Math.PI * Hm0 / (Gerstner.G * Tp * Tp),
    checkFactorPeak: dir.checkFactor[kp],
    largestWave: largest,
    numLines: arr.length,
    interferingLines: arr.filter(L => L.numWaves > 1).length,
  };
}


// ---------------------------------------------------------------------------------------------
// Full analysis
// ---------------------------------------------------------------------------------------------
export class OceanAnalysis {

  samplingRate = 2;     // Hz
  seconds = 60 * 60;    // Record length
  segmentSeconds = 256; // Welch segment length
  numDirections = 72;   // 5 degree bins, as CDIP polar spectra
  polarBandWidth = 0.01; // Hz, as CDIP polar spectra

  constructor(samplingRate, seconds) {
    this.samplingRate = samplingRate || this.samplingRate;
    this.seconds = seconds || this.seconds;
  }

  // waves: [{hm0, T, dir, phase}] as in the discrete waves panel / sceneManager.getDiscreteWaves()
  // options.matchGPU: analyse the waves as encoded in the 8-bit parameter texture (what is rendered)
  analyze(waves, options = {}) {
    const samplingRate = options.samplingRate || this.samplingRate;
    const seconds = options.seconds || this.seconds;
    const analysedWaves = options.matchGPU === false ? waves : Gerstner.toRenderedWaves(waves);

    const buoy = simulateBuoy(analysedWaves, samplingRate, seconds);
    const east = buoy.west.map(v => -v);
    const spec = crossSpectra(buoy.heave, buoy.north, east, samplingRate, this.segmentSeconds);
    const dir = directionalMoments(spec);
    const bulk = bulkParameters(spec, dir);
    const zc = zeroCrossing(buoy.heave, samplingRate);
    const bands = mergeBands(spec, Math.max(1, Math.round(this.polarBandWidth / spec.df)));
    const polar = this.polarSpectrum(bands, directionalMoments(bands));

    const nyquist = samplingRate / 2;
    const aliased = analysedWaves.filter(w => 1 / w.T > nyquist);

    return {
      settings: { samplingRate, seconds: buoy.duration, numSamples: buoy.heave.length,
        segmentLength: spec.segmentLength, numSegments: spec.numSegments, df: spec.df,
        degreesOfFreedom: spec.degreesOfFreedom, nyquist, matchGPU: options.matchGPU !== false },
      waves: analysedWaves,
      expected: { aliased },
      theoretical: theoreticalParameters(analysedWaves),
      buoy, spectrum: spec, directional: dir, bulk, zeroCrossing: zc, polar,
    };
  }

  // Directional spectrum E(f, theta) = S(f) D(f, theta) in m^2/Hz/deg (MEM), on numDirections bins
  polarSpectrum(spec, dir, minRelativeEnergy = 0.005) {
    const nd = this.numDirections;
    const dirs = new Float64Array(nd);
    for (let d = 0; d < nd; d++) dirs[d] = d * 360 / nd; // Bin centres: 0 = N, as CDIP
    let maxS = 0;
    for (let k = 0; k < spec.freq.length; k++) if (spec.freq[k] > 0) maxS = Math.max(maxS, spec.Czz[k]);
    const energy = [];
    let maxE = 0, peak = { f: NaN, dir: NaN, value: 0 };
    for (let k = 0; k < spec.freq.length; k++) {
      if (!(spec.freq[k] > 0) || !(spec.Czz[k] > minRelativeEnergy * maxS) || !isFinite(dir.a1[k])) { energy.push(null); continue; }
      const D = memDistribution(dir.a1[k], dir.b1[k], dir.a2[k], dir.b2[k], dirs);
      const row = new Float64Array(nd);
      for (let d = 0; d < nd; d++) {
        row[d] = spec.Czz[k] * D[d];
        if (row[d] > maxE) { maxE = row[d]; peak = { f: spec.freq[k], dir: dirs[d], value: row[d] }; }
      }
      energy.push(row);
    }
    return { freq: spec.freq, df: spec.df, dirs, binWidth: 360 / nd, energy, max: maxE, peak };
  }

}
