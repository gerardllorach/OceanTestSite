import * as THREE from 'three';
import Stats from '/OceanTestSite/lib/three.js/examples/jsm/libs/stats.module.js';
import { OrbitControls } from '/OceanTestSite/lib/three.js/examples/jsm/controls/OrbitControls.js';

import { SkyboxEntity } from '/OceanTestSite/Assets/Skybox/SkyboxEntity.js';

import * as FogShader from '/OceanTestSite/Assets/Terrain/FogShader.js'
import { OceanEntity } from '/OceanTestSite/Assets/Ocean/OceanEntity.js';
import { spectralDensity } from '/OceanTestSite/Assets/Ocean/SeaSpectrum.js';

import { TextMeshEntity } from '/OceanTestSite/Assets/TextMesh/TextMeshEntity.js';

import { RulerEntity } from '/OceanTestSite/Assets/Ruler/RulerEntity.js';

import { Recorder } from './Recorder.js';


class SceneManager{

  stats;
  prevTime = 0;

  isRecording = false;

  constructor(canvas){
    // Add loading screen
    this.addLoadingScreen();
    
    // Cache
    THREE.Cache.enabled = false;

    //const canvas = document.querySelector('#c');
    const renderer = new THREE.WebGLRenderer({ canvas });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    const fov = 45;
    const aspect = 2;  // the canvas default
    const near = 0.1;
    const far = 2000;
    const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.selectedCamera = this.camera = camera;

    // CAMERA CONTROLS
    const controls = new OrbitControls(camera, canvas);
    this.controls = controls;
    // TODO: limit orbit controls
    // Surface
    //camera.position.set(10, 7.5, 10);
    camera.position.set(-32, 62, 32)
    controls.target.set(0, 1, -30);


    controls.update();
    controls.enableDamping = true;


    // STATS
    let stats = new Stats();
    this.stats = stats;
    document.body.appendChild(stats.dom);
    stats.dom.style.right = null;
    stats.dom.style.left = '0px';
    stats.isVisible = false;
    stats.showPanel(false);
    
    






    // SCENE
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = new THREE.Color(0x47A0B9);
    this.scene.camera = this.camera;

    // Fog
    scene.fog = new THREE.FogExp2(new THREE.Color(0x47A0B9), 0.02);
    scene.fog.density = 0;
    // Fog only below water
    THREE.ShaderChunk.fog_fragment = FogShader.fogFrag;
    THREE.ShaderChunk.fog_pars_fragment = FogShader.fogFragParams;
    THREE.ShaderChunk.fog_vertex = FogShader.fogVertex;
    THREE.ShaderChunk.fog_pars_vertex = FogShader.fogVertexParams;
    // AO shader fix
    THREE.ShaderChunk.aomap_fragment = `
    #ifdef USE_AOMAP
      float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r ) * aoMapIntensity ;
      reflectedLight.directDiffuse *= ambientOcclusion;
      reflectedLight.indirectDiffuse *= ambientOcclusion;
      reflectedLight.directSpecular *= ambientOcclusion;
      reflectedLight.indirectSpecular *= ambientOcclusion;
      #if defined( USE_ENVMAP ) && defined( STANDARD )
        float dotNV = saturate( dot( geometry.normal, geometry.viewDir ) );
        reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
      #endif
    #endif`

    // Ocean
    this.ocean = new OceanEntity(scene);
    // Skybox. Once loaded, the water reflects it
    this.skybox = new SkyboxEntity(scene, (root) => this.ocean.captureSky(this.renderer, root));



    

    



    // SCENE TEXT
    // SURFACE
    // Wind text mesh
    // this.windText = new TextMeshEntity(scene, "", 0.25, 0x000000, () => {
    //   this.windText.textObj.position.y = 3;
    // });
    // Orientation text meshes
    this.Ntext = new TextMeshEntity(scene, "N", 0.5, 0xff0000, () => {
      this.Ntext.textObj.rotation.x = -Math.PI / 2;
      this.Ntext.textObj.position.y = 1;
      this.Ntext.textObj.position.z = -4;
    });
    this.Stext = new TextMeshEntity(scene, "S", 0.5, 0xffffff, () => {
      this.Stext.textObj.rotation.x = -Math.PI / 2;
      this.Stext.textObj.position.y = 1;
      this.Stext.textObj.position.z = 4;
    });


    this.ruler = new RulerEntity(scene);





    { // LIGHT
      const skyColor = 0xB1E1FF;  // light blue
      const groundColor = 0x2090b9;  // blue
      const intensity = 0.6;
      const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
      scene.add(light);
    }

    { // LIGHT (sun): its direction is set by setSun()
      const color = 0xFFFFFF;
      const intensity = 0.8;
      const light = new THREE.DirectionalLight(color, intensity);
      light.position.set(0, 10, 0);
      light.target.position.set(0, 0, 0);
      scene.add(light);
      scene.add(light.target);
      this.sunLight = light;
    }
    this.setSun(this.sunSettings);


    // RECORDER
    this.recorder = new Recorder(scene, this.ocean);

  }



