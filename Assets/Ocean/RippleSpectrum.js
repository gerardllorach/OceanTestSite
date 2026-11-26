// Surface ripples: the short waves (from where the FFT sea stops, ~4 m, down to a few cm) on a second FFT cascade
// (Assets/Ocean/FFTOcean.js), a small tile next to the tile of the sea. The GPU computes their displacement, slopes
// and Jacobian; the shader adds them to the sea, displaces the geometry with them where the mesh is fine enough and
// draws their normals down to the pixel. Finer than that, the mipmaps keep their slope variance as roughness.
//
// Each grid point is a trochoidal (Gerstner) component, like the FFT sea: height a sin(k.x - w t + phi), horizontal
// (k / |k|) a cos(...), deep-water dispersion w^2 = g k (g = 9.8, the capillary term below ~5 cm is left out to keep
// a single wave model). The sea state analysis adds them at the rest position, like the FFT sea.
//
// Spectrum: the saturation range, F(k) ~ k^-3 (Phillips 1958), i.e. the same slope variance per octave, with a
// directional spreading around the wind that is broader for shorter ripples. In the wavevector plane
//   Psi(kx, kz) = F(k) D(theta) / k ~ k^-4 D(theta)          (the 1/k is the Jacobian from polar to Cartesian)
// It is scaled so that the mean square slope of the whole surface (discrete waves + FFT sea + ripples + tail) matches
// Cox & Munk (1954). The tail (the part of the slope budget finer than the ripple grid) is roughness only (Bruneton et
// al. 2010, "Real-time realistic ocean lighting using seamless transitions from geometry to BRDF").

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

