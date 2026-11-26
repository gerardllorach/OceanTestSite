import * as THREE from 'three';
import { FOAM_STATE_GLSL, FOAM_DISPLACEMENT_GLSL, SMALL_BREAKERS_GLSL } from '/OceanTestSite/Assets/Ocean/OceanShaderChunks.js';

// SPRAY: droplets thrown off by the breaking crests, carried by the wind, that fall back into the sea and turn into
// foam there. Droplets that land close together merge into one patch of foam.
//
// PARTICLES (flying only): GPU particles with state (two textures, ping-pong), one texel per particle. The FFT maps
// hold the current time only, so a particle has to remember where and when it was born.
//   0: (x, y, z, age)       position relative to u_origin (camera-anchored, snapped), age (s)
//   1: (vx, vy, vz, stage)  stage > 0: flying, its drag time (s); -1: landed this frame (0.xz: its REST position);
//                           0: dead (free to spawn)
//
// HOW MANY, AND WHERE (physically based, in proportions: the "droplets" drawn are 1.5-3 cm, larger than real spray,
// they stand for clusters of it):
//  - Energy: a breaking front of phase speed c dissipates ~ b rho c^5 / g per unit crest length (Duncan 1981, Phillips
//    1985), so large breakers throw far more spray per metre of crest. The candidates are spread over the area, which
//    already gives ~c^2 per metre of crest (a breaking zone is ~ as wide as the wave); the acceptance adds ~c^3,
//    saturated so that it stays a probability: E(c) = c^3 / (c^3 + c_E^3)
//  - Onset: spray leaves where breaking starts (stage A), at the front of the breaking zone:
//      large breakers: breaking x (1 - collapse): the collapse follows breaking after 0.2 periods (Foam.js)
//      small breakers: the front edge of the breaking zone (more breaking here than a little ahead of the crest)
//  - Spume: above ~7.5 m/s the wind tears droplets off the crest tips (Koga 1981; the spume part of the sea spray
//    generation functions, Fairall, Kepert & Holland 1994, Andreas 1998), steeply more with the wind. These are light
//    droplets that leave with the wind rather than with the crest
//  - Sizes: spray size distributions are heavy tailed, dN/dr ~ r^-3 over the spume range (Veron 2015, de Leeuw et al.
//    2011; similar power laws in plunging breakers, Erinin et al. 2019): each droplet's diameter is drawn from r^-3
//    between SPRAY_SIZE / 2 and SPRAY_SIZE (median ~1.3 x the smallest)
// Bursts: the 16 particles of a 4 x 4 block of the state share the spot and the decision during a burst period.
//
// FLIGHT: from the surface, horizontal, forward: 0.8 to 1.7 times the crest's phase speed (at breaking the crest's
// water moves at least at the phase speed, u >= c, Perlin, Choi & Tian 2013; up to ~1.7 c in plunging breakers, Chang
// & Liu 1998), plus the whitecap's forward surge for the large breakers. It does not land during its first
// SPRAY_NO_COLLIDE seconds. Then drag towards the wind and gravity: the light droplets accelerate with the wind (drag
// time 0.25 s) and are held up by its turbulence (effective gravity down to 10% in a strong wind); the heavy ones
// (1.5 s, full gravity) land just in front of the crest.
//
// LANDING -> FOAM: a droplet falling into the sea entrains air: a small patch of bubbles (foamPatch times its
// diameter). Each landing droplet adds that area to a foam texture and dies, spread as a Gaussian over at least
// foamRadius (it groups the landings of a breaker into one patch instead of separate spots). The texture holds the
// summed area (per unit area) of the landed droplets around the camera (SPRAY_FOAM_EXTENT metres), indexed by the REST
// position like the whitecaps (Foam.js), so the foam moves with the water. Each frame it spreads a little (diffusion)
// and fades (foamLifetime). The ocean shader turns the sum v into foam logarithmically, max log(1 + k v / full) /
// log(1 + k), capped at max: the first droplets make some foam, many more are needed to whiten the sea. It draws it with the same lacy
// pattern as the whitecaps (foamPattern).
//
// Distance: droplets are a few centimetres, so they only matter where a pixel is smaller than that. Above that
// distance from the sea (or zoomed out in the orthographic views) nothing is updated or drawn.

export const SPRAY_SIZE = 0.03;     // m, diameter of the largest droplets (the smallest: half). Sets the distance
                                    // up to which droplets are made
const SPRAY_PIXELS = 1;             // Droplets are made where they are at least this many pixels wide (drawn >= 1.5 px,
                                    // fainter when smaller)
const SPRAY_CANDIDATES = 3;         // Random spots a dead particle tries per frame
const SPRAY_RATE = 40;              // Tries per second of a dead particle, at amount 1
const SPRAY_WIND_LIFT = 12;         // m/s: wind at which the light droplets are fully held up by the turbulence
const SPRAY_AREA_PER_PARTICLE = 1 / 256; // m^2: the pool fills an area of side^2 / 256 m^2 (1000 m^2 at 'high'). In a
                                    // smaller area (zoomed in) fewer particles are born: the same density per m^2
