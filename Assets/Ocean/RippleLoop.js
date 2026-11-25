import * as THREE from 'three';

// RIPPLE FIELD LOOP: the surface ripples precomputed as a looping animation, for the quality without FFT ('low', see
// Assets/Ocean/Quality.js). No GPU work per frame: the fragment shader reads two frames of a texture array
// and blends them.
//
// The ripples come from generateRipples (Assets/Ocean/RippleSpectrum.js) on a RIPPLE_LOOP_N grid. To loop exactly
// after RIPPLE_LOOP_PERIOD seconds, every angular frequency is rounded to a multiple of 2 pi / period (the dispersion
// is approximate: up to +-0.8 rad/s, noticeable only in the speed of the longest ripples). Each frame is an inverse FFT
// on the CPU, done again when the ripples change.
//
// Texels (RGBA8, in the wind frame: u along the direction the ripples travel, c across):
//   (su, sc, su^2, sc^2) / scale, slopes mapped to [0, 1]
// The mipmaps average them, so at any level the mean slopes and the slope variance finer than the level follow
// (LEAN mapping, as the FFT maps): variance = E[s^2] - E[s]^2. The cross term is left out: the ripples spread
// symmetrically around their direction, so it is ~0 in this frame. RGBA8 (not half float): the GPU can generate its
// mipmaps on every device (half float needs float render targets, missing on many phones).

export const RIPPLE_LOOP_N = 128;      // Grid (texture size): ripples down to ~10-20 cm, the rest is the tail (roughness)
export const RIPPLE_LOOP_FRAMES = 64;  // Frames of the loop (layers of the texture array)
export const RIPPLE_LOOP_PERIOD = 4;   // s. 64 frames: the shortest ripples move ~1-1.7 rad per frame

