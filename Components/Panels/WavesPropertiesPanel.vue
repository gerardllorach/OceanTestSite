<template>
  
  <div id="waves-properties-panel" class="content">

    <h3>Properties of present waves</h3>

    <!-- TABLE -->
    <div class="container-vertical">
      <!-- ROW -->
      <div class="container-horizontal">
        <span class="emptyCell"></span>
        <span>Wave</span>
        <span>Height</span>
        <span>Period</span>
        <span>Direction</span>
      </div>

      <div class="container-horizontal" v-for="(ww, index) in wavesProperties">
        <button class="close-button clickable" @click="removeWave(index)"><span>x</span></button>
        <span>{{ index +1}}</span>
        <!-- Display numbers -->
        <span class="editableSpan clickable" v-show="!isEditing" @click="startEditing">{{ ww.hm0 }} m</span>
        <span class="editableSpan clickable" v-show="!isEditing" @click="startEditing">{{ ww.T }} s</span>
        <span class="editableSpan clickable" v-show="!isEditing" @click="startEditing">{{ ww.dir }}º</span>
        <!-- Input forms -->
        <div v-show="isEditing">
          <input  type="number" min="0.01" max="10" step="0.01" :value="ww.hm0" name="hm0" @change="onChange($event, index, 'hm0')"/>
          <span> m</span>
        </div>
        <div v-show="isEditing">
          <input  type="number" min="1" max="20" step="0.1" :value="ww.T" name="T" @change="onChange($event, index, 'T')"/>
          <span> s</span>
        </div>
        <div v-show="isEditing">
          <input  type="number" min="0" max="360" step="1" :value="ww.dir" name="dir" @change="onChange($event, index, 'dir')"/>
          <span> º</span>
        </div>

      </div>
      <!-- Add new wave -->
      <div class="container-horizontal">
        <button class="add-button clickable" @click="addWave"><span>+</span></button>
        <span></span>
        <span></span>
        <span></span>
        <span></span>
      </div>
      
      <!-- Export button -->
      <button class="exportButton clickable" @click="exportData">Export data <span class="fa">&#xf56d;</span></button>

    </div>
  </div>
  

</template>






<script>




export default {
  name: "WavesPropertiesPanel",
  created() {

  },
  mounted() {


  },
  data() {
    return {
      wavesProperties: [
        {hm0: 1, T: 8, dir: 45},
        {hm0: 2, T: 5, dir: 68},
        {hm0: 0.5, T: 2, dir: 76},
        {hm0: 0.2, T: 3, dir: 35},
      ],
      isEditing: false,
    }
  },
  methods: {
    // USER INPUT
    addWave: function(e){
      if (e){ e.preventDefault(); e.stopPropagation();}
      // Create wave
      this.wavesProperties.push({
        hm0: (Math.random()*2.5+0.5).toFixed(1),
        T: (Math.random()*4 + 2).toFixed(1),
        dir: (Math.random()*360).toFixed(0),
      });
      this.startEditing();
      window.eventBus.emit('WavesPropertiesPanel_setWavesProperties', this.wavesProperties);
    },
    removeWave: function(index){
      this.wavesProperties.splice(index, 1);
      window.eventBus.emit('WavesPropertiesPanel_setWavesProperties', this.wavesProperties);
    },
    exportData: function(){
      window.eventBus.emit('OceanParametersPanel_exportData');
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
      let value = e.target.valueAsNumber;
      // Limit value
      if (value > parseFloat(e.target.max) || isNaN(value)){
        e.target.valueAsNumber = parseFloat(e.target.max);
        e.target.value = value = e.target.max;
      } else if (value < parseFloat(e.target.min) || isNaN(value)){
        e.target.valueAsNumber = parseFloat(e.target.min);
        e.target.value = value = e.target.min;
      }
       // TODO: TAKE INTO ACCOUNT RELATIONSHIP BETWEEN HM0 AND T (steepness below 0.5)
      this.wavesProperties[index][key] = value;
      window.eventBus.emit('WavesPropertiesPanel_setWavesProperties', this.wavesProperties);
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

.close-button {
  width: 20px;
  height: 20px;
  background: var(--red);
  border-radius: 50%;
  text-align: center;

  box-shadow: 0px 0px 4px rgba(0, 0, 0, 0.6);
}

.add-button {
  width: 20px;
  height: 20px;
  background: #1dbb1d;
  border-radius: 50%;
  text-align: center;

  box-shadow: 0px 0px 4px rgba(0, 0, 0, 0.6);
}


.emptyCell{
  width: 60px;
  height: 20px;
}

.exportButton{
  margin: 20px 20px 0px 20px;
}

.exportButton:hover{
  background: var(--blue);
}

.editableSpan {
  cursor: pointer;
}

input {
  text-align: center;
  font-size: clamp(0.8rem, 1.2vw, 0.8rem);
}
</style>