import * as THREE from 'three';
import { Vector3 } from 'three';
import { GLTFLoader } from '/OceanTestSite/lib/three.js/examples/jsm/loaders/GLTFLoader.js';

import { OceanGrid } from '/OceanTestSite/Assets/Ocean/OceanGrid.js';
import {OceanProjectedGridVertShader, OceanProjectedGridFragShader} from '/OceanTestSite/Assets/Ocean/OceanProjectedGridShader.js';

import { OceanParameters } from '/OceanTestSite/Assets/Ocean/OceanParams.js';
import { DEFAULT_RIPPLE_SETTINGS, RIPPLE_N, generateRipples, travelVector } from '/OceanTestSite/Assets/Ocean/RippleSpectrum.js';
import { FFT_N } from '/OceanTestSite/Assets/Ocean/SeaSpectrum.js';
import { FFTOcean } from '/OceanTestSite/Assets/Ocean/FFTOcean.js';
import { RippleLoop, RIPPLE_LOOP_N, RIPPLE_LOOP_FRAMES, RIPPLE_LOOP_PERIOD } from '/OceanTestSite/Assets/Ocean/RippleLoop.js';
import { QUALITY_PRESETS, SHADING_OPTIONS, initialQuality, loadShadingOptions } from '/OceanTestSite/Assets/Ocean/Quality.js';

class OceanEntity {

  isLoaded = false;

  time = 0;
  tangent = new THREE.Vector3();
  binormal = new THREE.Vector3();
  normal = new THREE.Vector3();

  direction = new THREE.Vector2();

  tempVec3 = new THREE.Vector3();
  tempVec2 = new THREE.Vector2();

  // LOD - Ocean resolutions
  oceanLOD = {'HR': undefined,'MR': undefined, 'LR': undefined, 'LLR': undefined};