// Radix-2 inverse FFT (unnormalised, + sign: x[j] = sum_n X[n] e^{+2 pi i n j / N}), in place on (re, im)
function makeInverseFFT(n) {
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  return function (re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < half; j++) {
          const a = i + j, b = a + half, k = j * step;
          const tr = re[b] * cos[k] - im[b] * sin[k];
          const ti = re[b] * sin[k] + im[b] * cos[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  };
}

export class RippleLoop {

  texture = null; // THREE.DataArrayTexture, RIPPLE_LOOP_N^2 x RIPPLE_LOOP_FRAMES
  scale = 1;      // Slope of texel value 1 (see above)
  L = 1;          // Tile size (m)

  // ripples: output of generateRipples (N, L, amp, phase, omega). windU: [x, z] unit vector, direction the ripples
  // travel (the u axis of the texels; the shader rotates back with u_windDirection)
  build(ripples, windU) {
    const { N, L, amp, phase, omega } = ripples;
    const K = RIPPLE_LOOP_FRAMES, T = RIPPLE_LOOP_PERIOD, dt = T / K, dw = 2 * Math.PI / T;
    const [wx, wz] = windU;
    const dk = 2 * Math.PI / L;
    const NN = N * N;

    // Components c = a e^{i (phi - wq t)} at t = 0, their rotation per frame e^{-i wq dt}, their wavevectors
    const cRe = new Float64Array(NN), cIm = new Float64Array(NN);
    const rRe = new Float64Array(NN), rIm = new Float64Array(NN);
    const kx = new Float64Array(NN), kz = new Float64Array(NN), neg = new Uint32Array(NN);
    let varU = 0, varC = 0;
    for (let m = 0; m < N; m++) {
      for (let n = 0; n < N; n++) {
        const i = m * N + n;
        const nn = n < N / 2 ? n : n - N, mm = m < N / 2 ? m : m - N;
        kx[i] = nn * dk; kz[i] = mm * dk;
        neg[i] = ((N - m) % N) * N + (N - n) % N;
        const a = amp[i];
        if (!(a > 0)) continue;
        cRe[i] = a * Math.cos(phase[i]); cIm[i] = a * Math.sin(phase[i]);
        const wq = Math.round(omega[i] / dw) * dw;
        rRe[i] = Math.cos(wq * dt); rIm[i] = -Math.sin(wq * dt);
        // Slope variance along / across the ripple direction: a^2 / 2 per component
        const ku = wx * kx[i] + wz * kz[i], kc = -wz * kx[i] + wx * kz[i];
        varU += 0.5 * a * a * ku * ku; varC += 0.5 * a * a * kc * kc;
      }
    }
    // Slopes beyond 4 sigma are clamped (rare)
    const scale = Math.max(1e-4, 4 * Math.sqrt(Math.max(varU, varC)));

    const ifft = makeInverseFFT(N);
    const re = new Float64Array(NN), im = new Float64Array(NN);
    const lineRe = new Float64Array(N), lineIm = new Float64Array(N);
    const data = new Uint8Array(NN * 4 * K);
    const enc = v => Math.round(255 * Math.min(1, Math.max(0, v)));

    for (let f = 0; f < K; f++) {
      // Slopes (hx, hz) are real fields: their Hermitian spectra F(k) = (G(k) + conj(G(-k))) / 2 with G = kx c, kz c,
      // packed as hx + i hz: S = (kx + i kz) (c(k) - conj(c(-k))) / 2
      for (let i = 0; i < NN; i++) {
        const j = neg[i];
        const dRe = cRe[i] - cRe[j], dIm = cIm[i] + cIm[j];
        re[i] = 0.5 * (kx[i] * dRe - kz[i] * dIm);
        im[i] = 0.5 * (kx[i] * dIm + kz[i] * dRe);
      }
      // 2D inverse FFT: rows (x), then columns (z)
      for (let m = 0; m < N; m++) {
        const o = m * N;
        for (let n = 0; n < N; n++) { lineRe[n] = re[o + n]; lineIm[n] = im[o + n]; }
        ifft(lineRe, lineIm);
        for (let n = 0; n < N; n++) { re[o + n] = lineRe[n]; im[o + n] = lineIm[n]; }
      }
      for (let n = 0; n < N; n++) {
        for (let m = 0; m < N; m++) { lineRe[m] = re[m * N + n]; lineIm[m] = im[m * N + n]; }
        ifft(lineRe, lineIm);
        for (let m = 0; m < N; m++) { re[m * N + n] = lineRe[m]; im[m * N + n] = lineIm[m]; }
      }
      // Texels: slopes in the wind frame, clamped, and their squares
      const base = f * NN * 4;
      for (let i = 0; i < NN; i++) {
        const hx = re[i], hz = im[i];
        const su = Math.min(1, Math.max(-1, (wx * hx + wz * hz) / scale));
        const sc = Math.min(1, Math.max(-1, (-wz * hx + wx * hz) / scale));
        const o = base + i * 4;
        data[o] = enc(0.5 * su + 0.5);
        data[o + 1] = enc(0.5 * sc + 0.5);
        data[o + 2] = enc(su * su);
        data[o + 3] = enc(sc * sc);
      }
      // Next frame
      for (let i = 0; i < NN; i++) {
        const a = cRe[i], b = cIm[i];
        cRe[i] = a * rRe[i] - b * rIm[i];
        cIm[i] = a * rIm[i] + b * rRe[i];
      }
    }

    if (this.texture && (this.texture.image.width != N || this.texture.image.depth != K)) this.dispose();
    if (!this.texture) {
      const tex = new THREE.DataArrayTexture(data, N, N, K);
      tex.format = THREE.RGBAFormat;
      tex.type = THREE.UnsignedByteType;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.generateMipmaps = true;
      this.texture = tex;
    } else {
      this.texture.image.data = data;
    }
    this.texture.needsUpdate = true;
    this.scale = scale;
    this.L = L;
  }

  // Frames to blend at `time` (s): [frame a, frame b, weight of b]
  framesAt(time) {
    const K = RIPPLE_LOOP_FRAMES;
    const t = ((time % RIPPLE_LOOP_PERIOD) + RIPPLE_LOOP_PERIOD) % RIPPLE_LOOP_PERIOD;
    const f = t / RIPPLE_LOOP_PERIOD * K;
    const f0 = Math.floor(f) % K;
    return [f0, (f0 + 1) % K, f - Math.floor(f)];
  }

  dispose() {
    if (this.texture) this.texture.dispose();
    this.texture = null;
  }
}
