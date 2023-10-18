<template>
  
  <div id="ocean-parameters-panel" class="content">

    <h3>Ocean parameters</h3>

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

      <div class="container-horizontal" v-for="(ww, index) in oceanParams">
        <button class="close-button clickable" :click="removeWave(index)"><span>x</span></button>
        <span>{{ index +1}}</span>
        <span>{{ ww.hm0 }} m</span>
        <span>{{ ww.T }} s</span>
        <span>{{ ww.dir }}º</span>

      </div>
      <!-- Add new wave -->
      <div class="container-horizontal">
        <button class="add-button clickable" :click="addWave"><span>+</span></button>
        <span></span>
        <span></span>
        <span></span>
        <span></span>
      </div>
      
      <!-- Export button -->
      <button class="exportButton clickable" :click="exportData">Export data <span class="fa">&#xf56d;</span></button>

    </div>
  </div>
  

</template>






<script>




export default {
  name: "OceanParametersPanel",
  created() {

  },
  mounted() {


  },
  data() {
    return {
      oceanParams: [
        {hm0: 1, T: 8, dir: 45},
        {hm0: 2, T: 5, dir: 68},
        {hm0: 0.5, T: 2, dir: 76},
        {hm0: 0.2, T: 3, dir: 35},
      ]
    }
  },
  methods: {
    // USER INPUT
    addWave: function(){
      window.eventBus.emit('OceanParametersPanel_addWave', {hm0: 1, T: 5, dir: 0});
    },
    removeWave: function(index){
      window.eventBus.emit('OceanParametersPanel_removeWave', index);
    },
    exportData: function(){
      window.eventBus.emit('OceanParametersPanel_exportData');
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
</style>