<template>
  
  <div id="render-stereo-panel" class="content">

    <h3>Render stereo frames</h3>

    <!-- TABLE -->
    <div class="container-vertical options">
      <!-- DURATION -->
      <div class="container-horizontal">
        <span>Duration</span>
        <div><input type="range" min="1" max="500" :value="duration" @input="e => duration = e.target.value"><span>{{ duration }} seconds</span></div>
      </div>
      <!-- FPS -->
      <div class="container-horizontal">
        <span>Frames per second</span>
        <div><input type="range" min="1" max="60" :value="fps"  @input="e => fps = e.target.value"><span>{{ fps }} fps</span></div>
      </div>
      <!-- Grayscale -->
      <div class="container-horizontal">
        <span>Grayscale</span>
        <div><input type="checkbox" v-model="grayscale"><span>2 MB per frame</span></div>
      </div>
      <!-- LEFT CAMERA -->
      <div class="container-horizontal section">
        <span>Left camera</span>
      </div>
      <!-- Left Camera position -->
      <div class="container-horizontal">
        <span>Left camera position (Y=height)</span>
        <div class="container-horizontal">
          <input  type="number" min="-500" max="500" step="0.01" :value="camLPos[0]" v-model="camLPos[0]" name="camLPos" @change="onChange($event)"/>
          <input  type="number" min="0" max="500" step="0.01" :value="camLPos[1]" v-model="camLPos[1]" name="camLPos" @change="onChange($event)"/>
          <input  type="number" min="-500" max="500" step="0.01" :value="camLPos[2]" v-model="camLPos[2]" name="camLPos" @change="onChange($event)"/>
          <span> m</span>   
        </div>
      </div>
      <!-- Left Camera rotation -->
      <div class="container-horizontal">
        <span>Left camera rotation (Pitch and Yaw)</span>
        <div class="container-horizontal">
          <input  type="number" min="-90" max="90" step="0.01" :value="camLPitchYaw[0]" v-model="camLPitchYaw[0]" name="camLPos" @change="onChange($event)"/>
          <input  type="number" min="-180" max="180" step="0.01" :value="camLPitchYaw[1]" v-model="camLPitchYaw[1]" name="camLPos" @change="onChange($event)"/>
          <span> º</span>     
        </div>
      </div>

      <!-- RIGHT CAMERA -->
      <div class="container-horizontal section">
        <span>Right camera</span>
      </div>
      <!-- Right Camera position -->
      <div class="container-horizontal">
        <span>Right camera position (Y=height)</span>
        <div class="container-horizontal">
          <input  type="number" min="-500" max="500" step="0.01" :value="camRPos[0]" v-model="camRPos[0]" name="camRPos" @change="onChange($event)"/>
          <input  type="number" min="0" max="500" step="0.01" :value="camRPos[1]" v-model="camRPos[1]" name="camRPos" @change="onChange($event)"/>
          <input  type="number" min="-500" max="500" step="0.01" :value="camRPos[2]" v-model="camRPos[2]" name="camRPos" @change="onChange($event)"/>
          <span> m</span>   
        </div>
      </div>
      <!-- Right Camera rotation -->
      <div class="container-horizontal">
        <span>Right camera rotation (Pitch and Yaw)</span>
        <div class="container-horizontal">
          <input  type="number" min="-90" max="90" step="0.01" :value="camRPitchYaw[0]" v-model="camRPitchYaw[0]" name="camRPos" @change="onChange($event)"/>
          <input  type="number" min="-180" max="180" step="0.01" :value="camRPitchYaw[1]" v-model="camRPitchYaw[1]" name="camRPos" @change="onChange($event)"/>
          <span> º</span>     
        </div>
      </div>
      

    </div>

    <!-- Export button -->
    <div class="container-vertical">
      <button class="renderButton clickable" @click="renderFramesClicked">Render frames <span class="fa">&#xf56d;</span></button>
      <!-- Progress bar -->
      <div class="progress-container" v-show="progress!=100">
        <div :style="'width:' + progress + '%' "></div>
      </div>
      <p>This process can take several minutes. Estimated time: <strong>{{ (duration * fps * 0.6 * 2)/60 }} minutes</strong> (if your app runs at 60 fps now). 
      Estimated required space: <strong>{{ grayscale ? duration * fps * 2 * 2 : duration * fps * 2 * 4 }} MB.</strong></p>
      
      <p>
        You should configure your browser to store the files in a certain folder automatically. This will avoid you having to click "Save" for each frame.
      </p>
    </div>
  </div>
</template>






<script>




export default {
  name: "RenderStereoPanel",
  created() {

  },
  mounted() {
    window.eventBus.on('SceneManager_recordProgress', (progress) => {
      this.progress = progress;
    });
    window.eventBus.on('SceneManager_recordFinished', () => {
      this.progress = 100;
    });
  },
  data() {
    return {
      duration: 1,
      fps: 10,
      grayscale: false,
      progress: 100,
      // Data hardcoded from Rcorder.js constructor
      camLPos: [- 5.04 / 2, 33, 0],
      camLPitchYaw: [25, 0], 
      camRPos: [5.04 / 2, 33, 0],
      camRPitchYaw: [25, 0],
    }
  },
  methods: {
    // USER INPUT
    onChange: function(e, camLorR, variable){
      console.log( {
        camLPos: this.camLPos,
        camLPitchYaw: this.camLPitchYaw, 
        camRPos: this.camRPos,
        camRPitchYaw: this.camRPitchYaw
      });
      window.eventBus.emit('RenderStereoPanel_camConfigChanged', {
        camLPos: this.camLPos,
        camLPitchYaw: this.camLPitchYaw, 
        camRPos: this.camRPos,
        camRPitchYaw: this.camRPitchYaw
      });
    },
    renderFramesClicked: function(){
      window.eventBus.emit('RenderStereoPanel_renderFramesClicked', {
        duration: this.duration,
        fps: this.fps,
        grayscale: this.grayscale,
      });
    }
  },
  components: {

  }
}
</script>



<style scoped>

.content {
  padding: 20px;
  overflow: auto;
}

.container-vertical{
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;

  
}

.options {
  padding: 20px;
  background: var(--lightBlue);
  border-radius: 20px;
}

.container-horizontal {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  justify-content: space-evenly;
  padding: 2px;
}

.container-horizontal > * {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  max-height: 25px;
}

.section {
  background: linear-gradient(90deg, transparent 0%, #77cfef 10%, #77cfef 90%, transparent 100%);
}

input {
  border-radius: 5px;
  text-align: center;
  font-size: small;
}

.renderButton{
  margin: 20px 20px 0px 20px;
}

.progress-container {
  width: 100%;
  background: #77cfef;
  margin-top: 10px;
  margin-bottom: 10px;
  border-radius: 25px;
  border-color: #0f3062;
  border-width: thin;
  border-style: solid;
}

.progress-container > * {
  background: linear-gradient(180deg, #52b5d9, #459dbd);
  border-radius: 15px;
  margin: 1px;
  height: 24px;
}


</style>