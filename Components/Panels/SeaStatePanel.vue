<template>
  <div id="sea-state-panel" class="content">

    <p>Generates the discrete waves as a random realisation of a wave spectrum: JONSWAP (Hasselmann et al. 1973),
      which becomes the Pierson–Moskowitz spectrum of a fully developed sea with γ = 1, and a cos<sup>2s</sup>
      directional spreading. Each wave has its own frequency (random inside its band) and direction, so the sea is
      short-crested and does not repeat. The waves stop at {{ fmt(splitPeriod, 1) }} s, where the surface ripples take over.</p>

    <div class="container-vertical options">
      <div class="container-horizontal">
        <span>H<sub>m0</sub></span>
        <div><input type="range" min="0.1" max="8" step="0.05" :value="s.Hm0" @input="change({ Hm0: Number($event.target.value) })"><span>{{ fmt(s.Hm0, 2) }} m</span></div>
      </div>
      <div class="container-horizontal">
        <span>Peak period T<sub>p</sub></span>
        <div class="column">
          <label class="checkbox-label" title="Peak period of a fully developed sea with this Hm0 (Pierson-Moskowitz)">
            <input type="checkbox" :checked="tpAuto" @change="toggleTpAuto($event.target.checked)"> Fully developed
          </label>
          <div v-if="!tpAuto"><input type="range" min="2" max="20" step="0.1" :value="s.Tp" @input="change({ Tp: Number($event.target.value) })"><span>{{ fmt(s.Tp, 1) }} s</span></div>
          <span v-else class="derived">{{ fmt(resolvedTp, 1) }} s</span>
        </div>
      </div>
      <div class="container-horizontal">
        <span title="Peak enhancement: 1 = Pierson-Moskowitz (fully developed), 3.3 = mean JONSWAP (growing sea)">Peak enhancement γ</span>
        <div><input type="range" min="1" max="7" step="0.1" :value="s.gamma" @input="change({ gamma: Number($event.target.value) })"><span>{{ fmt(s.gamma, 1) }}</span></div>
      </div>
      <div class="container-horizontal">
        <span>Mean direction (from)</span>
        <div class="knob-row">
          <knob size="50px" :value="s.Mdir" @change="v => change({ Mdir: Math.round(v) })"></knob>
          <span>{{ compass(s.Mdir) }}</span>
        </div>
      </div>
      <div class="container-horizontal">
        <span title="Directional spread sigma1 (Kuik et al. 1988). Over ~80 degrees the waves come from all directions">Directional spread</span>
        <div><input type="range" min="5" max="80" step="1" :value="s.Spr1" @input="change({ Spr1: Number($event.target.value) })"><span>{{ fmt(s.Spr1, 0) }}°</span></div>
      </div>
      <div class="container-horizontal">
        <span title="Every wave is evaluated for every vertex: more waves cost more rendering time">Waves</span>
        <div><input type="range" min="5" max="80" step="1" :value="s.numComponents" @input="change({ numComponents: Number($event.target.value) })"><span>{{ s.numComponents }}</span></div>
      </div>
      <div class="container-horizontal">
        <span>Realisation</span>
        <div class="knob-row">
          <span>seed {{ s.seed }}</span>
          <button class="clickable" @click="change({ seed: s.seed + 1 })">New realisation <span class="fa">&#xf2f1;</span></button>
        </div>
      </div>
    </div>

    <p v-if="!isSpectral" class="note">The current waves were set by hand (discrete waves panel or a .json file).
      Moving any control generates a new spectral sea.</p>
    <template v-else>
      <div class="stats">
        <span>H<sub>m0</sub> of the waves <b>{{ fmt(sea.realizedHm0, 2) }} m</b></span>
        <span>T<sub>p</sub> <b>{{ fmt(sea.settings.Tp, 2) }} s</b></span>
        <span>Band <b>{{ fmt(1 / sea.fHi, 1) }}–{{ fmt(1 / sea.fLo, 1) }} s</b></span>
        <span title="Gerstner crests loop where waves add up if this is over 1">Σ a·k <b>{{ fmt(sea.steepnessSum, 2) }}</b></span>
      </div>
      <p v-if="sea.steepnessSum > 1" class="warning">The waves are steep (Σ a·k &gt; 1): Gerstner crests may loop where
        several waves add up. Use a longer peak period or a lower H<sub>m0</sub>.</p>
      <p class="chart-title">Spectrum</p>
      <div class="chart" ref="chart-sea"></div>
      <p class="footnote">Line: target variance density S(f). Points: each wave, as its variance (H/2)²/2 divided by the
        width of its frequency band. The sea state analysis compares the virtual buoy with this target.</p>
    </template>
  </div>
