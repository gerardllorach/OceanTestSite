// https://threejs.org/docs/index.html#api/en/materials/ShaderMaterial
// https://threejs.org/docs/#api/en/renderers/webgl/WebGLProgram -- cameraPosition matrices etc...
// https://webglfundamentals.org/webgl/lessons/webgl-shaders-and-glsl.html
// https://www.khronos.org/files/opengles_shading_language.pdf
// https://registry.khronos.org/OpenGL/specs/es/2.0/GLSL_ES_Specification_1.00.pdf // For WebGL

// Data texture
// https://codepen.io/prisoner849/pen/WNQNdpv?editors=0010

// Ben Cloward has some interesting tutorials with Unreal Engine on how to make water effects, but they are not explained
// UE Ocean using texture https://www.youtube.com/watch?v=r68DnTMeFFQ&list=PL78XDi0TS4lGXKflD2Z5aY2sLuIln6-sD&ab_channel=BenCloward
// Adding a Gestner wave to that https://www.youtube.com/watch?v=BJSMVvZMQ1w&ab_channel=BenCloward

// Gestner waves tutorial
// https://catlikecoding.com/unity/tutorials/flow/waves/

// 2D water effect
// https://brandenstrochinsky.blogspot.com/2016/06/water-effect.html
// Screen space reflections (SSR)
// https://www.youtube.com/watch?v=K2rs7K4y_sY&ab_channel=NullPointer
// /OceanTestSite/lib/three.js/examples/?q=post#webgl_postprocessing_ssr
// Mirror reflection
// http://www.shiplab.hials.org/app/simulator/Elias/

// Blending normals
// https://blog.selfshadow.com/publications/blending-in-detail/

// Foam
// RenderToTarget the displacement. Use it to create a foam texture and particles
// https://www.youtube.com/watch?v=UWGwq-_w08c&ab_channel=GhislainGirardot

// Read more about normal mapping
// https://www.youtube.com/watch?v=6_-NNKc4lrk&ab_channel=Makin%27StuffLookGood
// https://www.youtube.com/watch?v=JNj1A1bl7gg&ab_channel=VictorGordan

// GLSL OPTIMIZATIONS
// https://www.khronos.org/opengl/wiki/GLSL_Optimizations

// Surface ripples and ocean lighting (fragment shader)
// Bruneton, Neyret & Holzschuch 2010, "Real-time realistic ocean lighting using seamless transitions from geometry to BRDF"
// https://inria.hal.science/inria-00443630 -- ripples finer than a pixel become roughness (slope variance), so Fresnel,
// sky reflection and sun glitter stay consistent at every distance. The sea and the ripples are two FFT cascades
// (Assets/Ocean/FFTOcean.js, spectra in SeaSpectrum.js and RippleSpectrum.js); the discrete waves are Gerstner waves.


