// GLSL shared by the ocean shaders (OceanProjectedGridShader.js) and the spray (Spray.js), so that both see the same
// surface and the same small breakers. Each shader declares the uniforms these functions read (the names below).

// FOAM STATE AROUND A POINT (Assets/Ocean/Foam.js). Uniforms: u_foamCollapse, u_foamRadiusLod
export const FOAM_STATE_GLSL = /* glsl */`
  // Collapse around a point (Assets/Ocean/Foam.js): each scale l of breakers read at its own radius (mip
  // u_foamRadiusLod + l, not finer than minLod), the strongest
  float foamCollapse(vec2 uv, float minLod) {
    float c = textureLod(u_foamCollapse, uv, max(minLod, u_foamRadiusLod)).x;
    c = max(c, textureLod(u_foamCollapse, uv, max(minLod, u_foamRadiusLod + 1.0)).y);
    c = max(c, textureLod(u_foamCollapse, uv, max(minLod, u_foamRadiusLod + 2.0)).z);
    return max(c, textureLod(u_foamCollapse, uv, max(minLod, u_foamRadiusLod + 3.0)).w);
  }
  // Scale (0..1: breakers of scale 0..3) of the foam of a foam state (foam, breaking, bubbles, foam x scale)
  float foamScaleOf(vec4 state) {
    return state.r > 1e-3 ? clamp(state.a / state.r, 0.0, 1.0) : 0.0;
  }
`;

// FFT SEA DISPLACEMENT DAMPED WHERE THE WAVES HAVE BROKEN (Assets/Ocean/Foam.js; same expressions as its foam pass),
// each at the radius of its breakers (radiusFactor x their wavelength), ahead, behind and to the sides:
//  - trail: the foam and bubbles left behind (not the crest breaking now) damp the crests that pass through them
//  - collapse: the crest that has just broken drops (up to 80% at the top, the water around it rises a little)
//    and squeezes less; its water surges forward (the mean direction of the sea) by u_foamSurge times the crest
//    height while the collapse grows, then drifts back as it recovers (both in fractions of the wave period)
// Uniforms: u_foam, u_trailDamping, u_collapseStrength, u_foamSurge, u_seaDirection, and those of FOAM_STATE_GLSL
// (included before this chunk)
export const FOAM_DISPLACEMENT_GLSL = /* glsl */`
  // seaDisplacement: of the FFT sea at the rest position of foamUV, read at mip footLod
  vec3 dampedSeaDisplacement(vec3 seaDisplacement, vec2 foamUV, float footLod) {
    float foamScale = foamScaleOf(textureLod(u_foam, foamUV, footLod));
    vec4 around = textureLod(u_foam, foamUV, max(footLod, u_foamRadiusLod + 3.0 * foamScale));
    float trail = max(around.r, around.b) * (1.0 - around.g);
    float collapseAround = foamCollapse(foamUV, footLod);
    float collapse = u_collapseStrength * collapseAround;
    float crestHeight = max(seaDisplacement.y, 0.0);
    seaDisplacement *= 1.0 - u_trailDamping * trail;
    seaDisplacement.y -= collapse * (0.4 * seaDisplacement.y + 0.4 * max(seaDisplacement.y, 0.0));
    seaDisplacement.xz *= 1.0 - 0.6 * collapse;
    seaDisplacement.xz += u_seaDirection * (u_foamSurge * collapseAround * crestHeight);
    return seaDisplacement;
  }
`;