  customWaveParameters = [];
  oceanSteepness;



  
  // Constructor
  constructor(scene){

    // Rendering quality (Assets/Ocean/Quality.js): grid size, FFT or Gerstner sea, FFT grids
    this.qualityName = initialQuality();
    this.quality = QUALITY_PRESETS[this.qualityName];
    this.shadingOptions = loadShadingOptions(); // Options of the simple shading ('low')

    // Creates a float texture with the parameters of the waves (period, height, direction, phase), one texel per wave.
    // The waves are a realisation of a wave spectrum (JONSWAP / Pierson-Moskowitz, Assets/Ocean/SeaSpectrum.js)
    this.dataTextureSize = 32;
    // Without FFT ('low'), the sea spectrum is drawn with Gerstner components from the start
    this.oceanParams = new OceanParameters(this.quality.fft ? {} : { method: 'gerstner', numComponents: this.quality.gerstnerCount },
      undefined, this.quality.seaN || FFT_N);
    let numWaves = this.oceanParams.numWaves;
    this.numWaves = numWaves;
    let paramsData = this.oceanParams.getWaveParamsImageData(this.dataTextureSize);
    let paramsTexture = new THREE.DataTexture(paramsData, this.dataTextureSize, this.dataTextureSize, THREE.RGBAFormat, THREE.FloatType);
    paramsTexture.magFilter = THREE.NearestFilter;
    paramsTexture.minFilter = THREE.NearestFilter;
    paramsTexture.generateMipmaps = false;
    paramsTexture.needsUpdate = true;
    this.paramsTexture = paramsTexture;

    // Smaller waves that the geometry cannot capture: procedural ripples in the fragment shader (see updateRipples).
    // They replace a looping video normal map, which aliased at grazing angles (no mipmaps), broke the Fresnel term,
    // was damaged by the video compression and was not synchronised with the simulation time.


    // Create geometry
    this.gridEntity = new OceanGrid(scene.camera, this.quality.gridVertices);
    

    // Create ocean material
    // Define material and shaders
    let oceanProjectedGridMaterial = new THREE.ShaderMaterial({
      blending: THREE.NormalBlending,
      transparent: true,
      // lights: true, // https://github.com/mrdoob/three.js/issues/16656
      uniforms: {
        u_time: { value: this.time },
        u_fogUnderwaterColor: { value: new THREE.Vector3(scene.fog.color.r, scene.fog.color.g, scene.fog.color.b)},
        u_fogDensity: {value: scene.fog.density},
        u_paramsTexture: {value: paramsTexture},
        u_maxEncodedWaveHeight: {value: this.oceanParams.WAVE_MAX},
        u_maxEncodedPeriod: {value : this.oceanParams.PERIOD_MAX},
        u_imgSize: {value: new THREE.Vector2(this.dataTextureSize, this.dataTextureSize)},
        u_numWaves: {value: numWaves},
        // u_steepnessFactor: { value: 0.2 },
        // u_wavelength: { value: 7.0 },
        // u_direction: { value: new THREE.Vector2(1, 0) },

        // Surface ripples (Assets/Ocean/RippleSpectrum.js)
        // Surface ripples: second FFT cascade (Assets/Ocean/RippleSpectrum.js), tile of u_rippleSize metres
        u_rippleEnabled: {value: false},
        u_rippleDisplacement: {value: null}, // (Dx, h, Dz)
        u_rippleSlopes: {value: null},       // (hx, hz, Dxx, Dzz)
        u_rippleExtra: {value: null},        // (Dxz, hx^2, hz^2, hx hz)
        u_rippleSize: {value: 4},
        u_rippleN: {value: RIPPLE_N},
        u_rippleTailSigma2: {value: new THREE.Vector2(0.003, 0.003)},
        u_rippleStrain: {value: DEFAULT_RIPPLE_SETTINGS.strain}, // Ripples strained by the long waves (0: off)
        // Ripple field loop (Assets/Ocean/RippleLoop.js), qualities without FFT. Tile of u_rippleSize metres
        u_rippleLoop: {value: null},
        u_rippleLoopEnabled: {value: false},
        u_rippleLoopFrames: {value: new THREE.Vector3(0, 1, 0)},
        u_rippleLoopScale: {value: 1},
        u_windDirection: {value: new THREE.Vector2(0, 1)},
        // Spacing of the grid vertices (mesh units, before the viewport scale): the vertex shader only displaces the
        // geometry with ripples that are at least ~4 vertices long
        u_gridStep: {value: this.gridEntity.gridStep.clone()},
        // Sun
        u_sunDirection: {value: new THREE.Vector3(0, 1, 0)},
        u_sunColor: {value: new THREE.Vector3(1, 1, 1)},
        // Sky reflection: the skybox rendered into a cube map (captureSky). Gradient until it is ready
        u_skyCube: {value: null},
        u_skyReady: {value: false},
        // FFT sea (Assets/Ocean/FFTOcean.js): tile of u_fftSize metres, u_fftN texels, repeated
        u_fftEnabled: {value: false},
        u_fftDisplacement: {value: null}, // (Dx, h, Dz)
        u_fftSlopes: {value: null},       // (hx, hz, Dxx, Dzz)
        u_fftExtra: {value: null},        // (Dxz, hx^2, hz^2, hx hz)
        u_fftSize: {value: 512},
        u_fftN: {value: 512},
        // Debug views: 0 final, 1 Fresnel, 2 normal, 3 roughness, 4 ripple slopes, 5 long-wave stretch
        u_debugView: {value: 0},

        // Projected grid parameters
        u_cameraModelMatrix: {value: this.gridEntity.cameraGrid.matrix},
        u_cameraGridPosition: {value: this.gridEntity.cameraGrid.position},
        u_cameraViewportScale: {value: new THREE.Vector2(1, 1)},
        // Special parameters for recording frames
        u_grayscale: {value: false},
        u_paintWaveHeight: {value: false},
        u_maxWaveHeight: {value: 1.5},

      },
      vertexShader: OceanProjectedGridVertShader,
      fragmentShader: OceanProjectedGridFragShader,
      defines: this.shaderDefines(),
    });

    oceanProjectedGridMaterial.side = THREE.DoubleSide;
    this.oceanMaterialMode(oceanProjectedGridMaterial); // Opaque and front faces only in 'low'

    // Create mesh
    this.oceanTile = new THREE.Mesh( this.gridEntity.gridGeom, oceanProjectedGridMaterial );
    this.oceanTile.frustrumCulled = false; // DELETE AT SOME POINT

    scene.add(this.oceanTile);

    // Ripples for the initial waves
    this.updateRipples();

    this.isLoaded = true;

    
  }

  


