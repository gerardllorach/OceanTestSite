import * as THREE from 'three';
import { Vector3 } from 'three';
import { GLTFLoader } from '/OceanTestSite/lib/three.js/examples/jsm/loaders/GLTFLoader.js';

import { OceanGrid } from '/OceanTestSite/Assets/Ocean/OceanGrid.js';
import {OceanProjectedGridVertShader, OceanProjectedGridFragShader} from '/OceanTestSite/Assets/Ocean/OceanProjectedGridShader.js';

import { OceanParameters } from '/OceanTestSite/Assets/Ocean/OceanParams.js';
import { DEFAULT_RIPPLE_SETTINGS, RIPPLE_N, generateRipples, travelVector } from '/OceanTestSite/Assets/Ocean/RippleSpectrum.js';
import { FFT_N } from '/OceanTestSite/Assets/Ocean/SeaSpectrum.js';
import { FFTOcean } from '/OceanTestSite/Assets/Ocean/FFTOcean.js';

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

    // Creates a float texture with the parameters of the waves (period, height, direction, phase), one texel per wave.
    // The waves are a realisation of a wave spectrum (JONSWAP / Pierson-Moskowitz, Assets/Ocean/SeaSpectrum.js)
    this.dataTextureSize = 32;
    this.oceanParams = new OceanParameters({});
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
    this.gridEntity = new OceanGrid(scene.camera, 1 * 10e5);
    

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
        // Debug views: 0 final, 1 Fresnel, 2 normal, 3 roughness, 4 ripple slopes
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
    });

    oceanProjectedGridMaterial.side = THREE.DoubleSide;

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
    if (!FFTOcean.isSupported(renderer)) {
      // No float render targets: render the spectrum with Gerstner components instead
      console.warn('FFT sea not supported (WebGL2 float render targets): using Gerstner components');
      if (this.oceanParams.oceanParameters.method == 'fft') this.oceanParams.setSeaSettings({ method: 'gerstner' }, true);
      this.updateParamsTexture();
      return;
    }
    // Two cascades: the sea and the ripples
    this.fft = new FFTOcean(renderer, FFT_N);
    this.rippleFFT = new FFTOcean(renderer, RIPPLE_N);
    const u = this.oceanTile.material.uniforms;
    u.u_fftDisplacement.value = this.fft.displacement.texture;
    u.u_fftSlopes.value = this.fft.slopes.texture;
    u.u_fftExtra.value = this.fft.extra.texture;
    u.u_rippleDisplacement.value = this.rippleFFT.displacement.texture;
    u.u_rippleSlopes.value = this.rippleFFT.slopes.texture;
    u.u_rippleExtra.value = this.rippleFFT.extra.texture;
    u.u_fftN.value = FFT_N;
    this.updateParamsTexture();
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
    this.updateRipples();
  }

  getRippleSettings() {
    return { ...this.rippleSettings };
  }

  // Exact (float) ripples, as sent to the GPU
  getRipples() {
    return this.ripples;
  }

  updateRipples() {
    // Before the renderer is set, the FFT ripples cannot be drawn: generate them disabled (roughness only)
    const settings = this.rippleFFT ? this.rippleSettings : { ...this.rippleSettings, enabled: false };
    this.ripples = generateRipples(this.getDiscreteWaves(), settings, this.getFFTSea());
    if (this.oceanTile) {
      const u = this.oceanTile.material.uniforms;
      u.u_rippleTailSigma2.value.set(this.ripples.tailSigma2.up, this.ripples.tailSigma2.cross);
      const [ux, uz] = travelVector(this.ripples.windDir);
      u.u_windDirection.value.set(ux, uz);
      u.u_rippleEnabled.value = this.ripples.enabled;
      u.u_rippleSize.value = this.ripples.L;
      if (this.rippleFFT) {
        this.rippleFFT.setSpectrum(this.ripples.enabled ? this.ripples : null);
        if (this.ripples.enabled) this.rippleFFT.update(this.time);
      }
    }
    if (window.eventBus) window.eventBus.emit('OceanEntity_ripplesChanged', this.ripples);
  }

  // SUN
  // direction: THREE.Vector3 from the surface towards the sun. color: THREE.Color or {r, g, b} (intensity included)
  setSun(direction, color) {
    if (!this.oceanTile) return;
    const u = this.oceanTile.material.uniforms;
    u.u_sunDirection.value.copy(direction).normalize();
    if (color) u.u_sunColor.value.set(color.r, color.g, color.b);
  }

  // 0 final, 1 Fresnel, 2 normal, 3 roughness, 4 ripple slopes
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