<template>
  <!-- Container -->
  <div id="app-manager" ref="appManager">

    <!-- Canvas 3D -->
    <canvas3D></canvas3D>

    <!-- Central Panel -->
    <central-panel></central-panel>


    <!-- ****** TOP RIGHT ICONS ****** -->
    <div class="top-right-icons-container">
      <!-- FPS button -->
      <div class="clickable icon-str" @click="fpsClicked">fps</div>
      <!-- github button -->
      <a href="https://github.com/gerardllorach/OceanTestSite" target="_blank">
        <svg height="32" aria-hidden="true" viewBox="0 0 16 16" version="1.1" width="32" data-view-component="true" class="clickable github-logo">
            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
        </svg>
      </a>
      <!-- information button -->
      <div class="clickable icon-str" @click="infoIconClicked" title='information'>i</div>

    </div>

    <!-- CAMERA ICONS -->
    <div class="camera-icons-container top-right-icons-container">
      <!-- Left cam button -->
      <div class="clickable icon-str fa" @click="camClicked('L')" title="Left sided camera">&#xf03d;</div>
      <!-- Right cam button -->
      <div class="clickable icon-str fa" @click="camClicked('R')" title="Right sided camera">&#xf03d;</div>
      <!-- Free cam button -->
      <div class="clickable icon-str fa-light fa" @click="camClicked('F')" title="Free view camera">&#xe0d8;</div>
    </div>

    <!-- RECORDING ICONS -->
    <div class="recording-icons-container top-right-icons-container">
      <!-- Record button -->
      <div class="clickable icon-str fa" @click="recordClicked" title="Create stereo images">&#xf03e;</div>
      <!-- Calibrate button -->
      <div class="clickable icon-str fa" @click="calibrateClicked" title="Create calibration images">&#xf43c;</div>
      <!-- Right cam button -->
      <div class="clickable icon-str fa" @click="exportJSONClicked" title="Export ocean params JSON">&#xf56d;</div>

    </div>

    <!-- Compass button -->
    <div class="compass-icons-container top-right-icons-container">
      <button class="roundButton icon-big icon-str clickable" @click="compassButtonClicked" title='Camera orientation'>
        <svg ref="compass-icon" xmlns="http://www.w3.org/2000/svg" width="35" height="35" viewBox="0 0 512 512">
          <path id="South" class="south"
            d="M332.782,253.277a25.947,25.947,0,0,1,0,15.446L261.812,461.8c-1.567,4.265-4.109,4.265-5.677,0l-70.97-193.073a25.947,25.947,0,0,1,0-15.446H332.782Z" />
          <path id="North" class="north"
            d="M261.812,52.2l70.97,193.073a25.947,25.947,0,0,1,0,15.446H185.165a25.947,25.947,0,0,1,0-15.446L256.135,52.2C257.7,47.939,260.245,47.939,261.812,52.2Z" />
          <circle id="Center" class="center" cx="260" cy="257" r="10" />
        </svg>
      </button>
    </div>



    <!-- ****** TOP-LEFT ICONS ****** -->
    <div class="top-left-icons-container">
      <button class="clickable" @click="wavesPropsClicked"><span>Wave's properites </span><span class="fa">&#xf085;</span></button>
    </div>
    
  </div>
</template>



<script>


// Import components
import Canvas3D from "./Canvas3D.vue"
import CentralPanel from "./CentralPanel.vue"

export default {
  name: "AppManager",
  created() {
    
  },
  mounted() {
    // Mobile bottom bar full height fix
    // https://dev.to/admitkard/mobile-issue-with-100vh-height-100-100vh-3-solutions-3nae
    this.$refs.appManager.style.height = window.innerHeight + 'px';
    window.onresize =  () => {
      this.$refs.appManager.style.height = window.innerHeight + 'px';
    }; 

    // Listen to the camera orientation
    window.eventBus.on('Canvas3D_cameraChange', (sceneManager) => {
      // Find orientation
      let target = sceneManager.controls.target;
      let camPos = sceneManager.camera.position;
      let xDir = camPos.x - target.x;
      let zDir = camPos.z - target.z;
      let angle = Math.atan2(xDir, zDir) * 180 / Math.PI;
      // Rotate compass in the opposite direction
      this.$refs["compass-icon"].style.transform = "rotate(" + angle + "deg)";
    })
  },
  data (){
    return {

    }
  },
  methods: {
    //onclick: function(e){},
    infoIconClicked: function(){
      window.eventBus.emit('OpenCentralPanel', 'infoPanel');
    },    
    fpsClicked: function() {
      window.eventBus.emit('AppManager_fpsButtonClicked');
    },
    recordClicked: function() {
      window.eventBus.emit('AppManager_recordClicked');
    },
    calibrateClicked: function(){
      window.eventBus.emit('AppManager_calibrateClicked');
    },
    exportJSONClicked: function(){
      window.eventBus.emit('AppManager_exportJSONClicked');
    },
    camClicked: function(value){
      window.eventBus.emit('AppManager_cameraClicked', value);
    },
    compassButtonClicked: function (e) {
      window.eventBus.emit('TopRightMenu_compassButtonClicked');
    },

    wavesPropsClicked: function(){
      window.eventBus.emit('OpenCentralPanel', 'wavesProperties');
    }
  },
  components: {
    "canvas3D": Canvas3D,
    "central-panel": CentralPanel,
  }
}
</script>


<style scoped>
#app-manager {
    width: 100vw;

    height: 100vh;
    position: fixed;
    /*height: 100%;
    position: absolute;*/

  }

  .logo {
  width: clamp(70px, 7vw, 100px);
  height: clamp(70px, 7vw, 100px);
  position: fixed;
  top: 10px;
  padding: 0px;
  margin: 0px;
  z-index: 10;
}

.icatmar-logo {
  left: 50px;
}

.obs-logo {
  left: clamp(110px, 9vw, 140px);
}

.top-right-icons-container{
  position: absolute;
  top: 6px;
  right: 10px;

  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
}

.top-right-icons-container > * {
  width: 28px;
  height: 28px;

  padding: 0px;
  margin: 5px;
  z-index: 10;
}


.top-left-icons-container{
  position: absolute;
  top: 60px;
  left: 20px;

  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
}



.recording-icons-container{
  top: 120px;
}
.recording-icons-container > *{
  color: rgb(255, 168, 168);
}

.camera-icons-container{
  top: 60px;
}

.compass-icons-container{
  top: 180px;
}

.north {
    stroke: #1a1a1a;
    stroke-width: 20px;
    fill-rule: evenodd;
    fill: #ed1c24;
  }
  .south {
    stroke: #1a1a1a;
    stroke-width: 20px;
    fill-rule: evenodd;
    fill: #ebebeb;
  }
  .center{
    stroke: #1a1a1a;
    stroke-width: 20px;
    fill: #1a1a1a;
  }




.github-logo {
  background: white;
  border-radius: 50%;
  border-color: black !important;
  border-width: thick;
  border: double;
  width: 28px;
  height: 28px;
}

</style>