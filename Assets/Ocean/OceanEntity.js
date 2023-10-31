import * as THREE from 'three';
import { Vector3 } from 'three';
import { GLTFLoader } from 'https://threejs.org/examples/jsm/loaders/GLTFLoader.js';

import { OceanGrid } from '/OceanTestSite/Assets/Ocean/OceanGrid.js';
import {OceanProjectedGridVertShader, OceanProjectedGridFragShader} from '/OceanTestSite/Assets/Ocean/OceanProjectedGridShader.js';

import { OceanParameters } from '/OceanTestSite/Assets/Ocean/OceanParams.js';

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

    // Creates a texture that has parameters for generating waves. It includes wave steepness, height, direction X, and direction Z (RGBA).
    let numWaves = 10;
    this.numWaves = numWaves;
    this.dataTextureSize = 32;
    this.oceanParams = new OceanParameters({}, numWaves);
    let paramsData = this.oceanParams.getWaveParamsImageData(this.dataTextureSize);
    let paramsTexture = new THREE.DataTexture(paramsData, this.dataTextureSize, this.dataTextureSize, THREE.RGBAFormat, THREE.UnsignedByteType);
    paramsTexture.magFilter = THREE.NearestFilter;
    paramsTexture.needsUpdate = true;

    // Load normal texture for smaller waves that the geometry cannot capture
    // let normalTexture = new THREE.TextureLoader().load('/OceanTestSite/Assets/Terrain/OceanNormal.png');
    // normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping;

    // Create video texture
    // https://blenderartists.org/t/animated-water-normal-map-tileable-looped/673140
    // https://threejs.org/examples/?q=video#webgl_materials_video
    // https://github.com/mrdoob/three.js/blob/master/examples/webgl_materials_video.html
    let videoEl = document.createElement("video");
    videoEl.loop = true; videoEl.crossOrigin = 'anonymous'; videoEl.playsInline = true; videoEl.muted = "muted";
    videoEl.src = '/OceanTestSite/Assets/Terrain/OceanNormal.mp4';
    videoEl.play();
    let normalTexture = new THREE.VideoTexture(videoEl);
    normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping;
    normalTexture.colorSpace = THREE.LinearSRGBColorSpace; // Normal maps should not have a color correction https://threejs.org/docs/#manual/en/introduction/Color-management


    
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
        u_normalTexture: {value: normalTexture}, // TODO: WHAT IF THE TEXTURE TAKES TOO LONG TO LOAD?

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

    this.isLoaded = true;

    
  }

  


  setWavesProperties = function(wavesProperties){
    this.numWaves = wavesProperties.length;
    let params = this.oceanParams;
    params.numWaves = this.numWaves;
    params.waveHeights = [];
    params.waveSteepness = [];
    params.waveDirections = [];
    for (let i = 0; i < this.numWaves; i++){
      params.waveHeights[i] = wavesProperties[i].hm0;
      let T = wavesProperties[i].T;
      params.waveSteepness[i] = 4 * Math.PI * Math.PI * wavesProperties[i].hm0 * 0.5 / (T * T * 9.8);
      params.waveDirections[i] = wavesProperties[i].dir;
    }

    this.updateParamsTexture();
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
    let paramsData = this.oceanParams.getWaveParamsImageData(this.dataTextureSize);
    let paramsTexture = new THREE.DataTexture(paramsData, this.dataTextureSize, this.dataTextureSize, THREE.RGBAFormat, THREE.UnsignedByteType);
    paramsTexture.magFilter = THREE.NearestFilter;
    paramsTexture.minFilter = THREE.NearestFilter;
    paramsTexture.generateMipmaps = false;
    paramsTexture.needsUpdate = true;
    // Update uniforms
    this.oceanTile.material.uniforms.u_paramsTexture.value = paramsTexture;
    this.oceanTile.material.uniforms.u_numWaves.value = this.numWaves;
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
    this.time += dt*1.2;

    // Update shader parameters
    if (this.oceanTile != undefined) {
      let oceanTile = this.oceanTile;
      oceanTile.material.uniforms.u_time.value = this.time; // dt

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