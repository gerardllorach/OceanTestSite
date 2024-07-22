<template>
  
  <div id="sea-state-analysis-panel" class="content">

    <p>In this section the sea state is analized and standard measures are provided, such as the Hm0, Hmax, Ts, Tp... These measures are provided
      by measuring the height at the position 0,0 for a given period of time.
    </p>

    <p>In the following table you can configure the sampling rate and the duration of the measurement.</p>

    <!-- TABLE -->
    <div class="container-vertical options">
      <!-- DURATION -->
      <div class="container-horizontal">
        <span>Duration</span>
        <div><input type="range" min="10" max="50" :value="duration" @input="durationChanged"><span>{{ duration }} minutes</span></div>
      </div>
      <!-- SAMPLING RATE -->
      <div class="container-horizontal">
        <span>Sampling rate</span>
        <div><input type="range" step="0.1" min="0.5" max="5" :value="samplingRate"  @input="samplingRateChanged"><span>{{ samplingRate }} /s</span></div>
      </div>
    </div>

    <p>
      <strong>Sea state variables</strong>
    </p>

  </div>
  

</template>






<script>




export default {
  name: "SeaStateAnalysisPanel",
  created() {
    this.oceanAnalysis = new window.OceanAnalysis(this.samplingRate, this.duration * 60);
  },
  mounted() {
    if (window.sceneManager != undefined){
      this.discreteWaves = window.sceneManager.getDiscreteWaves();
      this.oceanAnalysis.createSignal(this.discreteWaves);
    }
    // Events
    window.eventBus.on('DiscreteWavesPanel_setDiscreteWaves', (discreteWaves) => {
      this.discreteWaves = discreteWaves;
      // Analize parameters

    });
  },
  data() {
    return {
      duration: 20,
      samplingRate: 3,
    }
  },
  methods: {

    // USER INPUT
    durationChanged: function(e){
      this.duration = e.target.value;
    },
    samplingRateChanged: function(e){
      this.samplingRate = e.target.value;
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
  font-size: small;
  max-width: 700px;
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
  margin-bottom: 20px;
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
  margin: 20px 20px 20px 20px;
}

.calibButton{
  width: auto;
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