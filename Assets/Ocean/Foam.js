import * as THREE from 'three';

// WHITECAPS: foam left by breaking waves, at every scale (FFT sea and ripples, Assets/Ocean/FFTOcean.js).
//
// Where breaking starts: the Jacobian of the horizontal displacement, J = (1 + Dxx)(1 + Dzz) - Dxz^2 (Tessendorf
// 2001). J is the area of a patch of surface relative to its rest area: 1 for still water, below 1 where the waves
// squeeze the surface into a crest, 0 where it folds over. A crest steep enough to squeeze the surface below a
// threshold breaks. The breaking starts a little AHEAD of the crest: the source uses the Jacobian predicted a time
// 'lead' later, J + dJ/dt lead, which is the Jacobian a distance c lead ahead (c the phase speed).
//
// AT EVERY SCALE. The FFT maps are mipmapped: level l holds Dxx, Dzz, Dxz averaged over 2^l texels, where the waves
// shorter than ~4 2^l texels cancel out. So J at level l is the squeeze of the waves longer than
// lambda_l = 4 dx 2^l (dx = L / N: 4, 8, 16, 32 m at 'high'), and the scale of a breaker is the coarsest level that
// breaks. Its foam follows that scale: the breaking zone is as large as the wave (J_l is smooth over lambda_l), the
// foam lives about the wave period T = sqrt(2 pi lambda / g) (1.6 s for 4 m, 4.5 s for 32 m), it grows in a quarter
// of it, the collapse and the trail damping reach radiusFactor lambda around it, the bubbles go down ~0.15 lambda.
// Small breakers (waves of ~1-4 m) come from the ripple FFT, strained by the long waves (they break on the front faces
// of the long waves), without state: OceanProjectedGridShader.js draws them while their crest breaks.
//
// Where the foam is kept: textures of the size of the FFT sea grid, indexed by the REST position x0 like the FFT maps.
// In linear waves a water particle orbits around its rest position, so this grid moves with the water: foam written
// at x0 stays with the water without any advection, while the breaking crest travels on at its phase speed. That
// leaves the trail behind the crest. State (ping-pong, three textures):
//   0.R  surface foam     accumulates while the crest breaks (source dt / (T / 4), up to 1), fades over T persistence
//   0.G  breaking         grows towards the source in ~0.1 s, fades over 0.4 s: the breaking crest (stage A whitecap)
//   0.B  bubbles          accumulate like the foam, fade over 1.4 T persistence: bubble cloud under the surface
//   0.A  foam x scale     scale s = l / 3 of the breakers that made the foam, weighted by foam (s = A / R after
//                         filtering): sets the lifetime, the trail radius and the bubble depth
//   1.l  collapse of the breakers of level l (RGBA = levels 0..3): follows their breaking after ~0.2 T, fades over
//        ~0.6 T. The crest that has broken loses height and its water surges forward (vertex shader), read around it
//        at the mip of radiusFactor lambda_l: each scale softens its own neighbourhood
//   2.l  J_l - 1 of the previous frame (dJ/dt; J - 1 keeps the half-float precision of the slow coarse levels)
// Textures 0 and 1 are mipmapped: far away the shader reads the mean coverage of the area of the pixel (no aliasing),
// and the blurred mips spread the collapse and the trail around the crest.
//
// Breaking limits itself. The waves are damped where they have broken, in the geometry and in the breaking criterion:
//   - collapse: the crest that has just broken (texture 1)
//   - trail: the foam and bubbles left behind, max(foam, bubbles) (1 - breaking), so not the crest that is breaking
//     now. The crests that pass through a trail later are lower and less squeezed, and do not break there; they break
//     again ahead of it, in clean water. So the sea cannot turn all white.
// Both scale the FFT sea displacement: horizontal by (1 - trailDamping trail)(1 - 0.6 collapse), which also scales
// Dxx, Dzz, Dxz in J. Keep the same expressions in OceanProjectedGridShader.js (vertex and fragment shaders).
//
// How often crests break, two modes:
//   'wind'   the total comes from the wind. Whitecap coverage against the wind speed at 10 m (Monahan &
//            O'Muircheartaigh 1980): W = 3.84e-6 U10^3.41 (1% at 10 m/s, 4% at 15 m/s, 10% at 20 m/s). Only part of it
//            is actively breaking at any time (stage A, of the order of 20% of W; Monahan & Lu 1990). It is split
//            between the scales ('scaleSplit'):
//              'quantile'  the same breaking fraction at every scale
//              'phillips'  breaking crest length per unit area Lambda(c) ~ c^-6 (Phillips 1985), times the width of
//                          the breaking zone (~ lambda): many small breakers, few large ones
//            At each scale the divergence of the waves longer than lambda_l is Gaussian with variance
//            choppiness^2 sum(a^2 k^2 / 2) over those waves (sigmaJ_l), and E[J] = 1, so to first order
//            P(J_l < T_l) = Phi((T_l - 1) / sigmaJ_l): T_l is the quantile of that scale's breaking fraction. A swell
//            with no wind stays clean. The scales overlap (a large breaker also breaks the finer levels), the J
//            distribution is skewed, and the lead and the damping change the coverage, so the split cannot hit the
//            target by itself: OceanEntity reads the coverage drawn (measureCoverage) every 2 s and adjusts a gain
//            on the breaking fractions of the FFT sea scales ('gain' argument) until it matches.
//   'shape'  a fixed threshold on J at every scale: the crests break where the surface is squeezed enough, whatever the
//            wind. For a trochoid J = 1 - choppiness ak at the crest: the Stokes limit ak = 0.44 is J = 0.56.