const SPRAY_ORIGIN_STEP = 16;       // m, the origin of the stored positions follows the camera by these steps
const SPRAY_BURST_PERIOD = 0.3;     // s
const SPRAY_BURST_SPREAD = 0.3;     // m
const SPRAY_NO_COLLIDE = 0.1;       // s: droplets leave from the surface and do not land during this time
const COLLAPSE_ATTACK_PERIODS = 0.2; // As in Foam.js: a crest collapses (and surges forward) over 0.2 wave periods
const SPRAY_ENERGY_SPEED = 2.5;     // m/s, c_E: crests faster than this throw (nearly) all the spray they can
const SPRAY_SPUME_WIND = 7.5;       // m/s: spume torn off the crests above this wind
// Foam of the landed droplets
export const SPRAY_FOAM_EXTENT = 64; // m, side of the foam texture, centred on the camera
// Defaults of the spray foam settings (foamLifetime, foamPatch; Foam.js DEFAULT_FOAM_SETTINGS sprayFoam*)
const SPRAY_FOAM_LIFETIME = 0.6;    // s, e-folding time of the spray foam (thick patches stay visible longer)
const SPRAY_FOAM_PATCH = 4;         // Diameter of the bubble patch of a landed droplet, times the droplet's. Exaggerated
                                    // so that every landing leaves a visible spot (1.25 and 0.25 s keep the spray foam
                                    // of the order of the whitecap coverage, but a single droplet is then invisible)
const SPRAY_FOAM_DIFFUSION = 0.01;  // m^2/s: the foam spreads (~10 cm in half a second): close impacts merge

// Sky ambient light of the foam, as in OceanProjectedGridShader.js (skyReflection of the zenith, spread 1.5)
const SKY_GLSL = /* glsl */`
  const vec3 SKY_ZENITH = vec3(0.51, 0.75, 1.0) * 2.0;
  const vec3 SKY_HORIZON = vec3(0.655, 0.84, 1.0) * 2.0;
  vec3 skyAmbient() {
    if (!u_skyReady) return 0.25 * SKY_HORIZON + 0.25 * SKY_ZENITH + 0.5 * SKY_ZENITH;
    vec3 c = textureLod(u_skyCube, vec3(0.0, 1.0, 0.0), 7.9).rgb;
    c = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
    return -log(1.0 - min(c, vec3(0.96)));
  }
`;

// Uniforms of the ocean material read by the spray: shared objects, so the spray follows every change of the ocean
const OCEAN_UNIFORMS = ['u_fftEnabled', 'u_fftDisplacement', 'u_fftSlopes', 'u_fftExtra', 'u_fftSize', 'u_fftN',
  'u_rippleEnabled', 'u_rippleDisplacement', 'u_rippleSlopes', 'u_rippleExtra', 'u_rippleSize', 'u_rippleN',
  'u_rippleStrain', 'u_foamEnabled', 'u_foam', 'u_foamCollapse', 'u_foamRadiusLod', 'u_collapseStrength',
  'u_trailDamping', 'u_foamSurge', 'u_seaDirection', 'u_smallEnabled', 'u_smallLevels', 'u_smallThreshold',
  'u_smallWidth', 'u_seaSigmaJ', 'u_foamLambda0', 'u_windDirection', 'u_sunDirection', 'u_sunColor', 'u_skyCube', 'u_skyReady'];

const OCEAN_DECLARATIONS = /* glsl */`
  uniform bool u_fftEnabled;
  uniform sampler2D u_fftDisplacement; // (Dx, h, Dz)
  uniform sampler2D u_fftSlopes;       // (hx, hz, Dxx, Dzz)
  uniform sampler2D u_fftExtra;        // (Dxz, ...)
  uniform float u_fftSize;
  uniform float u_fftN;
  uniform bool u_rippleEnabled;
  uniform sampler2D u_rippleDisplacement;
  uniform sampler2D u_rippleSlopes;
  uniform sampler2D u_rippleExtra;
  uniform float u_rippleSize;
  uniform float u_rippleN;
  uniform float u_rippleStrain;
  uniform bool u_foamEnabled;
  uniform sampler2D u_foam;
  uniform sampler2D u_foamCollapse;
  uniform float u_foamRadiusLod;
  uniform float u_collapseStrength;
  uniform float u_trailDamping;
  uniform float u_foamSurge;
  uniform vec2 u_seaDirection;
  uniform bool u_smallEnabled;
  uniform vec2 u_smallLevels;
  uniform vec2 u_smallThreshold;
  uniform vec2 u_smallWidth;
  uniform float u_seaSigmaJ;
  uniform float u_foamLambda0;
  uniform vec2 u_windDirection;
  uniform vec3 u_sunDirection;
  uniform vec3 u_sunColor;
  uniform samplerCube u_skyCube;
  uniform bool u_skyReady;
`;

// Displacement of the sea surface at rest position x0, as the ocean vertex shader draws it near the camera (FFT sea,
// damped by the foam if 'damped', plus the ripples). The discrete Gerstner waves are left out (none on an FFT sea)
const SURFACE_GLSL = /* glsl */`
  ${FOAM_STATE_GLSL}
  ${FOAM_DISPLACEMENT_GLSL}
  vec3 surfaceDisplacement(vec2 x0, bool damped) {
    vec3 d = vec3(0.0);
    if (u_fftEnabled) {
      vec2 uv = x0 / u_fftSize + 0.5 / u_fftN;
      vec3 sea = textureLod(u_fftDisplacement, uv, 0.0).xyz;
      if (damped && u_foamEnabled) sea = dampedSeaDisplacement(sea, uv, 0.0);
      d += sea;
    }
    if (u_rippleEnabled) d += textureLod(u_rippleDisplacement, x0 / u_rippleSize + 0.5 / u_rippleN, 0.0).xyz;
    return d;
  }
`;