  // SUN
  // The sun moves on a vertical semicircle (Scene > Environment): arcAngle 0 = horizon at bearing `azimuth`,
  // 90 = zenith, 180 = horizon at the opposite bearing. Bearings in degrees clockwise from north (north = -z, east = +x).
  sunSettings = { arcAngle: 90, azimuth: 90 };
  sunDirection = new THREE.Vector3(0, 1, 0);
  sunColor = new THREE.Color(1, 1, 1);

  setSun = function(settings){
    Object.assign(this.sunSettings, settings);
    const a = this.sunSettings.arcAngle * Math.PI / 180;
    const phi = this.sunSettings.azimuth * Math.PI / 180;
    // Horizontal direction of the bearing phi, times cos(a), plus the vertical, times sin(a)
    this.sunDirection.set(Math.cos(a) * Math.sin(phi), Math.sin(a), -Math.cos(a) * Math.cos(phi)).normalize();
    // A low sun is dimmer and warmer (longer path through the atmosphere)
    const y = this.sunDirection.y;
    const warm = THREE.MathUtils.smoothstep(y, 0.0, 0.35);
    const intensity = THREE.MathUtils.lerp(0.45, 1.0, THREE.MathUtils.smoothstep(y, 0.0, 0.5));
    this.sunColor.setRGB(
      intensity,
      THREE.MathUtils.lerp(0.62, 0.97, warm) * intensity,
      THREE.MathUtils.lerp(0.38, 0.92, warm) * intensity);
    // Ocean shader and directional light (lights the other objects of the scene)
    this.ocean.setSun(this.sunDirection, this.sunColor);
    if (this.sunLight) {
      this.sunLight.position.copy(this.sunDirection).multiplyScalar(10);
      this.sunLight.color.copy(this.sunColor);
      this.sunLight.intensity = 0.8;
    }
    // Listeners: EnvironmentPanel (keeps its controls in sync when the sun is moved from elsewhere)
    if (window.eventBus) window.eventBus.emit('SceneManager_sunChanged', this.getSunSettings());
  }

  getSunSettings = function(){
    return { ...this.sunSettings };
  }

