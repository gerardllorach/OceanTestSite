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
              @input="change({ windSpeed: Number($event.target.value) })"><span><wind-speed :value="settings.windSpeed"></wind-speed></span></div>
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
        <b><wind-speed :value="ripples.windSpeed"></wind-speed></b> from <b>{{ compass(ripples.sourceWindDir ?? ripples.windDir) }}</b> (mean wave direction).
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
          <div class="segmented" role="group" aria-label="Directional spread of the ripples">
            <button class="clickable" :class="{ 'button-active': spreadModeShown == 'wind' }" :aria-pressed="spreadModeShown == 'wind'"
              title="Narrower with more wind: 60° at 7 kn, 15° from 30 kn (linear in knots)" @click="change({ spreadMode: 'wind' })">Wind</button>
            <button class="clickable" :class="{ 'button-active': spreadModeShown == 'auto' }" :aria-pressed="spreadModeShown == 'auto'"
              title="From the ratio of crosswind to upwind slopes of Cox & Munk" @click="change({ spreadMode: 'auto' })">Cox–Munk</button>
            <button class="clickable" :class="{ 'button-active': spreadModeShown == 'custom' }" :aria-pressed="spreadModeShown == 'custom'"
              @click="setCustomSpread()">Custom</button>
          </div>
          <div v-if="settings.spreadMode == 'custom'"><input type="range" min="5" max="150" step="1" :value="settings.spread"
              @input="change({ spread: Number($event.target.value) })"><span>{{ settings.spread }}°</span></div>
          <span v-else-if="ripples" class="derived-value">{{ fmt(ripples.spread, 0) }}°<template v-if="ripples.spreadMode == 'sea'"> (spreading of the sea)</template></span>
        </div>
      </div>
      <!-- Strength: only without Auto (Cox-Munk); Auto keeps the full Cox-Munk slope -->
      <div class="container-horizontal" v-if="settings.spreadMode == 'custom'">
        <span title="Fraction of the Cox & Munk slope left for the ripples (and the tail) that they get. Lower: smaller ripples and a glassier surface, as in calm water or a slick, where surface films damp the ripples">Ripple strength</span>
        <div><input type="range" min="0" max="100" step="5" :value="Math.round((settings.strength ?? 1) * 100)"
            @input="change({ strength: Number($event.target.value) / 100 })"><span>{{ Math.round((settings.strength ?? 1) * 100) }}%</span></div>
      </div>
      <!-- Light wind: Cox-Munk at any wind, or no ripples before the wind can raise them -->
      <div class="container-horizontal">
        <span title="Cox & Munk: their fit keeps some slope even with no wind. Calm in light wind: 5% of the Cox & Munk slopes up to 1.3 m/s (onset of wind waves on clean water, Kahma & Donelan 1988), the full Cox & Munk slopes from 3 m/s, a smooth step between">Light wind</span>
        <div class="column">
          <div class="segmented" role="group" aria-label="Ripples in light wind">
            <button class="clickable" :class="{ 'button-active': settings.lightWind != 'onset' }" :aria-pressed="settings.lightWind != 'onset'"
              @click="change({ lightWind: 'coxMunk' })">Cox &amp; Munk</button>
            <button class="clickable" :class="{ 'button-active': settings.lightWind == 'onset' }" :aria-pressed="settings.lightWind == 'onset'"
              @click="change({ lightWind: 'onset' })">Calm in light wind</button>
          </div>
          <span v-if="settings.lightWind == 'onset' && ripples" class="derived-value">×{{ fmt(ripples.lightWindFactor, 2) }} of
            Cox &amp; Munk at this wind (0.05 up to <wind-speed :value="1.3"></wind-speed>, 1 from <wind-speed :value="3"></wind-speed>)</span>
        </div>
      </div>

      <!-- SHAPE OF THE SPECTRUM -->
      <div class="container-horizontal">
        <span title="Sea spectrum (strict, set by Physics-based): the ripples continue the spectrum of the FFT sea (JONSWAP, TMA, Pierson-Moskowitz or Elfouhaily) in absolute units, not scaled to Cox &amp; Munk. Wind dependent (Elfouhaily et al. 1997, scaled to Cox &amp; Munk): in strong wind the short sharp ripples carry most of the slope, the mid-sized waves are few. Constant: the same slope per octave at any wind (Phillips 1958), scaled to Cox &amp; Munk">Spectrum shape</span>
        <div class="column">
          <div class="segmented" role="group" aria-label="Shape of the ripple spectrum">
            <button class="clickable" :class="{ 'button-active': settings.spectrum == 'sea' }" :aria-pressed="settings.spectrum == 'sea'"
              :disabled="!rippleFFT" @click="change({ spectrum: 'sea' })">Sea spectrum</button>
            <button class="clickable" :class="{ 'button-active': settings.spectrum == 'elfouhaily' }" :aria-pressed="settings.spectrum == 'elfouhaily'"
              @click="change({ spectrum: 'elfouhaily' })">Wind dependent</button>
            <button class="clickable" :class="{ 'button-active': !settings.spectrum || settings.spectrum == 'saturation' }" :aria-pressed="!settings.spectrum || settings.spectrum == 'saturation'"
              @click="change({ spectrum: 'saturation' })">Constant</button>
          </div>
          <span v-if="ripples && ripples.explicitFraction != null" class="derived-value">{{ Math.round(ripples.explicitFraction * 100) }}% of
            the ripple slope in the grid, the rest finer (roughness)<template v-if="ripples.strict && ripples.slopes">; total slope
            {{ Math.round((ripples.slopes.total.up + ripples.slopes.total.cross) / Math.max(1e-9, ripples.slopes.coxMunk.up + ripples.slopes.coxMunk.cross) * 100) }}% of Cox &amp; Munk</template></span>
        </div>
      </div>
      <div class="container-horizontal">
        <span title="On: each ripple gets a Rayleigh-distributed amplitude (as the FFT sea): groups and occasional sharper ripples. Off: the expected amplitude">Random amplitudes</span>
        <label class="checkbox-label"><input type="checkbox" :checked="settings.randomAmplitudes !== false"
            @change="change({ randomAmplitudes: $event.target.checked })"> Rayleigh</label>
      </div>
      <div class="container-horizontal">
        <span title="The ripples finer than the ripple grid (~9 cm down to a few mm, the capillary-gravity waves) drawn as a looping normal texture near the camera, at their real speed; farther, they are roughness as before. Off: roughness only. Their slope is taken from the roughness: the total stays the same">Centimetre ripples</span>
        <label class="checkbox-label"><input type="checkbox" :checked="settings.detail !== false"
            @change="change({ detail: $event.target.checked })"> Drawn near the camera</label>
      </div>

      <!-- STRAIN BY THE LONG WAVES -->
      <div class="container-horizontal">
        <span title="The long waves squeeze the surface on their crests and stretch it in their troughs, and the ripples with it: steeper and shorter on the crests, longer and smoother in the troughs, only across the long-wave crests (Longuet-Higgins & Stewart 1960). ×0: off, ×1: physical, above: exaggerated">Strained by the waves</span>
        <div><input type="range" min="0" max="10" step="0.5" :value="settings.strain ?? 1" :disabled="!rippleFFT"
            @input="change({ strain: Number($event.target.value) })"><span>×{{ (settings.strain ?? 1).toFixed(1) }}</span></div>
      </div>

      <!-- RIPPLE GRID ON / OFF -->
      <div class="container-horizontal">
        <span title="Off: no ripple grid; their slopes remain as roughness (sun glitter, Fresnel)">Ripple grid</span>
        <div>
          <label class="checkbox-label"><input type="checkbox" :checked="settings.enabled !== false" :disabled="!rippleGrid"
              @change="change({ enabled: $event.target.checked })"> Drawn</label>
        </div>
      </div>
      <p v-if="rippleLoop" class="hint-low">Low quality (Quality): the ripples are a precomputed
        loop ({{ loopFrames }} frames, {{ loopPeriod }} s, {{ ripples ? ripples.N : '' }}² grid), rebuilt when they
        change. They are not strained by the waves.</p>
      <p v-else-if="!rippleGrid" class="hint-low">No ripple grid at this quality: the ripples are roughness only.</p>

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

    <!-- NO SLOPE LEFT FOR THE RIPPLES (see generateRipples: they get Cox-Munk minus the slopes of the waves) -->
    <p v-if="noBudget" class="warning" role="status">
      No ripples: the FFT sea and the swell are already as steep as the sea surface of Cox &amp; Munk for a
      <wind-speed :value="ripples.windSpeed"></wind-speed> wind (mean square slope {{ fmt(waveSlope, 4) }}, target {{ fmt(coxMunkSlope, 4) }}),
      so nothing is left for the ripples. Raise the wind speed, or make the sea less steep (lower H<sub>m0</sub> or longer
      peak period).
    </p>

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

