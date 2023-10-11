
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

  constructor(){

    // Create canvas
    let canvas = document.createElement('canvas');
    canvas.width = 2456;
    canvas.height = 2048;

    // Create THREE renderer
    const renderer = new THREE.WebGLRenderer({ canvas });
    renderer.outputColorSpace = THREE.sRGBEncoding;
    this.renderer = renderer;

    

  }
}