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
// waves: the discrete Gerstner waves, chained as in the shader.
// restWaves: trochoidal components added at the rest position (FFT sea and surface ripples the buoy can follow,
//   already filtered by buoyComponents()), or null
export function simulateBuoy(waves, samplingRate, durationSeconds, x0 = 0, z0 = 0, restWaves = null) {
  const n = Math.max(2, Math.round(samplingRate * durationSeconds));
  const heave = new Float64Array(n), north = new Float64Array(n), west = new Float64Array(n);
  const rest = restWaves && restWaves.length ? restLayerRecord(restWaves, samplingRate, n, x0, z0) : null;
  const p = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    Gerstner.getParticlePosition(p, waves, i / samplingRate, x0, z0);
    if (rest) { p[0] += rest.x[i]; p[1] += rest.y[i]; p[2] += rest.z[i]; }
    heave[i] = p[1];
    north[i] = -(p[2] - z0); // north is -z
    west[i] = -(p[0] - x0);  // east is +x
  }
  removeMean(heave); removeMean(north); removeMean(west);
  return { samplingRate, duration: n / samplingRate, heave, north, west };
}

// Displacement over time of the particle at rest position (x0, z0) due to trochoidal components added at the rest
// position: x = chop * dirX * a cos(f), y = a sin(f), z = chop * dirZ * a cos(f), f = k (dir . x0) - w t + phase
// (same as Gerstner.getGerstnerDisplacement evaluated at the rest position).
// An FFT sea has tens of thousands of components, but on a grid many share the same |k|, hence the same w: their
// complex amplitudes are summed once, and each group is then advanced in time by one complex rotation per sample.
export function restLayerRecord(components, samplingRate, n, x0 = 0, z0 = 0) {
  const groups = new Map();
  components.forEach(c => {
    if (!(c.T > 0)) return;
    const w = 2 * Math.PI / c.T;
    const k = w * w / Gerstner.G;
    const dirRad = (c.dir || 0) * DEG2RAD;
    const dx = Math.sin(-dirRad), dz = Math.cos(-dirRad);
    const a = c.hm0 / 2, chop = c.chop ?? 1;
    const phase0 = k * (dx * x0 + dz * z0) + (c.phase || 0) * DEG2RAD;
    const cr = a * Math.cos(phase0), ci = a * Math.sin(phase0);
    const key = w.toPrecision(12);
    let g = groups.get(key);
    if (!g) { g = { w, yr: 0, yi: 0, xr: 0, xi: 0, zr: 0, zi: 0 }; groups.set(key, g); }
    g.yr += cr; g.yi += ci;
    g.xr += chop * dx * cr; g.xi += chop * dx * ci;
    g.zr += chop * dz * cr; g.zi += chop * dz * ci;
  });
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
  const dt = 1 / samplingRate;
  for (const g of groups.values()) {
    // e^{-i w t}, advanced by e^{-i w dt}; recomputed exactly every 256 samples (no drift)
    const sr = Math.cos(g.w * dt), si = -Math.sin(g.w * dt);
    let er = 1, ei = 0;
    for (let i = 0; i < n; i++) {
      if ((i & 255) == 0) { er = Math.cos(g.w * i * dt); ei = -Math.sin(g.w * i * dt); }
      // A e^{-i w t}: height = Im(.), horizontal = Re(.)
      y[i] += g.yr * ei + g.yi * er;
      x[i] += g.xr * er - g.xi * ei;
      z[i] += g.zr * er - g.zi * ei;
      const nr = er * sr - ei * si;
      ei = er * si + ei * sr;
      er = nr;
    }
  }
  return { x, y, z, numGroups: groups.size };
}