export const DEFAULT_FOAM_SETTINGS = {
  enabled: true,
  mode: 'wind',          // 'wind': threshold from the wind (Monahan). 'shape': fixed threshold on the Jacobian
  amount: 1,             // 'wind': multiplies the target whitecap coverage
  scaleSplit: 'quantile', // 'wind': 'quantile' (same fraction per scale) or 'phillips' (Lambda(c) ~ c^-6)
  threshold: 0.6,        // 'shape': Jacobian below which a crest breaks
  lead: 0.3,             // s: the breaking zone is the Jacobian predicted this time ahead (ahead of the crest)
  persistence: 1,        // Multiplies the foam lifetimes (about the period of the breaking wave)
  collapse: 0.6,         // How much a crest that has broken loses height (0: off)
  radius: 0.3,           // Radius of the collapse and of the trail damping, times the breaking wavelength
  trailDamping: 0.5,     // How much the foam trail damps the waves that pass through it (0: off)
  surge: 0.8,            // Forward surge of a collapsing crest, times its height (0: off)
  small: true,           // Small breakers from the ripples (waves of ~1-4 m)
};
export const FOAM_MODES = ['wind', 'shape'];
export const FOAM_SCALE_SPLITS = ['quantile', 'phillips'];
export const FOAM_LEVELS = 4;         // Scales of the FFT sea: mip levels 0..3 of its maps
const SMALL_LEVELS = 2;               // Scales of the ripples: waves of ~1 m and ~2 m
const SMALL_SHORTEST = 1;             // m, the shortest small breaker

const G = 9.8;
const ACTIVE_SHARE = 0.2;             // Share of the whitecap coverage that is actively breaking (stage A)
const TAU_BREAKING = 0.4;             // s, the breaking channel fades (the crest moves on)
const TAU_GROW_BREAKING = 0.1;
const BUBBLE_FACTOR = 1.4;            // Bubbles live longer than the surface foam
const GROW_PERIODS = 0.25;            // Foam accumulates in a quarter of the wave period
const COLLAPSE_ATTACK_PERIODS = 0.2;  // The crest collapses ~0.2 T after it breaks
const COLLAPSE_RELEASE_PERIODS = 0.6; // and recovers over ~0.6 T
export const FOAM_DETAIL_N = 512;     // Texels of the foam detail texture
export const FOAM_DETAIL_SIZE = 5;    // m, its tile size (1 cm texels)

export const wavePeriod = lambda => Math.sqrt(2 * Math.PI * lambda / G);