// Per particle (its index): its size, drawn from dN/dd ~ d^-3 between half SPRAY_SIZE and SPRAY_SIZE
const PARTICLE_GLSL = /* glsl */`
  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }
  // 0: the smallest droplet (SPRAY_SIZE / 2) .. 1: the largest (SPRAY_SIZE). Inverse of the cumulative distribution of
  // d^-3 on [1, 2] (in units of the smallest): d = (1 - 0.75 u)^-1/2, so 0 for u = 0, 1 for u = 1, median 0.26
  float particleSize01(int index) {
    float u = hash11(float(index));
    return inversesqrt(1.0 - 0.75 * u) - 1.0;
  }
`;

const quadVertex = /* glsl */`
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// One step of every particle
const updateFragment = /* glsl */`
  #ifndef PI
  #define PI 3.141592653589793
  #endif
  precision highp float;
  precision highp int;
  layout(location = 0) out vec4 out0;
  layout(location = 1) out vec4 out1;
  uniform sampler2D u_state0;
  uniform sampler2D u_state1;
  uniform bool u_reset;
  uniform float u_dt;
  uniform float u_frame;
  uniform float u_time;        // s, for the bursts
  uniform vec2 u_origin;       // World xz of the stored positions' origin
  uniform vec2 u_originShift;  // Previous origin - this origin
  // Where droplets are born: 0 a sector around the camera (perspective), 1 a rectangle (orthographic)
  uniform int u_regionMode;
  uniform vec2 u_regionCenter; // World xz
  uniform vec4 u_regionAxes;   // Sector: (forward, -); rectangle: (first axis, second axis). Unit, xz
  uniform vec4 u_regionSize;   // Sector: (radius, half angle, kill radius, -); rectangle: (half sizes, kill factor, -)
  uniform float u_attempt;     // Probability that a dead particle tries to be born this frame
  uniform float u_windSpeed;   // U10, m/s
  uniform float u_spume;       // 0..1: how much spume the wind tears off the crests
  uniform bool u_fromLarge;    // Also from the large breakers
  uniform vec2 u_smallSpeed;   // m/s, phase speed of the small breakers (their two scales)
  uniform vec2 u_smallLambda;  // m, their wavelengths
  uniform int u_side;
  ${OCEAN_DECLARATIONS}
  ${SURFACE_GLSL}
  ${SMALL_BREAKERS_GLSL}
  ${PARTICLE_GLSL}

  // Random numbers: PCG hash of the particle, the frame and a counter (Jarzynski & Olano 2020)
  uvec3 pcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v;
  }
  vec3 random3(uint k) {
    uvec3 h = pcg3d(uvec3(uvec2(gl_FragCoord.xy), uint(u_frame) * 16u + k));
    return vec3(h >> 8u) / 16777216.0;
  }
  // The same for the whole burst of this particle (its 4 x 4 block of texels) during this burst period
  vec3 burstRandom3(uint k) {
    uvec3 h = pcg3d(uvec3(uvec2(gl_FragCoord.xy) / 4u, uint(u_time / ${SPRAY_BURST_PERIOD.toFixed(2)}) * 16u + k));
    return vec3(h >> 8u) / 16777216.0;
  }

  // Share of the spray a crest of phase speed c throws: dissipation ~ c^5 per metre of crest (Duncan 1981, Phillips
  // 1985); c^2 comes from the area of its breaking zone (the candidates sample the area), c^3 from here (saturated)
  float energyWeight(float c) {
    float c3 = c * c * c, e3 = ${(SPRAY_ENERGY_SPEED ** 3).toFixed(3)};
    return c3 / (c3 + e3);
  }

  // Breaking at rest position x0. Returns (onset: how much spray this spot throws now 0..1, breaking strength 0..1).
  // speed: phase speed of the breaking crest (m/s), dir: its direction of travel (xz), surge: speed of the forward
  // surge of its water (m/s; large breakers only)
  vec2 breakingAt(vec2 x0, out float speed, out vec2 dir, out float surge) {
    float seaJ = 1.0;
    vec3 longStrain = vec3(0.0);
    vec2 uv = x0 / u_fftSize + 0.5 / u_fftN;
    if (u_fftEnabled) {
      vec4 a = textureLod(u_fftSlopes, uv, 0.0);
      float dxz = textureLod(u_fftExtra, uv, 0.0).x;
      longStrain = vec3(a.z, a.w, dxz);
      seaJ = (1.0 + a.z) * (1.0 + a.w) - dxz * dxz;
    }
    vec2 result = vec2(0.0);
    speed = mix(u_smallSpeed.x, u_smallSpeed.y, 0.5);
    dir = u_windDirection; // The ripples travel with the wind
    surge = 0.0;
    if (u_smallEnabled && u_rippleEnabled) {
      mat2 rippleT = u_rippleStrain > 0.0 ? inverseStretch(u_rippleStrain * longStrain) : mat2(1.0);
      float s = smallBreakerSource(x0, seaJ, rippleT, 1.0);
      if (s > 0.0) {
        // Front edge of the breaking zone: less breaking a quarter wavelength ahead (same long-wave strain)
        float ahead = smallBreakerSource(x0 + dir * (0.25 * u_smallLambda.x), seaJ, rippleT, 1.0);
        float front = clamp((s - ahead) / max(s, 1e-3), 0.0, 1.0);
        result = vec2(s * mix(0.3, 1.0, front) * energyWeight(speed), s);
      }
    }
    if (u_fromLarge && u_foamEnabled) {
      vec4 state = textureLod(u_foam, uv, 0.0);
      if (state.g > result.y) {
        float lambda = u_foamLambda0 * exp2(3.0 * foamScaleOf(state)); // Wavelength of that breaker
        speed = sqrt(9.81 * lambda / (2.0 * PI));
        dir = u_seaDirection;
        // Stage A: breaking that has not collapsed yet (the collapse follows after 0.2 periods)
        float onset = state.g * (1.0 - foamCollapse(uv, 0.0));
        result = vec2(onset * energyWeight(speed), state.g);
        // Forward surge of the whitecap (ocean vertex shader, dampedSeaDisplacement): its water moves forward by
        // u_foamSurge x the crest height while the crest collapses, over ${COLLAPSE_ATTACK_PERIODS} periods
        float period = sqrt(2.0 * PI * lambda / 9.81);
        float crest = u_fftEnabled ? max(textureLod(u_fftDisplacement, uv, 0.0).y, 0.0) : 0.0;
        surge = u_foamSurge * crest / (${COLLAPSE_ATTACK_PERIODS.toFixed(2)} * period) * state.g;
      }
    }
    return result;
  }

  vec2 candidate(vec2 q) {
    if (u_regionMode == 0) {
      float angle = (2.0 * q.x - 1.0) * u_regionSize.y;
      vec2 f = u_regionAxes.xy;
      vec2 dir = vec2(f.x * cos(angle) - f.y * sin(angle), f.x * sin(angle) + f.y * cos(angle));
      return u_regionCenter + dir * (u_regionSize.x * sqrt(q.y)); // Uniform over the area
    }
    return u_regionCenter + u_regionAxes.xy * ((2.0 * q.x - 1.0) * u_regionSize.x)
                          + u_regionAxes.zw * ((2.0 * q.y - 1.0) * u_regionSize.y);
  }

  bool outside(vec2 world) {
    vec2 d = world - u_regionCenter;
    if (u_regionMode == 0) return length(d) > u_regionSize.z;
    return abs(dot(d, u_regionAxes.xy)) > u_regionSize.x * u_regionSize.z
        || abs(dot(d, u_regionAxes.zw)) > u_regionSize.y * u_regionSize.z;
  }

  // Rest position whose displaced point is above 'world' (two fixed-point steps), and the surface height there
  vec3 surfaceUnder(vec2 world) {
    vec2 x0 = world - surfaceDisplacement(world, false).xz;
    x0 = world - surfaceDisplacement(x0, false).xz;
    return vec3(x0, surfaceDisplacement(x0, false).y);
  }

  void main() {
    ivec2 texel = ivec2(gl_FragCoord.xy);
    float size = particleSize01(texel.y * u_side + texel.x); // 0: smallest droplet, 1: largest
    vec4 s0 = texelFetch(u_state0, texel, 0);
    vec4 s1 = texelFetch(u_state1, texel, 0);
    if (u_reset) { s0 = vec4(0.0); s1 = vec4(0.0); }
    s0.xz += u_originShift;
    float dt = u_dt;
    vec2 windU = u_windDirection;

    if (s1.w > 0.0) {
      // FLYING: gravity and drag towards the wind (the wind near the surface: ~0.6 U10). The turbulence of the wind
      // holds the light droplets up: their effective gravity drops to 10% (the heaviest: 100%), as the wind rises
      vec3 wind = vec3(windU.x, 0.0, windU.y) * (0.6 * u_windSpeed);
      float lift = min(1.0, pow(u_windSpeed / ${SPRAY_WIND_LIFT.toFixed(1)}, 1.5));
      float gravity = 9.81 * mix(1.0, mix(0.1, 1.0, size * size), lift);
      vec3 v = s1.xyz + (vec3(0.0, -gravity, 0.0) + (wind - s1.xyz) / s1.w) * dt;
      vec3 p = s0.xyz + v * dt;
      float age = s0.w + dt;
      vec2 world = p.xz + u_origin;
      if (age > 2.0 || outside(world)) { out0 = vec4(0.0); out1 = vec4(0.0); return; }
      if (v.y < 0.0 && age > ${SPRAY_NO_COLLIDE.toFixed(3)}) { // Leaves the surface first
        vec3 under = surfaceUnder(world);
        if (p.y <= under.z) {
          // Lands: this frame it adds its foam at its rest position (the splat pass), then it is free again
          out0 = vec4(under.x - u_origin.x, under.z, under.y - u_origin.y, 0.0);
          out1 = vec4(0.0, 0.0, 0.0, -1.0);
          return;
        }
      }
      out0 = vec4(p, age);
      out1 = vec4(v, s1.w);
      return;
    }

    // DEAD (or landed last frame): try to be born on a breaking crest
    out0 = vec4(0.0); out1 = vec4(0.0);
    if (random3(0u).x >= u_attempt) return;
    for (int k = 0; k < ${SPRAY_CANDIDATES}; k++) {
      // The spot and the decisions are shared by the burst; each droplet leaves from a few centimetres around it
      vec3 q = burstRandom3(uint(k) + 1u);
      vec2 x0 = candidate(q.xy);
      float speed, surge;
      vec2 dir;
      vec2 breaking = breakingAt(x0, speed, dir, surge);
      // Spray from the breaking crest, or spume torn off its tip by the wind (the light droplets only)
      bool fromCrest = breaking.x > q.z;
      bool spume = !fromCrest && size < 0.5 && breaking.y * u_spume > burstRandom3(uint(k) + 20u).x;
      if (!fromCrest && !spume) continue;
      x0 += (random3(uint(k) + 4u).xy - 0.5) * ${SPRAY_BURST_SPREAD.toFixed(2)};
      // On the surface as drawn (with the collapse and surge of the large breakers)
      vec3 p = vec3(x0.x, 0.0, x0.y) + surfaceDisplacement(x0, true);
      vec3 r = random3(uint(k) + 8u);
      vec2 side = vec2(-dir.y, dir.x);
      vec2 horizontal;
      if (fromCrest) {
        // Forward with the crest: 0.8-1.7 c (u >= c at breaking, up to ~1.7 c), the heavy ones a little slower
        float forward = speed * mix(0.8, 1.7, random3(uint(k) + 16u).x) * mix(1.1, 0.9, size);
        horizontal = dir * forward + side * ((r.z - 0.5) * 0.2 * speed);
        // Large breakers: the droplets are part of the whitecap's forward surge (all of them: the water's speed)
        horizontal += dir * (surge * mix(0.7, 1.3, r.x));
      } else {
        // Spume: torn off by the wind, leaves with part of its speed (and some of the crest's)
        horizontal = windU * (0.6 * u_windSpeed * mix(0.4, 0.8, r.y)) + dir * (0.5 * speed) + side * ((r.z - 0.5) * 0.5);
      }
      // Drag time (s): the light droplets catch up with the wind in a few tenths of a second (0.25 s); the heavy ones
      // hardly notice it (1.5 s): a short parabola
      float drag = mix(0.25, 1.5, size);
      out0 = vec4(p.x - u_origin.x, p.y, p.z - u_origin.y, 0.0);
      out1 = vec4(horizontal.x, 0.0, horizontal.y, drag);
      return;
    }
  }