  // Waves set one by one (discrete waves panel, dropped .json): they no longer come from a spectrum
  setDiscreteWaves = function(discreteWaves){
    this.oceanParams.setDiscreteWaves(discreteWaves);
    this.updateParamsTexture();
  }

  getDiscreteWaves = function(){
    return this.oceanParams.getDiscreteWavesJSON();
  }

  // Generate the waves from a spectrum. settings: {Hm0, Tp (null: fully developed), gamma, Mdir, Spr1, numComponents, seed}
  generateSeaState = function(settings){
    this.oceanParams.setSeaSettings(settings);
    this.updateParamsTexture();
  }

  getSeaSettings = function(){
    return this.oceanParams.getSeaSettings();
  }

  // Output of generateSea() (Assets/Ocean/SeaSpectrum.js) for the current waves, or null if they were set by hand
  getSea = function(){
    return this.oceanParams.sea;
  }

  // Output of generateFFTSea() (Assets/Ocean/SeaSpectrum.js) when the sea is an FFT sea, or null
  getFFTSea = function(){
    return this.fft ? this.oceanParams.fftSea : null;
  }

  // FFT SEA ON THE GPU (needs the renderer, see SceneManager)
  setRenderer(renderer) {
    this.renderer = renderer;
    this.setupFFT();
    this.updateParamsTexture();
  }

  // FFT cascades (sea and ripples) for the current quality. None in 'low', or when the browser cannot render to float
  // textures: then the sea spectrum is drawn with Gerstner components and the ripples are roughness only.
  // Regenerates the sea (the FFT grid size depends on the quality); the caller updates the textures
  setupFFT() {
    const u = this.oceanTile.material.uniforms;
    [this.fft, this.rippleFFT].forEach(f => f && f.dispose());
    this.fft = this.rippleFFT = null;
    u.u_fftEnabled.value = u.u_rippleEnabled.value = false;
    ['u_fftDisplacement', 'u_fftSlopes', 'u_fftExtra', 'u_rippleDisplacement', 'u_rippleSlopes', 'u_rippleExtra']
      .forEach(name => u[name].value = null);

    const q = this.quality, renderer = this.renderer, params = this.oceanParams;
    // Half float when the preset asks for it, or when the device can only render to half float
    const halfFloat = q.halfFloat || !FFTOcean.isSupported(renderer, false);
    const useFFT = q.fft && FFTOcean.isSupported(renderer, halfFloat);
    if (q.fft && !useFFT) console.warn('FFT sea not supported (WebGL2 float render targets): using Gerstner components');

    if (!useFFT) {
      // Gerstner sea, with the number of components of the preset (a device without float targets keeps the count)
      const update = {};
      if (params.oceanParameters.method == 'fft') {
        // The Gerstner sea replaces the discrete waves: keep them for when the FFT comes back
        this.savedDiscreteWaves = params.sea ? null : this.getDiscreteWaves();
        update.method = 'gerstner';
      }
      if (q.gerstnerCount && q.gerstnerCount != params.oceanParameters.numComponents) update.numComponents = q.gerstnerCount;
      if (Object.keys(update).length) params.setSeaSettings(update, true);
      return;
    }

    params.fftN = q.seaN;
    this.fft = new FFTOcean(renderer, q.seaN, { halfFloat });
    this.rippleFFT = new FFTOcean(renderer, q.rippleN, { halfFloat });
    u.u_fftDisplacement.value = this.fft.displacementTexture;
    u.u_fftSlopes.value = this.fft.slopesTexture;
    u.u_fftExtra.value = this.fft.extraTexture;
    u.u_rippleDisplacement.value = this.rippleFFT.displacementTexture;
    u.u_rippleSlopes.value = this.rippleFFT.slopesTexture;
    u.u_rippleExtra.value = this.rippleFFT.extraTexture;
    u.u_fftN.value = q.seaN;
    u.u_rippleN.value = q.rippleN;

    if (params.oceanParameters.method == 'gerstner') {
      params.setSeaSettings({ method: 'fft' }, true);
      if (this.savedDiscreteWaves && this.savedDiscreteWaves.length) params.setDiscreteWaves(this.savedDiscreteWaves);
      this.savedDiscreteWaves = null;
    } else {
      params.generateDistributions(); // Same method, FFT grid of this quality
    }
  }