// Whitecap coverage (fraction of the sea surface) for a wind speed U10 (m/s), Monahan & O'Muircheartaigh 1980
export function whitecapCoverage(U10) {
  return U10 > 0 ? Math.min(0.5, 3.84e-6 * Math.pow(U10, 3.41)) : 0;
}

// Inverse of the standard normal cumulative distribution (Acklam's rational approximation, relative error < 1.2e-9)
function normalQuantile(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pLow) return -normalQuantile(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Standard normal cumulative distribution (Abramowitz & Stegun 7.1.26, error < 1.5e-7)
function normalCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    * Math.exp(-x * x / 2);
  return 0.5 * (1 + Math.sign(x) * erf);
}

// Standard deviation of the divergence of the waves longer than each wavelength of `lambdas`, for a grid of
// components (FFTOcean.setSpectrum format: amp, omega; deep water k = w^2 / g): choppiness sqrt(sum a^2 k^2 / 2).
// Cached per grid (it is only recomputed when the waves change)
const sigmaCache = new WeakMap();
function divergenceSigmas(grid, lambdas) {
  if (!grid || !grid.amp) return lambdas.map(() => 0);
  const key = lambdas.map(l => l.toFixed(4)).join(',');
  let cached = sigmaCache.get(grid);
  if (cached && cached.key == key) return cached.sigmas;
  const kMax = lambdas.map(l => 2 * Math.PI / l);
  const sums = lambdas.map(() => 0);
  const { amp, omega } = grid;
  for (let i = 0; i < amp.length; i++) {
    const a = amp[i];
    if (!(a > 0)) continue;
    const k = omega[i] * omega[i] / G;
    const v = 0.5 * a * a * k * k;
    for (let j = 0; j < kMax.length; j++) if (k <= kMax[j]) sums[j] += v;
  }
  const chop = grid.choppiness ?? 1;
  const sigmas = sums.map(v => chop * Math.sqrt(v));
  sigmaCache.set(grid, { key, sigmas });
  return sigmas;
}

