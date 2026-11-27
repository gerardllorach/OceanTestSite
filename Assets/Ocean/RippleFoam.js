import * as THREE from 'three';
import { SMALL_BREAKERS_GLSL } from '/OceanTestSite/Assets/Ocean/OceanShaderChunks.js';

// RIPPLE FOAM: the foam of the small breakers (waves of ~1-4 m, the ripple FFT), with memory, around the camera.
//
// Where a ripple crest breaks (smallBreakerSource: the Jacobian of the ripples strained by the long waves, the same
// criterion as before, from the shape of the waves only, not the wind), foam accumulates: v += rate dt source (1 - v),
// so it saturates (the same spot does not pile up foam) and grows over the time the crest breaks. It is stored at the
// REST position of the water, like the whitecaps (Foam.js): it stays with the water while the crest moves on and
// leaves a trail behind. Each frame it spreads a little (diffusion) and fades; the fading time varies slowly in space
// and time (smooth noise, +-variation), so a patch does not fade evenly: it breaks up and changes shape as it goes.
// The ocean shader draws it with the lace of the whitecaps (foamPattern), so as it fades its holes grow.
//
// No ripple foam is made where the large breakers already have foam (the foam state of Foam.js): their foam covers it.
//
// The texture covers `extent` metres, centred a little ahead of the camera, and follows it by whole texels (the old
// foam is moved, not resampled). It is the TRAIL of the small breakers; the ocean shader draws their breaking CREST
// everywhere, without memory. Beyond the window, the trail is the mean of the window (its last mip level): the far sea
// is whitened as much as the near sea.

const RIPPLE_FOAM_SUPPRESS = [0.05, 0.3]; // Large-breaker foam (Foam.js state .r) above which no ripple foam is made

// Uniforms of the ocean material read here: shared objects, so the pass follows every change of the ocean
const OCEAN_UNIFORMS = ['u_fftEnabled', 'u_fftSlopes', 'u_fftExtra', 'u_fftSize', 'u_fftN', 'u_rippleEnabled',
  'u_rippleSlopes', 'u_rippleExtra', 'u_rippleSize', 'u_rippleN', 'u_rippleStrain', 'u_foamEnabled', 'u_foam',
  'u_smallLevels', 'u_smallThreshold', 'u_smallWidth', 'u_seaSigmaJ',
  'u_smallShape', 'u_smallCrestLevels', 'u_smallCrestOffset', 'u_smallCrestWidth'];

const quadVertex = /* glsl */`
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const updateFragment = /* glsl */`
  precision highp float;
  precision highp int;
  uniform bool u_fftEnabled;
  uniform sampler2D u_fftSlopes;
  uniform sampler2D u_fftExtra;
  uniform float u_fftSize;
  uniform float u_fftN;
  uniform bool u_rippleEnabled;
  uniform sampler2D u_rippleSlopes;
  uniform sampler2D u_rippleExtra;
  uniform float u_rippleSize;
  uniform float u_rippleN;
  uniform float u_rippleStrain;
  uniform bool u_foamEnabled;
  uniform sampler2D u_foam;
  uniform vec2 u_smallLevels;
  uniform vec2 u_smallThreshold;
  uniform vec2 u_smallWidth;
  uniform float u_smallShape;          // 0: thin breaking crests .. 1: patches
  uniform vec2 u_smallCrestLevels;    // 'Crests' end: mip levels, line threshold and ramp of the shorter ripples' crests
  uniform vec2 u_smallCrestOffset;
  uniform vec2 u_smallCrestWidth;
  uniform float u_seaSigmaJ;

  uniform sampler2D u_previous;
  uniform ivec2 u_shift;     // Texels the window moved
  uniform int u_texels;
  uniform vec3 u_window;     // (min x, min z, side) in metres
  uniform bool u_reset;
  uniform float u_spread;    // Diffusion per frame (D dt / dx^2, <= 0.2)
  uniform float u_dt;
  uniform float u_lifetime;  // s, mean e-folding time
  uniform float u_variation; // 0..1, spread of the fading time (smooth noise)
  uniform float u_grow;      // 1/s, growth rate where the crest breaks fully
  uniform float u_time;
  out vec4 outColor;
  ${SMALL_BREAKERS_GLSL}

  float at(ivec2 p) {
    p += u_shift;
    if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, ivec2(u_texels)))) return 0.0;
    return texelFetch(u_previous, p, 0).r;
  }

  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec2 x0 = u_window.xy + (vec2(p) + 0.5) * (u_window.z / float(u_texels)); // Rest position (m)
    float v = 0.0;
    if (!u_reset) {
      float c = at(p);
      float n = at(p + ivec2(1, 0)) + at(p - ivec2(1, 0)) + at(p + ivec2(0, 1)) + at(p - ivec2(0, 1));
      v = c + u_spread * (n - 4.0 * c);
      // Fades over a time that varies slowly in space and time: the patch breaks up and changes shape as it fades
      float noise = valueNoise(x0 / 1.5 + vec2(0.13, 0.07) * u_time) * 0.6 + valueNoise(x0 / 0.4 - 0.2 * u_time) * 0.4;
      float lifetime = u_lifetime * exp2(u_variation * 2.0 * (noise - 0.5) * 2.0);
      v *= exp(-u_dt / max(lifetime, 0.02));
    }
    // New foam where a ripple crest breaks (not where the large breakers already have foam), saturating
    if (u_rippleEnabled) {
      float seaJ = 1.0;
      vec3 longStrain = vec3(0.0);
      vec2 uv = x0 / u_fftSize + 0.5 / u_fftN;
      if (u_fftEnabled) {
        vec4 a = textureLod(u_fftSlopes, uv, 0.0);
        float dxz = textureLod(u_fftExtra, uv, 0.0).x;
        longStrain = vec3(a.z, a.w, dxz);
        seaJ = (1.0 + a.z) * (1.0 + a.w) - dxz * dxz;
      }
      mat2 rippleT = u_rippleStrain > 0.0 ? inverseStretch(u_rippleStrain * longStrain) : mat2(1.0);
      float source = smallBreakerSource(x0, seaJ, rippleT, 1.0);
      if (u_foamEnabled)
        source *= 1.0 - smoothstep(${RIPPLE_FOAM_SUPPRESS[0].toFixed(2)}, ${RIPPLE_FOAM_SUPPRESS[1].toFixed(2)}, textureLod(u_foam, uv, 0.0).r);
      v += (1.0 - exp(-u_grow * u_dt * source)) * (1.0 - v);
    }
    outColor = vec4(clamp(v, 0.0, 1.0));
  }
