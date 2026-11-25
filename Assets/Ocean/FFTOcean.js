import * as THREE from 'three';

// FFT ocean on the GPU (Tessendorf 2001, "Simulating Ocean Water"). Used for two cascades: the sea (generateFFTSea in
// Assets/Ocean/SeaSpectrum.js) and the surface ripples (generateRipples in Assets/Ocean/RippleSpectrum.js).
// The components come as arrays, one per texel: amplitude a, phase phi and angular frequency w. Every frame:
//   1. Spectrum pass: the complex amplitude of each component at time t, c = a e^{i (phi - w t)}, multiplied by the
//      factor of each field (height, horizontal displacement, their derivatives). The fields are real, so their
//      spectra are Hermitian, which lets two fields share one complex inverse FFT: 8 fields in 2 RGBA textures.
//   2. Inverse FFT: log2(N) horizontal and log2(N) vertical Stockham passes on both textures.
//   3. Map pass: displacement, slopes and Jacobian terms in half-float textures with mipmaps. The mipmaps of the
//      squared slopes give the slope variance lost at each level (LEAN mapping): the roughness of the far sea.
// Every pass writes all its textures at once (multiple render targets): 2 log2(N) + 2 draws per frame. Each draw is
// a renderer.render() call with its CPU overhead, so the count matters as much as the fill.
// Every component is a trochoidal wave: height a sin(k.x - w t + phi), horizontal lambda (k/|k|) a cos(...).
// Time precision: w t is computed in float32 on the GPU, which loses precision when t grows (ripples have w up to
// ~40 rad/s). The phases are rebased on the CPU (double precision) every EPOCH seconds, phi' = phi - w t0, and the GPU
// only gets t - t0.
//
// Fields (x = east, z = south, as the scene):
//   h, Dx, Dz          height and horizontal displacement
//   hx, hz             d h / dx, d h / dz
//   Dxx, Dzz, Dxz      d Dx / dx, d Dz / dz, d Dx / dz (= d Dz / dx)

const quadVertex = /* glsl */`
  varying vec2 v_uv;
  void main() { v_uv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// 1. Spectrum at time t: out A = (h + i Dx, Dz + i hx), out B = (hz + i Dxx, Dzz + i Dxz)
const spectrumFragment = /* glsl */`
  precision highp float;
  layout(location = 0) out vec4 outA;
  layout(location = 1) out vec4 outB;
  uniform sampler2D u_h0;     // (a cos phi, a sin phi, w, 0)
  uniform float u_N;
  uniform float u_L;
  uniform float u_time;
  uniform float u_choppiness;
  #define PI 3.141592653589793

  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
  vec2 conj(vec2 a) { return vec2(a.x, -a.y); }
  const vec2 I = vec2(0.0, 1.0);

  // Complex amplitude of the component at texel ij, at time t
  vec2 amplitude(ivec2 ij) {
    vec4 h0 = texelFetch(u_h0, ij, 0);
    float wt = h0.z * u_time;
    return cmul(h0.xy, vec2(cos(wt), -sin(wt)));
  }

  // Factors of the fields for wavevector k: field = Re(g c e^{i k.x})
  // h: -i   Dx: l kx/k   Dz: l kz/k   hx: kx   hz: kz   Dxx: i l kx kx/k   Dzz: i l kz kz/k   Dxz: i l kx kz/k
  void factors(vec2 k, out vec2 g[8]) {
    float len = length(k);
    vec2 d = len > 0.0 ? k / len : vec2(0.0);
    float l = u_choppiness;
    g[0] = vec2(0.0, -1.0);
    g[1] = vec2(l * d.x, 0.0);
    g[2] = vec2(l * d.y, 0.0);
    g[3] = vec2(k.x, 0.0);
    g[4] = vec2(k.y, 0.0);
    g[5] = vec2(0.0, l * d.x * k.x);
    g[6] = vec2(0.0, l * d.y * k.y);
    g[7] = vec2(0.0, l * d.x * k.y);
  }

  void main() {
    ivec2 ij = ivec2(gl_FragCoord.xy);
    int N = int(u_N);
    ivec2 ijNeg = ivec2((N - ij.x) % N, (N - ij.y) % N);
    // Wavevector of the texel: index n -> n (n < N/2) or n - N
    vec2 n = vec2(ij);
    n = mix(n, n - u_N, step(u_N * 0.5, n));
    vec2 k = 2.0 * PI * n / u_L;
    vec2 c = amplitude(ij), cNeg = amplitude(ijNeg);
    vec2 g[8], gNeg[8];
    factors(k, g);
    factors(-k, gNeg);
    // Hermitian spectrum of each real field: F(k) = (G(k) + conj(G(-k))) / 2
    vec2 F[8];
    for (int j = 0; j < 8; j++)
      F[j] = 0.5 * (cmul(g[j], c) + conj(cmul(gNeg[j], cNeg)));
    // Pack two real fields per complex number: P = Fa + i Fb
    outA = vec4(F[0] + cmul(I, F[1]), F[2] + cmul(I, F[3]));
    outB = vec4(F[4] + cmul(I, F[5]), F[6] + cmul(I, F[7]));
  }
