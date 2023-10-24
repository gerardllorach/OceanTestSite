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
      <div class="container-horizontal">
        <span>Grayscale</span>
        <div><input type="checkbox" v-model="grayscale"><span>2 MB per frame</span></div>
      </div>
      
      

    </div>

    <!-- Export button -->
    <div class="container-vertical">
      <button class="renderButton clickable" @click="renderFramesClicked">Render frames <span class="fa">&#xf56d;</span></button>
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

  },
  data() {
    return {
      duration: 1,
      fps: 10,
      grayscale: false,
    }
  },
  methods: {
    // USER INPUT
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
}

.renderButton{
  margin: 20px 20px 0px 20px;
}


</style>