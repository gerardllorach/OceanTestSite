// Gerstner waves on the CPU, mirroring GerstnerWave() in Assets/Ocean/OceanProjectedGridShader.js.
// Keep both in sync: the analysis must measure exactly the surface that is rendered.
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

  out[0] = dirX * amplitude * Math.cos(f);
  out[1] = amplitude * Math.sin(f);
  out[2] = dirZ * amplitude * Math.cos(f);
  return out;
}


// Position at `time` of the surface particle whose rest position is (x0, 0, z0).
// Like the shader, each wave is evaluated at the position already displaced by the previous ones.
// A moored wave buoy follows this particle, so this is what a buoy measures (Lagrangian).
const displacement = [0, 0, 0];
const getParticlePosition = function (out, waves, time, x0 = 0, z0 = 0) {
  out[0] = x0; out[1] = 0; out[2] = z0;
  for (let i = 0; i < waves.length; i++) {
    getGerstnerDisplacement(displacement, out, waves[i], time);
    out[0] += displacement[0];
    out[1] += displacement[1];
    out[2] += displacement[2];
  }
  return out;
}


// Surface height at the fixed point (0, 0) (Eulerian, like a pressure sensor or a fixed pole).
// Gerstner waves move particles horizontally, so we look for the rest position P whose particle
// is currently above (0, 0): P = -D(P), solved by fixed-point iteration.
const particle = [0, 0, 0];
const findHeightAt00 = function (waves, time) {
  let x0 = 0, z0 = 0;
  for (let i = 0; i < 20; i++) {
    getParticlePosition(particle, waves, time, x0, z0);
    if (Math.hypot(particle[0], particle[2]) < 0.001)
      break;
    x0 -= particle[0];
    z0 -= particle[2];
  }
  return particle[1];
}


// The waves as the GPU sees them: OceanParams.getWaveParamsImageData() packs each parameter into
// one byte of an RGBA texture (Uint8Clamped: rounded and clamped to 0..255), and the shader decodes them.
// Heights are quantised in steps of WAVE_MAX/255 m, periods in PERIOD_MAX/255 s, angles in 360/255 deg.
// Directions or phases outside 0..360 are clamped, not wrapped.
const toRenderedWaves = function (waves, WAVE_MAX = 10, PERIOD_MAX = 20) {
  const encode = (value, max) => Math.min(255, Math.max(0, Math.round(255 * value / max))) / 255 * max;
  return waves.map(w => ({
    hm0: encode(Math.abs(w.hm0), WAVE_MAX),
    T: encode(w.T, PERIOD_MAX),
    dir: encode(w.dir || 0, 360),
    phase: encode(w.phase || 0, 360),
  }));
}


export { G, getGerstnerDisplacement, getParticlePosition, findHeightAt00, toRenderedWaves }