`;

// The flying droplets: one point per particle, read from the state by the vertex index (1 vertex per droplet), a round
// dot facing the camera
const dropletVertex = /* glsl */`
  precision highp float;
  precision highp int;
  uniform sampler2D u_state0;
  uniform sampler2D u_state1;
  uniform int u_side;
  uniform vec2 u_origin;
  uniform float u_viewportHeight; // Drawing buffer pixels
  uniform float u_size;           // m, the largest droplets
  ${OCEAN_DECLARATIONS}
  ${SKY_GLSL}
  ${PARTICLE_GLSL}
  const vec3 FOAM_FRESH = vec3(0.78, 0.84, 0.86);
  const float FOAM_SUN = 3.0;
  varying float v_alpha;
  varying vec3 v_color;

  void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; v_alpha = 0.0; }

  void main() {
    int index = gl_VertexID;
    ivec2 texel = ivec2(index % u_side, index / u_side);
    vec4 s0 = texelFetch(u_state0, texel, 0);
    vec4 s1 = texelFetch(u_state1, texel, 0);
    if (s1.w <= 0.0) { hide(); return; } // Dead or landed (its foam is in the spray foam texture)
    float size = u_size * 0.5 * (1.0 + particleSize01(index));
    vec4 clip = projectionMatrix * viewMatrix * vec4(s0.xyz + vec3(u_origin.x, 0.0, u_origin.y), 1.0);
    if (clip.w <= 0.0) { hide(); return; }
    // At least 1.5 pixels wide (thinner droplets drawn fainter: as much light as the droplet)
    float pixels = size * projectionMatrix[1][1] * 0.5 * u_viewportHeight / clip.w;
    gl_PointSize = clamp(pixels, 1.5, 128.0);
    gl_Position = clip;
    v_alpha = 0.9 * smoothstep(0.0, 0.05, s0.w) * min(1.0, pixels * pixels / 2.25);
    // Lit like the foam: sky and sun (droplets scatter light in all directions)
    vec3 light = skyAmbient() + FOAM_SUN * (u_sunDirection.y > 0.0 ? 0.7 : 0.0) * u_sunColor;
    v_color = FOAM_FRESH * light;
  }
