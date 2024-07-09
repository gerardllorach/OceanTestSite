<template>
  <!-- Container -->
  <div id="bottom-section" :class="[isSectionOpen ? 'bottom-section-open' : 'bottom-section-closed']">
    <!-- Button to open and close section -->
    <div class="section-opener-container">
      <button class="section-opener-button clickable" @click="bottomSectionClicked"><span>Menu</span>
        <span class="fa"
          :class="[isSectionOpen ? 'rotate180' : 'rotate0']"  
        >&#xf106;</span>
      </button>
    </div>

    
    <div v-show="isSectionOpen">
      <!-- Level 0 -->
      <div class="level-container">
        <button><span>Waves</span></button> 
        <button><span>Export</span></button>
        <button><span>Scene</span></button>
        <button><span>About</span></button>
      </div>
      <!-- Level 1 - Waves -->
      <div class="level-container">
        <button><span>Individual waves</span></button>
        <button><span>Analyze sea state</span></button>
      </div>
      <!-- Level 1 - Export -->
      <div class="level-container">
        <button><span>Individual waves (.json)</span></button>
        <button><span>Render heights (.png)</span></button>
        <button><span>Render stereo cameras (.png)</span></button>
      </div>
      <!-- Level 1 - Scene -->
      

    </div>
    

    
    

  </div>
</template>


<script>

export default {
  name: "BottomSection",
  created() {},
  mounted() {

  },
  data () {
    return {
      isSectionOpen: true
    }
  },
  methods: {
    // Shows / Hides bottom section
    bottomSectionClicked: function (e){
      this.isSectionOpen = !this.isSectionOpen;
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 750);
    },
  }
}


</script>

<style scoped>
#bottom-section {
  position: relative;
  width: 100%;
  background: rgb(200 240 255);;
}

.bottom-section-open {
  height: 100%;
  transition: all 0.7s ease-in-out;
}

.bottom-section-closed {
  height: 0;
  transition: all 0.7s ease-in-out;
}

.section-opener-container {
  display: flex;
  justify-content: center;
  translate: 0px -60px;
  height: 0px;
}
.section-opener-container > button {
  height: 40px;
}
.rotate0 {
  rotate: 0deg;
  transition: all 0.7s ease-in-out;
}
.rotate180 {
  rotate: 180deg;
  transition: all 0.7s ease-in-out;
}


.level-container{
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
}
</style>