<template>
  <!-- Container -->
  <div id="app-manager" ref="appManager">

    <!-- Shifted left when the side panel is open, so the camera centre stays in the middle of the visible area -->
    <div class="full-screen-container" :style="{ transform: canvasShift }">
      <!-- Canvas 3D -->
      <canvas3D></canvas3D>
    </div>

    <!-- Menu, sections and side panel (right), camera buttons (bottom right) -->
    <side-panel></side-panel>

  </div>
</template>



<script>

// Import components
import Canvas3D from "./Canvas3D.vue"
import SidePanel from "./SidePanel.vue"

export default {
  name: "AppManager",
  mounted() {
    // Mobile bottom bar full height fix
    // https://dev.to/admitkard/mobile-issue-with-100vh-height-100-100vh-3-solutions-3nae
    this.$refs.appManager.style.height = window.innerHeight + 'px';
    window.onresize = () => {
      this.$refs.appManager.style.height = window.innerHeight + 'px';
    };

    // Side panel covers the right side: translate the 3D view by half its width (no resize, no re-render)
    window.eventBus.on('SidePanel_layoutChanged', ({ isOpen, width }) => {
      this.canvasShift = isOpen ? 'translateX(calc(' + width + ' / -2))' : 'none';
    });
  },
  data() {
    return {
      canvasShift: 'none',
    }
  },
  components: {
    "canvas3D": Canvas3D,
    "side-panel": SidePanel,
  }
}
</script>


<style scoped>
#app-manager {
  width: 100vw;
  height: 100vh;
  position: fixed;
}

.full-screen-container {
  position: relative;
  width: 100%;
  height: 100%;
  /* Same timing as the side panel */
  transition: transform 0.5s ease-out;
}
</style>
