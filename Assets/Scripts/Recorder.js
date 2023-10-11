
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
    const aspect = 2;  // the canvas default
    const near = 0.1;
    const far = 2000;

    // Create cameras
    this.cameraR = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.cameraL = new THREE.PerspectiveCamera(fov, aspect, near, far);
    
    // Camera positions
    //this.cameraR.position.set( this.distBetweenCams / 2, this.camElevation, 0);
    this.cameraL.position.set(- this.distBetweenCams / 2, this.camElevation, 0);
    // Camera rotation
    //this.cameraR.rotation.set(- this.camInclination * Math.PI / 180, 0, 0);
    this.cameraL.rotation.set(- this.camInclination * Math.PI / 180, 0, 0);


    // TODO: OCEAN DEPENDS ON CAMERA, WE NEED TO CONNECT OCEAN ENTITY TO CAMERA-LEFT AND CAMERA-RIGHT
    

    document.body.appendChild( this.canvas );
  }


  render = () => {

    // TODO: TEST
    // Update ocean grid
    this.ocean.gridEntity.update(this.ocean.oceanTile, this.cameraL)

    //this.renderer.render( this.scene, this.cameraR );
    this.renderer.render( this.scene, this.cameraL );

    
  }
}

export { Recorder }