`;

const dropletFragment = /* glsl */`
  precision highp float;
  varying float v_alpha;
  varying vec3 v_color;
  out vec4 outColor;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0 || v_alpha <= 0.0) discard;
    outColor = vec4(1.0 - exp(-v_color * 0.99), v_alpha * smoothstep(1.0, 0.5, r2)); // Tone mapping of the ocean (hdr)
  }
`;

// SPRAY FOAM. Splat: each droplet that landed this frame adds the area of its bubble patch (a Gaussian) to the foam
// texture, at its rest position (additive blending)
const splatVertex = /* glsl */`
  precision highp float;
  precision highp int;
  uniform sampler2D u_state0;
  uniform sampler2D u_state1;
  uniform int u_side;
  uniform vec2 u_origin;
  uniform vec3 u_window;  // (min x, min z, side) in metres
  uniform float u_texels; // Texels per side of the foam texture
  uniform float u_size;   // m, the largest droplets
  uniform float u_patch;  // Diameter of the bubble patch, times the droplet's
  uniform float u_radius; // m: the foam of each droplet is spread over at least this radius (groups the landings)
  ${PARTICLE_GLSL}
  varying float v_amount;
  varying float v_sigma;
  varying float v_pointSize;

  void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; v_amount = 0.0; }

  void main() {
    int index = gl_VertexID;
    ivec2 texel = ivec2(index % u_side, index / u_side);
    vec4 s1 = texelFetch(u_state1, texel, 0);
    if (s1.w != -1.0) { hide(); return; }
    vec2 x0 = texelFetch(u_state0, texel, 0).xz + u_origin;
    vec2 uv = (x0 - u_window.xy) / u_window.z;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) { hide(); return; }
    float texelSize = u_window.z / u_texels;
    float diameter = u_size * 0.5 * (1.0 + particleSize01(index));
    float bubbles = u_patch * diameter;                                   // m, diameter of its bubble patch
    v_amount = 0.785398 * bubbles * bubbles / (texelSize * texelSize);    // Its area, in texels
    v_sigma = clamp(max(0.5 * bubbles, u_radius) / texelSize, 0.7, 26.0); // Texels
    v_pointSize = clamp(ceil(6.0 * v_sigma), 2.0, 160.0);
    gl_PointSize = v_pointSize;
    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const splatFragment = /* glsl */`
  precision highp float;
  varying float v_amount;
  varying float v_sigma;
  varying float v_pointSize;
  out vec4 outColor;
  void main() {
    vec2 q = (gl_PointCoord - 0.5) * v_pointSize; // Texels from the centre
    float s2 = v_sigma * v_sigma;
    outColor = vec4(v_amount * exp(-0.5 * dot(q, q) / s2) / (6.2831853 * s2));
  }
`;