// ---------------------------------------------------------------------------------------------
// 1b. What the buoy can follow of the surface ripples (Assets/Ocean/RippleSpectrum.js)
// ---------------------------------------------------------------------------------------------
// Ripples have periods of ~0.1-1.6 s, mostly above the Nyquist frequency of the record. A real buoy does not
// alias them: (1) its hull averages the surface over its diameter, so it cannot follow waves shorter than itself,
// and (2) its anti-alias filter removes the energy above its band before sampling. Both are modelled here:
//   (1) each ripple is scaled by the response of a disc of radius r, R(k) = 2 J1(k r) / (k r)
//   (2) ripples above `bandFraction` x Nyquist are left out of the record
// The Gerstner waves are not scaled (R > 0.995 for wavelengths over 20 m), so the analysis without ripples is unchanged.
export const BUOY_DIAMETER = 0.9;  // m, Datawell DWR-MkIII
export const BUOY_BAND_FRACTION = 0.9;

// Bessel function of the first kind, order 1: J1(x) = (1/pi) * integral over [0, pi] of cos(t - x sin t) dt
export function besselJ1(x) {
  const n = 256;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const t = Math.PI * i / n;
    sum += (i == 0 || i == n ? 0.5 : 1) * Math.cos(t - x * Math.sin(t));
  }
  return sum / n;
}

// Heave response of a disc of diameter `diameter` (m) to a wave of wavenumber k (rad/m)
export function hullResponse(k, diameter = BUOY_DIAMETER) {
  const x = k * diameter / 2;
  return x < 1e-6 ? 1 : 2 * besselJ1(x) / x;
}

// Split components added at the rest position (ripples, FFT sea) into the ones the buoy records (scaled by the hull
// response) and the ones above its band
export function buoyComponents(components, samplingRate, diameter = BUOY_DIAMETER, bandFraction = BUOY_BAND_FRACTION) {
  const cutoff = bandFraction * samplingRate / 2;
  const inBand = [], aboveBand = [];
  const responses = new Map(); // Many FFT components share |k|
  (components || []).forEach(r => {
    if (1 / r.T > cutoff) { aboveBand.push(r); return; }
    const k = r.k || 4 * Math.PI * Math.PI / (r.T * r.T * Gerstner.G);
    const key = k.toPrecision(10);
    if (!responses.has(key)) responses.set(key, hullResponse(k, diameter));
    const response = responses.get(key);
    inBand.push({ hm0: r.hm0 * response, T: r.T, dir: r.dir, phase: r.phase, chop: r.chop, hullResponse: response });
  });
  return { cutoff, inBand, aboveBand };
}
export const buoyRipples = buoyComponents;

