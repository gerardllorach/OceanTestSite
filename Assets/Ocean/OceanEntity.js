import * as THREE from 'three';
import { Vector3 } from 'three';
import { GLTFLoader } from '/OceanTestSite/lib/three.js/examples/jsm/loaders/GLTFLoader.js';

import { OceanGrid } from '/OceanTestSite/Assets/Ocean/OceanGrid.js';
import {OceanProjectedGridVertShader, OceanProjectedGridFragShader} from '/OceanTestSite/Assets/Ocean/OceanProjectedGridShader.js';

import { OceanParameters } from '/OceanTestSite/Assets/Ocean/OceanParams.js';
import { DEFAULT_RIPPLE_SETTINGS, RIPPLE_N, generateRipples, travelVector } from '/OceanTestSite/Assets/Ocean/RippleSpectrum.js';
import { FFT_N } from '/OceanTestSite/Assets/Ocean/SeaSpectrum.js';
import { FFTOcean } from '/OceanTestSite/Assets/Ocean/FFTOcean.js';
import { FoamSimulation, DEFAULT_FOAM_SETTINGS, FOAM_DETAIL_N, FOAM_DETAIL_SIZE, foamCalibration, foamDetailTexture, foamRadiusLod } from '/OceanTestSite/Assets/Ocean/Foam.js';
import { Spray } from '/OceanTestSite/Assets/Ocean/Spray.js';
import { RippleFoam } from '/OceanTestSite/Assets/Ocean/RippleFoam.js';
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

    this.scene = scene; // The spray droplets are added to it (setupFFT)

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
        // Whitecaps (Assets/Ocean/Foam.js): foam state on the grid of the FFT sea, and its detail
        u_foamEnabled: {value: false},
        u_foam: {value: null},
        u_foamDetail: {value: null},
        u_foamDetailSize: {value: FOAM_DETAIL_SIZE},
        u_foamDetailN: {value: FOAM_DETAIL_N},
        u_foamStretch: {value: 1},
        u_foamThreshold: {value: -1e3},
        u_collapseStrength: {value: DEFAULT_FOAM_SETTINGS.collapse}, // Crest that has broken: loses height
        u_trailDamping: {value: DEFAULT_FOAM_SETTINGS.trailDamping}, // Foam trail: damps the waves through it
        u_foamCollapse: {value: null},                               // Collapse of each scale of breakers
        u_foamRadiusLod: {value: 0},                                 // Mip of their radius, scale 0 (+1 per scale)
        u_foamLambda0: {value: 4},                                   // m, wavelength of the breakers of scale 0
        // Small breakers (waves of ~1-4 m) from the ripple FFT, without state
        u_smallEnabled: {value: false},
        u_smallLevels: {value: new THREE.Vector2(4, 5)},
        u_smallThreshold: {value: new THREE.Vector2(-1e3, -1e3)},
        u_smallWidth: {value: new THREE.Vector2(1, 1)},
        u_smallExpected: {value: 0},
        u_smallFoam: {value: DEFAULT_FOAM_SETTINGS.smallFoam},           // Ripple foam trail drawn (0: off)
        u_smallCrest: {value: DEFAULT_FOAM_SETTINGS.smallCrest},         // Their breaking crest drawn (0: off)
        u_smallLead: {value: 0.4},                                       // m: the crest foam is this far ahead
        u_rippleFoamMeanLod: {value: 10},                                // Last mip of the ripple foam (its mean)
        u_smallFoamScale: {value: DEFAULT_FOAM_SETTINGS.smallFoamScale}, // Their lace pattern scale
        u_sprayFoamScale: {value: DEFAULT_FOAM_SETTINGS.sprayFoamScale}, // Lace pattern scale of the spray foam
        u_sprayFoamFull: {value: DEFAULT_FOAM_SETTINGS.sprayFoamFull},   // Droplet area for the maximum foam
        u_sprayFoamLog: {value: DEFAULT_FOAM_SETTINGS.sprayFoamLog},     // Steepness of the logarithm
        u_sprayFoamMax: {value: DEFAULT_FOAM_SETTINGS.sprayFoamMax},     // Maximum of the spray foam
        u_seaSigmaJ: {value: 0.1},
        u_foamSurge: {value: DEFAULT_FOAM_SETTINGS.surge},           // Forward surge of a collapsing crest
        u_seaDirection: {value: new THREE.Vector2(0, 1)},            // Mean travel direction of the FFT sea
        // Spray foam (Assets/Ocean/Spray.js): the landed droplets, around the camera
        u_sprayFoamEnabled: {value: false},
        u_sprayFoam: {value: null},
        u_sprayFoamWindow: {value: new THREE.Vector3(0, 0, 64)},     // (min x, min z, side) in metres
        // Ripple foam with memory (Assets/Ocean/RippleFoam.js), around the camera
        u_rippleFoamEnabled: {value: false},
        u_rippleFoam: {value: null},
        u_rippleFoamWindow: {value: new THREE.Vector3(0, 0, 96)},    // (min x, min z, side) in metres
        // Debug views: 0 final, 1 Fresnel, 2 normal, 3 roughness, 4 ripple slopes, 5 long-wave stretch, 6 foam,
        // 7 Jacobian of the FFT sea, 8 foam by breaking scale
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
    [this.fft, this.rippleFFT, this.foam, this.spray, this.rippleFoam].forEach(f => f && f.dispose());
    this.fft = this.rippleFFT = this.foam = this.spray = this.rippleFoam = null;
    u.u_fftEnabled.value = u.u_rippleEnabled.value = u.u_foamEnabled.value = false;
    u.u_foam.value = u.u_foamCollapse.value = null;
    u.u_smallEnabled.value = false;
    u.u_sprayFoamEnabled.value = false;
    u.u_sprayFoam.value = null;
    u.u_rippleFoamEnabled.value = false;
    u.u_rippleFoam.value = null;
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
    // Whitecaps on the grid of the FFT sea
    this.foam = new FoamSimulation(renderer, q.seaN);
    u.u_foam.value = this.foam.texture;
    u.u_foamCollapse.value = this.foam.collapseTexture;
    u.u_foamDetail.value = foamDetailTexture();
    // Spray droplets from the breakers (float state where the device can render to it)
    this.spray = new Spray(renderer, q.sprayN || 64, q.sprayFoamN || 512, u, FFTOcean.isSupported(renderer, false));
    this.scene.add(this.spray.points);
    // Foam of the small breakers, with memory, around the camera
    this.rippleFoam = new RippleFoam(renderer, q.rippleFoamN || 512, q.rippleFoamExtent || 64, u);
    u.u_rippleFoamMeanLod.value = Math.log2(q.rippleFoamN || 512);

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
    // New waves: the old foam belongs to waves that no longer exist (recalibrated with the ripples, see updateFoam)
    if (this.foam) this.foam.reset();
    if (this.spray) this.spray.reset();
    if (this.rippleFoam) this.rippleFoam.reset();
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
    // The foam depends on the wind of the ripples and on the FFT sea
    this.updateFoam();
  }



  // WHITECAPS (Assets/Ocean/Foam.js): only on the FFT sea (none in 'low')
  foamSettings = { ...DEFAULT_FOAM_SETTINGS };
  foamCalibration = null;
  foamGain = 1;          // 'wind' mode: feedback gain so that the coverage drawn matches the wind (see adjustFoamGain)
  foamGainClock = 0;     // s since the last adjustment

  // partial: {enabled, mode ('wind' | 'shape'), amount, scaleSplit ('quantile' | 'phillips'), threshold, lead,
  // persistence, collapse, radius (x wavelength), trailDamping, surge, small (small breakers from the ripples), spray,
  // smallCrest, smallFoam, smallFoamScale, smallFoamGrow, smallFoamLifetime, smallFoamVariation, smallFoamSpread, sprayAmount, sprayLarge, sprayFoam, sprayFoamPatch, sprayFoamLifetime, sprayFoamScale,
  // sprayFoamRadius, sprayFoamFull, sprayFoamLog, sprayFoamMax (Assets/Ocean/Spray.js)}
  setFoamSettings(partial) {
    const wasEnabled = this.foamSettings.enabled;
    Object.assign(this.foamSettings, partial);
    if (this.foam && this.foamSettings.enabled && !wasEnabled) this.foam.reset();
    this.updateFoam();
  }

  getFoamSettings() {
    return { ...this.foamSettings };
  }

  // Output of foamCalibration() for the current sea and wind, or null without FFT sea
  getFoam() {
    return this.foamCalibration;
  }

  // 'wind' mode: every 2 s, compare the coverage drawn (read back from the GPU, without stalling it) with the target
  // of the wind, minus the expected coverage of the small breakers (drawn by the shader, not in the foam texture), and
  // move the gain on the breaking fractions of the FFT sea scales towards it (at most x2 per step). Skipped while the
  // foam builds up after a reset (two lifetimes of the longest scale)
  async adjustFoamGain() {
    const c = this.foamCalibration;
    if (!c || c.mode != 'wind' || !this.foam || !this.oceanTile.material.uniforms.u_foamEnabled.value) return;
    if (this.foam.age < 2 * c.tauFoam[1]) return;
    const m = await this.foam.measureCoverage();
    if (!m || this.foamCalibration !== c) return;
    // The ripple whitecaps are drawn at smallFoam (0.75 when their expected coverage was estimated)
    const smallDrawn = c.small.enabled ? c.small.expected * (this.foamSettings.smallFoam ?? DEFAULT_FOAM_SETTINGS.smallFoam) / 0.75 : 0;
    const target = Math.max(1e-5, (c.coverage || 0) - smallDrawn);
    if (!(c.coverage > 1e-5)) return;
    const ratio = Math.min(2, Math.max(0.5, Math.sqrt(target / Math.max(m.coverage, 1e-5))));
    const gain = Math.min(100, Math.max(0.05, this.foamGain * ratio));
    if (Math.abs(gain / this.foamGain - 1) < 0.02) return;
    this.foamGain = gain;
    this.updateFoam();
  }

  // Foam drawn on the sea: {coverage, active} (fractions), read back from the GPU; null without foam
  async measureFoamCoverage() {
    return this.foam && this.oceanTile.material.uniforms.u_foamEnabled.value ? this.foam.measureCoverage() : null;
  }

  // Wind ('wind' mode): the wind of the ripples, set in the ripples panel or the one of a fully developed sea with the
  // same Hm0. The FFT sea's choppiness and slopes set the spread of the Jacobian
  updateFoam() {
    if (!this.oceanTile) return;
    const u = this.oceanTile.material.uniforms;
    const sea = this.fft && this.fft.enabled ? this.oceanParams.fftSea : null;
    const windSpeed = this.ripples ? this.ripples.windSpeed : 0;
    // The ripples give the small breakers, when their FFT is drawn
    const ripples = this.rippleFFT && this.rippleFFT.enabled ? this.ripples : null;
    this.foamCalibration = sea ? foamCalibration(sea, windSpeed, this.foamSettings, ripples, this.foamGain) : null;
    const c = this.foamCalibration;
    if (this.foam && c) this.foam.setCalibration(c);
    u.u_foamEnabled.value = !!(this.foam && c && this.foamSettings.enabled);
    u.u_foamThreshold.value = c ? c.threshold : -1e3;
    u.u_foamStretch.value = c ? c.streak : 1;
    u.u_collapseStrength.value = c ? c.collapse : 0;
    u.u_trailDamping.value = c ? c.trailDamping : 0;
    u.u_foamRadiusLod.value = c ? foamRadiusLod(c) : 0;
    u.u_foamLambda0.value = c ? c.lambda0 : 4;
    u.u_seaSigmaJ.value = c ? Math.max(1e-3, c.sigmaJ) : 0.1;
    const small = c && c.small.enabled ? c.small : null;
    u.u_smallEnabled.value = !!(small && u.u_foamEnabled.value);
    if (small) {
      u.u_smallLevels.value.set(small.levels[0], small.levels[1]);
      u.u_smallThreshold.value.set(small.scales[0].threshold, small.scales[1].threshold);
      u.u_smallWidth.value.set(small.scales[0].width, small.scales[1].width);
      u.u_smallExpected.value = small.expected;
    }
    u.u_foamSurge.value = c ? c.surge : 0;
    u.u_smallFoam.value = this.foamSettings.smallFoam ?? DEFAULT_FOAM_SETTINGS.smallFoam;
    u.u_smallCrest.value = this.foamSettings.smallCrest ?? DEFAULT_FOAM_SETTINGS.smallCrest;
    // The breaking crest of the small breakers is ahead of the crest by its phase speed x the breaking lead (as the
    // large breakers): they travel with the wind (the ripples)
    if (small) u.u_smallLead.value = (c.lead || 0) * Math.sqrt(9.81 * (small.lambdas[0] + small.lambdas[1]) / 2 / (2 * Math.PI));
    u.u_smallFoamScale.value = this.foamSettings.smallFoamScale ?? DEFAULT_FOAM_SETTINGS.smallFoamScale;
    u.u_sprayFoamScale.value = this.foamSettings.sprayFoamScale ?? DEFAULT_FOAM_SETTINGS.sprayFoamScale;
    u.u_sprayFoamFull.value = Math.max(0.01, this.foamSettings.sprayFoamFull ?? DEFAULT_FOAM_SETTINGS.sprayFoamFull);
    u.u_sprayFoamMax.value = this.foamSettings.sprayFoamMax ?? DEFAULT_FOAM_SETTINGS.sprayFoamMax;
    u.u_sprayFoamLog.value = Math.max(0.1, this.foamSettings.sprayFoamLog ?? DEFAULT_FOAM_SETTINGS.sprayFoamLog);
    if (this.rippleFoam) {
      const fs = this.foamSettings, d = DEFAULT_FOAM_SETTINGS;
      this.rippleFoam.setSettings({ grow: fs.smallFoamGrow ?? d.smallFoamGrow, lifetime: fs.smallFoamLifetime ?? d.smallFoamLifetime,
        variation: fs.smallFoamVariation ?? d.smallFoamVariation, spread: fs.smallFoamSpread ?? d.smallFoamSpread });
    }
    if (this.spray) {
      this.spray.windSpeed = windSpeed;
      if (small) this.spray.setSmallWavelengths(small.lambdas);
      const fs = this.foamSettings, d = DEFAULT_FOAM_SETTINGS;
      this.spray.setSettings({ enabled: !!(fs.spray && u.u_foamEnabled.value), amount: fs.sprayAmount ?? 1,
        fromLarge: !!fs.sprayLarge, foam: fs.sprayFoam !== false, foamPatch: fs.sprayFoamPatch ?? d.sprayFoamPatch,
        foamLifetime: fs.sprayFoamLifetime ?? d.sprayFoamLifetime, foamRadius: fs.sprayFoamRadius ?? d.sprayFoamRadius });
    }
    if (sea) u.u_seaDirection.value.fromArray(travelVector(sea.settings.Mdir));
    if (window.eventBus) window.eventBus.emit('OceanEntity_foamChanged', { settings: this.getFoamSettings(), calibration: c,
      available: !!this.foam });
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

  // 0 final, 1 Fresnel, 2 normal, 3 roughness, 4 ripple slopes, 5 long-wave stretch, 6 foam, 7 Jacobian, 8 foam by
  // scale (yellow: spray foam)
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
  // camera: the camera that draws the scene (the spray is only made where its droplets are visible)
  update(dt, camera){
    this.time += dt;

    // Update shader parameters
    if (this.oceanTile != undefined) {
      let oceanTile = this.oceanTile;
      oceanTile.material.uniforms.u_time.value = this.time; // dt
      // FFT cascades at this time (displacement and slope maps): sea and ripples
      if (this.fft && this.fft.enabled) this.fft.update(this.time);
      if (this.rippleFFT && this.rippleFFT.enabled) this.rippleFFT.update(this.time);
      // Whitecaps: one step of the foam from the new FFT maps
      if (this.foam && oceanTile.material.uniforms.u_foamEnabled.value) {
        this.foam.update(this.fft, dt);
        this.foamGainClock += dt;
        if (this.foamGainClock > 2) { this.foamGainClock = 0; this.adjustFoamGain(); }
        oceanTile.material.uniforms.u_foam.value = this.foam.texture;
        oceanTile.material.uniforms.u_foamCollapse.value = this.foam.collapseTexture;
      }
      // Ripple foam: one step of the foam of the small breakers (with memory), around the camera
      if (this.rippleFoam) {
        const u = oceanTile.material.uniforms, on = u.u_smallEnabled.value && u.u_rippleEnabled.value;
        if (on) this.rippleFoam.update(dt, camera);
        else this.rippleFoam.reset();
        u.u_rippleFoamEnabled.value = on && this.rippleFoam.active;
        u.u_rippleFoam.value = this.rippleFoam.texture;
        u.u_rippleFoamWindow.value.copy(this.rippleFoam.window);
      }
      // Spray: one step of the droplets near the camera, and the foam of those that landed
      if (this.spray) {
        this.spray.update(dt, camera);
        const u = oceanTile.material.uniforms;
        u.u_sprayFoamEnabled.value = this.spray.foamActive;
        u.u_sprayFoam.value = this.spray.foamTexture;
        u.u_sprayFoamWindow.value.copy(this.spray.window);
      }
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