// RIPPLES STRAINED BY THE LONG WAVES and SMALL BREAKERS. Uniforms: u_rippleSlopes, u_rippleExtra, u_rippleSize,
// u_rippleN, u_smallLevels, u_smallThreshold, u_smallWidth, u_seaSigmaJ
export const SMALL_BREAKERS_GLSL = /* glsl */`
  // Principal stretches of the symmetric matrix I + e, e = (xx, zz, xz): (largest, smallest)
  vec2 principalStretch(vec3 e) {
    float m = 1.0 + 0.5 * (e.x + e.y);
    float r = sqrt(0.25 * (e.x - e.y) * (e.x - e.y) + e.z * e.z);
    return vec2(m + r, m - r);
  }

  // Inverse of I + e, with the principal stretches clamped to >= 0.6. Where the long waves squeeze the surface to
  // nothing (the crest of a Gerstner wave about to loop) the ripples would grow without limit; in the sea they break
  // (micro-breaking). 0.6 caps the ripple slope gain at ~2.8 (1 / 0.6^2)
  // Spectral decomposition without angles: with P1 = (M - l2 I) / (l1 - l2) the projector on the largest stretch,
  // f(M) = f(l1) P1 + f(l2) (I - P1)
  mat2 inverseStretch(vec3 e) {
    vec2 p = principalStretch(e);
    float i1 = 1.0 / max(p.x, 0.6), i2 = 1.0 / max(p.y, 0.6);
    float gap = p.x - p.y;
    if (gap < 1e-6) return mat2(i1); // Isotropic
    mat2 P1 = (mat2(1.0 + e.x, e.z, e.z, 1.0 + e.y) - mat2(p.y)) / gap;
    return i2 * mat2(1.0) + (i1 - i2) * P1;
  }

  // Smooth value noise (period-free), for the small breakers
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float valueNoise(vec2 x) {
    vec2 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + 1.0), f.x), f.y);
  }

  // SMALL BREAKERS (waves of ~1-4 m, Assets/Ocean/Foam.js): the Jacobian of the ripples longer than ~1 m and ~2 m
  // (mip levels of the ripple maps), strained by the long waves like the ripples. No state: foam while the crest
  // breaks. The ripple tile repeats every few metres and a threshold picks the same extreme in every tile (a lattice
  // of breakers), so:
  //  - the long waves modulate their steepness (short waves steepen on the crests and front faces of the long waves,
  //    Phillips & Banner 1974): the squeeze 1 - J of the ripples is scaled by 1 + 0.6 (1 - J_sea) / sigma_sea
  //    (up to x2.8 on the steepest long-wave crests, down to x0.4 in their troughs), and they do not break where
  //    the long waves stretch the surface
  //  - their threshold varies smoothly from tile to tile (period-free noise, +-1 ramp width)
  // Breaking strength 0..1 at rest position xz. seaJ: Jacobian of the FFT sea there; rippleT: inverse strain of the
  // ripples by the long waves; rippleDamp: their damping under the foam
  float smallBreakerSource(vec2 xz, float seaJ, mat2 rippleT, float rippleDamp) {
    float longSqueeze = (1.0 - seaJ) / u_seaSigmaJ;
    float modulation = 1.0 + 0.6 * clamp(longSqueeze, -1.0, 3.0);
    float gate = smoothstep(-0.5, 0.5, longSqueeze);
    float jitter = 2.0 * (valueNoise(xz / u_rippleSize + 17.0) - 0.5);
    vec2 ruv = xz / u_rippleSize + 0.5 / u_rippleN;
    float source = 0.0;
    for (int i = 0; i < 2; i++) {
      float level = i == 0 ? u_smallLevels.x : u_smallLevels.y;
      vec4 a = textureLod(u_rippleSlopes, ruv, level);
      float dxz = textureLod(u_rippleExtra, ruv, level).x;
      mat2 rJ = rippleT * mat2(a.z, dxz, dxz, a.w) * rippleDamp;
      float offDiagonal = 0.5 * (rJ[0][1] + rJ[1][0]);
      float j = 1.0 - modulation * (1.0 - ((1.0 + rJ[0][0]) * (1.0 + rJ[1][1]) - offDiagonal * offDiagonal));
      float width = 2.0 * (i == 0 ? u_smallWidth.x : u_smallWidth.y); // Soft: thin foam at the edges
      float threshold = (i == 0 ? u_smallThreshold.x : u_smallThreshold.y) + jitter * width;
      source = max(source, clamp((threshold - j) / width, 0.0, 1.0));
    }
    return source * gate;
  }
`;