`;

export class RippleFoam {

  // texels: per side of the texture; extent: its side in metres. oceanUniforms: the ocean material's uniforms
  constructor(renderer, texels, extent, oceanUniforms) {
    this.renderer = renderer;
    this.texels = texels;
    this.extent = extent;
    this.settings = { grow: 14, lifetime: 1.5, variation: 0.5, spread: 0.01 };
    this.window = new THREE.Vector3(0, 0, extent); // (min x, min z, side) in metres
    this.windowTexel = null;
    this.needsReset = true;
    this.time = 0;
    this.active = false;

    // Mipmapped: filtered when seen from afar, and the last level is the mean over the window (the far sea)
    const target = () => new THREE.WebGLRenderTarget(texels, texels, { type: THREE.HalfFloatType,
      format: THREE.RedFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false,
      generateMipmaps: true });
    this.targets = [target(), target()];
    this.current = 0;

    const shared = {};
    OCEAN_UNIFORMS.forEach(name => shared[name] = oceanUniforms[name]);
    this.material = new THREE.ShaderMaterial({ vertexShader: quadVertex, fragmentShader: updateFragment,
      glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
      uniforms: { ...shared, u_previous: { value: null }, u_shift: { value: new THREE.Vector2() },
        u_texels: { value: texels }, u_window: { value: this.window }, u_reset: { value: true },
        u_spread: { value: 0 }, u_dt: { value: 0 }, u_lifetime: { value: 1.5 }, u_variation: { value: 0.5 },
        u_grow: { value: 14 }, u_time: { value: 0 } } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  // Foam of the ripples (0..1) around the camera; its window (min x, min z, side) in metres is `window`
  get texture() { return this.targets[this.current].texture; }

  // {grow (1/s), lifetime (s), variation (0..1), spread (m^2/s)}
  setSettings(settings) { Object.assign(this.settings, settings); }

  reset() { this.needsReset = true; }

  // One step; camera: the selected camera (the window is centred a little ahead of it)
  update(dt, camera) {
    if (!camera) return;
    dt = Math.min(Math.max(0, dt), 0.05);
    this.time = (this.time + dt) % 1000;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements, L = this.extent, N = this.texels, texel = L / N;
    let cx = camera.position.x, cz = camera.position.z;
    if (!camera.isOrthographicCamera) {
      // Most of the near sea a perspective camera sees is ahead of it
      const fx = -e[8], fz = -e[10], flat = Math.hypot(fx, fz);
      if (flat > 1e-3) { cx += fx / flat * 0.3 * L * Math.min(1, flat * 2); cz += fz / flat * 0.3 * L * Math.min(1, flat * 2); }
    }
    const wx = Math.floor((cx - L / 2) / texel), wz = Math.floor((cz - L / 2) / texel);
    const u = this.material.uniforms, s = this.settings;
    const shift = this.windowTexel ? [wx - this.windowTexel[0], wz - this.windowTexel[1]] : [0, 0];
    u.u_reset.value = this.needsReset || !this.windowTexel || Math.abs(shift[0]) >= N || Math.abs(shift[1]) >= N;
    this.needsReset = false;
    u.u_shift.value.set(shift[0], shift[1]);
    u.u_spread.value = Math.min(0.2, s.spread * dt / (texel * texel));
    u.u_dt.value = dt;
    u.u_lifetime.value = s.lifetime;
    u.u_variation.value = s.variation;
    u.u_grow.value = s.grow;
    u.u_time.value = this.time;
    u.u_previous.value = this.targets[this.current].texture;
    this.windowTexel = [wx, wz];
    this.window.set(wx * texel, wz * texel, L);
    this.current = 1 - this.current;

    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.targets[this.current]);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
    this.active = true;
  }

  dispose() {
    this.targets.forEach(t => t.dispose());
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
