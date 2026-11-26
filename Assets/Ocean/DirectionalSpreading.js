// Directional spreading of the sea: D(f, theta), the share of the energy at frequency f that travels in each direction
// (1/rad, integrates to 1 over a full turn), theta measured from the mean direction. Pure module (no three.js).
//
// Models (SPREAD_MODELS):
//   constant       cos^2s(theta / 2), the same s at every frequency, from the directional spread sigma1 (by hand)
//                  (Longuet-Higgins et al. 1963; sigma1 as in Kuik et al. 1988)
//   mitsuyasu      cos^2s(theta / 2), Mitsuyasu et al. (1975), cloverleaf buoy:
//                    s = s_p (f / fp)^5 for f <= fp,  s_p (f / fp)^-2.5 for f > fp
//                    s_p = 11.5 (2 pi fp U10 / g)^-2.5 = 11.5 (U10 / cp)^-2.5   (cp: phase speed of the peak)
//   hasselmann     cos^2s(theta / 2), Hasselmann, Dunckel & Ewing (1980), JONSWAP pitch-roll buoy:
//                    s = 6.97 (f / fp)^4.06 for f < 1.05 fp,  9.77 (f / fp)^mu for f >= 1.05 fp
//                    mu = -2.33 - 1.45 (U10 / cp - 1.17)
//   donelan        sech^2(beta theta), Donelan, Hamilton & Hui (1985), Lake Ontario wave-staff array:
//                    beta = 2.61 (f / fp)^1.3 for 0.56 < f / fp < 0.95,  2.28 (f / fp)^-1.3 for 0.95 <= f / fp < 1.6,
//                    1.24 otherwise (their suggestion outside the measured range)
//   donelanBanner  as donelan, with Banner (1990) above 1.6 fp (stereo photographs of the short waves):
//                    beta = 10^(-0.4 + 0.8393 exp(-0.567 ln((f / fp)^2)))   (1.24 at 1.6 fp: continuous)
//   goda           cos^2s(theta / 2), the Mitsuyasu shape with a chosen peak value s_max (Goda & Suzuki 1975):
//                    s = s_max (f / fp)^5 for f <= fp,  s_max (f / fp)^-2.5 for f > fp
//                    s_max = 10 wind waves, 25 swell with a short decay distance, 75 swell with a long decay distance
//
// mitsuyasu and hasselmann depend on the wind through the inverse wave age U10 / cp: a young, growing sea (high
// U10 / cp) spreads more than an old one. When no wind is given, it is the wind of a JONSWAP sea with the same Hm0 and
// Tp (windOfSea).
//
// cos^2s(theta / 2) is normalised exactly (Gamma functions); sech^2(beta theta) over -pi..pi. The spread sigma1(f)
// (Kuik et al. 1988) is sqrt(2 (1 - m1)), m1 = integral of D cos(theta): sqrt(2 / (s + 1)) for cos^2s.

const G = 9.8; // Same gravity as SeaSpectrum.js (which imports this module)
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const MAX_S = 400; // cos^2s exponent cap (sigma1 ~ 4 deg): almost a single direction

export const SPREAD_MODELS = [
  { id: 'constant', title: 'Constant σ1 (by hand)', needsWind: false },
  { id: 'mitsuyasu', title: 'Mitsuyasu et al. (1975)', needsWind: true },
  { id: 'hasselmann', title: 'Hasselmann et al. (1980)', needsWind: true },
  { id: 'donelan', title: 'Donelan et al. (1985)', needsWind: false },
  { id: 'donelanBanner', title: 'Donelan et al. (1985) + Banner (1990)', needsWind: false },
  { id: 'goda', title: 'Goda & Suzuki (1975), s_max', needsWind: false },
];
export const SPREAD_MODEL_IDS = SPREAD_MODELS.map(m => m.id);
export const needsWind = model => !!(SPREAD_MODELS.find(m => m.id == model) || {}).needsWind;

// Goda & Suzuki (1975) peak values of s
export const GODA_SMAX = [
  { value: 10, title: 'Wind waves' },
  { value: 25, title: 'Young swell' },
  { value: 75, title: 'Old swell' },
];


// cos^2s exponent for a directional spread sigma1 (deg): sigma1 = sqrt(2 / (1 + s)) rad, so s = 2 / sigma1^2 - 1
export function spreadingExponent(spreadDeg) {
  const sigma = Math.max(1, spreadDeg) * DEG2RAD;
  return Math.min(MAX_S, Math.max(0, 2 / (sigma * sigma) - 1));
}

// ln Gamma(x), x > 0 (Lanczos, g = 7, 9 terms)
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function lnGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Integral of cos^2s(theta / 2) over a full turn: 2 sqrt(pi) Gamma(s + 1/2) / Gamma(s + 1)
export function cos2sNorm(s) {
  return 2 * Math.sqrt(Math.PI) * Math.exp(lnGamma(s + 0.5) - lnGamma(s + 1));
}

