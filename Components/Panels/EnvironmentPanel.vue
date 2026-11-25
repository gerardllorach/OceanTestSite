<template>
  <div id="environment-panel" class="content">

    <p>Position of the sun. It lights the scene and is reflected by the waves and the surface ripples
      (sun glitter). Move it to check the reflections from different angles.</p>

    <div class="container-vertical options">
      <p class="section-title">Sun</p>
      <!-- Elevation: the sun moves on a vertical semicircle -->
      <sun-arc-control :value="arcAngle" :azimuth="azimuth" @change="onArcChange"></sun-arc-control>
      <p class="hint">Drag the sun along the arc, or focus it and use the arrow keys (shift: 10°).</p>

      <!-- Orientation of the semicircle -->
      <div class="container-horizontal orientation">
        <div class="knob-wrap">
          <knob size="60px" :value="azimuth" @change="onAzimuthChange"></knob>
        </div>
        <div class="readouts">
          <div>Arc orientation: right horizon at <b>{{ compass(azimuth) }}</b></div>
          <div>Sun elevation: <b>{{ elevation.toFixed(0) }}°</b></div>
          <div>Sun bearing: <b>{{ bearingText }}</b></div>
        </div>
      </div>

      <div class="buttons">
        <button class="clickable" @click="reset" title="Sun overhead, as before this control existed">Reset (overhead)</button>
      </div>
    </div>

    <p class="footnote">The sun is dimmer and warmer near the horizon. Its reflection on the water follows the slope
      statistics of the surface: resolved waves and ripples draw the glitter, finer ripples widen it (roughness).</p>
  </div>
</template>



<script>

import SunArcControl from '../SunArcControl.vue';
import Knob from '../Knob.vue';

const DEFAULT_SUN = { arcAngle: 90, azimuth: 90 };

export default {
  name: "EnvironmentPanel",
  mounted() {
    if (window.sceneManager) this.onSunChanged(window.sceneManager.getSunSettings());
    window.eventBus.on('SceneManager_sunChanged', this.onSunChanged);
  },
  unmounted() {
    window.eventBus.off('SceneManager_sunChanged', this.onSunChanged);
  },
  data() {
    return { ...DEFAULT_SUN };
  },
  computed: {
    elevation() {
      return this.arcAngle <= 90 ? this.arcAngle : 180 - this.arcAngle;
    },
    bearingText() {
      if (Math.abs(this.arcAngle - 90) < 0.05) return 'overhead';
      return this.compass(this.arcAngle < 90 ? this.azimuth : this.azimuth + 180);
    },
  },
  methods: {
    onSunChanged: function (s) {
      this.arcAngle = s.arcAngle;
      this.azimuth = s.azimuth;
    },
    onArcChange: function (angle) {
      this.arcAngle = angle;
      this.emitSun();
    },
    onAzimuthChange: function (angle) {
      this.azimuth = Math.round(angle);
      this.emitSun();
    },
    reset: function () {
      Object.assign(this, DEFAULT_SUN);
      this.emitSun();
    },
    emitSun: function () {
      window.eventBus.emit('EnvironmentPanel_sunChanged', { arcAngle: this.arcAngle, azimuth: this.azimuth });
    },
    compass: function (deg) {
      deg = ((deg % 360) + 360) % 360;
      return Math.round(deg) + '° ' + (window.AnalysisCharts ? window.AnalysisCharts.compass(deg) : '');
    },
  },
  components: {
    'sun-arc-control': SunArcControl,
    'knob': Knob,
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

.container-vertical {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  gap: 8px;
}

.options {
  padding: 16px 20px;
  background: var(--lightBlue);
  border-radius: 20px;
}

.section-title {
  font-weight: 600;
  margin: 0;
}

.hint {
  margin: 0;
  font-size: x-small;
  text-align: center;
}

.container-horizontal {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
}

.knob-wrap {
  display: flex;
  justify-content: center;
  min-width: 70px;
}

.readouts {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.buttons {
  display: flex;
  justify-content: center;
}

.buttons button {
  padding: 4px 14px;
}

.footnote {
  color: #3d3c39;
  font-size: x-small;
  margin-top: 8px;
}
</style>