import WindSpeed from '../WindSpeed.vue';

import Knob from '../Knob.vue';

export default {
  name: "SurfaceRipplesPanel",
  // embedded: inside the Generation page (no introduction)
  props: { embedded: Boolean },
  mounted() {
    window.eventBus.on('OceanEntity_ripplesChanged', this.onRipplesChanged);
    window.eventBus.on('OceanEntity_qualityChanged', this.onQualityChanged);
    if (window.sceneManager) {
      this.onQualityChanged(window.sceneManager.getQuality());
      this.settings = window.sceneManager.getRippleSettings();
      this.ripples = window.sceneManager.getRipples();
      this.debugView = window.sceneManager.ocean.oceanTile.material.uniforms.u_debugView.value;
    }
  },
  unmounted() {
    window.eventBus.off('OceanEntity_ripplesChanged', this.onRipplesChanged);
    window.eventBus.off('OceanEntity_qualityChanged', this.onQualityChanged);
  },
  data() {
    return {
      settings: { mode: 'seaState', windSpeed: 7, windDir: 0, enabled: true, directionMode: 'wind', direction: 0, spreadMode: 'wind', spread: 30, strength: 1, strain: 1, lightWind: 'coxMunk', spectrum: 'saturation', randomAmplitudes: true, detail: true },
      ripples: null,
      rippleGrid: true,  // Ripples drawn (FFT or loop)
      rippleFFT: true,   // Ripple FFT (the strain needs it)
      rippleLoop: false, // Precomputed loop (qualities without FFT)
      loopFrames: 64,
      loopPeriod: 4,
      debugView: 0,
      debugViews: [
        { id: 0, title: 'Final image' },
        { id: 1, title: 'Fresnel reflectance' },
        { id: 2, title: 'Surface normal' },
        { id: 3, title: 'Roughness (red upwind, green crosswind)' },
        { id: 4, title: 'Ripple slopes' },
        { id: 5, title: 'Stretch by the waves (red squeezed, blue stretched)' },
        { id: 6, title: 'Foam (red foam, green breaking, blue trail damping)' },
        { id: 7, title: 'Jacobian (red: below threshold, green: breaking, blue: collapse)' },
        { id: 8, title: 'Foam by breaking scale (blue small .. red large, green ripples)' },
      ],
    }
  },
  computed: {
    // Spread mode as resolved by the ripples ('sea' under the twin shows none active)
    spreadModeShown() { return this.ripples ? this.ripples.spreadMode : (this.settings.spreadMode || 'wind'); },
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
    // Slope of the waves (FFT sea + swell) against the Cox-Munk target, upwind + crosswind
    waveSlope() {
      const s = this.ripples.slopes, fft = s.fft || { up: 0, cross: 0 };
      return s.gerstner.up + s.gerstner.cross + fft.up + fft.cross;
    },
    coxMunkSlope() { return this.ripples.slopes.coxMunk.up + this.ripples.slopes.coxMunk.cross; },
    // The waves use (almost) the whole Cox-Munk budget: under 2% of it is left for the ripples and the tail
    noBudget() {
      if (!this.ripples) return false;
      const s = this.ripples.slopes, fft = s.fft || { up: 0, cross: 0 };
      const left = Math.max(0, s.coxMunk.up - s.gerstner.up - fft.up) + Math.max(0, s.coxMunk.cross - s.gerstner.cross - fft.cross);
      return left < 0.02 * (s.coxMunk.up + s.coxMunk.cross);
    },
    longest() { return 2 * Math.PI / this.ripples.kMin; },
    shortest() { return 2 * Math.PI / this.ripples.kCut; },
    maxT() { return 2 * Math.PI / Math.sqrt(9.8 * this.ripples.kMin); },
    minT() { return 2 * Math.PI / Math.sqrt(9.8 * this.ripples.kCut); },
  },
  methods: {
    onQualityChanged(quality) {
      this.rippleFFT = quality.fft;
      this.rippleLoop = quality.rippleLoop;
      this.rippleGrid = quality.fft || quality.rippleLoop;
      this.loopFrames = quality.rippleLoopFrames;
      this.loopPeriod = quality.rippleLoopPeriod;
    },
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
    // Custom spread, starting from the current one
    setCustomSpread: function () {
      if (this.settings.spreadMode == 'custom') return;
      this.change({ spreadMode: 'custom', spread: this.ripples ? Math.round(this.ripples.spread) : 30 });
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
    'wind-speed': WindSpeed,
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

.warning {
  background: var(--red);
  border-radius: 10px;
  padding: 6px 12px;
  margin: 0 0 12px;
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
.hint-low {
  margin: 0;
  font-size: x-small;
  color: #3d3c39;
}
</style>