// Wind (U10, m/s) of a JONSWAP sea (Hasselmann et al. 1973) with this Hm0 and Tp: the fetch-limited growth laws
//   Hm0 = 1.6e-3 sqrt(X) U10^2 / g,  Tp = U10 X^0.33 / (3.5 g)   (X = g fetch / U10^2)
// solved for U10 (Assets/Ocean/WindSea.js has the same laws, the other way round). A sea with a longer Tp than a
// fully developed one for its Hm0 (swell-like) gives a lighter wind, so an older, narrower sea.
export function windOfSea(Hm0, Tp) {
  if (!(Hm0 > 0) || !(Tp > 0)) return 0;
  const A = Math.pow(Hm0 * G / 1.6e-3, 2);              // X = A / U^4
  const U = Math.pow(Tp * 3.5 * G / Math.pow(A, 0.33), -1 / 0.32); // Tp 3.5 g = U (A / U^4)^0.33
  return isFinite(U) ? U : 0;
}

// Inverse wave age U10 / cp of the peak (deep water): ~0.83 for a fully developed sea, over 1 for a growing sea
export function inverseWaveAge(U10, fp) {
  return fp > 0 ? U10 * 2 * Math.PI * fp / G : NaN;
}

// Parameter of the spreading at frequency ratio r = f / fp: {kind: 'cos2s', s} or {kind: 'sech2', beta}
function parameterAt(model, r, p) {
  switch (model) {
    case 'mitsuyasu': {
      const s = r <= 1 ? p.sPeak * Math.pow(r, 5) : p.sPeak * Math.pow(r, -2.5);
      return { kind: 'cos2s', s: Math.min(MAX_S, s) };
    }
    case 'hasselmann': {
      const s = r < 1.05 ? 6.97 * Math.pow(r, 4.06) : 9.77 * Math.pow(r, p.mu);
      return { kind: 'cos2s', s: Math.min(MAX_S, s) };
    }
    case 'goda': {
      const s = r <= 1 ? p.smax * Math.pow(r, 5) : p.smax * Math.pow(r, -2.5);
      return { kind: 'cos2s', s: Math.min(MAX_S, s) };
    }
    case 'donelan':
    case 'donelanBanner': {
      let beta = 1.24;
      if (r > 0.56 && r < 0.95) beta = 2.61 * Math.pow(r, 1.3);
      else if (r >= 0.95 && r < 1.6) beta = 2.28 * Math.pow(r, -1.3);
      else if (r >= 1.6 && model == 'donelanBanner') beta = Math.pow(10, -0.4 + 0.8393 * Math.exp(-0.567 * Math.log(r * r)));
      return { kind: 'sech2', beta };
    }
    default:
      return { kind: 'cos2s', s: p.sConstant };
  }
}

// D (1/rad) for a parameter, theta in rad from the mean direction (-pi..pi)
function density(par, theta) {
  if (par.kind == 'sech2') {
    const c = Math.cosh(par.beta * theta);
    return par.beta / (c * c) / (2 * Math.tanh(par.beta * Math.PI));
  }
  return Math.pow(Math.abs(Math.cos(theta / 2)), 2 * par.s) / cos2sNorm(par.s);
}

// Spreading of a sea. settings: {model, spread (deg, constant), windSpeed (U10, m/s), smax (goda)}; fp: peak (Hz).
// Returns {model, fp, windSpeed, inverseWaveAge, parameter(f), D(f, theta) (1/rad), sigma1(f) (deg), draw(f, u) (deg)}
export function createSpreading(settings, fp) {
  const model = SPREAD_MODEL_IDS.includes(settings.model) ? settings.model : 'constant';
  const U = Math.max(0, Number(settings.windSpeed) || 0);
  const iwa = inverseWaveAge(U, fp);
  const p = {
    sConstant: spreadingExponent(Number(settings.spread) || 30),
    sPeak: U > 0 ? 11.5 * Math.pow(iwa, -2.5) : MAX_S,  // Mitsuyasu: no wind, no spreading
    mu: -2.33 - 1.45 * ((U > 0 ? iwa : 0) - 1.17),     // Hasselmann
    smax: Math.max(0, Number(settings.smax) || 10),     // Goda
  };
  const parameter = f => parameterAt(model, fp > 0 ? f / fp : 1, p);
  const D = (f, theta) => density(parameter(f), theta);
  const sigma1 = f => {
    const par = parameter(f);
    if (par.kind == 'cos2s') return Math.sqrt(2 / (par.s + 1)) * RAD2DEG;
    const n = 720;
    let m1 = 0;
    for (let i = 0; i < n; i++) { const t = -Math.PI + 2 * Math.PI * (i + 0.5) / n; m1 += density(par, t) * Math.cos(t) * 2 * Math.PI / n; }
    return Math.sqrt(2 * Math.max(0, 1 - m1)) * RAD2DEG;
  };
  // Direction (deg from the mean) drawn from D(f, .) with one uniform random number u (inverse cumulative distribution)
  const draw = (f, u) => {
    const par = parameter(f), n = 1440;
    const cdf = new Float64Array(n + 1);
    let prev = density(par, -Math.PI);
    for (let i = 1; i <= n; i++) {
      const cur = density(par, -Math.PI + 2 * Math.PI * i / n);
      cdf[i] = cdf[i - 1] + 0.5 * (prev + cur);
      prev = cur;
    }
    const target = u * cdf[n];
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cdf[mid] < target) lo = mid; else hi = mid; }
    const t = (target - cdf[lo]) / Math.max(1e-300, cdf[hi] - cdf[lo]);
    return (-Math.PI + 2 * Math.PI * (lo + t) / n) * RAD2DEG;
  };
  return { model, fp, windSpeed: U, inverseWaveAge: iwa, parameter, D, sigma1, draw };
}