// Fade and spread: the foam of the previous frame, moved with the window (whole texels), diffused and faded
const fadeFragment = /* glsl */`
  precision highp float;
  precision highp int;
  uniform sampler2D u_previous;
  uniform ivec2 u_shift;   // Texels the window moved
  uniform int u_texels;
  uniform float u_spread;  // Diffusion per frame (D dt / dx^2, <= 0.2)
  uniform float u_fade;    // exp(-dt / lifetime)
  uniform bool u_reset;
  out vec4 outColor;
  float at(ivec2 p) {
    p += u_shift;
    if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, ivec2(u_texels)))) return 0.0;
    return texelFetch(u_previous, p, 0).r;
  }
  void main() {
    if (u_reset) { outColor = vec4(0.0); return; }
    ivec2 p = ivec2(gl_FragCoord.xy);
    float c = at(p);
    float n = at(p + ivec2(1, 0)) + at(p - ivec2(1, 0)) + at(p + ivec2(0, 1)) + at(p - ivec2(0, 1));
    outColor = vec4(max(0.0, (c + u_spread * (n - 4.0 * c)) * u_fade));
  }
`;

export class Spray {

  // side: particles per side of the state textures (side^2 particles). foamTexels: texels per side of the spray foam
  // texture. oceanUniforms: the ocean material's uniforms
  constructor(renderer, side, foamTexels, oceanUniforms, float = true) {
    this.renderer = renderer;
    this.side = side;
    this.foamTexels = foamTexels;
    this.settings = { enabled: true, amount: 1, fromLarge: true, foam: true, foamPatch: SPRAY_FOAM_PATCH,
      foamLifetime: SPRAY_FOAM_LIFETIME };
    this.foamActive = false; // Spray foam drawn (the ocean reads foamTexture)
    this.windSpeed = 0;
    this.frame = 0;
    this.needsReset = true;
    this.active = false;
    this.origin = new THREE.Vector2();
    this.status = { active: false, distance: 0 };

    const target = () => new THREE.WebGLRenderTarget(side, side, { count: 2,
      type: float ? THREE.FloatType : THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false,
      generateMipmaps: false });
    this.targets = [target(), target()];
    this.current = 0;

    // Spray foam: fraction of the surface covered, around the camera (half float, one channel, filtered)
    const foamTarget = () => new THREE.WebGLRenderTarget(foamTexels, foamTexels, { type: THREE.HalfFloatType,
      format: THREE.RedFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false,
      generateMipmaps: false });
    this.foamTargets = [foamTarget(), foamTarget()];
    this.foamCurrent = 0;
    this.window = new THREE.Vector3(0, 0, SPRAY_FOAM_EXTENT); // (min x, min z, side) in metres
    this.windowTexel = null; // Snapped window origin, in texels

    const shared = {};
    OCEAN_UNIFORMS.forEach(name => shared[name] = oceanUniforms[name]);

    this.updateMaterial = new THREE.ShaderMaterial({ vertexShader: quadVertex, fragmentShader: updateFragment,
      glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
      uniforms: { ...shared, u_state0: { value: null }, u_state1: { value: null }, u_reset: { value: true },
        u_dt: { value: 0 }, u_frame: { value: 0 }, u_time: { value: 0 }, u_origin: { value: new THREE.Vector2() },
        u_originShift: { value: new THREE.Vector2() }, u_regionMode: { value: 0 },
        u_regionCenter: { value: new THREE.Vector2() }, u_regionAxes: { value: new THREE.Vector4(0, 1, 1, 0) },
        u_regionSize: { value: new THREE.Vector4() }, u_attempt: { value: 0 }, u_windSpeed: { value: 0 },
        u_spume: { value: 0 }, u_fromLarge: { value: true }, u_smallSpeed: { value: new THREE.Vector2(1.25, 1.77) },
        u_smallLambda: { value: new THREE.Vector2(1, 2) }, u_side: { value: side } } });
    this.fadeMaterial = new THREE.ShaderMaterial({ vertexShader: quadVertex, fragmentShader: fadeFragment,
      glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
      uniforms: { u_previous: { value: null }, u_shift: { value: new THREE.Vector2() }, u_texels: { value: foamTexels },
        u_spread: { value: 0 }, u_fade: { value: 1 }, u_reset: { value: true } } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.updateMaterial);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // One vertex per particle (the vertex shaders only use its index: a 1-byte dummy attribute sets the count)
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Uint8Array(side * side), 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity); // Not computed from the dummy attribute
    this.geometry = geometry;

    this.pointsMaterial = new THREE.ShaderMaterial({ vertexShader: dropletVertex, fragmentShader: dropletFragment,
      glslVersion: THREE.GLSL3, transparent: true, depthWrite: false, depthTest: true,
      uniforms: { ...shared, u_state0: { value: null }, u_state1: { value: null }, u_side: { value: side },
        u_origin: { value: new THREE.Vector2() }, u_viewportHeight: { value: 1 }, u_size: { value: SPRAY_SIZE } } });
    this.points = new THREE.Points(geometry, this.pointsMaterial);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1; // After the ocean (transparent too): tested against its depth
    this.points.visible = false;

    this.splatMaterial = new THREE.ShaderMaterial({ vertexShader: splatVertex, fragmentShader: splatFragment,
      glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      uniforms: { u_state0: { value: null }, u_state1: { value: null }, u_side: { value: side },
        u_origin: { value: new THREE.Vector2() }, u_window: { value: this.window }, u_texels: { value: foamTexels },
        u_size: { value: SPRAY_SIZE }, u_patch: { value: SPRAY_FOAM_PATCH }, u_radius: { value: 0.25 } } });
    this.splatPoints = new THREE.Points(geometry, this.splatMaterial);
    this.splatPoints.frustumCulled = false;
    this.splatScene = new THREE.Scene();
    this.splatScene.add(this.splatPoints);
  }

