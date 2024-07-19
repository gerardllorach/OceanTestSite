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
        <div><input type="range" min="10" max="50" :value="duration" @input="e => duration = e.target.value"><span>{{ duration }} minutes</span></div>
      </div>
      <!-- SAMPLING RATE -->
      <div class="container-horizontal">
        <span>Sampling rate</span>
        <div><input type="range" step="0.1" min="0.5" max="5" :value="samplingRate"  @input="e => samplingRate = e.target.value"><span>{{ samplingRate }} /s</span></div>
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

  },
  mounted() {
    if (window.sceneManager != undefined){
      this.discreteWaves = window.sceneManager.getDiscreteWaves();
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
    addWave: function(e){
      if (e){ e.preventDefault(); e.stopPropagation();}
      // Create wave
      this.discreteWaves.push({
        hm0: (Math.random()*1+0.5),
        T: (Math.random()*12 + 2),
        dir: (Math.random()*90),
        phase: Math.random()*360,
      });
      this.startEditing();
      window.eventBus.emit('DiscreteWavesPanel_setDiscreteWaves', this.discreteWaves);
    },
    removeWave: function(index){
      this.discreteWaves.splice(index, 1);
      window.eventBus.emit('DiscreteWavesPanel_setDiscreteWaves', this.discreteWaves);
    },
    exportData: function(){
      const link = document.createElement('a');
      link.download = 'discreteWaves.json';
      let data = this.discreteWaves;
      link.href = window.URL.createObjectURL(new Blob([JSON.stringify(data)], {type: 'text/json'}));
      link.click();
      link.delete;
    },
    // START / STOP EDITING VALUES
    startEditing: function(e){
      if (e !== undefined){
        e.stopPropagation();
        e.preventDefault();
      }
      this.isEditing = true;
      // EVENTS
      // Stops editing when clicking outside the input forms or pressing Enter / Escape
      const stopEditing = (e)=>{
        // Do not apply if clicking input EL
        if (e.type == 'click'){
          if (e.target.nodeName == 'INPUT')
            return
        }
        // Apply only for escape
        if (e.type == 'keyup'){
          if (e.key != 'Escape' && e.key != 'NumpadEnter' && e.key != 'Enter')
            return;
        }
        this.isEditing = false;
        document.removeEventListener("click", stopEditing);        
        window.removeEventListener("keyup", stopEditing);
      };
      document.addEventListener("click", stopEditing);
      window.addEventListener("keyup", stopEditing);
    },
    onChange: function(e, index, key){
      let value = parseFloat(e.target.valueAsNumber);
      // Limit value
      if (value > parseFloat(e.target.max) || isNaN(value)){
        e.target.valueAsNumber = parseFloat(e.target.max);
        e.target.value = value = parseFloat(e.target.max);
      } else if (value < parseFloat(e.target.min) || isNaN(value)){
        e.target.valueAsNumber = parseFloat(e.target.min);
        e.target.value = value = parseFloat(e.target.min);
      }
       // TODO: TAKE INTO ACCOUNT RELATIONSHIP BETWEEN HM0 AND T (steepness below 0.5)
      this.discreteWaves[index][key] = value;
      window.eventBus.emit('DiscreteWavesPanel_setDiscreteWaves', this.discreteWaves);
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