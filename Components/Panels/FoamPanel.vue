<template>
  <div id="foam-panel" class="content">
    <div class="container-vertical options">
      <!-- ON / OFF -->
      <div class="container-horizontal">
        <span>Whitecaps</span>
        <div>
          <label class="checkbox-label"><input type="checkbox" :checked="settings.enabled" :disabled="!available"
              @change="change({ enabled: $event.target.checked })"> Drawn</label>
        </div>
      </div>

      <template v-if="available">
        <!-- MODE -->
        <div class="container-horizontal">
          <span title="Wind: how often crests break follows the wind speed (Monahan & O'Muircheartaigh 1980). Wave shape: crests break where the surface is squeezed enough, whatever the wind">Breaking from</span>
          <div class="segmented" role="group" aria-label="Breaking from">
            <button class="clickable" :class="{ 'button-active': settings.mode != 'shape' }" :aria-pressed="settings.mode != 'shape'"
              @click="change({ mode: 'wind' })">Wind</button>
            <button class="clickable" :class="{ 'button-active': settings.mode == 'shape' }" :aria-pressed="settings.mode == 'shape'"
              @click="change({ mode: 'shape' })">Wave shape</button>
          </div>
        </div>

        <template v-if="settings.mode != 'shape'">
          <p class="derived" v-if="calibration">
            Wind <b><wind-speed :value="calibration.windSpeed"></wind-speed></b> (from the ripples): target whitecap coverage
            <b>{{ pct(calibration.coverage) }}</b><template v-if="measured">, drawn <b>{{ pct(measured.coverage + (calibration.small.enabled ? calibration.small.expected : 0)) }}</b></template>
            (adjusted automatically: breaking ×{{ fmt(calibration.gain, 2) }}).

          </p>
          <div class="container-horizontal">
            <span title="How the coverage of the wind is shared between the scales of breakers. Same fraction: every scale breaks as often. Phillips: breaking crest length per unit area ~ c^-6 (Phillips 1985), times the width of the breaking zone: many small breakers, few large ones">Scale split</span>
            <div class="segmented" role="group" aria-label="Scale split">
              <button class="clickable" :class="{ 'button-active': settings.scaleSplit != 'phillips' }" :aria-pressed="settings.scaleSplit != 'phillips'"
                @click="change({ scaleSplit: 'quantile' })">Same fraction</button>
              <button class="clickable" :class="{ 'button-active': settings.scaleSplit == 'phillips' }" :aria-pressed="settings.scaleSplit == 'phillips'"
                @click="change({ scaleSplit: 'phillips' })">Phillips</button>
            </div>
          </div>
          <div class="container-horizontal">
            <span title="Multiplies the whitecap coverage of Monahan & O'Muircheartaigh for this wind">Amount</span>
            <div><input type="range" min="0" max="5" step="0.1" :value="settings.amount"
                @input="change({ amount: Number($event.target.value) })"><span>×{{ settings.amount.toFixed(1) }}</span></div>
          </div>
        </template>
        <template v-else>
          <p class="derived" v-if="calibration">
            Crests break where the Jacobian falls below <b>{{ fmt(calibration.threshold, 2) }}</b>: a local steepness
            ak above <b>{{ fmt(calibration.steepness, 2) }}</b> (Stokes limit 0.44)<template v-if="measured">.
            Foam drawn <b>{{ pct(measured.coverage) }}</b></template>.
          </p>
          <div class="container-horizontal">
            <span title="Jacobian of the horizontal displacement below which a crest breaks: 1 on still water, 0 where the surface folds over. Higher: more breaking">Breaking threshold</span>
            <div><input type="range" min="0" max="1" step="0.01" :value="settings.threshold"
                @input="change({ threshold: Number($event.target.value) })"><span>J &lt; {{ settings.threshold.toFixed(2) }}</span></div>
          </div>
        </template>

        <div class="container-horizontal">
          <span title="The breaking zone is where the crest will be this time later: ahead of the crest, by the phase speed times this time (closer for short waves, which are slower)">Breaking lead</span>
          <div><input type="range" min="0" max="1" step="0.05" :value="settings.lead"
              @input="change({ lead: Number($event.target.value) })"><span>{{ settings.lead.toFixed(2) }} s</span></div>
        </div>
        <div class="container-horizontal">
          <span title="How long the foam lasts, times the period of the breaking wave (the foam of a small breaker goes sooner than the foam of a large one)">Persistence</span>
          <div><input type="range" min="0.2" max="4" step="0.1" :value="settings.persistence"
              @input="change({ persistence: Number($event.target.value) })"><span>×{{ settings.persistence.toFixed(1) }} period
              ({{ calibration ? fmt(calibration.tauFoam[0], 1) + '–' + fmt(calibration.tauFoam[1], 1) : '–' }} s)</span></div>
        </div>
        <div class="container-horizontal">
          <span title="How much a crest that has broken loses height, shortly after it breaks. 0: the crests keep their shape">Collapse</span>
          <div><input type="range" min="0" max="1" step="0.05" :value="settings.collapse"
              @input="change({ collapse: Number($event.target.value) })"><span>{{ Math.round(settings.collapse * 100) }}%</span></div>
        </div>
        <div class="container-horizontal">
          <span title="While a crest collapses its water surges forward (along the mean direction of the waves), by this factor times the crest height, then drifts back as the crest recovers. 0: off">Forward surge</span>
          <div><input type="range" min="0" max="2" step="0.05" :value="settings.surge"
              @input="change({ surge: Number($event.target.value) })"><span>×{{ settings.surge.toFixed(2) }}</span></div>
        </div>
        <div class="container-horizontal">
          <span title="How much the foam and bubbles left behind damp the waves that pass through them later: they do not break there again. 0: off">Trail damping</span>
          <div><input type="range" min="0" max="1" step="0.05" :value="settings.trailDamping"
              @input="change({ trailDamping: Number($event.target.value) })"><span>{{ Math.round(settings.trailDamping * 100) }}%</span></div>
        </div>
        <div class="container-horizontal">
          <span title="Radius of the collapse and of the trail damping around a breaker, ahead, behind and to the sides, times its wavelength: small breakers soften a small area, large ones a large area">Softening radius</span>
          <div><input type="range" min="0.1" max="1" step="0.05" :value="settings.radius"
              @input="change({ radius: Number($event.target.value) })"><span>×{{ settings.radius.toFixed(2) }} wavelength</span></div>
        </div>
        <div class="container-horizontal">
          <span title="Waves of about 1 to 4 m (the ripple grid) break too, mostly on the front faces of the long waves. Their foam is drawn while they break, without a trail">Small breakers</span>
          <div>
            <label class="checkbox-label"><input type="checkbox" :checked="settings.small !== false"
                @change="change({ small: $event.target.checked })"> From the ripples</label>
          </div>
        </div>
      </template>
      <p v-else class="hint-low">No whitecaps at this quality: they need the FFT sea (Scene &gt; Quality: medium or high).</p>
    </div>

    <!-- SCALES -->
    <table class="scale-table" v-if="available && calibration">
      <thead>
        <tr><th>Breaking waves</th><th>Period</th><th>σ<sub>J</sub></th><th>Breaks below J</th><th>Breaking</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in scaleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ fmt(row.period, 1) }} s</td>
          <td>{{ fmt(row.sigmaJ, 3) }}</td>
          <td>{{ row.threshold > -100 ? fmt(row.threshold, 2) : '–' }}</td>
          <td>{{ pct(row.fraction) }}</td>
        </tr>
      </tbody>
    </table>

    <p class="footnote" v-if="available && calibration">
      Breaking happens at every scale. At each scale the Jacobian of the horizontal displacement (the area of the
      surface relative to still water: 1 on still water, 0 where it folds) is measured on the waves longer than that
      scale (the mipmaps of the FFT maps), predicted {{ fmt(calibration.lead, 2) }} s ahead, so a little ahead of the
      crest. A crest breaks at the largest scale where it falls below the threshold (σ<sub>J</sub>: its standard
      deviation on this sea; Breaking: the expected fraction of the sea, before the damping). The foam follows the
      breaker: as large as the wave, it lasts about its period, its collapse and trail damping reach
      ×{{ fmt(calibration.radius, 2) }} its wavelength, and its bubbles go deeper for larger waves. Small breakers come
      from the ripple grid, strained by the long waves: they break on the long-wave crests. The foam is stored at the
      rest position of the water, so it stays with the water while the crest moves on and leaves a trail; the trail
      damps the waves that pass through it, so breaking limits itself and the sea never turns all white. View &gt;
      Foam by breaking scale (in the ripples above) colours the foam by scale.
    </p>
  </div>