  // RENDERING QUALITY: 'low', 'medium' or 'high' (Assets/Ocean/Quality.js)
  setQuality(name) {
    if (!QUALITY_PRESETS[name] || name == this.qualityName) return;
    const previous = this.quality;
    this.qualityName = name;
    this.quality = QUALITY_PRESETS[name];
    if (this.quality.gridVertices != previous.gridVertices) {
      this.oceanTile.geometry = this.gridEntity.setNumVertices(this.quality.gridVertices);
      this.oceanTile.material.uniforms.u_gridStep.value.copy(this.gridEntity.gridStep);
    }
    // Shader variant (SIMPLE_SHADING and its options): recompiled when the defines change
    this.updateShaderDefines();
    this.oceanMaterialMode(this.oceanTile.material);
    if (this.renderer) this.setupFFT();
    this.updateParamsTexture();
    if (window.eventBus) window.eventBus.emit('OceanEntity_qualityChanged', this.getQuality());
  }

  // {name, fft (FFT cascades running), halfFloat, seaN, rippleN, gridVertices, simpleShading, shadingOptions, numWaves}
  getQuality() {
    return { name: this.qualityName, fft: !!this.fft, halfFloat: this.fft ? this.fft.halfFloat : false,
      seaN: this.fft ? this.fft.N : null, rippleN: this.rippleFFT ? this.rippleFFT.N : null,
      gridVertices: this.quality.gridVertices, simpleShading: !!this.quality.simpleShading,
      rippleLoop: this.rippleLoopActive(), rippleLoopFrames: RIPPLE_LOOP_FRAMES, rippleLoopPeriod: RIPPLE_LOOP_PERIOD,
      shadingOptions: { ...this.shadingOptions }, numWaves: this.numWaves };
  }

  // Options of the simple shading, e.g. {skyCube: true} (see SHADING_OPTIONS). Recompiles the shader
  setShadingOptions(partial) {
    Object.keys(partial).forEach(key => { if (key in SHADING_OPTIONS) this.shadingOptions[key] = !!partial[key]; });
    this.updateShaderDefines();
    if (window.eventBus) window.eventBus.emit('OceanEntity_qualityChanged', this.getQuality());
  }

  // Opaque, front faces only (quality 'opaque', see Quality.js), or transparent and double sided
  oceanMaterialMode(material) {
    const opaque = !!this.quality.opaque;
    const side = opaque ? THREE.FrontSide : THREE.DoubleSide;
    if (material.transparent == !opaque && material.side == side) return;
    material.transparent = !opaque;
    material.side = side;
    material.needsUpdate = true;
  }

  // Shader defines of the current quality: SIMPLE_SHADING and its options
  shaderDefines() {
    const defines = {};
    if (this.quality.rippleLoop) defines.RIPPLE_LOOP = '';
    if (!this.quality.simpleShading) return defines;
    defines.SIMPLE_SHADING = '';
    Object.keys(SHADING_OPTIONS).forEach(key => { if (this.shadingOptions[key]) defines[SHADING_OPTIONS[key].define] = ''; });
    return defines;
  }

  // Recompile the ocean shader if its defines changed
  updateShaderDefines() {
    const material = this.oceanTile.material, defines = this.shaderDefines();
    if (JSON.stringify(defines) == JSON.stringify(material.defines)) return;
    material.defines = defines;
    material.needsUpdate = true;
  }

  updateFFT() {
    if (!this.fft || !this.oceanTile) return;
    const sea = this.oceanParams.fftSea;
    this.fft.setSpectrum(sea);
    const u = this.oceanTile.material.uniforms;
    u.u_fftEnabled.value = !!sea;
    if (sea) u.u_fftSize.value = sea.L;
    if (sea) this.fft.update(this.time);
  }