// Use VS plugin "Comment tagged templates" and add /* glsl */
export const OceanProjectedGridVertShader = /* glsl */ `

  #define PI 3.141592653589793
  // highp: world coordinates reach ~1e5 m on the projected grid (lowp / mediump break on mobile GPUs)
  precision highp float;

  uniform float u_time;
  uniform vec2 u_imgSize;
  uniform int u_numWaves;
  uniform sampler2D u_paramsTexture;
  uniform float u_maxEncodedWaveHeight;
  uniform float u_maxEncodedPeriod;
  // uniform float u_steepnessFactor;

  // Grid reprojection
  uniform mat4 u_cameraModelMatrix;
  uniform vec3 u_cameraGridPosition;
  uniform vec2 u_cameraViewportScale;
  uniform vec2 u_gridStep; // Spacing of the grid vertices (mesh units, before the viewport scale)

  // FFT cascades (Assets/Ocean/FFTOcean.js): displacement (Dx, h, Dz) of a tile of Size metres and N texels, repeated.
  // Sea (u_fft*) and surface ripples (u_ripple*)
  uniform bool u_fftEnabled;
  uniform sampler2D u_fftDisplacement;
  uniform float u_fftSize;
  uniform float u_fftN;
  uniform bool u_rippleEnabled;
  uniform sampler2D u_rippleDisplacement;
  uniform float u_rippleSize;
  uniform float u_rippleN;

  varying vec3 v_WorldPosition; // Rest position of the surface point (projected grid on the plane y = 0)
  varying vec3 v_Normal;        // Normal of the Gerstner surface (without the FFT cascades: the fragment shader adds them)
  varying vec3 v_wavePosition;  // Position displaced by the Gerstner waves and the FFT cascades (filtered to the mesh)
  varying vec3 v_gerstnerStrain; // Strain of the Gerstner waves (dDx/dx, dDz/dz, dDx/dz): how they stretch the surface



  // Gerstner Wave
  // https://catlikecoding.com/unity/tutorials/flow/waves/
  vec3 GerstnerWave(
      vec4 waveParams, vec3 position, 
      inout vec3 tangent, inout vec3 binormal, inout vec3 strain){

    float amplitude = waveParams.y / 2.0;
    float T = max(waveParams.x, 0.1);
    // Deep-water dispersion relation: the wavenumber depends on the period only (k = w^2 / g).
    //
    // Removed clamp: this used to be
    //   amplitude = max(height, 0.01) / 2;  steepness = max(k * amplitude, 0.01);  wavelength = amplitude * 2PI / steepness;
    // Most likely there to avoid render artifacts / degenerate waves (zero height -> infinite wavelength).
    // But it was a lower bound and the wavelength came from the clamped steepness, so every wave with
    // k * amplitude < 0.01 (e.g. 10 s waves under 0.5 m, 5 s waves under 0.12 m) was rendered with a shorter
    // period than requested (0.2 m / 10 s was rendered at 6.4 s). Now k comes from T and a zero height is fine.
    // Note: a lower bound never prevented loops. Gerstner crests loop when the waves are too steep
    // (sum of k * amplitude over the waves > 1). If that shows up, limit the steepness without changing k
    // (e.g. scale down the horizontal displacement), so that the periods stay correct.
    // Keep in sync with Assets/Scripts/OceanAnalysis/gerstner.js.
    float k = 4.0 * PI * PI / (T * T * 9.8);
    float steepness = k * amplitude;
    // Direction from angle
    vec2 direction = vec2(sin(-waveParams.z), cos(-waveParams.z)); // Direction (negative for clockwise rotation)
    float phase = waveParams.w;

    // Velocity (related to gravity and wavelength)
    float velocity = sqrt(9.8 / k);
    
    // Normalize direction
    direction = normalize(direction);
    // Trochoidal wave movement
    //float f = k * (dot(direction, position.xz) - velocity * u_time); // + randomPhase
    float f = k * (dot(direction, position.xz) - velocity * u_time ) + phase;
    
    // Tangent
    tangent += vec3(
      -direction.x * direction.x * (steepness * sin(f)),
      direction.x * (steepness * cos(f)),
      -direction.x * direction.y * (steepness * sin(f))
    );

    // Binormal
    binormal += vec3(
      -direction.x * direction.y * (steepness * sin(f)),
      direction.y * (steepness * cos(f)),
      -direction.y * direction.y * (steepness * sin(f))
    );

    // Strain: derivatives of the horizontal displacement (the same terms as in the tangent and binormal, which are
    // normalised and lose them). 1 - steepness at the crest (squeezed), 1 + steepness in the trough (stretched)
    strain += -steepness * sin(f) * vec3(direction.x * direction.x, direction.y * direction.y, direction.x * direction.y);

    return vec3(
      direction.x * (amplitude * cos(f)),
      amplitude * sin(f),
      direction.y * (amplitude * cos(f))
    );

  }


  // ******************************** //
  // Grid reprojection: position of a grid vertex projected on the sea plane (y = 0)
  vec3 gridToPlane(vec3 gridPosition) {
    // Scale the vertices to fall inside the viewport
    vec3 scaledPosition = gridPosition;
    scaledPosition.x = gridPosition.x * u_cameraViewportScale.x; // TODO EXTRA SCALING IF BIG WAVES?
    scaledPosition.y = gridPosition.y * u_cameraViewportScale.y; // TODO EXTRA SCALING (* 1.5?) IF BIG WAVES?

    // Move vertices in front of the camera
    vec3 worldPosFrontCamera = vec3(modelMatrix * vec4(scaledPosition, 1.0));

    // Project vertex in the XZ plane
    // Calculate intersection between plane and camera ray
    vec3 ray = normalize(worldPosFrontCamera - u_cameraGridPosition);
    // Ray is not parallel to the horizon
    float t = -1.0;
    if (ray.y != 0.0)
        t = (0.0 - u_cameraGridPosition.y) / ray.y;

    // Intersection point
    vec3 intersectionPoint = u_cameraGridPosition + ray * t;

    // HACK -> if cameraForward is opposite from ray direction, move intersection point on the opposite side
    // TODO: this method assumes that the camera is close to the center 0,0,0
    // Extract forward vector from camera
    mat3 orientationMatrix = mat3(u_cameraModelMatrix);
    vec3 forwardCameraVector = -orientationMatrix[2];
    vec3 ray2 = intersectionPoint - u_cameraGridPosition;
    float dotResult = dot(forwardCameraVector, ray2);
    if (dotResult < 0.0)
        intersectionPoint = intersectionPoint * -1.0;
    return intersectionPoint;
  }


  // Displacement of an FFT cascade at rest position xz. Mip level from the size of the mesh: where the mesh is coarser
  // than the texels, it takes the filtered displacement instead of aliasing it
  vec3 cascadeDisplacement(sampler2D map, float size, float n, vec2 xz, float footprint) {
    float lod = clamp(log2(max(footprint, 1e-6) * n / size), 0.0, log2(n));
    return textureLod(map, xz / size + 0.5 / n, lod).xyz;
  }


  void main() {

    // ******************************** //
    // Grid reprojection
    vec3 intersectionPoint = gridToPlane(position);
    // Distance between this vertex and its neighbours on the sea plane: the size of the mesh here (adaptive:
    // centimetres near the camera, metres far away). Ripples shorter than ~3 vertices are not put on the geometry
    float footprint = max(distance(gridToPlane(position + vec3(u_gridStep.x, 0.0, 0.0)), intersectionPoint),
                          distance(gridToPlane(position + vec3(0.0, u_gridStep.y, 0.0)), intersectionPoint));

    // ******************************** //


    // Get position
    vec3 modPos = intersectionPoint; // position;

    // Attenuate waves as they get further away form the center (avoids artifacts)
    float distanceToCenter = distance(vec3(0.0, 0.0, 0.0), intersectionPoint);
    float distanceStart = 200.0;
    distanceToCenter = min(10000.0, max(distanceStart, distanceToCenter));
    float distanceFactor = max(0.0001, distanceStart/(distanceToCenter));
    distanceFactor = 1.0;

    // Declare tangent and binormal
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    vec3 strain = vec3(0.0);


    // Gerstner Waves (the discrete waves), chained: each one is evaluated at the position displaced by the previous ones
    // Iterate over all the waves (none when the sea is only an FFT sea)
    int numTexels = int(u_imgSize.x * u_imgSize.y);
    for (int n = 0; n < numTexels; n++){
      if (n >= u_numWaves) break;
      int i = n % int(u_imgSize.x);
      int j = n / int(u_imgSize.x);
      {
        // u_paramsTexture(period, wave height, direction, phase), sampled at the centre of the texel
        vec4 params = texture2D(u_paramsTexture, vec2((float(i) + 0.5)/u_imgSize.x, (float(j) + 0.5)/u_imgSize.y));
        // Skip if height or steepness are zero
        //if (params.r == 0.0 || params.g == 0.0){

        //} else {

          // Wave height encoded
          params.y = params.y * u_maxEncodedWaveHeight;
          // Period encoded
          params.x = params.x * u_maxEncodedPeriod;
          // Direction
          params.z = params.z * 360.0 * PI / 180.0;
          // Phase
          params.w = params.w * 360.0 * PI / 180.0;
          
          // Interate position
          modPos += GerstnerWave(params, modPos, tangent, binormal, strain);
          
          // Attenuation
          //modPos.y *= distanceFactor;
          //tangent.x /= distanceFactor;
          //binormal.z /= distanceFactor;
          tangent = normalize(tangent);
          binormal = normalize(binormal);
        //}
      }
    }


    // Normal
    vec3 normal = normalize(cross(binormal, tangent));
    v_Normal = normalize(normal.xyz);
    v_gerstnerStrain = strain;

    // FFT cascades (sea and ripples): displacement at the rest position (Tessendorf: linear superposition of
    // trochoidal components), added after the discrete waves, like in the analysis
    if (u_fftEnabled)
      modPos += cascadeDisplacement(u_fftDisplacement, u_fftSize, u_fftN, intersectionPoint.xz, footprint);
    if (u_rippleEnabled)
      modPos += cascadeDisplacement(u_rippleDisplacement, u_rippleSize, u_rippleN, intersectionPoint.xz, footprint);

    // World position
    //vec4 worldPosition = modelMatrix * vec4(modPos, 1.0);
    //v_WorldPosition = worldPosition.xyz;
    v_WorldPosition = intersectionPoint;
    v_wavePosition = modPos;


    // Screen space position
    //gl_Position = projectionMatrix * modelViewMatrix * vec4(modPos, 1.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(modPos, 1.0);
  }
  `;












