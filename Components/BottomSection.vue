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
      isSectionOpen: false
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
  background: blue;
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
  margin: -60px;
}



.rotate0 {
  rotate: 0deg;
  transition: all 0.7s ease-in-out;
}
.rotate180 {
  rotate: 180deg;
  transition: all 0.7s ease-in-out;
}
</style>