  // USER INPUT 
  // Steepness range slider
  // updateSteepness = function(steepnessFactor){
  //   if (this.oceanTile)
  //     this.oceanTile.material.uniforms.u_steepnessFactor.value = steepnessFactor;
  // }
  // updateSwell = function(varName, value, index){
  //   if (!this.oceanTile)
  //     return;
  //   index = index || 0;
  //   let uniformParams;
  //   if (index == 0)
  //     uniformParams = this.oceanTile.material.uniforms.u_wave1Params;
  //   else if (index == 1)
  //     uniformParams = this.oceanTile.material.uniforms.u_wave2Params;
  //   if (varName == 'height'){
  //     this.swellParameters[index].Hm0 = value;
  //     uniformParams.value.y = value;// steepness, waveHeight, directionx, directionz
  //   } else if (varName == 'direction'){
  //     this.swellParameters[index].Mdir = value;
  //     value += 90;
  //     let dirX = Math.cos(value * Math.PI / 180);
  //     let dirZ = Math.sin(value * Math.PI / 180);
      
  //     uniformParams.value.z = dirX;
  //     uniformParams.value.w = dirZ;
  //   } else if (varName == 'steepness'){
  //     this.swellParameters[index].Steepness = value;
  //     uniformParams.value.x = value;
  //   }
  // }
  // Update wave significant height
  updateWaveSignificantHeight = function(waveSignificantHeight){
    this.oceanParams.updateWaveSignificantHeight(waveSignificantHeight);
    this.updateParamsTexture();
  }
  // Update mean wave direction
  updateMeanWaveDirection = function(mdir){
    this.oceanParams.updateMeanWaveDirection(mdir);
    this.updateParamsTexture();
  }
  // Update wave directional spread
  updateDirectionalSpread = function(spr1){
    this.oceanParams.updateDirectionalSpread(spr1);
    this.updateParamsTexture();
  }

  // Update ocean parameters
  updateOceanParameters = function(params){
    this.oceanParams.updateParams(params);
    this.updateParamsTexture();
  }

  updateParamsTexture() {
    if (!this.oceanTile)
      return;
    this.numWaves = this.oceanParams.numWaves;
    // Same texture, new data
    this.oceanParams.getWaveParamsImageData(this.dataTextureSize, this.paramsTexture.image.data);
    this.paramsTexture.needsUpdate = true;
    this.oceanTile.material.uniforms.u_numWaves.value = this.numWaves;
    // FFT sea
    this.updateFFT();
    // The ripples depend on the waves (slope budget; wind in 'seaState' mode)
    this.updateRipples();
    // Listeners: panels that show the waves
    if (window.eventBus) window.eventBus.emit('OceanEntity_wavesChanged', this.getDiscreteWaves());
  }