// Variance density per layer on the frequency bins of a spectrum (m^2/Hz): each component adds (H/2)^2/2 to the bin
// of its frequency
export function layerDensity(components, spec) {
  const out = new Float64Array(spec.freq.length);
  (components || []).forEach(c => {
    const k = Math.round((1 / c.T) / spec.df);
    if (k >= 1 && k < out.length) out[k] += Math.pow(c.hm0 / 2, 2) / 2 / spec.df;
  });
  return out;
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


// The bins of the spectrum with centre frequency in [fmin, fmax] (the mean, f = 0, is left out)
export function selectBins(spec, fmin, fmax) {
  const keys = ['freq', 'Czz', 'Cnn', 'Cee', 'Cne', 'Qzn', 'Qze'];
  const ks = [];
  for (let k = 1; k < spec.freq.length; k++) if (spec.freq[k] >= fmin && spec.freq[k] <= fmax) ks.push(k);
  const out = { df: spec.df, segmentLength: spec.segmentLength, numSegments: spec.numSegments,
    degreesOfFreedom: spec.degreesOfFreedom };
  keys.forEach(key => out[key] = Float64Array.from(ks, k => spec[key][k]));
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
  // MEM needs moments of a valid (non-negative) distribution: the Toeplitz matrix of [1, d1, d2] must be
  // positive definite, i.e. |d2 - d1^2| < 1 - |d1|^2. A band with a single wave direction sits on that
  // boundary (|d1| = 1) and estimation noise can push it outside. Shrinking d_n by rho^n is the same as
  // convolving D with a narrow wrapped Cauchy kernel: it keeps the shape and makes the moments valid.
  const isValid = (d1r, d1i, d2r, d2i) => {
    const r2 = d1r * d1r + d1i * d1i;
    const er = d2r - (d1r * d1r - d1i * d1i), ei = d2i - 2 * d1r * d1i;
    return 1 - r2 - Math.hypot(er, ei) > 1e-4;
  };
  let rho = 1;
  while (!isValid(a1 * rho, b1 * rho, a2 * rho * rho, b2 * rho * rho) && rho > 0.5) rho *= 0.995;
  // c1 = (d1 - d2 conj(d1)) / (1 - |d1|^2), c2 = d2 - c1 d1
  const d1r = a1 * rho, d1i = b1 * rho, d2r = a2 * rho * rho, d2i = b2 * rho * rho;
  const den = 1 - (d1r * d1r + d1i * d1i);
  const c1r = (d1r - (d2r * d1r + d2i * d1i)) / den;
  const c1i = (d1i - (d2i * d1r - d2r * d1i)) / den;
  const c2r = d2r - (c1r * d1r - c1i * d1i);
  const c2i = d2i - (c1r * d1i + c1i * d1r);
  // Numerator 1 - c1 conj(d1) - c2 conj(d2) (real)
  const num = 1 - (c1r * d1r + c1i * d1i) - (c2r * d2r + c2i * d2i);

  // Integrate each bin on a 0.1-degree sub-grid so narrow peaks (a few tenths of a degree) are measured
  const sub = Math.max(1, Math.round(binWidth / 0.1));
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
    // (horizontal scaled by `chop` for the surface ripples)
    const cr = a * Math.cos(ph), ci = a * Math.sin(ph);
    const h = w.chop ?? 1;
    L.numWaves++;
    L.Zr += ci; L.Zi -= cr;
    L.Nr -= h * Math.cos(th) * cr; L.Ni -= h * Math.cos(th) * ci;
    L.Er -= h * Math.sin(th) * cr; L.Ei -= h * Math.sin(th) * ci;
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
  // Polar spectrum: 72 direction bins of 5 degrees (360 / 5, as CDIP). The frequency bins are the bins of the
  // spectrum (its resolution), between 33 s and 3 s by default
  numDirections = 72;
  polarFmin = 1 / 33; // Hz
  polarFmax = 1 / 3;
  buoyDiameter = BUOY_DIAMETER; // m, for the response to the surface ripples

  constructor(samplingRate, seconds) {
    this.samplingRate = samplingRate || this.samplingRate;
    this.seconds = seconds || this.seconds;
  }

  // waves: [{hm0, T, dir, phase}] the discrete Gerstner waves (discrete waves panel / sceneManager.getDiscreteWaves())
  // options.matchGPU: analyse the waves as stored in the float32 texture sent to the GPU (what is rendered)
  // options.fft: the FFT sea, as sceneManager.getFFTSea() (Assets/Ocean/SeaSpectrum.js generateFFTSea): its components
  //   (the ones carrying 99.95% of its variance) are trochoids added at the rest position. options.includeFFT === false
  //   leaves it out.
  // options.ripples: surface ripples, as sceneManager.getRipples() (Assets/Ocean/RippleSpectrum.js). They are sent to
  //   the GPU as floats, so they are never quantised. options.includeRipples === false leaves them out.
  //
  // The sea is made of layers, reported separately in `layers` (variance per layer, and its density on the bins of
  // the spectrum): the discrete Gerstner waves (chained), the FFT sea and the ripples (both at the rest position).
  // Every component of every layer is a trochoidal wave. A buoy follows the surface particle, so for each component it
  // records a sinusoidal heave (the sharp crests of a trochoid are only seen at a fixed point): the measured spectrum
  // is the sum of the variances of the components, plus the small interactions between the chained Gerstner waves.
  analyze(waves, options = {}) {
    const samplingRate = options.samplingRate || this.samplingRate;
    const seconds = options.seconds || this.seconds;
    const analysedWaves = options.matchGPU === false ? waves : Gerstner.toRenderedWaves(waves);
    const fftSea = options.includeFFT !== false && options.fft && options.fft.components.length ? options.fft : null;
    const rippleSet = options.includeRipples !== false && options.ripples && options.ripples.components && options.ripples.components.length ? options.ripples : null;
    const fftBand = buoyComponents(fftSea ? fftSea.components : [], samplingRate, this.buoyDiameter);
    const band = buoyComponents(rippleSet ? rippleSet.components : [], samplingRate, this.buoyDiameter);
    const restInBand = fftBand.inBand.concat(band.inBand);

    const buoy = simulateBuoy(analysedWaves, samplingRate, seconds, 0, 0, restInBand);
    const east = buoy.west.map(v => -v);
    const spec = crossSpectra(buoy.heave, buoy.north, east, samplingRate, this.segmentSeconds);
    const dir = directionalMoments(spec);
    const bulk = bulkParameters(spec, dir);
    const zc = zeroCrossing(buoy.heave, samplingRate);
    const polar = this.directionalSpectrum(spec);

    const nyquist = samplingRate / 2;
    const aliased = analysedWaves.filter(w => 1 / w.T > nyquist);
    const hasLayers = !!(fftSea || rippleSet);
    const gerstnerTheory = analysedWaves.length ? theoreticalParameters(analysedWaves) : null;

    return {
      settings: { samplingRate, seconds: buoy.duration, numSamples: buoy.heave.length,
        segmentLength: spec.segmentLength, numSegments: spec.numSegments, df: spec.df,
        degreesOfFreedom: spec.degreesOfFreedom, nyquist, matchGPU: options.matchGPU !== false,
        includeFFT: !!fftSea, includeRipples: !!rippleSet, buoyDiameter: this.buoyDiameter, buoyCutoff: band.cutoff },
      waves: analysedWaves,
      expected: { aliased, ripplesAboveBand: band.aboveBand, fftAboveBand: fftBand.aboveBand.length },
      // Theoretical: what the buoy can measure (all layers in its band, with the hull response)
      theoretical: theoreticalParameters(analysedWaves.concat(restInBand)),
      // Full surface: all the components of all the layers (what is rendered; a buoy cannot measure it all)
      theoreticalFull: hasLayers ? theoreticalParameters(analysedWaves.concat(fftSea ? fftSea.components : [], rippleSet ? rippleSet.components : [])) : null,
      // Discrete waves with exactly the same period interfere (their phases matter)
      gerstnerInterferingLines: gerstnerTheory ? gerstnerTheory.interferingLines : 0,
      layers: this.layerSummary(spec, analysedWaves, fftSea, fftBand, rippleSet, band),
      ripples: rippleSet ? this.rippleSummary(analysedWaves.concat(fftSea ? fftSea.components : []), rippleSet, band) : null,
      buoy, spectrum: spec, directional: dir, bulk, zeroCrossing: zc, polar,
    };
  }

  // Contribution of each layer: variance of the full layer and of what the buoy measures of it, and the density of
  // what the buoy measures on the bins of the spectrum
  layerSummary(spec, waves, fftSea, fftBand, rippleSet, band) {
    const variance = list => list.reduce((sum, w) => sum + Math.pow(w.hm0 / 2, 2) / 2, 0);
    // Shared log-spaced frequency bands (0.02 - 20 Hz) for the density of the full layers (Ripples & slopes tab)
    const logF = { f0: 0.02, f1: 20, n: 90 };
    const logDensity = list => {
      const out = new Float64Array(logF.n), r = Math.log(logF.f1 / logF.f0);
      list.forEach(c => {
        const b = Math.floor(logF.n * Math.log((1 / c.T) / logF.f0) / r);
        if (b >= 0 && b < logF.n) out[b] += Math.pow(c.hm0 / 2, 2) / 2;
      });
      for (let b = 0; b < logF.n; b++) out[b] /= logF.f0 * (Math.exp(r * (b + 1) / logF.n) - Math.exp(r * b / logF.n));
      return out;
    };
    const layer = (name, all, inBand, extra = {}) => ({ name, numComponents: all.length,
      m0: variance(all), m0InBand: variance(inBand), density: layerDensity(inBand, spec),
      logDensity: logDensity(all), logDensityInBand: logDensity(inBand), ...extra });
    const out = { gerstner: layer('Discrete Gerstner waves', waves, waves, { method: 'chained' }),
      logBands: Array.from({ length: logF.n }, (_, b) => logF.f0 * Math.exp(Math.log(logF.f1 / logF.f0) * (b + 0.5) / logF.n)) };
    if (fftSea) out.fft = layer('FFT sea (Tessendorf)', fftSea.components, fftBand.inBand, {
      method: 'rest position', gridComponents: fftSea.numComponents, L: fftSea.L, kCut: fftSea.kCut, fCut: fftSea.fCut,
      choppiness: fftSea.settings.choppiness, settings: fftSea.settings });
    if (rippleSet) out.ripples = layer('Surface ripples (FFT)', rippleSet.components, band.inBand, {
      method: 'rest position', gridComponents: rippleSet.numComponents, L: rippleSet.L, kMin: rippleSet.kMin, kCut: rippleSet.kCut });
    return out;
  }

  // Contribution of the ripples: variance (and Hm0) of the full surface and of what the buoy measures, slopes.
  // waves: the components of the other layers (discrete waves and FFT sea)
  rippleSummary(waves, rippleSet, band) {
    const variance = list => list.reduce((sum, w) => sum + Math.pow(w.hm0 / 2, 2) / 2, 0);
    const m0Waves = variance(waves);
    const hm0 = m0 => 4 * Math.sqrt(m0);
    const full = variance(rippleSet.components), inBand = variance(band.inBand);
    return {
      settings: rippleSet.settings, windSpeed: rippleSet.windSpeed, windDir: rippleSet.windDir,
      numRipples: rippleSet.components.length, numInBand: band.inBand.length, numAboveBand: band.aboveBand.length,
      gridComponents: rippleSet.numComponents, L: rippleSet.L, kMin: rippleSet.kMin, kCut: rippleSet.kCut,
      cutoff: band.cutoff, buoyDiameter: this.buoyDiameter,
      m0Waves,
      deltaM0: { full, inBand },
      deltaHm0: { full: hm0(m0Waves + full) - hm0(m0Waves), inBand: hm0(m0Waves + inBand) - hm0(m0Waves) },
      slopes: rippleSet.slopes, tailSigma2: rippleSet.tailSigma2,
    };
  }

  // Directional spectrum E(f, theta) = S(f) D(f, theta) in m^2/Hz/deg (MEM), for the polar plot: one ring per
  // frequency bin of the spectrum between fmin and fmax, and `numDirections` bins (centred on 0 = N)
  directionalSpectrum(spec, { numDirections = this.numDirections, fmin = this.polarFmin, fmax = this.polarFmax } = {}) {
    const bins = selectBins(spec, fmin, fmax);
    return this.polarSpectrum(bins, directionalMoments(bins), numDirections);
  }

  polarSpectrum(spec, dir, numDirections = this.numDirections, fmin = 0, fmax = Infinity, minRelativeEnergy = 0.005) {
    const nd = numDirections;
    const dirs = new Float64Array(nd);
    for (let d = 0; d < nd; d++) dirs[d] = d * 360 / nd; // Bin centres: 0 = N, as CDIP
    const inRange = k => spec.freq[k] > 0 && spec.freq[k] + spec.df / 2 >= fmin && spec.freq[k] - spec.df / 2 <= fmax;
    let maxS = 0;
    for (let k = 0; k < spec.freq.length; k++) if (inRange(k)) maxS = Math.max(maxS, spec.Czz[k]);
    const energy = [];
    let maxE = 0, peak = { f: NaN, dir: NaN, value: 0 };
    for (let k = 0; k < spec.freq.length; k++) {
      if (!inRange(k) || !(spec.Czz[k] > minRelativeEnergy * maxS) || !isFinite(dir.a1[k])) { energy.push(null); continue; }
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