  // Foam of the landed droplets (fraction of the surface covered), and its window (min x, min z, side) in metres
  get foamTexture() { return this.foamTargets[this.foamCurrent].texture; }

  // Wavelengths (m) of the two scales of small breakers: their crest speeds launch the droplets
  setSmallWavelengths(lambdas) {
    const c = l => Math.sqrt(9.81 * l / (2 * Math.PI));
    if (!lambdas || lambdas.length < 2) return;
    this.updateMaterial.uniforms.u_smallSpeed.value.set(c(lambdas[0]), c(lambdas[1]));
    this.updateMaterial.uniforms.u_smallLambda.value.set(lambdas[0], lambdas[1]);
  }

  // {enabled, amount, fromLarge, foam (landed droplets turn into foam), foamPatch (bubble patch, x droplet diameter),
  // foamLifetime (s), foamRadius (m, the foam of each droplet is spread over at least this radius)}
  setSettings(settings) {
    Object.assign(this.settings, settings);
    if (!this.settings.enabled) this.deactivate();
  }

  reset() { this.needsReset = true; }

  deactivate() {
    this.active = false;
    this.foamActive = false;
    this.needsReset = true;
    this.points.visible = false;
    this.status = { active: false, distance: this.status.distance };
  }

  // Where droplets are worth drawing for this camera: sets the region uniforms, or returns false (too far)
  setRegion(camera, height) {
    const u = this.updateMaterial.uniforms, size = SPRAY_SIZE / SPRAY_PIXELS;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    u.u_regionCenter.value.set(camera.position.x, camera.position.z);
    if (camera.isOrthographicCamera) {
      const viewH = (camera.top - camera.bottom) / camera.zoom, viewW = (camera.right - camera.left) / camera.zoom;
      this.status.distance = 0;
      if (viewH / height > size || camera.position.y < 0) return false;
      // Camera axes projected on the sea (looking down: the visible rectangle)
      const a = new THREE.Vector2(e[0], e[2]), b = new THREE.Vector2(e[4], e[6]);
      if (a.lengthSq() < 1e-6 || b.lengthSq() < 1e-6) return false;
      a.normalize(); b.normalize();
      u.u_regionMode.value = 1;
      u.u_regionAxes.value.set(a.x, a.y, b.x, b.y);
      u.u_regionSize.value.set(viewW / 2, viewH / 2, 1.3, 0);
      this.area = viewW * viewH;
      return true;
    }
    // Perspective: a droplet is SPRAY_PIXELS wide up to dMax = size f, f the focal length in pixels
    const f = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) * (camera.zoom || 1);
    const dMax = size * f, h = camera.position.y;
    this.status.distance = dMax;
    if (h <= 0 || h >= dMax) return false;
    const radius = Math.sqrt(dMax * dMax - h * h);
    // Sector of the view on the sea (all around when looking down)
    const forward = new THREE.Vector2(-e[8], -e[10]);
    const flat = forward.length();
    let halfAngle = Math.PI;
    if (flat > 0.3) {
      forward.divideScalar(flat);
      const halfFov = Math.atan(camera.aspect * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      halfAngle = Math.min(Math.PI, halfFov + 0.35 + (flat < 0.8 ? 0.8 : 0));
    } else forward.set(0, 1);
    u.u_regionMode.value = 0;
    u.u_regionAxes.value.set(forward.x, forward.y, 0, 0);
    u.u_regionSize.value.set(radius, halfAngle, radius * 1.2 + 3, 0);
    this.area = halfAngle * radius * radius;
    return true;
  }