// Parameters of the foam for an FFT sea (generateFFTSea, Assets/Ocean/SeaSpectrum.js), the ripples (generateRipples,
// Assets/Ocean/RippleSpectrum.js; null: no small breakers) and a wind speed U10 (m/s). Pure function (no three.js).
// Returns {mode, scaleSplit, windSpeed, coverage (target W, 'wind' only), activeFraction (expected breaking fraction
// at all scales, before lead and damping), dx, lambda0, levels: [{lambda (m, shortest wave of the scale), period,
// sigmaJ, threshold, width, fraction (expected breaking fraction)}] for the FFT sea, small: {enabled, levels (mip
// levels of the ripple maps), scales: [same as levels], expected (mean coverage, for the far sea)}, steepness (ak of
// the 'shape' threshold), streak, lead, collapse, radius, trailDamping, surge, persistence}
// gain: multiplies the breaking fractions of the FFT sea scales in 'wind' mode (feedback from the coverage drawn)
export function foamCalibration(fftSea, windSpeed, settings = DEFAULT_FOAM_SETTINGS, ripples = null, gain = 1) {
  const s = { ...DEFAULT_FOAM_SETTINGS, ...settings };
  const mode = FOAM_MODES.includes(s.mode) ? s.mode : 'wind';
  const scaleSplit = FOAM_SCALE_SPLITS.includes(s.scaleSplit) ? s.scaleSplit : 'quantile';
  const U = Math.max(0, Number(windSpeed) || 0);
  const choppiness = fftSea ? (fftSea.choppiness ?? 1) : 1;

  // Scales of the FFT sea (mip levels of its maps) and of the small breakers (mip levels of the ripple maps)
  const dx = fftSea ? fftSea.L / fftSea.N : 1;
  const seaLambdas = Array.from({ length: FOAM_LEVELS }, (_, l) => 4 * dx * Math.pow(2, l));
  const seaSigmas = divergenceSigmas(fftSea, seaLambdas);
  let small = { enabled: false, levels: [0, 0], scales: [], expected: 0 };
  const smallOn = !!(s.small && ripples && ripples.enabled && ripples.amp);
  if (smallOn) {
    const rdx = ripples.L / ripples.N;
    const maxLevel = Math.max(0, Math.log2(ripples.N) - 2); // Waves of the tile size
    const first = Math.min(maxLevel - (SMALL_LEVELS - 1), Math.max(0, Math.round(Math.log2(SMALL_SHORTEST / (4 * rdx)))));
    const levels = Array.from({ length: SMALL_LEVELS }, (_, i) => first + i);
    const lambdas = levels.map(l => 4 * rdx * Math.pow(2, l));
    small = { enabled: true, levels, lambdas, sigmas: divergenceSigmas(ripples, lambdas), tile: ripples.L };
  }

  // Bands, from the shortest: [lambda, next lambda (Infinity for the longest)]
  const bands = [];
  if (small.enabled) small.lambdas.forEach((l, i) => bands.push({ small: true, lambda: l,
    upper: i + 1 < small.lambdas.length ? small.lambdas[i + 1] : small.tile, sigma: small.sigmas[i] }));
  seaLambdas.forEach((l, i) => bands.push({ small: false, lambda: l,
    upper: i + 1 < seaLambdas.length ? seaLambdas[i + 1] : Infinity, sigma: seaSigmas[i] }));

  let coverage = null, activeFraction = 0;
  if (mode == 'wind') {
    coverage = Math.min(0.5, whitecapCoverage(U) * Math.max(0, s.amount));
    const active = coverage * ACTIVE_SHARE;
    // Share of each band
    let weights;
    if (scaleSplit == 'phillips') {
      // Lambda(c) dc ~ c^-6 dc, c ~ lambda^0.5: crest length in [l1, l2] ~ l1^-2.5 - l2^-2.5, times the width of the
      // breaking zone ~ lambda (geometric mean of the band; twice the lower bound for the open band)
      weights = bands.map(b => {
        const upper = isFinite(b.upper) ? b.upper : 2 * b.lambda;
        return (Math.pow(b.lambda, -2.5) - (isFinite(b.upper) ? Math.pow(b.upper, -2.5) : 0)) * Math.sqrt(b.lambda * upper);
      });
    } else {
      weights = bands.map(() => 1);
    }
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    bands.forEach((b, i) => {
      b.fraction = active * weights[i] / total * (b.small ? 1 : gain);
      // No wind or a flat sea: a threshold no J reaches
      b.threshold = b.fraction > 1e-9 && b.sigma > 1e-6 ? 1 + b.sigma * normalQuantile(Math.min(0.5, b.fraction)) : -1e3;
    });
    activeFraction = active;
  } else {
    bands.forEach(b => {
      b.threshold = Number(s.threshold);
      b.fraction = b.sigma > 1e-6 ? normalCdf((b.threshold - 1) / b.sigma) : 0;
    });
  }
  bands.forEach(b => {
    b.width = Math.max(0.02, 0.5 * b.sigma); // J from threshold to threshold - width: from no source to full foam
    b.period = wavePeriod(b.lambda);
    b.sigmaJ = b.sigma;
  });
  const seaBands = bands.filter(b => !b.small);
  if (mode == 'shape') activeFraction = Math.min(1, bands.reduce((a, b) => Math.max(a, b.fraction), 0));
  if (small.enabled) {
    small.scales = bands.filter(b => b.small);
    // Mean coverage of the small breakers where they are finer than the pixel: P(J below the middle of the ramp)
    small.expected = Math.min(0.5, small.scales.reduce((a, b) =>
      Math.max(a, b.sigma > 1e-6 ? normalCdf((b.threshold - 0.5 * b.width - 1) / b.sigma) : 0), 0));
  }

  return {
    mode, scaleSplit, windSpeed: U, coverage, activeFraction, dx, lambda0: seaLambdas[0], gain,
    levels: seaBands, small,
    sigmaJ: seaSigmas[0], threshold: seaBands[0].threshold,
    steepness: choppiness > 0 ? (1 - Number(s.threshold)) / choppiness : null,
    // Beaufort 7 and above: foam blown in streaks along the wind ('wind' mode only)
    streak: mode == 'wind' ? 1 + 2 * Math.min(1, Math.max(0, (U - 12) / 8)) : 1,
    lead: Math.max(0, Number(s.lead) || 0),
    collapse: Math.max(0, Math.min(1, Number(s.collapse) || 0)),
    radius: Math.max(0.05, Number(s.radius) || 0.3),
    trailDamping: Math.max(0, Math.min(1, Number(s.trailDamping) || 0)),
    surge: Math.max(0, Number(s.surge) || 0),
    persistence: Math.max(0.2, Number(s.persistence) || 1),
    // Foam lifetime of the shortest and longest scales (s)
    tauFoam: [seaBands[0].period, seaBands[seaBands.length - 1].period].map(t => t * Math.max(0.2, Number(s.persistence) || 1)),
  };
}


