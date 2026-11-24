// Gerstner waves on the CPU, mirroring GerstnerWave() in Assets/Ocean/OceanProjectedGridShader.js.
// Keep both in sync: the analysis must measure exactly the surface that is rendered.
// Surface ripples (Assets/Ocean/RippleSpectrum.js) are small waves of the same family (same format and dispersion
// relation). As in the fragment shader, they are evaluated at the particle's rest position and added on top of the
// Gerstner waves, instead of being chained like them.
//
// Scene axes: x = east, y = up, z = south (north is -z, see the "N" text mesh in SceneManager).
// Wave direction `dir` is where the waves come FROM, in degrees clockwise from north
// (shader: travel vector = (sin(-dir), cos(-dir)) in xz, so dir = 0 travels towards +z = south).

const G = 9.8; // Same gravity as the shader
const DEG2RAD = Math.PI / 180;

// Displacement produced by one wave for the particle at `position` (x, y, z). Written into `out`.
const getGerstnerDisplacement = function (out, position, wave, time) {
  const amplitude = wave.hm0 / 2;
  const T = Math.max(wave.T, 0.1);
  // Deep-water dispersion relation: the wavenumber depends on the period only (k = w^2 / g).
  // Removed clamp (as in the shader, see OceanProjectedGridShader.js): the wavelength used to come from
  // steepness = max(k * amplitude, 0.01) and amplitude = max(height, 0.01) / 2, most likely to avoid render
  // artifacts / degenerate waves (zero height -> infinite wavelength). As a lower bound it rendered low waves
  // (k * amplitude < 0.01) with a shorter period than requested, and it never prevented loops of too steep waves.
  const k = 4 * Math.PI * Math.PI / (T * T * G);
  const velocity = Math.sqrt(G / k);

  const dirRad = (wave.dir || 0) * DEG2RAD;
  const dirX = Math.sin(-dirRad);
  const dirZ = Math.cos(-dirRad);
  const phase = (wave.phase || 0) * DEG2RAD;

  const f = k * (dirX * position[0] + dirZ * position[2] - velocity * time) + phase;
  // Horizontal displacement factor: 1 for the discrete waves, `chop` (< 1) for the surface ripples
  const horizontal = wave.chop ?? 1;

  out[0] = horizontal * dirX * amplitude * Math.cos(f);
  out[1] = amplitude * Math.sin(f);
  out[2] = horizontal * dirZ * amplitude * Math.cos(f);
  return out;
}


// Position at `time` of the surface particle whose rest position is (x0, 0, z0).
// Like the shader, each wave is evaluated at the position already displaced by the previous ones.
// The ripples (optional, same format as the waves) are then added, each evaluated at the rest position.
// A moored wave buoy follows this particle, so this is what a buoy measures (Lagrangian).
const displacement = [0, 0, 0];
const restPosition = [0, 0, 0];
const getParticlePosition = function (out, waves, time, x0 = 0, z0 = 0, ripples = null) {
  out[0] = x0; out[1] = 0; out[2] = z0;
  for (let i = 0; i < waves.length; i++) {
    getGerstnerDisplacement(displacement, out, waves[i], time);
    out[0] += displacement[0];
    out[1] += displacement[1];
    out[2] += displacement[2];
  }
  if (ripples && ripples.length) {
    restPosition[0] = x0; restPosition[1] = 0; restPosition[2] = z0;
    for (let i = 0; i < ripples.length; i++) {
      getGerstnerDisplacement(displacement, restPosition, ripples[i], time);
      out[0] += displacement[0];
      out[1] += displacement[1];
      out[2] += displacement[2];
    }
  }
  return out;
}


// Surface height at the fixed point (0, 0) (Eulerian, like a pressure sensor or a fixed pole).
// Gerstner waves move particles horizontally, so we look for the rest position P whose particle
// is currently above (0, 0): P = -D(P), solved by fixed-point iteration.
const particle = [0, 0, 0];
const findHeightAt00 = function (waves, time, ripples = null) {
  let x0 = 0, z0 = 0;
  for (let i = 0; i < 20; i++) {
    getParticlePosition(particle, waves, time, x0, z0, ripples);
    if (Math.hypot(particle[0], particle[2]) < 0.001)
      break;
    x0 -= particle[0];
    z0 -= particle[2];
  }
  return particle[1];
}


// The waves as the GPU sees them: OceanParams.getWaveParamsImageData() stores each parameter divided by its maximum
// in a float32 RGBA texture (directions and phases wrapped to 0..360), and the shader multiplies them back.
// (Until the spectral sea it was an 8-bit texture, which rounded heights to steps of 4 cm and periods to 0.078 s.)
const toRenderedWaves = function (waves, WAVE_MAX = 10, PERIOD_MAX = 20) {
  const f32 = Math.fround;
  const encode = (value, max) => f32(f32(value / max) * max);
  const wrap360 = deg => ((deg % 360) + 360) % 360;
  return waves.map(w => ({
    hm0: encode(Math.abs(w.hm0), WAVE_MAX),
    T: encode(w.T, PERIOD_MAX),
    dir: encode(wrap360(w.dir || 0), 360),
    phase: encode(wrap360(w.phase || 0), 360),
  }));
}


export { G, getGerstnerDisplacement, getParticlePosition, findHeightAt00, toRenderedWaves }