export const DEFAULT_RIPPLE_SETTINGS = {
  mode: 'seaState', // 'wind': windSpeed / windDir below. 'seaState': derived from the waves
  windSpeed: 7,     // U10, m/s
  windDir: 0,       // Where the wind comes FROM, deg clockwise from north
  enabled: true,    // false: no ripple grid, only roughness (the tail carries the whole budget)
  seed: 20261124,   // Fixed seed: the same settings always give the same ripples (reproducible renders)
  // Directionality
  directionMode: 'wind', // 'wind': the ripples come from the wind direction (or the mean wave direction). 'custom'
  direction: 0,          // Custom direction the ripples come FROM (deg clockwise from north)
  spreadMode: 'auto',    // 'auto': spread from the Cox-Munk cross/up slope ratio, broader for shorter ripples. 'custom'
  spread: 30,            // Custom directional spread (deg, width of the wrapped normal distribution), the same for all
  strength: 1,           // Custom only: fraction of the slope budget given to the ripples and the tail (0: glassy surface)
  // Light wind: 'coxMunk' keeps the Cox-Munk slopes at any wind (their fit has slopes even at 0 m/s); 'onset' keeps
  // LIGHT_WIND_FLOOR of them up to LIGHT_WIND[0] and the full Cox-Munk slopes from LIGHT_WIND[1] on (lightWindFactor)
  lightWind: 'coxMunk',
  // Rendering only (no new spectrum): ripples strained by the long waves, steeper on the crests and smoother in the
  // troughs (Longuet-Higgins & Stewart 1960). 0: off, 1: physical, up to 10: exaggerated
  strain: 1,
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

// Wrapped normal distribution of width sigma (rad), per radian
export function wrappedNormal(theta, sigma) {
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
  //  - auto: chosen so that the cross / up ratio of the slopes, <sin^2> / <cos^2> = (1 - e) / (1 + e) with
  //    e = exp(-2 sigma^2), matches the budget, and broader for shorter ripples (towards +60% at the shortest), as
  //    observed for short wind waves. The tail then completes Cox-Munk along both axes.
  //  - custom: the same width for all the ripples. The total slope stays the Cox-Munk one, but its split between
  //    upwind and crosswind follows the chosen spread (a narrow spread gives long-crested ripples)
  const ratio = budget.up > 0 ? Math.min(0.98, budget.cross / budget.up) : 0.98;
  const autoSpread = s.spreadMode != 'custom';
  const sigmaTheta = autoSpread ? Math.sqrt(-0.5 * Math.log((1 - ratio) / (1 + ratio)))
    : clamp(Number(s.spread) || 30, 1, 180) * DEG2RAD;
  const spreadGrowth = autoSpread ? 0.6 : 0;
  const logRange = Math.log(kCut / kMin);

  const amp = new Float64Array(N * N), phase = new Float64Array(N * N), omega = new Float64Array(N * N);
  const rand = mulberry32(s.seed);
  let rawSlope = 0;
  const windRad = windDir * DEG2RAD;
  for (let m = 0; m < N; m++) {
    for (let n = 0; n < N; n++) {
      const ph = rand() * TWO_PI; // Drawn for every texel: the phases do not depend on the range
      if (!s.enabled) continue;
      const nn = n < N / 2 ? n : n - N, mm = m < N / 2 ? m : m - N;
      const kx = nn * dk, kz = mm * dk, k = Math.hypot(kx, kz);
      if (k < kMin * (1 - 1e-9) || k > kCut) continue;
      const from = Math.atan2(-kx / k, kz / k); // Direction the component comes from
      let rel = from - windRad;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const sigma = autoSpread ? Math.min(1.6, sigmaTheta * (1 + spreadGrowth * Math.log(k / kMin) / logRange)) : sigmaTheta;
      const psi = Math.pow(k, -4) * wrappedNormal(rel, sigma); // Saturation range, any scale
      const a = Math.sqrt(2 * psi * dk * dk);
      const i = m * N + n;
      amp[i] = a; phase[i] = ph; omega[i] = Math.sqrt(G * k);
      rawSlope += 0.5 * a * a * k * k;
    }
  }

  // Scale so that the grid carries EXPLICIT_FRACTION of the slope budget
  const scale = rawSlope > 0 ? Math.sqrt(EXPLICIT_FRACTION * (budget.up + budget.cross) / rawSlope) : 0;
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

  // Tail: the rest of the budget along each axis (roughness only). With a custom spread, what the grid carries in
  // excess along one axis is taken from the tail of the other one, so that the total stays Cox-Munk
  let tail = { up: Math.max(0, budget.up - ripplesSlopes.up), cross: Math.max(0, budget.cross - ripplesSlopes.cross) };
  const excess = Math.max(0, ripplesSlopes.up - budget.up) + Math.max(0, ripplesSlopes.cross - budget.cross);
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
    lightWindFactor: onset, // Share of the Cox-Munk budget left by the light-wind onset (1 with 'coxMunk')
    windDir,       // Direction of the ripples (from): the wind, or the custom direction
    sourceWindDir, // Wind direction (or mean wave direction in 'seaState' mode)
    spread: sigmaTheta * RAD2DEG, // Directional spread of the longest ripples (deg)
    autoSpread,
    seaStateHm0: seaState.Hm0,
    // Grid (FFTOcean.setSpectrum)
    N, L, dk, kMin, kMax: kCut, kCut, amp, phase, omega, choppiness: 1,
    numComponents: all.length,
    // Continuous spectrum the grid samples (rippleDirectionalDensity in Assets/Ocean/InputSpectrum.js):
    // Psi(kx, kz) = scale^2 k^-4 D(theta; sigma(k)) for kMin <= k <= kCut
    spectrum: { scale, sigmaTheta, spreadGrowth, logRange },
    components,
    ripples: components, // Same list (older name)
    chop: 1, // Horizontal displacement factor (1: trochoids)
    slopeTensor,
    tailSigma2: tail, // Upwind / crosswind slope variance of the tail
    slopes: { coxMunk: target, gerstner, fft: fftSlopes, ripples: ripplesSlopes, tail, total },
    heightVariance: variance, // m^2
  };
}