const quadVertex = /* glsl */`
  varying vec2 v_uv;
  void main() { v_uv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// One step of the foam. Texel ij of the FFT maps = texel ij of the foam (same grid). Four scales: mip levels 0..3
const foamFragment = /* glsl */`
  precision highp float;
  layout(location = 0) out vec4 outState;    // (foam, breaking, bubbles, foam x scale)
  layout(location = 1) out vec4 outCollapse; // Collapse of the scales 0..3
  layout(location = 2) out vec4 outJ;        // J - 1 of the scales 0..3
  uniform sampler2D u_slopes;      // (hx, hz, Dxx, Dzz) of the FFT sea, mipmapped
  uniform sampler2D u_extra;       // (Dxz, hx^2, hz^2, hx hz)
  uniform sampler2D u_previous;    // State of the previous frame (mipmapped)
  uniform sampler2D u_previousCollapse;
  uniform sampler2D u_previousJ;
  uniform float u_N;
  uniform vec4 u_threshold;        // Per scale
  uniform vec4 u_width;
  uniform float u_dt;
  uniform float u_lead;            // s
  uniform float u_collapse;        // Strength of the collapse
  uniform float u_trailDamping;
  uniform float u_radiusLod;       // Mip level of the radius around a breaker of scale 0 (+1 per scale)
  uniform float u_period0;         // Period of the waves of scale 0 (s); x sqrt(2) per scale
  uniform float u_persistence;
  uniform vec2 u_decay;            // e^{-dt / tau}: breaking (fixed), grow rate of the breaking
  uniform vec4 u_collapseGrow;     // 1 - e^{-dt / attack} per scale
  uniform vec4 u_collapseDecay;    // e^{-dt / release} per scale
  uniform bool u_reset;

  // Towards target: grows with rate 'grow' when below it, fades with 'decay' (not below the target) otherwise
  float approach(float x, float target, float grow, float decay) {
    return target > x ? x + (target - x) * grow : max(x * decay, target);
  }

  float component(vec4 v, int i) { return i == 0 ? v.x : i == 1 ? v.y : i == 2 ? v.z : v.w; }

  void main() {
    ivec2 ij = ivec2(gl_FragCoord.xy);
    vec2 uv = (vec2(ij) + 0.5) / u_N;
    vec4 previous = u_reset ? vec4(0.0) : texelFetch(u_previous, ij, 0);
    vec4 previousCollapse = u_reset ? vec4(0.0) : texelFetch(u_previousCollapse, ij, 0);

    // Damping of the waves around this texel (same expressions in OceanProjectedGridShader.js):
    //  - trail: read at the radius of the scale of the foam here
    //  - collapse: each scale read at its own radius
    float foamScale = previous.r > 1e-3 ? clamp(previous.a / previous.r, 0.0, 1.0) : 0.0;
    vec4 around = u_reset ? vec4(0.0) : textureLod(u_previous, uv, u_radiusLod + 3.0 * foamScale);
    float trail = max(around.r, around.b) * (1.0 - around.g);
    float collapseAround = 0.0;
    if (!u_reset)
      for (int l = 0; l < 4; l++)
        collapseAround = max(collapseAround, component(textureLod(u_previousCollapse, uv, u_radiusLod + float(l)), l));
    float damp = (1.0 - u_trailDamping * trail) * (1.0 - 0.6 * u_collapse * collapseAround);

    // Breaking at each scale: J of the waves longer than the scale (mip level l of the maps), predicted u_lead ahead
    vec4 J1, source;
    float level = -1.0, src = 0.0;
    for (int l = 0; l < 4; l++) {
      vec4 sl = textureLod(u_slopes, uv, float(l));
      float dxz = textureLod(u_extra, uv, float(l)).x;
      float j1 = damp * (sl.z + sl.w) + damp * damp * (sl.z * sl.w - dxz * dxz); // J - 1
      float previousJ1 = u_reset ? j1 : component(texelFetch(u_previousJ, ij, 0), l);
      float dJdt = u_dt > 0.0 ? (j1 - previousJ1) / u_dt : 0.0;
      float sourceL = clamp((component(u_threshold, l) - (1.0 + j1 + dJdt * u_lead)) / component(u_width, l), 0.0, 1.0);
      if (l == 0) { J1.x = j1; source.x = sourceL; }
      else if (l == 1) { J1.y = j1; source.y = sourceL; }
      else if (l == 2) { J1.z = j1; source.z = sourceL; }
      else { J1.w = j1; source.w = sourceL; }
      if (sourceL > 0.02) level = float(l); // The coarsest scale that breaks: the scale of the breaker
      src = max(src, sourceL);
    }
    float newScale = max(level, 0.0) / 3.0;

    // Foam and bubbles: accumulate in a quarter of the period of the breaker, fade over its period (persistence)
    float period = u_period0 * exp2(1.5 * foamScale);        // T ~ sqrt(lambda), lambda = lambda0 2^(3 s)
    float newPeriod = u_period0 * exp2(1.5 * newScale);
    float grow = src * u_dt / (0.25 * newPeriod);
    float decayFoam = exp(-u_dt / (u_persistence * period));
    float decayBubbles = exp(-u_dt / (1.4 * u_persistence * period));
    float foam = min(1.0, previous.r * decayFoam + grow);
    float scaled = min(foam, previous.a * decayFoam + grow * newScale);
    float bubbles = min(1.0, previous.b * decayBubbles + grow);
    float breaking = approach(previous.g, src, u_decay.y, u_decay.x);
    vec4 collapse;
    for (int l = 0; l < 4; l++) {
      float c = approach(component(previousCollapse, l), component(source, l),
        component(u_collapseGrow, l), component(u_collapseDecay, l));
      if (l == 0) collapse.x = c; else if (l == 1) collapse.y = c; else if (l == 2) collapse.z = c; else collapse.w = c;
    }
    outState = vec4(foam, breaking, bubbles, scaled);
    outCollapse = collapse;
    outJ = J1;
  }
