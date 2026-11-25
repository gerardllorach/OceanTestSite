<template>
  <!-- Switch the 3D view to a render camera, and back to the free view -->
  <div class="camera-view-buttons">
    <span class="label">View from</span>
    <button v-for="cam in cameras" :key="cam.id" class="clickable" :class="{ 'button-active': selected == cam.id }"
      @click="select(cam.id)" :title="'Show the view of the ' + cam.title.toLowerCase()">
      <span class="fa" :class="cam.iconClass">&#xf03d;</span><span>{{ cam.title }}</span>
    </button>
    <button class="clickable" :class="{ 'button-active': selected == 'F' }" @click="select('F')"
      title="Back to the free (normal) view">
      <span class="fa">&#xe0d8;</span><span>Free view</span>
    </button>
  </div>
</template>


<script>
export default {
  name: "CameraViewButtons",
  props: {
    // [{id: 'L' | 'R' | 'Top', title, iconClass}]
    cameras: { type: Array, required: true },
  },
  mounted() {
    if (window.sceneManager) this.selected = window.sceneManager.selectedCameraName;
    window.eventBus.on('SceneManager_cameraChanged', this.onCameraChanged);
  },
  unmounted() {
    window.eventBus.off('SceneManager_cameraChanged', this.onCameraChanged);
  },
  data() {
    return {
      selected: 'F',
    }
  },
  methods: {
    select: function (id) {
      window.eventBus.emit('CameraViewButtons_cameraClicked', id);
    },
    onCameraChanged: function (id) {
      this.selected = id;
    },
  },
}
</script>


<style scoped>
.camera-view-buttons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 10px 0 16px;
}

.label {
  color: #0b0b0b;
  text-shadow: none;
}

button {
  padding: 4px 12px;
  gap: 4px;
}

.flip {
  transform: scaleX(-1);
}

.rotate90 {
  transform: rotate(90deg);
}
</style>
