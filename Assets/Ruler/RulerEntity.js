import * as THREE from 'three';
import { GLTFLoader } from 'https://threejs.org/examples/jsm/loaders/GLTFLoader.js';


class RulerEntity {

  isLoaded = false;

  constructor(scene){

    // Load mesh
    let gltfLoader = new GLTFLoader();

    gltfLoader.load('/OceanTestSite/Assets/Ruler/ruler.glb', (gltf) => {
      let ruler = gltf.scene.children[0];
      this.obj = ruler;
      scene.add(ruler);

      this.isLoaded = true;

    });

  }

}

export { RulerEntity }