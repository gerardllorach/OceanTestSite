<template>
  <div id="surface-ripples-panel" class="content" :class="{ embedded }">

    <p v-if="!embedded">Ripples are the short waves, from where the FFT sea stops (~4 m) down to a few centimetres. They are a second FFT
      cascade on a small tile: tens of thousands of trochoidal components that displace the mesh where it is fine
      enough (near the camera) and the surface normals down to the pixel. Their slopes follow the
      Cox &amp; Munk (1954) relation between wind speed and the roughness of the sea surface, and they are included in
      the sea state analysis.</p>

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
            <span class="knob-value">{{ compass(settings.windDir) }}</span>
          </div>
        </div>
      </template>
      <p v-else-if="ripples" class="derived">
        Equivalent wind of a fully developed sea with the same H<sub>m0</sub> ({{ fmt(ripples.seaStateHm0, 2) }} m):
        <b>{{ fmt(ripples.windSpeed, 1) }} m/s</b> from <b>{{ compass(ripples.sourceWindDir ?? ripples.windDir) }}</b> (mean wave direction).
      </p>

      <!-- DIRECTIONALITY -->
      <div class="container-horizontal">
        <span title="Direction the ripples come from: the wind (or the mean wave direction), or a direction of your own">Ripple direction</span>
        <div class="segmented" role="group" aria-label="Ripple direction">
          <button class="clickable" :class="{ 'button-active': settings.directionMode != 'custom' }" :aria-pressed="settings.directionMode != 'custom'"
            @click="change({ directionMode: 'wind' })">Follow wind</button>
          <button class="clickable" :class="{ 'button-active': settings.directionMode == 'custom' }" :aria-pressed="settings.directionMode == 'custom'"
            @click="setCustomDirection">Custom</button>
        </div>
      </div>
      <div class="container-horizontal" v-if="settings.directionMode == 'custom'">
        <span>Ripples from</span>
        <div class="knob-row">
          <knob size="50px" :value="settings.direction" @change="v => change({ direction: Math.round(v) })"></knob>
          <span class="knob-value">{{ compass(settings.direction) }}</span>
        </div>
      </div>
      <div class="container-horizontal">
        <span title="Width of the directional distribution of the ripples. Narrow: long-crested ripples aligned with their direction. Wide: short-crested, from all directions">Directional spread</span>
        <div class="column">
          <label class="checkbox-label" title="From the ratio of crosswind to upwind slopes of Cox & Munk, and broader for shorter ripples">
            <input type="checkbox" :checked="settings.spreadMode != 'custom'" @change="toggleAutoSpread($event.target.checked)"> Auto (Cox–Munk)
          </label>
          <div v-if="settings.spreadMode == 'custom'"><input type="range" min="5" max="150" step="1" :value="settings.spread"
              @input="change({ spread: Number($event.target.value) })"><span>{{ settings.spread }}°</span></div>
          <span v-else-if="ripples" class="derived-value">{{ fmt(ripples.spread, 0) }}°, broader for shorter ripples</span>
        </div>
      </div>

      <!-- RIPPLE GRID ON / OFF -->
      <div class="container-horizontal">
        <span title="Off: no ripple grid; their slopes remain as roughness (sun glitter, Fresnel)">Ripple grid</span>
        <div>
          <label class="checkbox-label"><input type="checkbox" :checked="settings.enabled !== false"
              @change="change({ enabled: $event.target.checked })"> Drawn</label>
        </div>
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
      <template v-if="ripples.enabled">{{ ripples.numComponents }} components on a {{ fmt(ripples.L, 1) }} m tile
        ({{ ripples.N }}² grid), wavelengths from {{ fmt(longest, 2) }} m to {{ fmt(shortest * 100, 1) }} cm
        (periods {{ fmt(maxT, 2) }}–{{ fmt(minT, 2) }} s), with the same slope variance per octave (saturation range,
        F(k) ∝ k⁻³). They add {{ fmt(ripples.heightVariance * 1e4, 1) }} cm² to the height variance. </template>
      Where the pixels are larger than the ripples, the mipmaps keep their slope variance as roughness, together with
      the tail (finer than the grid), so the Fresnel reflection and the sun glitter do not depend on the distance.
    </p>
  </div>
</template>



<script>

import Knob from '../Knob.vue';

export default {
  name: "SurfaceRipplesPanel",
  // embedded: inside the Generation page (no introduction)
  props: { embedded: Boolean },
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
      settings: { mode: 'seaState', windSpeed: 7, windDir: 0, enabled: true, directionMode: 'wind', direction: 0, spreadMode: 'auto', spread: 30 },
      ripples: null,
      debugView: 0,
      debugViews: [
        { id: 0, title: 'Final image' },
        { id: 1, title: 'Fresnel reflectance' },
        { id: 2, title: 'Surface normal' },
        { id: 3, title: 'Roughness (red upwind, green crosswind)' },
        { id: 4, title: 'Ripple slopes' },
      ],
    }
  },
  computed: {
    slopeRows() {
      const s = this.ripples.slopes;
      return [
        { name: 'Swell (Gerstner waves)', v: s.gerstner },
        ...(s.fft && (s.fft.up + s.fft.cross) > 0 ? [{ name: 'FFT sea', v: s.fft }] : []),
        { name: 'Ripples (FFT grid)', v: s.ripples },
        { name: 'Tail (roughness only)', v: s.tail },
        { name: 'Total', v: s.total, total: true },
        { name: 'Cox & Munk target', v: s.coxMunk },
      ];
    },
    longest() { return 2 * Math.PI / this.ripples.kMin; },
    shortest() { return 2 * Math.PI / this.ripples.kCut; },
    maxT() { return 2 * Math.PI / Math.sqrt(9.8 * this.ripples.kMin); },
    minT() { return 2 * Math.PI / Math.sqrt(9.8 * this.ripples.kCut); },
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
      this.change(r ? { mode: 'wind', windSpeed: Math.round(r.windSpeed * 2) / 2, windDir: Math.round(r.sourceWindDir ?? r.windDir) } : { mode: 'wind' });
    },
    // Custom direction, starting from the current one
    setCustomDirection: function () {
      if (this.settings.directionMode == 'custom') return;
      this.change({ directionMode: 'custom', direction: this.ripples ? Math.round(this.ripples.windDir) : 0 });
    },
    // Custom spread, starting from the current (auto) one
    toggleAutoSpread: function (auto) {
      this.change(auto ? { spreadMode: 'auto' } : { spreadMode: 'custom', spread: this.ripples ? Math.round(this.ripples.spread) : 30 });
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

/* Inside the Generation page */
.content.embedded {
  padding: 0;
  overflow: visible;
  max-width: none;
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

.column {
  flex-direction: column;
  gap: 2px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.derived-value {
  font-weight: 600;
}

.knob-row {
  gap: 12px;
}

/* Fixed width, so the knob does not move while dragging as the text changes ("5° N" vs "158° SSE") */
.knob-value {
  width: 9ch;
  text-align: left;
  font-variant-numeric: tabular-nums;
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