</template>



<script>

import Knob from '../Knob.vue';

export default {
  name: "SeaStatePanel",
  mounted() {
    window.eventBus.on('OceanEntity_wavesChanged', this.onWavesChanged);
    window.addEventListener('resize', this.drawChart);
    this.onWavesChanged();
  },
  unmounted() {
    window.eventBus.off('OceanEntity_wavesChanged', this.onWavesChanged);
    window.removeEventListener('resize', this.drawChart);
    this.isUnmounted = true;
  },
  data() {
    return {
      s: { Hm0: 1, Tp: null, gamma: 3.3, Mdir: 0, Spr1: 30, numComponents: 40, seed: 1 },
      isSpectral: false,
      sea: null,
      splitPeriod: 1.64,
    }
  },
  computed: {
    tpAuto() { return !(this.s.Tp > 0); },
    resolvedTp() { return this.sea ? this.sea.settings.Tp : NaN; },
  },
  methods: {
    onWavesChanged: function () {
      if (!window.sceneManager) return;
      const p = window.sceneManager.ocean.oceanParams.oceanParameters;
      this.s = { Hm0: p.Hm0, Tp: p.Tp, gamma: p.gamma, Mdir: p.Mdir, Spr1: p.Spr1, numComponents: p.numComponents, seed: p.seed };
      const sea = window.sceneManager.getSea();
      this.isSpectral = !!sea;
      this.sea = sea ? { settings: { ...sea.settings }, realizedHm0: sea.realizedHm0, fLo: sea.fLo, fHi: sea.fHi, steepnessSum: sea.steepnessSum } : null;
      this.seaFull = sea; // Not reactive: waves and bins for the chart
      this.$nextTick(() => this.drawChart());
    },
    toggleTpAuto: function (auto) {
      this.change({ Tp: auto ? null : Math.round((this.resolvedTp || 8) * 10) / 10 });
    },
    change: function (partial) {
      Object.assign(this.s, partial);
      window.eventBus.emit('SeaStatePanel_changed', { ...this.s });
    },
    drawChart: function () {
      const sea = this.seaFull;
      if (!sea || this.isUnmounted || !this.$refs['chart-sea'] || !window.sceneManager) return;
      const C = window.AnalysisCharts.COLORS;
      const fMax = Math.min(1.2, sea.fHi * 1.15);
      const fx = [];
      for (let i = 1; i <= 300; i++) fx.push(fMax * i / 300);
      const target = window.sceneManager.getSeaSpectralDensity(fx);
      window.AnalysisCharts.lineChart(this.$refs['chart-sea'], {
        height: 220,
        x: { label: 'Frequency (Hz)', domain: [0, fMax] },
        y: { label: 'Energy density (m²/Hz)' },
        series: [
          { name: 'Target spectrum', x: fx, y: target, color: C.series[0], type: 'area', unit: 'm²/Hz', digits: 4 },
          { name: 'Waves', x: sea.bins.map(b => b.f), y: sea.waves.map((w, i) => Math.pow(w.hm0 / 2, 2) / 2 / sea.bins[i].df),
            color: C.series[1], type: 'points', unit: 'm²/Hz', digits: 4 },
        ],
        markers: [{ x: 1 / sea.settings.Tp, label: 'Tp' }],
        directLabels: false,
        tooltipX: v => `${v.toFixed(3)} Hz (${(1 / v).toFixed(1)} s)`,
      });
    },
    compass: function (deg) {
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
  max-width: 760px;
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

.knob-row {
  gap: 12px;
}

.knob-row button {
  padding: 2px 12px;
}

.derived {
  font-weight: 600;
}

.note {
  background: #fcfcfb;
  border-radius: 10px;
  padding: 6px 12px;
}

.warning {
  background: var(--red);
  border-radius: 10px;
  padding: 6px 12px;
}

/* globalStyle.css paints every span white with a shadow (for the blue panels); not on light backgrounds */
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin-bottom: 10px;
}

.stats span {
  color: #0b0b0b;
  text-shadow: none;
  padding: 0;
  font-size: inherit;
}

.chart-title {
  font-weight: 600;
  margin: 10px 0 4px;
}

.chart {
  background: #fcfcfb;
  border-radius: 15px;
  padding: 6px 4px;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
}

.footnote {
  color: #3d3c39;
  font-size: x-small;
  margin-top: 8px;
}
</style>