`;

// 2. One Stockham radix-2 pass of the inverse FFT (both complex numbers of the RGBA texel, both textures):
//    out[i] = even + e^{+2 pi i (i mod s) / s} odd. After log2(N) passes: field[j] = sum_n F[n] e^{+2 pi i n j / N}
const fftFragment = /* glsl */`
  precision highp float;
  layout(location = 0) out vec4 outA;
  layout(location = 1) out vec4 outB;
  uniform sampler2D u_inputA;
  uniform sampler2D u_inputB;
  uniform float u_N;
  uniform float u_subSize;
  uniform bool u_horizontal;
  #define PI 3.141592653589793
  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
  void main() {
    ivec2 ij = ivec2(gl_FragCoord.xy);
    float index = float(u_horizontal ? ij.x : ij.y);
    float halfSize = u_subSize * 0.5;
    float evenIndex = floor(index / u_subSize) * halfSize + mod(index, halfSize);
    ivec2 evenIJ = u_horizontal ? ivec2(int(evenIndex), ij.y) : ivec2(ij.x, int(evenIndex));
    ivec2 oddIJ = u_horizontal ? ivec2(int(evenIndex + u_N * 0.5), ij.y) : ivec2(ij.x, int(evenIndex + u_N * 0.5));
    float angle = 2.0 * PI * mod(index, u_subSize) / u_subSize;
    vec2 twiddle = vec2(cos(angle), sin(angle));
    vec4 even = texelFetch(u_inputA, evenIJ, 0), odd = texelFetch(u_inputA, oddIJ, 0);
    outA = vec4(even.xy + cmul(twiddle, odd.xy), even.zw + cmul(twiddle, odd.zw));
    even = texelFetch(u_inputB, evenIJ, 0); odd = texelFetch(u_inputB, oddIJ, 0);
    outB = vec4(even.xy + cmul(twiddle, odd.xy), even.zw + cmul(twiddle, odd.zw));
  }
`;

// 3. Maps. A = (h, Dx, Dz, hx), B = (hz, Dxx, Dzz, Dxz)
const mapFragment = /* glsl */`
  precision highp float;
  layout(location = 0) out vec4 outDisplacement;
  layout(location = 1) out vec4 outSlopes;
  layout(location = 2) out vec4 outExtra;
  uniform sampler2D u_A;
  uniform sampler2D u_B;
  void main() {
    ivec2 ij = ivec2(gl_FragCoord.xy);
    vec4 A = texelFetch(u_A, ij, 0), B = texelFetch(u_B, ij, 0);
    outDisplacement = vec4(A.y, A.x, A.z, 1.0);              // (Dx, h, Dz)
    outSlopes = vec4(A.w, B.x, B.y, B.z);                    // (hx, hz, Dxx, Dzz)
    outExtra = vec4(B.w, A.w * A.w, B.x * B.x, A.w * B.x);   // (Dxz, hx^2, hz^2, hx hz)
  }