</template>



<script>

import WindSpeed from '../WindSpeed.vue';

export default {
  name: "FoamPanel",
  mounted() {
    window.eventBus.on('OceanEntity_foamChanged', this.onFoamChanged);
    if (window.sceneManager) {
      this.settings = window.sceneManager.getFoamSettings();
      this.calibration = window.sceneManager.getFoam();
      this.available = !!window.sceneManager.ocean.foam;
    }
    // Coverage drawn on the sea, read back from the GPU every 2 s while the panel is open
    this.timer = setInterval(this.measure, 2000);
  },
  unmounted() {
    window.eventBus.off('OceanEntity_foamChanged', this.onFoamChanged);
    clearInterval(this.timer);
  },
  data() {
    return {
      settings: { enabled: true, mode: 'shape', amount: 1, scaleSplit: 'quantile', threshold: 0.6, lead: 0.3, persistence: 1,
        collapse: 0.6, radius: 0.75, trailDamping: 0.5, surge: 2, small: true },
      calibration: null,
      available: true,
      measured: null,
    }
  },
  computed: {
    // Scales of breakers: the small ones (ripples) and the FFT sea, from the shortest
    scaleRows() {
      const c = this.calibration;
      if (!c) return [];
      const name = (b, upper) => isFinite(upper) ? `${this.fmt(b.lambda, b.lambda < 4 ? 1 : 0)}–${this.fmt(upper, upper < 4 ? 1 : 0)} m`
        : `> ${this.fmt(b.lambda, 0)} m`;
      const small = c.small && c.small.enabled ? c.small.scales.map(b => ({ ...b, name: name(b, b.upper) + ' (ripples)' })) : [];
      return [...small, ...c.levels.map(b => ({ ...b, name: name(b, b.upper) }))];
    },
  },
  methods: {
    onFoamChanged: function (e) {
      this.settings = { ...e.settings };
      this.calibration = e.calibration;
      this.available = e.available;
    },
    measure: async function () {
      if (!window.sceneManager || !this.available || !this.settings.enabled) { this.measured = null; return; }
      try {
        this.measured = await window.sceneManager.measureFoamCoverage();
      } catch (e) {
        this.measured = null;
      }
    },
    change: function (partial) {
      Object.assign(this.settings, partial);
      window.eventBus.emit('FoamPanel_changed', partial);
    },
    pct: function (v) {
      if (v == null || !isFinite(v)) return '–';
      return (v * 100).toFixed(v < 0.01 ? 2 : 1) + '%';
    },
    fmt: function (v, d = 2) {
      return (v == null || !isFinite(v)) ? '–' : Number(v).toFixed(d);
    },
  },
  components: {
    'wind-speed': WindSpeed,
  }
}
</script>



<style scoped>
.content {
  padding: 0;
  font-size: small;
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

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.derived {
  margin: 6px 0;
  text-align: center;
}

.scale-table {
  width: 100%;
  border-collapse: collapse;
  background: #fcfcfb;
  border-radius: 15px;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.scale-table th,
.scale-table td {
  padding: 4px 8px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.scale-table th:first-child,
.scale-table td:first-child {
  text-align: left;
}

.scale-table tbody tr {
  border-top: 1px solid #e6e5e0;
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