  // Elevation (deg) and bearing (deg, clockwise from north) of the sun
  getSunPosition = function(){
    const d = this.sunDirection;
    return {
      elevation: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) * 180 / Math.PI,
      bearing: ((Math.atan2(d.x, -d.z) * 180 / Math.PI) + 360) % 360,
    };
  }


  // SEA STATE FROM A SPECTRUM (see Assets/Ocean/SeaSpectrum.js)
  // settings: {Hm0, Tp (null: fully developed sea), gamma, Mdir, Spr1, numComponents, seed}
  generateSeaState = function(settings){
    this.ocean.generateSeaState(settings);
  }
  getSeaSettings = function(){
    return this.ocean.getSeaSettings();
  }
  // Spectrum of the current waves ({settings, waves, bins, ...}) or null if they were set by hand
  getSea = function(){
    return this.ocean.getSea();
  }
  // Target variance density S(f) (m^2/Hz) of the current spectrum at the frequencies `freqs`, or null
  getSeaSpectralDensity = function(freqs){
    const sea = this.ocean.getSea();
    return sea ? Array.from(freqs, f => spectralDensity(f, sea.settings)) : null;
  }


  // SURFACE RIPPLES (see Assets/Ocean/RippleSpectrum.js)
  setRippleSettings = function(settings){
    this.ocean.setRippleSettings(settings);
  }
  getRippleSettings = function(){
    return this.ocean.getRippleSettings();
  }
  getRipples = function(){
    return this.ocean.getRipples();
  }
  setDebugView = function(view){
    this.ocean.setDebugView(view);
  }












  // Show/Hide FPS
  showHideFPS = function(){
    let stats = this.stats;
    if (stats.isVisible){
      stats.showPanel(false);
      stats.isVisible = false;
    } else{
      stats.showPanel(0);
      stats.isVisible = true;
    }
  }


  calibrate = function(){
    // Create calibration frames
    this.recorder.renderCalibration();
  }



  // Record frames
  record = async function(inDuration, inFps, grayscale){
    if (this.isRecording)
      return;
    this.isRecording = !this.isRecording;
    let currentPercent = 0;
    if (this.isRecording){

      // Iterate through time
      const fps = inFps || 10;
      const duration = inDuration || 1;
      // Set default width and height
      this.recorder.renderer.setSize(this.recorder.imgWidth, this.recorder.imgHeight);

      // Create JSZip
      let zip = new JSZip();

      for (let i = 0; i < fps * duration; i++){
        let time = i/fps;
        this.update(1000 * time);
        this.recorder.renderLeft(grayscale);
        let timeStr = String(time.toFixed(2)).padStart(6, '0');
        zip.file('L_' + timeStr + '.png', this.recorder.getImgData(), {binary: true});
        this.recorder.renderRight(grayscale);
        zip.file('R_' + timeStr + '.png', this.recorder.getImgData(), {binary: true});

        // Show progress
        if ((100 *(i+1) / (fps*duration)) > currentPercent){
          currentPercent++;
          window.eventBus.emit('SceneManager_recordProgress', 100 * (i+1) / (fps*duration));
        }
      }

      // Generate zip and download
      let nowDateISO = new Date().toISOString();
      zip.generateAsync({type:"blob"})
      .then(function(content) {
        let blobUrl = URL.createObjectURL(content);
        let link = document.createElement('a');
        link.download = 'OceanTestSite_StereoCameras_' + nowDateISO.substring(0,10) + '.zip';
        link.href = blobUrl;
        link.click();
        link.delete;
      });
      window.eventBus.emit('SceneManager_recordFinished');


      // Export json
      this.exportOceanParamsJSON();

      this.isRecording = false;
      this.startRender();
    }
  }

  // Record heights
  recordHeights = async function(params){
    if (this.isRecording)
      return;
    // Input variables
    let duration = params.duration;
    let fps = params.fps;
    let imgSize = params.imgSize;
    let maxWaveHeight = params.maxWaveHeight;
    // Is recording
    this.isRecording = !this.isRecording;
    // Set canvas size
    this.recorder.renderer.setSize(imgSize, imgSize);
    // Hide N and S letters
    this.Ntext.textObj.visible = false;
    this.Stext.textObj.visible = false;
    // Hide ruler
    this.ruler.obj.visible = false;
    // Keep track of progress
    let currentPercent = 0;
    // Reset timer in ocean entity
    this.ocean.prevTime = 0;
    // Create JSZip
    let zip = new JSZip();
    // Iterate frames
    for (let i = 0; i < fps * duration; i++){
      let time = i/fps;
      this.update(1000 * time);
      this.recorder.renderTop(maxWaveHeight);
      let timeStr = String(time.toFixed(2)).padStart(6, '0');
      zip.file('WaveHeight_range_' + maxWaveHeight + '_' + timeStr + '.png', this.recorder.getImgData(), {binary: true});

      // Show progress
      if ((100 *(i+1) / (fps*duration)) > currentPercent){
        currentPercent++;
        window.eventBus.emit('SceneManager_recordProgress', 100 * (i+1) / (fps*duration));
      }
    }
    // Generate zip and download
    let nowDateISO = new Date().toISOString();
    zip.generateAsync({type:"blob"})
    .then(function(content) {
      let blobUrl = URL.createObjectURL(content);
      let link = document.createElement('a');
      link.download = 'OceanTestSite_WaveHeights_' + nowDateISO.substring(0,10) + '.zip';
      link.href = blobUrl;
      link.click();
      link.delete;
    });
    // Loaded
    window.eventBus.emit('SceneManager_recordFinished');

    // Export json
    this.exportOceanParamsJSON();

    // Restore N and S letters
    this.Ntext.textObj.visible = true;
    this.Stext.textObj.visible = true;
    // Restore ruler
    this.ruler.obj.visible = true;
    // Start rendering again
    this.isRecording = false;
    this.startRender();
  }

  setDiscreteWaves = function(discreteWaves){
    this.ocean.setDiscreteWaves(discreteWaves);
  }

  getDiscreteWaves = function(){
    return this.ocean.getDiscreteWaves();
  }

  // Export JSON: discreteWaves.json (unchanged format: a list of waves) and surfaceRipples.json (sidecar with the
  // ripples and the sun, so that a render can be reproduced)
  exportOceanParamsJSON = function(){
    this.ocean.oceanParams.exportOceanParameters().then(() => this.exportRipplesJSON());
  }

  exportRipplesJSON = function(){
    const r = this.ocean.getRipples();
    if (!r) return;
    const data = {
      description: 'Surface ripples rendered in the fragment shader (Assets/Ocean/RippleSpectrum.js). Same wave format ' +
        'as discreteWaves.json: hm0 = 2 x amplitude (m), T (s), dir (deg, from, clockwise from north), phase (deg). ' +
        'tailSigma2: slope variance not drawn as ripples (roughness), upwind and crosswind. ' +
        'Regenerate them with generateRipples(discreteWaves, settings).',
      settings: r.settings,
      windSpeed: r.windSpeed, windDir: r.windDir,
      ripples: r.ripples.map(w => ({ hm0: w.hm0, T: w.T, dir: w.dir, phase: w.phase, chop: w.chop })),
      tailSigma2: r.tailSigma2,
      slopes: r.slopes,
      sun: { ...this.getSunSettings(), ...this.getSunPosition() },
    };
    const link = document.createElement('a');
    link.download = 'surfaceRipples.json';
    link.href = window.URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'text/json' }));
    link.click();
  }

  // Camera used to render the view: 'F' (free, orbit controls), 'L' / 'R' (stereo cameras), 'Top' (heights camera)
  selectedCameraName = 'F';
  changeCamera = function(value){
    if (value == 'F')
      this.selectedCamera = this.camera;
    else if (value == 'R')
      this.selectedCamera = this.recorder.cameraR;
    else if (value == 'L')
      this.selectedCamera = this.recorder.cameraL;
    else if (value == 'Top')
      this.selectedCamera = this.recorder.cameraTop;
    else
      return;
    this.selectedCameraName = value;
    window.eventBus.emit('SceneManager_cameraChanged', value);
  }

  // Move the free camera so that it looks at the centre of the scene (0,0), keeping its viewing angle and distance
  centerCamera = function(){
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  faceNorthward = function(){
    // Tween camera position to face northward
    let dist = this.camera.position.distanceTo(this.controls.target);
    let newZ = Math.sqrt(dist * dist - Math.pow(this.camera.position.y-this.controls.target.y, 2));

    this.controls.target.x = 0;
    this.camera.position.set(this.controls.target.x, this.camera.position.y, newZ*0.5);
    this.controls.update();
  }




  

  // ADD LOADING SCREEN
  addLoadingScreen = function(){
    // Create
    let loadDiv = document.createElement("div");
    loadDiv.style.width = '100vw';//document.body.clientWidth + 'px';
    loadDiv.style.height = '100vh';//document.body.clientHeight + 'px';
    // Style
    loadDiv.style.background = 'radial-gradient(rgba(160, 215, 242, 0.95) 0%, rgba(0, 90, 134, 0.95) 100%';
    loadDiv.style.position = 'absolute';
    loadDiv.style.display = 'flex';
    loadDiv.style["flex-direction"] = 'column';
    loadDiv.style["justify-content"] = 'center';
    loadDiv.style['align-items'] = 'center';
    loadDiv.style['transition'] = 'all 1.5s ease-in-out';


    // Create progress bar
    let progress = document.createElement('div');
    let progressBar = document.createElement('div');
    progressBar.className = 'progressBarLoadScreen';
    progress.appendChild(progressBar);
    progress.style = `
      margin-top: 20px;
      width: 70vw;
      height: 20px;
      background: rgba(40, 122, 163, 1);
      border: none;
      border-radius: 10px`;
    progressBar.style = `width: 70vw;
      height: 20px;
      background: rgba(11, 85, 122, 1);
      border: none;
      border-radius: 10px`;



    // Add to div
    loadDiv.appendChild(progress);
    // Add to body
    document.body.appendChild(loadDiv);


    // Load manager
    THREE.DefaultLoadingManager.onStart = function (url, itemsLoaded, itemsTotal) {
      if (url.includes('OceanSurfaceMR') || url.includes('OceanSurfaceHR')){
        debugger;
      }
      console.log('Started loading file: ' + url + '.\nLoaded ' + itemsLoaded + ' of ' + itemsTotal + ' files.');
    };

    THREE.DefaultLoadingManager.onLoad = function () {
      console.log('Loading Complete!');
      if (loadDiv.parentElement != null){
        loadDiv.style.opacity = 0;
        setTimeout(() => document.body.removeChild(loadDiv), 1300);
        
      }
      // Emit event
      window.eventBus.emit('SceneManager_LoadingComplete');
      // TODO: Twice OceanSurfaceMR
      // TODO: For some reason the files appear to be loaded twice?
    };
    THREE.DefaultLoadingManager.onProgress = function (url, itemsLoaded, itemsTotal) {
      console.log('Loading file: ' + url + '.\nLoaded ' + itemsLoaded + ' of ' + itemsTotal + ' files.');
      progressBar.style.width = (itemsLoaded / itemsTotal * 100) + '%';
    };

    THREE.DefaultLoadingManager.onError = function (url) {
      console.log('There was an error loading ' + url);
    };
  }

  // WINDOW RESIZE (called from Canvas3D.vue)
  windowWasResized = function(){
    if (this.resizeRendererToDisplaySize(this.renderer)) {
      const canvas = this.renderer.domElement;
      this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
      this.camera.updateProjectionMatrix();
    }
  }








  // UPDATE
  update = function(time){
    
    if (this.prevTime == 0) this.prevTime = time; // Initial timestamp
    let dt = (time - this.prevTime) / 1000;
    this.prevTime = time;
    this.stats.update();


    // Ocean updates
    if (this.ocean && this.camera.position.y > -4) { // Limiting the updates by camera position does not improve performance in my PC 
      if (this.ocean.isLoaded) {

        // Update ocean grid
        this.ocean.gridEntity.update(this.ocean.oceanTile, this.selectedCamera);
        this.ocean.update(dt);

      }
    }






  }





  // Resize renderer
  resizeRendererToDisplaySize = function (renderer) {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
    }
    return needResize;
  }




  // RENDER
  render = function (time) {
    if (this.isRecording)
      return;
    // // Tween update
    // if (TWEEN)
    //   TWEEN.update();

    // if (this.resizeRendererToDisplaySize(this.renderer)) {
    //   const canvas = this.renderer.domElement;
    //   this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    //   this.camera.updateProjectionMatrix();
    // }

    this.update(time);

    this.renderer.render(this.scene, this.selectedCamera);

    this.controls.update();

    //this.recorder.renderLeft();

    requestAnimationFrame(this.render.bind(this));
  }


  startRender = function(){
    requestAnimationFrame(this.render.bind(this));
  }









  

}

export default SceneManager;