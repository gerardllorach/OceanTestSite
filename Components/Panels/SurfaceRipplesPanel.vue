<template>
  <div id="surface-ripples-panel" class="content">

    <p>Ripples are the short waves (from ~4 m down to ~2 cm) that the 3D mesh cannot represent. They are drawn on the
      surface normals in the shader, and they are included in the sea state analysis. Their slopes follow the
      Cox &amp; Munk (1954) relation between wind speed and the roughness of the sea surface.</p>

    <div class="container-vertical options">
      <!-- SOURCE -->
      <div class="container-horizontal">
        <span>Source</span>
        <div class="segmented" role="group" aria-label="Ripple source">
          <button class="clickable" :class="{ 'button-active': settings.mode == 'seaState' }" :aria-pressed="settings.mode == 'seaState'"
            @click="change({ mode: 'seaState' })">From sea state</button>
          <button class="clickable" :class="{ 'button-active': settings.mode == 'wind' }" :aria-pressed="settings.mode == 'wind'"
            @click="switchToWind">Wind</button>
        </div>
      </div>

      <!-- WIND -->
      <template v-if="settings.mode == 'wind'">
        <div class="container-horizontal">
          <span>Wind speed (U10)</span>
          <div><input type="range" min="0" max="25" step="0.5" :value="settings.windSpeed"
              @input="change({ windSpeed: Number($event.target.value) })"><span>{{ settings.windSpeed.toFixed(1) }} m/s</span></div>
        </div>
        <div class="container-horizontal">
          <span>Wind from</span>
          <div class="knob-row">
            <knob size="50px" :value="settings.windDir" @change="v => change({ windDir: Math.round(v) })"></knob>
            <span>{{ compass(settings.windDir) }}</span>
          </div>
        </div>
      </template>
      <p v-else-if="ripples" class="derived">
        Equivalent wind of a fully developed sea with the same H<sub>m0</sub> ({{ fmt(ripples.seaStateHm0, 2) }} m):
        <b>{{ fmt(ripples.windSpeed, 1) }} m/s</b> from <b>{{ compass(ripples.windDir) }}</b> (mean wave direction).
      </p>

      <!-- NUMBER OF RIPPLES -->
      <div class="container-horizontal">
        <span>Drawn ripples</span>
        <div><input type="range" min="0" :max="maxRipples" step="1" :value="settings.count"
            @input="change({ count: Number($event.target.value) })"><span>{{ settings.count }}</span></div>
      </div>

      <!-- DEBUG VIEW -->
      <div class="container-horizontal">
        <span>View</span>
        <div>
          <select :value="debugView" @change="setDebugView(Number($event.target.value))">
            <option v-for="v in debugViews" :key="v.id" :value="v.id">{{ v.title }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- SLOPES -->
    <table class="slope-table" v-if="ripples">
      <thead>
        <tr><th>Mean square slope</th><th>Upwind</th><th>Crosswind</th><th>Total</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in slopeRows" :key="row.name" :class="{ total: row.total }">
          <td>{{ row.name }}</td>
          <td>{{ fmt(row.v.up, 4) }}</td>
          <td>{{ fmt(row.v.cross, 4) }}</td>
          <td>{{ fmt(row.v.up + row.v.cross, 4) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="footnote" v-if="ripples">
      {{ ripples.ripples.length }} ripples with wavelengths from {{ fmt(longest, 2) }} m to {{ fmt(shortest * 100, 1) }} cm
      (periods {{ fmt(maxT, 2) }}–{{ fmt(minT, 2) }} s), each with the same slope variance (saturation range, F(k) ∝ k⁻³).
      They add {{ fmt(ripples.heightVariance * 1e4, 1) }} cm² to the height variance. Ripples shorter than two pixels are
      not drawn: their slope variance becomes roughness, together with the tail, so the Fresnel reflection and the sun
      glitter do not depend on the distance.
    </p>
  </div>
</template>



<script>

import Knob from '../Knob.vue';

export default {
  name: "SurfaceRipplesPanel",
  mounted() {
    window.eventBus.on('OceanEntity_ripplesChanged', this.onRipplesChanged);
    if (window.sceneManager) {
      this.settings = window.sceneManager.getRippleSettings();
      this.ripples = window.sceneManager.getRipples();
      this.debugView = window.sceneManager.ocean.oceanTile.material.uniforms.u_debugView.value;
    }
  },
  unmounted() {
    window.eventBus.off('OceanEntity_ripplesChanged', this.onRipplesChanged);
  },
  data() {
    return {
      settings: { mode: 'seaState', windSpeed: 7, windDir: 0, count: 48 },
      ripples: null,
      maxRipples: 64,
      debugView: 0,
      debugViews: [
        { id: 0, title: 'Final image' },
        { id: 1, title: 'Fresnel reflectance' },
        { id: 2, title: 'Surface normal' },
        { id: 3, title: 'Roughness (red upwind, green crosswind)' },
        { id: 4, title: 'Resolved ripple slopes' },
      ],
    }
  },
  computed: {
    slopeRows() {
      const s = this.ripples.slopes;
      return [
        { name: 'Waves (Gerstner)', v: s.gerstner },
        { name: 'Ripples (drawn when resolved)', v: s.ripples },
        { name: 'Tail (roughness only)', v: s.tail },
        { name: 'Total', v: s.total, total: true },
        { name: 'Cox & Munk target', v: s.coxMunk },
      ];
    },
    longest() { return this.ripples.ripples.length ? this.ripples.ripples[0].wavelength : NaN; },
    shortest() { const r = this.ripples.ripples; return r.length ? r[r.length - 1].wavelength : NaN; },
    maxT() { return this.ripples.ripples.length ? this.ripples.ripples[0].T : NaN; },
    minT() { const r = this.ripples.ripples; return r.length ? r[r.length - 1].T : NaN; },
  },
  methods: {
    onRipplesChanged: function (ripples) {
      this.ripples = ripples;
      this.settings = { ...ripples.settings };
    },
    // Start from the wind derived from the sea state, so that switching does not change the surface
    switchToWind: function () {
      if (this.settings.mode == 'wind') return;
      const r = this.ripples;
      this.change(r ? { mode: 'wind', windSpeed: Math.round(r.windSpeed * 2) / 2, windDir: Math.round(r.windDir) } : { mode: 'wind' });
    },
    change: function (partial) {
      Object.assign(this.settings, partial);
      window.eventBus.emit('SurfaceRipplesPanel_changed', partial);
    },
    setDebugView: function (view) {
      this.debugView = view;
      window.eventBus.emit('SurfaceRipplesPanel_debugViewChanged', view);
    },
    compass: function (deg) {
      if (!isFinite(deg)) return '–';
      deg = ((deg % 360) + 360) % 360;
      return Math.round(deg) + '° ' + (window.AnalysisCharts ? window.AnalysisCharts.compass(deg) : '');
    },
    fmt: function (v, d = 2) {
      return (v == null || !isFinite(v)) ? '–' : Number(v).toFixed(d);
    },
  },
  components: {
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
}

.options {
  padding: 16px 20px;
  background: var(--lightBlue);
  border-radius: 20px;
  margin-bottom: 12px;
}

.container-horizontal {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  justify-content: space-evenly;
  padding: 2px;
}

.container-horizontal>* {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 30px;
}

.segmented {
  gap: 6px;
}

.segmented button {
  padding: 2px 12px;
}

.knob-row {
  gap: 12px;
}

.derived {
  margin: 6px 0;
  text-align: center;
}

select {
  border-radius: 5px;
  font-size: small;
}

.slope-table {
  width: 100%;
  border-collapse: collapse;
  background: #fcfcfb;
  border-radius: 15px;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.slope-table th,
.slope-table td {
  padding: 4px 8px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.slope-table th:first-child,
.slope-table td:first-child {
  text-align: left;
}

.slope-table tbody tr {
  border-top: 1px solid #e6e5e0;
}

.slope-table tr.total td {
  font-weight: 600;
}

.footnote {
  color: #3d3c39;
  font-size: x-small;
  margin-top: 8px;
}
</style>