`;

// Mean of the foam (its last mip level), encoded for an 8-bit read: R = 40 mean (to 2.5%), G = mean
const meanFragment = /* glsl */`
  precision highp float;
  layout(location = 0) out vec4 outMean;
  uniform sampler2D u_foam;
  uniform float u_maxLod;
  void main() {
    vec4 m = textureLod(u_foam, vec2(0.5), u_maxLod);
    outMean = vec4(clamp(m.r * 40.0, 0.0, 1.0), clamp(m.r, 0.0, 1.0), clamp(m.g * 40.0, 0.0, 1.0), 1.0);
  }
`;


export class FoamSimulation {

  constructor(renderer, N) {
    this.renderer = renderer;
    this.N = N;
    this.needsReset = true;
    // Ping-pong, three textures, half float (an 8-bit foam would stop decaying, x * 0.99 rounds back to x): the state
    // and the collapse (mipmapped, repeated), and J - 1 (no mipmaps)
    const target = () => {
      const t = new THREE.WebGLRenderTarget(N, N, { count: 3,
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
        depthBuffer: false, stencilBuffer: false, generateMipmaps: true });
      const j = t.textures[2];
      j.minFilter = j.magFilter = THREE.NearestFilter;
      j.generateMipmaps = false;
      return t;
    };
    this.targets = [target(), target()];
    this.current = 0;

    const material = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ vertexShader: quadVertex, fragmentShader,
      uniforms, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false });
    this.material = material(foamFragment, { u_slopes: { value: null }, u_extra: { value: null },
      u_previous: { value: null }, u_previousCollapse: { value: null }, u_previousJ: { value: null }, u_N: { value: N },
      u_threshold: { value: new THREE.Vector4(-1e3, -1e3, -1e3, -1e3) }, u_width: { value: new THREE.Vector4(1, 1, 1, 1) },
      u_dt: { value: 0 }, u_lead: { value: 0 }, u_collapse: { value: 0 }, u_trailDamping: { value: 0 },
      u_radiusLod: { value: 0 }, u_period0: { value: 1.6 }, u_persistence: { value: 1 },
      u_decay: { value: new THREE.Vector2() }, u_collapseGrow: { value: new THREE.Vector4() },
      u_collapseDecay: { value: new THREE.Vector4() }, u_reset: { value: true } });
    this.meanMaterial = material(meanFragment, { u_foam: { value: null }, u_maxLod: { value: Math.log2(N) } });
    this.meanTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
    this.meanBuffer = new Uint8Array(4);

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.calibration = null;
  }

  // (foam, breaking, bubbles, foam x scale), mipmapped: read by the ocean shader
  get texture() { return this.targets[this.current].textures[0]; }
  // Collapse of the scales 0..3, mipmapped
  get collapseTexture() { return this.targets[this.current].textures[1]; }

  // calibration: output of foamCalibration
  setCalibration(calibration) {
    this.calibration = calibration;
    const u = this.material.uniforms, levels = calibration.levels;
    u.u_threshold.value.set(...levels.map(l => l.threshold));
    u.u_width.value.set(...levels.map(l => l.width));
    u.u_lead.value = calibration.lead;
    u.u_collapse.value = calibration.collapse;
    u.u_trailDamping.value = calibration.trailDamping;
    u.u_radiusLod.value = foamRadiusLod(calibration);
    u.u_period0.value = levels[0].period;
    u.u_persistence.value = calibration.persistence;
  }

  // Start from a clean sea (new waves: the old foam belongs to waves that no longer exist)
  reset() { this.needsReset = true; this.age = 0; }

  // One step of dt seconds, from the current maps of the FFT sea (an FFTOcean)
  update(fft, dt) {
    if (!this.calibration) return;
    const c = this.calibration, u = this.material.uniforms;
    dt = Math.max(0, dt);
    const decay = tau => Math.exp(-dt / tau), grow = tau => 1 - Math.exp(-dt / tau);
    u.u_decay.value.set(decay(TAU_BREAKING), grow(TAU_GROW_BREAKING));
    u.u_collapseGrow.value.set(...c.levels.map(l => grow(COLLAPSE_ATTACK_PERIODS * l.period)));
    u.u_collapseDecay.value.set(...c.levels.map(l => decay(COLLAPSE_RELEASE_PERIODS * l.period)));
    u.u_dt.value = dt;
    u.u_slopes.value = fft.slopesTexture;
    u.u_extra.value = fft.extraTexture;
    const previous = this.targets[this.current].textures;
    u.u_previous.value = previous[0];
    u.u_previousCollapse.value = previous[1];
    u.u_previousJ.value = previous[2];
    u.u_reset.value = this.needsReset;
    this.needsReset = false;
    this.age = (this.age || 0) + dt; // s since the last reset
    this.current = 1 - this.current;

    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.quad.material = this.material;
    renderer.setRenderTarget(this.targets[this.current]); // Mipmaps are generated after the render
    renderer.render(this.scene, this.camera);
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
  }

  // Mean foam drawn on the sea (fraction of the surface covered) and breaking fraction, read back from the GPU
  // without stalling it. Resolves to {coverage, active} or null
  async measureCoverage() {
    if (this.measuring) return null;
    this.measuring = true;
    try {
      const renderer = this.renderer;
      const previousTarget = renderer.getRenderTarget();
      this.meanMaterial.uniforms.u_foam.value = this.texture;
      this.quad.material = this.meanMaterial;
      renderer.setRenderTarget(this.meanTarget);
      renderer.render(this.scene, this.camera);
      renderer.setRenderTarget(previousTarget);
      const b = this.meanBuffer;
      if (renderer.readRenderTargetPixelsAsync) await renderer.readRenderTargetPixelsAsync(this.meanTarget, 0, 0, 1, 1, b);
      else renderer.readRenderTargetPixels(this.meanTarget, 0, 0, 1, 1, b);
      return { coverage: b[0] < 255 ? b[0] / 255 / 40 : b[1] / 255, active: b[2] / 255 / 40 };
    } finally {
      this.measuring = false;
    }
  }

  dispose() {
    this.targets.forEach(t => t.dispose());
    this.meanTarget.dispose();
    this.material.dispose();
    this.meanMaterial.dispose();
  }
}

// Mip level of the collapse and trail radius around a breaker of scale 0: radius lambda0 radiusFactor, lambda0 = 4 dx,
// so (in texels) 4 radiusFactor. Scale l: + l
export function foamRadiusLod(calibration) {
  return Math.log2(4 * calibration.radius);
}


// FOAM DETAIL: the structure of the foam finer than the foam texture (1-2 m texels). Tileable, 8 bits, mipmapped.
// 5 m tile: cells of ~0.3 m and ~0.12 m, fBm from ~0.6 m down to 8 cm.
// Lacy cells (Worley F2 - F1: low on the cell edges) with fBm, then equalised to a uniform histogram: the shader draws
// foam where detail < foam, so the mean coverage stays the foam value, and old (low) foam remains as a network of
// thin edges and patches instead of fading out evenly.
let detailTexture = null;
export function foamDetailTexture() {
  if (detailTexture) return detailTexture;
  const N = FOAM_DETAIL_N;
  let seed = 12345;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  // Periodic value noise of `cells` cells per tile
  const valueNoise = cells => {
    const g = new Float32Array(cells * cells).map(() => rand());
    const at = (i, j) => g[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)];
    return (x, y) => {
      const fx = x * cells, fy = y * cells, i = Math.floor(fx), j = Math.floor(fy);
      let tx = fx - i, ty = fy - j;
      tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
      const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
      return a + (b - a) * ty;
    };
  };
  const octaves = [8, 16, 32, 64].map(valueNoise);

  // Periodic Worley noise (one jittered point per cell): F2 - F1, low on the cell edges
  const worleyNoise = cells => {
    const points = new Float32Array(cells * cells * 2).map(() => rand());
    return (x, y) => {
      const fx = x * cells, fy = y * cells, i = Math.floor(fx), j = Math.floor(fy);
      let f1 = 1e9, f2 = 1e9;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ci = i + di, cj = j + dj;
        const k = (((cj % cells) + cells) % cells) * cells + (((ci % cells) + cells) % cells);
        const d = Math.hypot(ci + points[2 * k] - fx, cj + points[2 * k + 1] - fy);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      return Math.min(1, (f2 - f1) * 1.6);
    };
  };
  const coarseCells = worleyNoise(16), fineCells = worleyNoise(40);
  const warpX = valueNoise(10), warpY = valueNoise(10);
  const fbm = (u, v) => 0.5 * octaves[0](u, v) + 0.25 * octaves[1](u, v) + 0.15 * octaves[2](u, v) + 0.1 * octaves[3](u, v);

  const values = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    // Warped cells: irregular, of different sizes, instead of a regular honeycomb (periodic: the warp is periodic)
    const wu = u + 0.04 * (warpX(u, v) - 0.5), wv = v + 0.04 * (warpY(u, v) - 0.5);
    const cellsValue = 0.45 * coarseCells(wu, wv) + 0.55 * fineCells(wu + 0.37, wv + 0.11);
    values[y * N + x] = 0.45 * cellsValue + 0.55 * fbm(u, v);
  }
  // Equalise: value -> rank
  const order = new Uint32Array(N * N).map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const data = new Uint8Array(N * N);
  order.forEach((index, rank) => data[index] = Math.round(255 * rank / (N * N - 1)));

  detailTexture = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  detailTexture.wrapS = detailTexture.wrapT = THREE.RepeatWrapping;
  detailTexture.minFilter = THREE.LinearMipmapLinearFilter;
  detailTexture.magFilter = THREE.LinearFilter;
  detailTexture.generateMipmaps = true;
  detailTexture.needsUpdate = true;
  return detailTexture;
}