  // One step: camera, the selected camera; dt in s
  update(dt, camera) {
    const s = this.settings;
    if (!s.enabled || !camera) { if (this.active || this.points.visible) this.deactivate(); return; }
    const renderer = this.renderer;
    const height = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    if (!this.setRegion(camera, height)) { this.deactivate(); return; }
    this.active = true;
    this.status = { active: true, distance: this.status.distance };

    const u = this.updateMaterial.uniforms;
    dt = Math.min(Math.max(0, dt), 0.05);
    const reset = this.needsReset;
    this.needsReset = false;
    // Origin of the stored positions: follows the camera by steps (precision of the half-float fallback)
    const center = u.u_regionCenter.value;
    const ox = Math.round(center.x / SPRAY_ORIGIN_STEP) * SPRAY_ORIGIN_STEP;
    const oz = Math.round(center.y / SPRAY_ORIGIN_STEP) * SPRAY_ORIGIN_STEP;
    u.u_originShift.value.set(reset ? 0 : this.origin.x - ox, reset ? 0 : this.origin.y - oz);
    this.origin.set(ox, oz);
    u.u_origin.value.copy(this.origin);

    const U = this.windSpeed;
    // Droplets come from the breakers (whose number already follows the wind); the wind sets how far they fly, and
    // above SPRAY_SPUME_WIND it tears spume off the crests, steeply more with the wind
    const fill = Math.min(1, this.area / (this.side * this.side * SPRAY_AREA_PER_PARTICLE));
    u.u_attempt.value = 1 - Math.exp(-SPRAY_RATE * s.amount * fill * dt);
    u.u_spume.value = Math.min(1, Math.max(0, (U - SPRAY_SPUME_WIND) / SPRAY_SPUME_WIND) ** 2);
    u.u_windSpeed.value = U;
    u.u_fromLarge.value = !!s.fromLarge;
    u.u_dt.value = dt;
    u.u_frame.value = (this.frame = (this.frame + 1) % 1000000);
    u.u_time.value = (this.time = ((this.time || 0) + dt) % 10000);
    const previous = this.targets[this.current].textures;
    u.u_state0.value = previous[0];
    u.u_state1.value = previous[1];
    u.u_reset.value = reset;
    this.current = 1 - this.current;
    const next = this.targets[this.current].textures;

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.quad.material = this.updateMaterial;
    renderer.setRenderTarget(this.targets[this.current]);
    renderer.render(this.scene, this.camera);

    // Spray foam: move the window with the camera (whole texels), fade and spread the old foam, add the landed droplets
    if (s.foam) {
      const N = this.foamTexels, texel = SPRAY_FOAM_EXTENT / N;
      const wx = Math.floor((center.x - SPRAY_FOAM_EXTENT / 2) / texel), wz = Math.floor((center.y - SPRAY_FOAM_EXTENT / 2) / texel);
      const f = this.fadeMaterial.uniforms;
      const shift = this.windowTexel ? [wx - this.windowTexel[0], wz - this.windowTexel[1]] : [0, 0];
      f.u_reset.value = reset || !this.foamActive || !this.windowTexel || Math.abs(shift[0]) >= N || Math.abs(shift[1]) >= N;
      f.u_shift.value.set(shift[0], shift[1]);
      f.u_spread.value = Math.min(0.2, SPRAY_FOAM_DIFFUSION * dt / (texel * texel));
      f.u_fade.value = Math.exp(-dt / Math.max(0.02, s.foamLifetime ?? SPRAY_FOAM_LIFETIME));
      f.u_previous.value = this.foamTargets[this.foamCurrent].texture;
      this.windowTexel = [wx, wz];
      this.window.set(wx * texel, wz * texel, SPRAY_FOAM_EXTENT);
      this.foamCurrent = 1 - this.foamCurrent;
      renderer.setRenderTarget(this.foamTargets[this.foamCurrent]);
      this.quad.material = this.fadeMaterial;
      renderer.render(this.scene, this.camera);
      const sp = this.splatMaterial.uniforms;
      sp.u_state0.value = next[0];
      sp.u_state1.value = next[1];
      sp.u_origin.value.copy(this.origin);
      sp.u_patch.value = s.foamPatch ?? SPRAY_FOAM_PATCH;
      sp.u_radius.value = s.foamRadius ?? 0.25;
      renderer.render(this.splatScene, this.camera);
      this.quad.material = this.updateMaterial;
    }
    this.foamActive = !!s.foam;

    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);

    const p = this.pointsMaterial.uniforms;
    p.u_state0.value = next[0];
    p.u_state1.value = next[1];
    p.u_origin.value.copy(this.origin);
    p.u_viewportHeight.value = height;
    this.points.visible = true;
  }

  // Particles (read back from the GPU, for testing): {flying, landed (this frame), total}
  async count() {
    const n = this.side * this.side, target = this.targets[this.current];
    const float = target.textures[1].type == THREE.FloatType;
    const buffer = float ? new Float32Array(n * 4) : new Uint16Array(n * 4);
    await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, this.side, this.side, buffer, undefined, 1);
    const value = float ? i => buffer[i] : i => THREE.DataUtils.fromHalfFloat(buffer[i]);
    let flying = 0, landed = 0;
    for (let i = 0; i < n; i++) { const w = value(i * 4 + 3); if (w > 0) flying++; else if (w < 0) landed++; }
    return { flying, landed, total: n };
  }

  // Mean and maximum of the spray foam (read back, for testing)
  async foamStats() {
    const N = this.foamTexels, buffer = new Uint16Array(N * N);
    await this.renderer.readRenderTargetPixelsAsync(this.foamTargets[this.foamCurrent], 0, 0, N, N, buffer);
    let sum = 0, max = 0, covered = 0;
    for (let i = 0; i < N * N; i++) {
      const v = THREE.DataUtils.fromHalfFloat(buffer[i]);
      sum += v; max = Math.max(max, v); if (v > 0.05) covered++;
    }
    return { mean: sum / (N * N), max, covered: covered / (N * N) };
  }

  dispose() {
    this.targets.forEach(t => t.dispose());
    this.foamTargets.forEach(t => t.dispose());
    this.updateMaterial.dispose();
    this.fadeMaterial.dispose();
    this.pointsMaterial.dispose();
    this.splatMaterial.dispose();
    this.quad.geometry.dispose();
    this.geometry.dispose();
    if (this.points.parent) this.points.parent.remove(this.points);
  }
}
