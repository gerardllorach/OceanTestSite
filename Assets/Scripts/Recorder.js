
/*
Benetazzo, A., Bergamasco, F., Yoo, J., Cavaleri, L., Kim, S. S., Bertotti, L., ... & Shim, J. S. (2018). Characterizing the signature of a spatio-temporal wind wave field. Ocean Modelling, 129, 104-123.
https://doi.org/10.1016/j.ocemod.2018.06.007
*/
// Frame rate: 10 Hz
// Seconds: 600 seconds
// Image resolution: 2456 x 2048
// 8-bit grayscale
// 8-mm distortionless lenses
// 5.04 meters appart, 33m above sea level
// Inclination: 25º

import * as THREE from 'three';
import { OceanEntity } from '/OceanTestSite/Assets/Ocean/OceanEntity.js';
import { GLTFLoader } from 'https://threejs.org/examples/jsm/loaders/GLTFLoader.js';

class Recorder {

  imgWidth = 2456;
  imgHeight = 2048;

  distBetweenCams = 5.04;
  camElevation = 33;
  camInclination = 25;

  constructor(scene, oceanEntity){

    // Scene
    this.scene = scene;
    this.ocean = oceanEntity;

    // Create THREE renderer
    const renderer = new THREE.WebGLRenderer({});
    //renderer.outputColorSpace = THREE.sRGBEncoding;
    renderer.setSize( this.imgWidth, this.imgHeight);
    this.renderer = renderer;

    // Get canvas
    this.canvas = this.renderer.domElement;

    // Camera presets
    const fov = 45;
    const aspect = this.imgWidth / this.imgHeight;  // the canvas default
    const near = 0.1;
    const far = 2000;

    // Create cameras
    this.cameraR = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.cameraL = new THREE.PerspectiveCamera(fov, aspect, near, far);
    
    // Camera positions
    this.cameraR.position.set( this.distBetweenCams / 2, this.camElevation, 0);
    this.cameraL.position.set(- this.distBetweenCams / 2, this.camElevation, 0);
    // Camera rotation
    this.cameraR.rotation.set(- this.camInclination * Math.PI / 180, 0, 0);
    this.cameraL.rotation.set(- this.camInclination * Math.PI / 180, 0, 0);

    // Create objects for left and right cameras
    // Update camera's matrices
    this.cameraR.updateWorldMatrix();
    this.cameraL.updateWorldMatrix();
    // Create helpers
    this.helper = new THREE.CameraHelper( this.cameraR );
    scene.add( this.helper );
    this.helper2= new THREE.CameraHelper( this.cameraL );
    scene.add( this.helper2 );

    //document.body.appendChild( this.canvas );
  }


  // Create renders with checkerboard
  renderCalibration = function(){
    // Load checker board
    // Load mesh
    let gltfLoader = new GLTFLoader();

    gltfLoader.load('/OceanTestSite/Assets/Calibration/checkerboard.glb', (gltf) => {

      let checkerboard = gltf.scene.children[0];
      this.scene.add(checkerboard);

      // Positions
      let pp = [
        [0, 30, -10],
        [0, 29, -5],
        [5, 25, -15],
        [-6, 26, -14],
        [0.6, 30, -5],
        [0.2, 29.5, -6],
        [-0.7, 27.5, -8],
        [-1.5, 31, -15],
        [-10, 30, -17],
        [10, 30, -17],

        [0, 30, -17],
        [0, 30.5, -13],
        [1, 31, -19],
        [2, 32, -10],
        [-1, 26, -15],
        [-3, 28, -12],
      ];
      // Rotations
      let rr = [
        [60, 0, 0],
        [55, 0, 0],
        [39, 0, 0],
        [58, 0, 0],
        [67, 0, 0],
        [62, 0, 0],
        [66, -0, 0],
        [57, -0, 0],
        [53, -0, -0],
        [78, 0, 0],

        [72, 0, 0],
        [72, 0, 0],
        [39, 0, 0],
        [47, 0, 0],
        [84, 0, 0],
        [45, 0, 0],
      ];
      const DEG2RAD = Math.PI/180;
      // Move checker board and store images
      for (let i = 0; i < pp.length; i++){
        //{let i = 0;
        checkerboard.position.set(pp[i][0], pp[i][1], pp[i][2]);
        checkerboard.rotation.set(rr[i][0] * DEG2RAD, rr[i][1] * DEG2RAD, rr[i][2] * DEG2RAD);
      
        checkerboard.updateWorldMatrix();

        this.renderLeft();
        this.savePNG('Calib_Left' + i);

        this.renderRight();
        this.savePNG('Calib_Right' + i);
      }
      
    });

  }


  renderLeft = (grayscale) => {
    // Update ocean grid
    this.ocean.gridEntity.update(this.ocean.oceanTile, this.cameraL);
    // Hide helpers
    this.displayHelpers(false);
    // Update shader to paint in grayscale
    this.ocean.oceanTile.material.uniforms.u_grayscale.value = grayscale;
    // Paint canvas
    this.renderer.render( this.scene, this.cameraL );
    // Restore grayscale
    this.ocean.oceanTile.material.uniforms.u_grayscale.value = false;
    // Show helpers
    this.displayHelpers(true);
    
  }
  renderRight = (grayscale)=>{
    // Update ocean grid
    this.ocean.gridEntity.update(this.ocean.oceanTile, this.cameraR);
    // Hide helpers
    this.displayHelpers(false);
    // Update shader to paint in grayscale
    this.ocean.oceanTile.material.uniforms.u_grayscale.value = grayscale;
    // Paint canvas
    this.renderer.render( this.scene, this.cameraR );
    // Restore grayscale
    this.ocean.oceanTile.material.uniforms.u_grayscale.value = false;
    // Show helpers
    this.displayHelpers(true);
  }


  savePNG = async function(filename){
    return new Promise((resolve) => {
      const link = document.createElement('a');
      link.download = filename + '.png';
      link.href = this.canvas.toDataURL();
      link.click();
      link.delete;
      setTimeout(resolve, 10);
    })
    
    
  }

  displayHelpers = function(state){
    this.helper.visible = state;
    this.helper2.visible = state;
  }
}

export { Recorder }