`;


const EPOCH = 600; // s

export class FFTOcean {

  // options.halfFloat: half-float spectrum and FFT buffers (half the memory traffic, for mobile GPUs). The maps are
  // half float either way
  constructor(renderer, N, { halfFloat = false } = {}) {
    this.renderer = renderer;
    this.N = N;
    this.halfFloat = halfFloat;
    this.L = 512;
    this.enabled = false;

    // Spectrum and FFT ping-pong: two float textures each (A, B)
    const floatTarget = () => new THREE.WebGLMultipleRenderTargets(N, N, 2, {
      type: halfFloat ? THREE.HalfFloatType : THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
    this.spectrum = floatTarget();
    this.ping = floatTarget(); this.pong = floatTarget();
    // Maps, written in one pass: half float, mipmapped, repeated
    this.maps = new THREE.WebGLMultipleRenderTargets(N, N, 3, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: true });
    this.displacementTexture = this.maps.texture[0]; // (Dx, h, Dz, 1)
    this.slopesTexture = this.maps.texture[1];       // (hx, hz, Dxx, Dzz)
    this.extraTexture = this.maps.texture[2];        // (Dxz, hx^2, hz^2, hx hz)

    this.h0Texture = new THREE.DataTexture(new Float32Array(N * N * 4), N, N, THREE.RGBAFormat, THREE.FloatType);
    this.h0Texture.minFilter = this.h0Texture.magFilter = THREE.NearestFilter;
    this.h0Texture.generateMipmaps = false;
    this.h0Texture.needsUpdate = true;

    // GLSL3: the shaders declare their own outputs (one per render target)
    const material = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ vertexShader: quadVertex, fragmentShader,
      uniforms, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false });
    this.spectrumMaterial = material(spectrumFragment, { u_h0: { value: this.h0Texture }, u_N: { value: N },
      u_L: { value: this.L }, u_time: { value: 0 }, u_choppiness: { value: 1 } });
    this.fftMaterial = material(fftFragment, { u_inputA: { value: null }, u_inputB: { value: null }, u_N: { value: N },
      u_subSize: { value: 2 }, u_horizontal: { value: true } });
    this.mapMaterial = material(mapFragment, { u_A: { value: null }, u_B: { value: null } });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.spectrumMaterial);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  // WebGL2 with float render targets (float32, or half float only when halfFloat) is needed
  static isSupported(renderer, halfFloat = false) {
    if (!renderer.capabilities.isWebGL2) return false;
    if (renderer.extensions.has('EXT_color_buffer_float')) return true; // Covers half float too
    return halfFloat && renderer.extensions.has('EXT_color_buffer_half_float');
  }

  // spectrum: {L, choppiness, amp, phase, omega} (Float64Arrays of N * N, texel (n, m) at m * N + n, see
  // generateFFTSea), or null to disable
  setSpectrum(spectrum) {
    if (!spectrum) { this.enabled = false; this.components = null; return; }
    this.components = spectrum;
    this.L = spectrum.L;
    this.spectrumMaterial.uniforms.u_L.value = spectrum.L;
    this.spectrumMaterial.uniforms.u_choppiness.value = spectrum.choppiness;
    this.epoch = null; // Rebuild the texture of the components at the next update
    this.enabled = true;
  }

  // Components with their phases at time `epoch`: (a cos(phi - w epoch), a sin(phi - w epoch), w)
  writeComponents(epoch) {
    const { amp, phase, omega } = this.components;
    const data = this.h0Texture.image.data;
    for (let i = 0; i < amp.length; i++) {
      const a = amp[i];
      if (!(a > 0)) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 0; continue; }
      const ph = phase[i] - omega[i] * epoch;
      data[i * 4] = a * Math.cos(ph);
      data[i * 4 + 1] = a * Math.sin(ph);
      data[i * 4 + 2] = omega[i];
    }
    this.h0Texture.needsUpdate = true;
    this.epoch = epoch;
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  // Inverse FFT of both textures of `input` (log2 N horizontal + log2 N vertical passes). Returns the target with
  // the result (ping or pong)
  inverseFFT(input) {
    const u = this.fftMaterial.uniforms;
    let source = input, target = this.ping;
    for (const horizontal of [true, false]) {
      for (let sub = 2; sub <= this.N; sub *= 2) {
        u.u_inputA.value = source.texture[0];
        u.u_inputB.value = source.texture[1];
        u.u_subSize.value = sub;
        u.u_horizontal.value = horizontal;
        this.pass(this.fftMaterial, target);
        source = target;
        target = target == this.ping ? this.pong : this.ping;
      }
    }
    return source;
  }

  // Compute the maps at time `time` (s)
  update(time) {
    if (!this.enabled) return;
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    const epoch = Math.floor(time / EPOCH) * EPOCH;
    if (epoch !== this.epoch) this.writeComponents(epoch);
    this.spectrumMaterial.uniforms.u_time.value = time - epoch;
    this.pass(this.spectrumMaterial, this.spectrum);

    const fields = this.inverseFFT(this.spectrum); // A = (h, Dx, Dz, hx), B = (hz, Dxx, Dzz, Dxz)

    const mu = this.mapMaterial.uniforms;
    mu.u_A.value = fields.texture[0];
    mu.u_B.value = fields.texture[1];
    this.pass(this.mapMaterial, this.maps);

    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
  }

  dispose() {
    [this.spectrum, this.ping, this.pong, this.maps].forEach(t => t.dispose());
    this.h0Texture.dispose();
    [this.spectrumMaterial, this.fftMaterial, this.mapMaterial].forEach(m => m.dispose());
  }
}
