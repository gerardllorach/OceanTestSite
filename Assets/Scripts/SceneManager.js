import * as THREE from 'three';
import Stats from '/OceanTestSite/lib/three.js/examples/jsm/libs/stats.module.js';
import { OrbitControls } from '/OceanTestSite/lib/three.js/examples/jsm/controls/OrbitControls.js';

import { SkyboxEntity } from '/OceanTestSite/Assets/Skybox/SkyboxEntity.js';

import * as FogShader from '/OceanTestSite/Assets/Terrain/FogShader.js'
import { OceanEntity } from '/OceanTestSite/Assets/Ocean/OceanEntity.js';

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

    // Skybox
    this.skybox = new SkyboxEntity(scene);
    // Ocean
    this.ocean = new OceanEntity(scene);



    

    



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

    { // LIGHT
      const color = 0xFFFFFF;
      const intensity = 0.8;
      const light = new THREE.DirectionalLight(color, intensity);
      light.position.set(0, 10, 0);
      light.target.position.set(-5, 0, 0);
      scene.add(light);
      scene.add(light.target);
    }


    // RECORDER
    this.recorder = new Recorder(scene, this.ocean);

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

      for (let i = 0; i < fps * duration; i++){
        let time = i/fps;
        this.update(1000 * time);
        this.recorder.renderLeft(grayscale);
        let timeStr = String(time.toFixed(2)).padStart(6, '0');
        await this.recorder.savePNG('L_' + timeStr);
        this.recorder.renderRight(grayscale);
        await this.recorder.savePNG('R_' + timeStr);

        // Show progress
        if ((100 *(i+1) / (fps*duration)) > currentPercent){
          currentPercent++;
          window.eventBus.emit('SceneManager_recordProgress', 100 * (i+1) / (fps*duration));
        }
      }
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
    // Iterate frames
    for (let i = 0; i < fps * duration; i++){
      let time = i/fps;
      this.update(1000 * time);
      this.recorder.renderTop(maxWaveHeight);
      let timeStr = String(time.toFixed(2)).padStart(6, '0');
      await this.recorder.savePNG('WaveHeight_range_' + maxWaveHeight + '_' + timeStr);

      // Show progress
      if ((100 *(i+1) / (fps*duration)) > currentPercent){
        currentPercent++;
        window.eventBus.emit('SceneManager_recordProgress', 100 * (i+1) / (fps*duration));
      }
    }
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

  setWavesProperties = function(wavesProperties){
    this.ocean.setWavesProperties(wavesProperties);
  }

  // Export JSON
  exportOceanParamsJSON = function(){
    this.ocean.oceanParams.exportOceanParameters();
  }

  changeCamera = function(value){
    if (value == 'F')
      this.selectedCamera = this.camera;
    else if (value == 'R')
      this.selectedCamera = this.recorder.cameraR;
    else if (value == 'L')
      this.selectedCamera = this.recorder.cameraL;
    else if (value == 'Top')
      this.selectedCamera = this.recorder.cameraTop;
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