export const OceanProjectedGridFragShader = /* glsl */`

  #define PI 3.141592653589793
  precision highp float;

  varying vec3 v_WorldPosition; // Rest position of the surface point (projected grid on the plane y = 0)
  varying vec3 v_Normal;        // Normal of the Gerstner surface
  varying vec3 v_wavePosition;  // Position displaced by the Gerstner waves and the FFT cascades
  varying vec3 v_gerstnerStrain; // Strain of the Gerstner waves (dDx/dx, dDz/dz, dDx/dz)

  uniform vec2 u_rippleTailSigma2;        // Slope variance finer than the ripple grid (upwind, crosswind)
  uniform float u_rippleStrain;           // Ripples strained by the long waves. 0: off, 1: Longuet-Higgins & Stewart
  uniform vec2 u_windDirection;           // Direction the wind blows towards, in the xz plane (unit)

  // Sun
  uniform vec3 u_sunDirection;            // From the surface towards the sun (unit)
  uniform vec3 u_sunColor;                // Colour and intensity (1, 1, 1 with a high sun)

  // Sky: the skybox rendered into a cube map, with mipmaps (OceanEntity.captureSky)
  uniform samplerCube u_skyCube;

  // FFT cascades (Assets/Ocean/FFTOcean.js), mipmapped: sea (u_fft*) and surface ripples (u_ripple*)
  uniform bool u_fftEnabled;
  uniform sampler2D u_fftSlopes; // (hx, hz, Dxx, Dzz)
  uniform sampler2D u_fftExtra;  // (Dxz, hx^2, hz^2, hx hz)
  uniform float u_fftSize;
  uniform float u_fftN;
  uniform bool u_rippleEnabled;
  uniform sampler2D u_rippleSlopes;
  uniform sampler2D u_rippleExtra;
  uniform float u_rippleSize;
  uniform float u_rippleN;
  uniform bool u_skyReady;

  // 0: final colour, 1: Fresnel, 2: normal, 3: roughness (red upwind, green crosswind), 4: resolved ripple slopes,
  // 5: stretch of the surface by the long waves (red squeezed, blue stretched)
  uniform int u_debugView;

  // Fog
  uniform vec3 u_fogUnderwaterColor;
  uniform float u_fogDensity;

  // Special uniforms for rendering frames
  // Grayscale
  uniform bool u_grayscale;
  // Render wave heights
  uniform bool u_paintWaveHeight;
  uniform float u_maxWaveHeight;

  const vec3 OCEAN_COLOR = vec3(0.016, 0.064, 0.192);
  // Sky radiance. The factor 2 keeps the brightness of the previous version (skyColor * fresnel * 2)
  const vec3 SKY_ZENITH = vec3(0.51, 0.75, 1.0) * 2.0;
  const vec3 SKY_HORIZON = vec3(0.655, 0.84, 1.0) * 2.0;
  const float SUN_IRRADIANCE = 6.0;


  // https://github.com/dli/waves/blob/master/simulation.js
  vec3 hdr (vec3 color, float exposure) {
      return 1.0 - exp(-color * exposure);
  }

  // Sky seen in a direction whose elevation has sine y: gradient from the horizon to the zenith
  vec3 skyRadiance(float y) {
    return mix(SKY_HORIZON, SKY_ZENITH, sqrt(clamp(y, 0.0, 1.0)));
  }

  // Sky reflected in direction R. Rough water reflects a cone of directions of about "spread" radians: a blurrier
  // mip level of the cube map. The colours are converted so that a perfect mirror (fresnel = 1) shows exactly the
  // skybox after the tone mapping (hdr) below.
  vec3 skyReflection(vec3 R, float spread) {
    if (!u_skyReady)
      return 0.25 * skyRadiance(R.y - spread) + 0.5 * skyRadiance(R.y) + 0.25 * skyRadiance(R.y + spread);
    // A ray reflected downwards (back of a steep crest) would hit another wave and see the sky from there: mirror it
    // upwards. The skybox is a dome with nothing below the horizon (clamping to it drew grey lines on the crests)
    vec3 dir = normalize(vec3(R.x, max(abs(R.y), 0.05), R.z));
    float lod = clamp(log2(max(spread, 1e-4) / 0.0061), 0.0, 8.0); // 0.0061 rad: one texel of the 256 px cube
    vec3 c = textureLod(u_skyCube, dir, lod).rgb;
    c = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); // Linear (render target) to display values
    return -log(1.0 - min(c, vec3(0.96)));     // Inverse of hdr()
  }

  // Slope variance of the surface along the azimuth of direction D (D projected on the tangent plane Tu, Tc)
  float slopeVarianceAlong(vec3 D, vec3 Tu, vec3 Tc, vec2 sigmaSq) {
    float du = dot(D, Tu), dc = dot(D, Tc);
    return (du * du * sigmaSq.x + dc * dc * sigmaSq.y) / max(du * du + dc * dc, 1e-6);
  }

  // Fresnel reflectance averaged over Gaussian slopes of standard deviation sigmaV (Bruneton et al. 2010).
  // With sigmaV = 0 it is the Schlick term (1 - cos)^5. Used as 0.02 + 0.98 * meanFresnel.
  float meanFresnel(float cosThetaV, float sigmaV) {
    return pow(1.0 - cosThetaV, 5.0 * exp(-2.69 * sigmaV)) / (1.0 + 22.7 * pow(sigmaV, 1.5));
  }

  float erfcApprox(float x) {
    return 2.0 * exp(-x * x) / (2.319 * x + sqrt(4.0 + 1.52 * x * x));
  }

  // Smith shadowing / masking for Gaussian slopes of variance sigmaSq
  float smithLambda(float cosTheta, float sigmaSq) {
    cosTheta = clamp(cosTheta, 0.01, 0.9999);
    float v = min(20.0, cosTheta / sqrt((1.0 - cosTheta * cosTheta) * 2.0 * sigmaSq));
    return max(0.0, (exp(-v * v) - v * sqrt(PI) * erfcApprox(v)) / (2.0 * v * sqrt(PI)));
  }

  // Sun reflected by a surface whose slopes are Gaussian around N, with variances sigmaSq along Tu and Tc
  // (Bruneton et al. 2010). Multiply by the sun irradiance.
  float reflectedSunRadiance(vec3 L, vec3 V, vec3 N, vec3 Tu, vec3 Tc, vec2 sigmaSq) {
    vec3 H = normalize(L + V);
    float zH = max(dot(H, N), 1e-3);
    float zetaU = dot(H, Tu) / zH; // Slopes of the facets that reflect the sun into the camera
    float zetaC = dot(H, Tc) / zH;
    float p = exp(-0.5 * (zetaU * zetaU / sigmaSq.x + zetaC * zetaC / sigmaSq.y)) / (2.0 * PI * sqrt(sigmaSq.x * sigmaSq.y));
    float zL = max(dot(L, N), 0.01);
    float zV = max(dot(V, N), 0.01);
    float sigmaL2 = slopeVarianceAlong(L, Tu, Tc, sigmaSq);
    float sigmaV2 = slopeVarianceAlong(V, Tu, Tc, sigmaSq);
    float fresnel = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, H), 0.0, 1.0), 5.0);
    float zH2 = zH * zH;
    return fresnel * p / ((1.0 + smithLambda(zL, sigmaL2) + smithLambda(zV, sigmaV2)) * zV * zH2 * zH2 * 4.0);
  }



  // Slopes and Jacobian of an FFT cascade at rest position xz, at the mip level of the pixel (trilinear filtering):
  // adds (hx, hz, Dxx, Dzz) to s and Dxz to dxz. Its mipmaps of the squared slopes keep the slope variance finer than
  // that level (LEAN mapping); returned as a symmetric tensor (xx, zz, xz)
  vec3 sampleCascade(sampler2D slopes, sampler2D extra, float size, float n, vec2 xz, inout vec4 s, inout float dxz) {
    vec2 uv = xz / size + 0.5 / n;
    vec4 a = texture2D(slopes, uv); // (hx, hz, Dxx, Dzz)
    vec4 b = texture2D(extra, uv);  // (Dxz, hx^2, hz^2, hx hz)
    s += a;
    dxz += b.x;
    return vec3(max(0.0, b.y - a.x * a.x), max(0.0, b.z - a.y * a.y), b.w - a.x * a.y);
  }

  // Slope variance tensor (xx, zz, xz) as (upwind, crosswind) variances for the wind direction windU
  vec2 toWindFrame(vec3 v, vec2 windU) {
    return max(vec2(0.0), vec2(
      windU.x * windU.x * v.x + 2.0 * windU.x * windU.y * v.z + windU.y * windU.y * v.y,
      windU.y * windU.y * v.x - 2.0 * windU.x * windU.y * v.z + windU.x * windU.x * v.y));
  }

  // (Upwind, crosswind) variances as a tensor (xx, zz, xz)
  vec3 fromWindFrame(vec2 uc, vec2 windU) {
    return vec3(uc.x * windU.x * windU.x + uc.y * windU.y * windU.y,
                uc.x * windU.y * windU.y + uc.y * windU.x * windU.x,
                (uc.x - uc.y) * windU.x * windU.y);
  }

  // RIPPLES STRAINED BY THE LONG WAVES (Longuet-Higgins & Stewart 1960, "Changes in the form of short gravity waves on
  // long waves and tidal currents"). The orbital velocity of a long wave converges on its front face and diverges on its
  // back face, so a patch of surface is squeezed at the crest and stretched in the trough by J = 1 - ak cos(phase)
  // (the Jacobian of the horizontal displacement). The ripples riding on it change with it, only along the direction
  // of the squeeze: their wavenumber and their amplitude both scale by 1 / J, so their slope by 1 / J^2. Steeper and
  // shorter on the crests, longer and smoother in the troughs; ripples whose crests lie along the stretch do not change.
  //
  // Principal stretches of the symmetric matrix I + e, e = (xx, zz, xz): (largest, smallest, angle of the largest)
  vec3 principalStretch(vec3 e) {
    float a = 1.0 + e.x, d = 1.0 + e.y;
    float m = 0.5 * (a + d);
    float r = sqrt(0.25 * (a - d) * (a - d) + e.z * e.z);
    float theta = r > 1e-6 ? 0.5 * atan(2.0 * e.z, a - d) : 0.0;
    return vec3(m + r, m - r, theta);
  }

  // Inverse of I + e, with the principal stretches clamped to >= 0.6. Where the long waves squeeze the surface to
  // nothing (the crest of a Gerstner wave about to loop) the ripples would grow without limit; in the sea they break
  // (micro-breaking). 0.6 caps the ripple slope gain at ~2.8 (1 / 0.6^2)
  mat2 inverseStretch(vec3 e) {
    vec3 p = principalStretch(e);
    float i1 = 1.0 / max(p.x, 0.6), i2 = 1.0 / max(p.y, 0.6);
    float c = cos(p.z), s = sin(p.z);
    float xz = c * s * (i1 - i2);
    return mat2(c * c * i1 + s * s * i2, xz, xz, s * s * i1 + c * c * i2);
  }

  // T V T^t for a symmetric tensor v = (xx, zz, xz)
  vec3 transformTensor(mat2 T, vec3 v) {
    mat2 R = T * mat2(v.x, v.z, v.z, v.y) * mat2(T[0][0], T[1][0], T[0][1], T[1][1]);
    return vec3(R[0][0], R[1][1], 0.5 * (R[0][1] + R[1][0]));
  }


  void main(){

    vec3 V = normalize(cameraPosition - v_wavePosition); // Towards the camera, from the displaced surface
    bool underwater = cameraPosition.y < v_wavePosition.y;
    vec3 geoNormal = normalize(v_Normal);

    // ******************************** //
    // FFT CASCADES (sea and ripples), at the rest position like the virtual buoy of the analysis.
    // Their fields add up (linear superposition): one normal from the summed slopes and Jacobian of the horizontal
    // displacement; their unresolved slope variances add up as roughness.
    vec2 xz = v_WorldPosition.xz;
    vec2 windU = u_windDirection;
    vec4 cs = vec4(0.0); // (hx, hz, Dxx, Dzz)
    float cDxz = 0.0;
    vec2 unresolved = vec2(0.0); // Slope variance finer than the pixel (upwind, crosswind)
    if (u_fftEnabled)
      unresolved += toWindFrame(sampleCascade(u_fftSlopes, u_fftExtra, u_fftSize, u_fftN, xz, cs, cDxz), windU);

    // Ripples strained by the long waves (Gerstner + FFT sea; see principalStretch). Their slope gets 1 / J twice:
    //  - amplitude (Longuet-Higgins & Stewart): the inverse of the whole long-wave strain
    //  - wavenumber: the ripples are sampled at the rest position, so the displaced mesh already squeezes them; their
    //    slope follows by the chain rule. The normal below does it for the FFT sea (it sums the Jacobians), not for
    //    the Gerstner waves (their slopes are added): their inverse strain here
    // u_rippleStrain scales the strain (0: off, as before; > 1: exaggerated)
    vec3 gStrain = v_gerstnerStrain;
    vec3 longStrain = gStrain + vec3(cs.z, cs.w, cDxz); // Gerstner + FFT sea (the ripples are not added yet)
    mat2 rippleT = inverseStretch(u_rippleStrain * gStrain) * inverseStretch(u_rippleStrain * longStrain);
    vec3 rippleTensor = fromWindFrame(u_rippleTailSigma2, windU); // Tail: strained like the ripples

    vec4 rippleS = vec4(0.0); float rippleDxz = 0.0;
    if (u_rippleEnabled) {
      rippleTensor += sampleCascade(u_rippleSlopes, u_rippleExtra, u_rippleSize, u_rippleN, xz, rippleS, rippleDxz);
      rippleS.xy = rippleT * rippleS.xy;
      // Their own Jacobian (trochoidal ripples) scales like their slope
      mat2 rJ = rippleT * mat2(rippleS.z, rippleDxz, rippleDxz, rippleS.w);
      rippleS.zw = vec2(rJ[0][0], rJ[1][1]);
      rippleDxz = 0.5 * (rJ[0][1] + rJ[1][0]);
      cs += rippleS; cDxz += rippleDxz;
    }
    unresolved += toWindFrame(transformTensor(rippleT, rippleTensor), windU); // Ripples finer than the pixel + tail
    vec3 cT = vec3(1.0 + cs.z, cs.x, cDxz);
    vec3 cB = vec3(cDxz, cs.y, 1.0 + cs.w);
    vec3 cN = normalize(cross(cB, cT));
    vec2 cascadeSlope = -cN.xz / max(cN.y, 0.05); // d(height)/dx, d(height)/dz
    vec2 rippleSlope = rippleS.xy;

    // Render wave heights: the geometry (Gerstner waves and the ripples the mesh represents)
    if (u_paintWaveHeight){
      float value = (v_wavePosition.y + u_maxWaveHeight) / (u_maxWaveHeight * 2.0);
      gl_FragColor = vec4(value, value, value, 1.0);
      return;
    }

    // Normal: slopes of the Gerstner surface plus the resolved ripples (partial derivative blending,
    // https://blog.selfshadow.com/publications/blending-in-detail/)
    vec2 slope = -geoNormal.xz / max(geoNormal.y, 0.05) + cascadeSlope;
    vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
    if (underwater) { N = -N; geoNormal = -geoNormal; }

    // Roughness: slope variance of everything finer than the pixel, in a frame along / across the wind
    vec2 sigmaSq = unresolved + vec2(2e-4);
    vec3 wind3 = vec3(windU.x, 0.0, windU.y);
    vec3 Tu = normalize(wind3 - N * dot(N, wind3));
    vec3 Tc = cross(N, Tu);

    // ******************************** //
    // LIGHTING
    // Fresnel, averaged over the unresolved slopes (no aliasing at grazing angles)
    float sigmaV2 = slopeVarianceAlong(V, Tu, Tc, sigmaSq);
    float fresnel = 0.02 + 0.98 * meanFresnel(clamp(dot(V, N), 0.0, 1.0), sqrt(sigmaV2));

    // Sky reflection. Rough water reflects a range of directions (about twice the slope spread)
    vec3 R = reflect(-V, N);
    vec3 sky = skyReflection(R, 2.0 * sqrt(sigmaV2));

    // Sun glitter
    vec3 L = normalize(u_sunDirection);
    vec3 sun = vec3(0.0);
    if (L.y > 0.0 && !underwater)
      sun = SUN_IRRADIANCE * u_sunColor * reflectedSunRadiance(L, V, N, Tu, Tc, sigmaSq);

    // Light from the water body (sky and sun light scattered up). With the rippled normal, so that the ripples still
    // show where the reflection is weak (looking down at the water)
    float diffuse = L.y > 0.0 ? max(0.0, dot(N, L)) : 0.0;
    vec3 water = OCEAN_COLOR * (2.0 + diffuse * u_sunColor);

    vec3 color = fresnel * sky + (1.0 - fresnel) * water + sun;

    // Debug views
    if (u_debugView == 1) { gl_FragColor = vec4(vec3(fresnel), 1.0); return; }
    if (u_debugView == 2) { gl_FragColor = vec4(N.x * 0.5 + 0.5, N.y, N.z * 0.5 + 0.5, 1.0); return; }
    if (u_debugView == 3) { gl_FragColor = vec4(sqrt(sigmaSq) * 4.0, 0.0, 1.0); return; }
    if (u_debugView == 4) { gl_FragColor = vec4(rippleSlope * 2.0 + 0.5, 0.5, 1.0); return; }
    if (u_debugView == 5) {
      vec3 p = principalStretch(longStrain);
      gl_FragColor = vec4(0.1 + 3.0 * max(0.0, 1.0 - p.y), 0.1, 0.1 + 3.0 * max(0.0, p.x - 1.0), 1.0);
      return;
    }

    color = hdr(color, 0.99); // From David Li https://github.com/dli/waves/blob/master/simulation.js

    // Underwater factor (if camera is above or below water)
    float underwaterFactor = (abs(cameraPosition.y)/cameraPosition.y)*0.5 + 0.5;
    // Fog underwater (Fog exp 2)
    float fogDepth = distance(v_WorldPosition, cameraPosition);
    float fogDensity = u_fogDensity - u_fogDensity * 0.5 * underwaterFactor;
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDepth * fogDepth );
    vec3 fogAirColor = vec3(0.8, 0.93, 1.0);
    vec3 fogColor = mix(u_fogUnderwaterColor, fogAirColor, underwaterFactor) ;
    color = mix( color, fogColor, fogFactor );

    if (u_grayscale == false) {
      gl_FragColor = vec4(color, 1.0);
    } else {
      float luminance = color.r * 0.3 + color.g * 0.59 + color.b * 0.11;// https://en.wikipedia.org/wiki/Grayscale
      gl_FragColor = vec4(luminance, luminance, luminance, 1.0);
    }
  }
  `;