  // SKY REFLECTION
  // Render the skybox once into a cube map that the water reflects (with mipmaps: rough water reflects a blurred sky)
  captureSky(renderer, skyObject) {
    if (!this.oceanTile || !skyObject) return;
    const target = new THREE.WebGLCubeRenderTarget(256, {
      generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    const cubeCamera = new THREE.CubeCamera(0.1, 5000, target);
    const skyScene = new THREE.Scene();
    skyScene.add(skyObject.clone()); // Shares geometry and material, keeps the transform
    cubeCamera.update(renderer, skyScene);
    const u = this.oceanTile.material.uniforms;
    if (u.u_skyCube.value) u.u_skyCube.value.dispose();
    u.u_skyCube.value = target.texture;
    u.u_skyReady.value = true;
  }



  // SURFACE RIPPLES
  rippleSettings = { ...DEFAULT_RIPPLE_SETTINGS };
  ripples = null; // Output of generateRipples(): the ripples sent to the GPU, also used by the sea state analysis

  // partial: {mode: 'wind' | 'seaState', windSpeed (m/s), windDir (deg, from), enabled}
  setRippleSettings(partial) {
    Object.assign(this.rippleSettings, partial);
    // The strain is a shader uniform only: no need to regenerate the spectrum (the slider would stutter)
    if (Object.keys(partial).every(key => key == 'strain')) this.updateRippleStrain();
    else this.updateRipples();
  }

  // Off without the ripple FFT: the strain would only bend the roughness, at the cost of the shader
  updateRippleStrain() {
    if (this.oceanTile)
      this.oceanTile.material.uniforms.u_rippleStrain.value = this.rippleFFT ? (this.rippleSettings.strain ?? 1) : 0;
  }

  getRippleSettings() {
    return { ...this.rippleSettings };
  }

  // Exact (float) ripples, as sent to the GPU
  getRipples() {
    return this.ripples;
  }

  updateRipples() {
    // Drawn with the ripple FFT, or with the ripple field loop (qualities without FFT). Otherwise (e.g. before the
    // renderer is set with an FFT quality) generated disabled: roughness only
    const loop = this.rippleLoopActive();
    const settings = this.rippleFFT || loop ? this.rippleSettings : { ...this.rippleSettings, enabled: false };
    const N = this.rippleFFT ? this.rippleFFT.N : loop ? RIPPLE_LOOP_N : RIPPLE_N;
    this.ripples = generateRipples(this.getDiscreteWaves(), settings, this.getFFTSea(), N);
    if (this.oceanTile) {
      const u = this.oceanTile.material.uniforms;
      u.u_rippleTailSigma2.value.set(this.ripples.tailSigma2.up, this.ripples.tailSigma2.cross);
      const [ux, uz] = travelVector(this.ripples.windDir);
      u.u_windDirection.value.set(ux, uz);
      u.u_rippleEnabled.value = this.ripples.enabled && !!this.rippleFFT; // FFT ripple textures
      u.u_rippleSize.value = this.ripples.L;
      this.updateRippleStrain();
      if (this.rippleFFT) {
        this.rippleFFT.setSpectrum(this.ripples.enabled ? this.ripples : null);
        if (this.ripples.enabled) this.rippleFFT.update(this.time);
      }
      this.updateRippleLoop();
    }
    if (window.eventBus) window.eventBus.emit('OceanEntity_ripplesChanged', this.ripples);
  }

  // RIPPLE FIELD LOOP (Assets/Ocean/RippleLoop.js): the ripples of the qualities without FFT
  rippleLoopActive() {
    return !!this.quality.rippleLoop && !this.rippleFFT;
  }

  // Rebuild the loop for the current ripples: at once the first time, then 150 ms after the last change (sliders
  // send many changes; each build is a few hundred ms on a phone). Skipped when the ripples did not change
  updateRippleLoop() {
    const u = this.oceanTile.material.uniforms;
    clearTimeout(this.rippleLoopTimer);
    if (!this.rippleLoopActive() || !this.ripples.enabled) {
      u.u_rippleLoopEnabled.value = false;
      if (!this.rippleLoopActive() && this.rippleLoop) { this.rippleLoop.dispose(); this.rippleLoop = null; this.rippleLoopKey = null; }
      return;
    }
    const r = this.ripples;
    const key = JSON.stringify([r.settings, r.windDir, r.L, r.N, r.kCut, r.heightVariance]);
    if (key == this.rippleLoopKey && this.rippleLoop) { u.u_rippleLoopEnabled.value = true; return; }
    const build = () => {
      if (!this.rippleLoopActive() || this.ripples !== r) return; // Superseded
      if (!this.rippleLoop) this.rippleLoop = new RippleLoop();
      this.rippleLoop.build(r, travelVector(r.windDir));
      this.rippleLoopKey = key;
      u.u_rippleLoop.value = this.rippleLoop.texture;
      u.u_rippleLoopScale.value = this.rippleLoop.scale;
      u.u_rippleLoopEnabled.value = true;
    };
    if (!this.rippleLoop) build();
    else this.rippleLoopTimer = setTimeout(build, 150);
  }

  // SUN
  // direction: THREE.Vector3 from the surface towards the sun. color: THREE.Color or {r, g, b} (intensity included)
  setSun(direction, color) {
    if (!this.oceanTile) return;
    const u = this.oceanTile.material.uniforms;
    u.u_sunDirection.value.copy(direction).normalize();
    if (color) u.u_sunColor.value.set(color.r, color.g, color.b);
  }

  // 0 final, 1 Fresnel, 2 normal, 3 roughness, 4 ripple slopes, 5 long-wave stretch
  setDebugView(view) {
    if (this.oceanTile) this.oceanTile.material.uniforms.u_debugView.value = Number(view) || 0;
  }











  // Find normal at 0,0 using Gerstner equation
  getGerstnerPosition = function(params, position, tangent, binormal) { // position is needed if we decide to use xz movements
    let steepness = params.Steepness;
    let amplitude = params.Hm0 / 2.0;
    let dir = params.Mdir;
    
    // Calculate direction
    dir += 90;
    let dirX = Math.cos(dir * Math.PI / 180);
    let dirZ = Math.sin(dir * Math.PI / 180);
    let direction = this.direction.set(dirX, dirZ);
    // this.oceanTile.material.uniforms.u_wave1Params.value.z = dirX;
    // this.oceanTile.material.uniforms.u_wave1Params.value.w = dirZ;

    let wavelength = amplitude * 2.0 * Math.PI / steepness;
    // this.direction.set(-params[3], params[2]);
    // let direction = this.direction;//new THREE.Vector2(-params[3], params[2]);

    let k = 2.0 * Math.PI / wavelength;
    let velocity = Math.sqrt(9.8 / k);

    direction = direction.normalize();
    let f = k * (direction.dot(this.tempVec2.set(position.x, position.z)) - velocity * this.time); // assume that we are always at x 0 and z 0 // float f = k * (dot(direction, position.xz) - velocity * u_time);

    this.tempVec3.set(
      -direction.x * direction.x * steepness * Math.sin(f),
      direction.x * steepness * Math.cos(f),
      -direction.x * direction.y * steepness * Math.sin(f)
    );
    tangent.add(this.tempVec3);

    this.tempVec3.set(
      -direction.x * direction.y * (steepness * Math.sin(f)),
      direction.y * (steepness * Math.cos(f)),
      -direction.y * direction.y * (steepness * Math.sin(f))
    );
    binormal.add(this.tempVec3);

    return this.tempVec3.set(
      direction.x * (amplitude * Math.cos(f)),
      amplitude * Math.sin(f),
      direction.y * (amplitude * Math.cos(f)))
  }




  getGerstnerNormal = function(position, params1, params2, params3) {
    
    this.tangent.set(1,0,0);
    let tangent = this.tangent;
    this.binormal.set(0,0,1);
    let binormal = this.binormal;

    this.tempVec3.copy(position);
    position.add(this.getGerstnerPosition(params1, this.tempVec3, tangent, binormal));
    position.add(this.getGerstnerPosition(params2, this.tempVec3, tangent, binormal));

    let normal = this.normal;
    normal.crossVectors(binormal, tangent);
    normal.normalize();
    return normal;
  }



  // getNormalAndPositionAt = function(position, normal){

  //   let calcNormal = this.getGerstnerNormal(position, 
  //     this.swellParameters[0], 
  //     this.swellParameters[1]);

  //   normal.set(calcNormal.x, calcNormal.y, calcNormal.z);

  // }















  // Update
  update(dt){
    this.time += dt;

    // Update shader parameters
    if (this.oceanTile != undefined) {
      let oceanTile = this.oceanTile;
      oceanTile.material.uniforms.u_time.value = this.time; // dt
      // FFT cascades at this time (displacement and slope maps): sea and ripples
      if (this.fft && this.fft.enabled) this.fft.update(this.time);
      if (this.rippleFFT && this.rippleFFT.enabled) this.rippleFFT.update(this.time);
      // Ripple field loop: the two frames to blend at this time
      if (this.rippleLoop && oceanTile.material.uniforms.u_rippleLoopEnabled.value)
        oceanTile.material.uniforms.u_rippleLoopFrames.value.fromArray(this.rippleLoop.framesAt(this.time));

      this.gridEntity.update(oceanTile);

      // let oceanSteepness = this.oceanSteepness;
      // oceanTile.material.uniforms.u_steepnessFactor.value = oceanSteepness;

      // let params1 = this.customWaveParameters[0];
      // oceanTile.material.uniforms.u_wave1Params.value.set(...params1);

      // let params2 = this.customWaveParameters[1];
      // oceanTile.material.uniforms.u_wave2Params.value.set(...params2);



      oceanTile.material.uniforms.u_time.uniformsNeedUpdate = true;
    }
  }

}

export { OceanEntity }