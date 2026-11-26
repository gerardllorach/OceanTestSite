<template>
  <div id="sea-state-panel" class="content" :class="{ embedded }">

    <p v-if="!embedded">Generates the sea from a wave spectrum: JONSWAP (Hasselmann et al. 1973), which becomes the Pierson–Moskowitz
      spectrum of a fully developed sea with γ = 1, and a directional spreading: the same at every frequency, or changing with the frequency after buoy measurements.
      <template v-if="s.method == 'gerstner'">Without the FFT (Scene &gt; Quality: Low, or a browser that cannot run it) the
        spectrum is drawn with {{ s.numComponents }} Gerstner waves, computed for every vertex. Fewer waves are faster.</template>
      <template v-else>The spectrum is
      rendered with an FFT (Tessendorf): tens of thousands of trochoidal (Gerstner) components on a grid of wavevectors,
      computed on the GPU and added at the rest position of the surface. Up to two discrete Gerstner waves
      (Sea State &gt; Generation &gt; Swell) can be added on top, e.g. swells from other directions. The spectrum stops where the
      surface ripples take over (the shortest wave of the FFT grid).</template></p>

    <div class="container-vertical options">
      <div class="container-horizontal">
        <span>H<sub>m0</sub></span>
        <div><input type="range" min="0" max="1" step="0.001" :value="hm0ToSlider(s.Hm0)" @input="change({ Hm0: sliderToHm0(Number($event.target.value)) })"><span>{{ fmt(s.Hm0, 2) }} m</span></div>
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
          <span class="knob-value">{{ compass(s.Mdir) }}</span>
        </div>
      </div>
      <!-- Directional spreading: constant (by hand) or changing with the frequency (DirectionalSpreading.js) -->
      <div class="container-horizontal">
        <span title="How the energy of each frequency spreads in direction around the mean direction. Constant: the same spread at every frequency. The others follow buoy measurements: the spread is narrowest near the peak and grows away from it">Directional spreading</span>
        <div><select :value="s.spreadModel" aria-label="Directional spreading" @change="change({ spreadModel: $event.target.value })">
            <option v-for="m in spreadModels" :key="m.id" :value="m.id">{{ m.title }}</option>
          </select></div>
      </div>
      <div class="container-horizontal" v-if="s.spreadModel == 'constant'">
        <span title="Directional spread sigma1 (Kuik et al. 1988), the same at every frequency. Over ~80 degrees the waves come from all directions">Directional spread σ<sub>1</sub></span>
        <div><input type="range" min="5" max="80" step="1" :value="s.Spr1" @input="change({ Spr1: Number($event.target.value) })"><span>{{ fmt(s.Spr1, 0) }}°</span></div>
      </div>
      <div class="container-horizontal" v-if="spreadNeedsWind">
        <span title="Wind 10 m above the sea. These spreadings depend on the inverse wave age U10/cp of the peak: a young, growing sea spreads more than an old one">Wind for the spreading (U<sub>10</sub>)</span>
        <div class="column">
          <label class="checkbox-label" title="The wind of a JONSWAP sea with this Hm0 and Tp (fetch-limited growth laws of Hasselmann et al. 1973)">
            <input type="checkbox" :checked="!(s.spreadWind > 0)" @change="toggleSpreadWindAuto($event.target.checked)"> From Hₘ₀ and Tₚ
          </label>
          <div v-if="s.spreadWind > 0"><input type="range" min="0.5" max="25" step="0.1" :value="s.spreadWind" @input="change({ spreadWind: Number($event.target.value) })"><span><wind-speed :value="s.spreadWind"></wind-speed></span></div>
          <span v-else class="derived"><wind-speed :value="spreadInfo.windSpeed"></wind-speed></span>
        </div>
      </div>
      <div class="container-horizontal" v-if="s.spreadModel == 'goda'">
        <span title="Value of s at the peak (Goda & Suzuki 1975): 10 for wind waves, 25 for swell with a short decay distance, 75 for swell with a long decay distance. Higher: narrower">Peak s<sub>max</sub></span>
        <div class="column">
          <div class="segmented" role="group" aria-label="Typical values of s_max">
            <button v-for="g in godaSmax" :key="g.value" class="clickable" :class="{ 'button-active': s.spreadSmax == g.value }"
              :aria-pressed="s.spreadSmax == g.value" @click="change({ spreadSmax: g.value })">{{ g.title }} ({{ g.value }})</button>
          </div>
          <div><input type="range" min="1" max="100" step="1" :value="s.spreadSmax" @input="change({ spreadSmax: Number($event.target.value) })"><span>{{ fmt(s.spreadSmax, 0) }}</span></div>
        </div>
      </div>
      <div class="container-horizontal" v-if="spreadInfo.peak != null">
        <span title="Directional spread sigma1 (Kuik et al. 1988) of the spreading at a few frequencies (fp: peak frequency)">Resulting σ<sub>1</sub></span>
        <span class="derived">{{ fmt(spreadInfo.low, 0) }}° at 0.8 f<sub>p</sub>, {{ fmt(spreadInfo.peak, 0) }}° at f<sub>p</sub>,
          {{ fmt(spreadInfo.high, 0) }}° at 2 f<sub>p</sub><template v-if="spreadNeedsWind">;&nbsp;U<sub>10</sub>/c<sub>p</sub>&nbsp;{{ fmt(spreadInfo.iwa, 2) }}</template></span>
      </div>
      <div class="container-horizontal">
        <span title="Horizontal displacement of the components (Tessendorf's lambda). 1: every component is a trochoid (Gerstner wave). 0: sinusoids, no horizontal motion">Choppiness λ</span>
        <div><input type="range" min="0" max="1.5" step="0.05" :value="s.choppiness" @input="change({ choppiness: Number($event.target.value) })"><span>{{ fmt(s.choppiness, 2) }}</span></div>
      </div>
      <div class="container-horizontal">
        <span>Realisation</span>
        <div class="knob-row">
          <span>seed {{ s.seed }}</span>
          <button class="clickable" @click="change({ seed: s.seed + 1 })">New realisation <span class="fa">&#xf2f1;</span></button>
        </div>
      </div>
    </div>

    <template v-if="spreadInfo.peak != null && s.spreadModel != 'constant'">
      <p class="chart-title">Directional spread by frequency</p>
      <div class="chart" ref="chart-spread"></div>
    </template>

    <template v-if="fft">
      <div class="stats">
        <span>H<sub>m0</sub> of the FFT sea <b>{{ fmt(fft.realizedHm0, 2) }} m</b></span>
        <span>T<sub>p</sub> <b>{{ fmt(fft.Tp, 2) }} s</b></span>
        <span title="The tile repeats every L metres">Tile <b>{{ fmt(fft.L, 0) }} m</b>, {{ fft.N }}² grid</span>
        <span>Components <b>{{ fft.numComponents }}</b></span>
        <span title="Shortest wave of the grid (4 texels); the ripples start there">Shortest <b>{{ fmt(fft.shortest, 1) }} m</b> ({{ fmt(fft.shortestT, 1) }} s)</span>
        <span v-if="!embedded">Gerstner waves on top <b>{{ numDiscrete }}</b> of 2<template v-if="numDiscrete"> (H<sub>m0</sub> {{ fmt(discreteHm0, 2) }} m)</template></span>
      </div>
      <template v-if="!embedded">
      <p class="chart-title">Spectrum</p>
      <div class="chart" ref="chart-sea"></div>
      <p class="footnote">Area: target variance density S(f). Line: the FFT components, summed in bands of
        {{ binWidth }} Hz. Points: the discrete Gerstner waves added on top, in the same bands. Each component adds its
        variance (H/2)²/2. The sea state analysis shows what the virtual buoy measures of each layer.</p>
      </template>
    </template>
    <template v-else-if="isSpectral">
      <p class="note">The FFT sea needs WebGL2 with float render targets, which this browser does not offer: the
        spectrum is rendered with Gerstner components instead.</p>
      <div class="stats">
        <span>H<sub>m0</sub> of the waves <b>{{ fmt(sea.realizedHm0, 2) }} m</b></span>
        <span>T<sub>p</sub> <b>{{ fmt(sea.settings.Tp, 2) }} s</b></span>
        <span>Band <b>{{ fmt(1 / sea.fHi, 1) }}–{{ fmt(1 / sea.fLo, 1) }} s</b></span>
        <span title="Gerstner crests loop where waves add up if this is over 1">Σ a·k <b>{{ fmt(sea.steepnessSum, 2) }}</b></span>
      </div>
      <p v-if="sea.steepnessSum > 1" class="warning">The waves are steep (Σ a·k &gt; 1): Gerstner crests may loop where
        several waves add up. Use a longer peak period or a lower H<sub>m0</sub>.</p>
      <template v-if="!embedded">
      <p class="chart-title">Spectrum</p>
      <div class="chart" ref="chart-sea"></div>
      <p class="footnote">Line: target variance density S(f). Points: each wave, as its variance (H/2)²/2 divided by the
        width of its frequency band. The sea state analysis compares the virtual buoy with this target.</p>
      </template>
    </template>
  </div>
</template>



<script>

import WindSpeed from '../WindSpeed.vue';

import Knob from '../Knob.vue';

const HM0_MIN = 0.01, HM0_MAX = 10; // m. 10 m: a fully developed sea of 20 m/s (Digital twin). The sea model floors Hm0 at 0.01 m

export default {
  name: "SeaStatePanel",
  // embedded: inside the Generation page (no introduction, no chart: the page shows the spectra of all the layers)
  props: { embedded: Boolean },
  mounted() {
    window.eventBus.on('OceanEntity_wavesChanged', this.onWavesChanged);
    window.addEventListener('resize', this.drawChart);
    window.addEventListener('resize', this.drawSpreadChart);
    this.onWavesChanged();
  },
  unmounted() {
    window.eventBus.off('OceanEntity_wavesChanged', this.onWavesChanged);
    window.removeEventListener('resize', this.drawChart);
    window.removeEventListener('resize', this.drawSpreadChart);
    this.isUnmounted = true;
  },
  data() {
    return {
      s: { method: 'fft', Hm0: 1, Tp: null, gamma: 3.3, Mdir: 0, Spr1: 30, spreadModel: 'constant', spreadWind: null, spreadSmax: 10,
        numComponents: 40, choppiness: 1, seed: 1 },
      spreadModels: window.DirectionalSpreading.SPREAD_MODELS,
      godaSmax: window.DirectionalSpreading.GODA_SMAX,
      spreadInfo: {},
      isSpectral: false,
      sea: null,
      fft: null,
      numDiscrete: 0,
      discreteHm0: 0,
      binWidth: 0.005,
    }
  },
  computed: {
    tpAuto() { return !(this.s.Tp > 0); },
    spreadNeedsWind() { return window.DirectionalSpreading.needsWind(this.s.spreadModel); },
    resolvedTp() { return this.sea ? this.sea.settings.Tp : this.fft ? this.fft.Tp : NaN; },
  },
  methods: {
    // Hm0 slider: square-law scale from 0.01 to 10 m, so the calm seas below 0.1 m get room (0.1 m at 9%, 1 m at 31%)
    hm0ToSlider: function (Hm0) { return Math.sqrt(Math.max(0, Hm0 - HM0_MIN) / (HM0_MAX - HM0_MIN)); },
    sliderToHm0: function (pos) {
      const h = HM0_MIN + (HM0_MAX - HM0_MIN) * pos * pos;
      const step = h < 1 ? 0.01 : 0.05;
      return Number((Math.round(h / step) * step).toFixed(3));
    },
    onWavesChanged: function () {
      if (!window.sceneManager) return;
      const p = window.sceneManager.ocean.oceanParams.oceanParameters;
      this.s = { method: p.method, Hm0: p.Hm0, Tp: p.Tp, gamma: p.gamma, Mdir: p.Mdir, Spr1: p.Spr1,
        spreadModel: p.spreadModel, spreadWind: p.spreadWind, spreadSmax: p.spreadSmax,
        numComponents: p.numComponents, choppiness: p.choppiness, seed: p.seed };
      const sea = window.sceneManager.getSea();
      this.isSpectral = !!sea;
      this.sea = sea ? { settings: { ...sea.settings }, realizedHm0: sea.realizedHm0, fLo: sea.fLo, fHi: sea.fHi, steepnessSum: sea.steepnessSum } : null;
      this.seaFull = sea; // Not reactive: waves and bins for the chart
      const fft = window.sceneManager.getFFTSea();
      this.fftFull = fft;
      this.fft = fft ? { realizedHm0: fft.realizedHm0, Tp: fft.settings.Tp, L: fft.L, N: fft.N, numComponents: fft.numComponents,
        shortest: 2 * Math.PI / fft.kCut, shortestT: 1 / fft.fCut } : null;
      const discrete = window.sceneManager.getDiscreteWaves();
      this.discreteWaves = discrete;
      this.numDiscrete = fft ? discrete.length : 0;
      this.discreteHm0 = 4 * Math.sqrt(discrete.reduce((m, w) => m + Math.pow(w.hm0 / 2, 2) / 2, 0));
      // Directional spreading of the sea that was generated
      const src = fft || sea, sp = src && src.spreading;
      this.spreadingFull = sp || null; // Not reactive: functions
      this.spreadInfo = sp ? { windSpeed: src.settings.spreadWindResolved, iwa: sp.inverseWaveAge,
        low: sp.sigma1(0.8 * sp.fp), peak: sp.sigma1(sp.fp), high: sp.sigma1(2 * sp.fp), fCutRatio: fft ? fft.fCut * fft.settings.Tp : NaN } : {};
      this.$nextTick(() => { this.drawChart(); this.drawSpreadChart(); });
    },
    // Wind of the spreading: from Hm0 and Tp (null), or by hand starting from the current one
    toggleSpreadWindAuto: function (auto) {
      this.change({ spreadWind: auto ? null : Math.round((this.spreadInfo.windSpeed || 10) * 10) / 10 });
    },
    // sigma1 of the spreading against f / fp
    drawSpreadChart: function () {
      const sp = this.spreadingFull, el = this.$refs['chart-spread'];
      if (!sp || !el || this.isUnmounted) return;
      const C = window.AnalysisCharts.COLORS;
      const x = Array.from({ length: 251 }, (_, i) => 0.4 + 2.6 * i / 250);
      const markers = [{ x: 1, label: 'fp' }];
      if (this.spreadInfo.fCutRatio > 0.4 && this.spreadInfo.fCutRatio < 3) markers.push({ x: this.spreadInfo.fCutRatio, label: 'Ripples' });
      window.AnalysisCharts.lineChart(el, {
        height: 170,
        x: { label: 'Frequency / peak frequency (f / fp)', domain: [0.4, 3] },
        y: { label: 'Spread σ1 (°)', domain: [0, 85] },
        series: [{ name: 'σ1', x, y: x.map(r => sp.sigma1(r * sp.fp)), color: C.series[0], unit: '°', digits: 1 }],
        markers,
        directLabels: false,
        tooltipX: v => `${v.toFixed(2)} fp (${(1 / (v * sp.fp)).toFixed(1)} s)`,
      });
    },
    toggleTpAuto: function (auto) {
      this.change({ Tp: auto ? null : Math.round((this.resolvedTp || 8) * 10) / 10 });
    },
    change: function (partial) {
      Object.assign(this.s, partial);
      window.eventBus.emit('SeaStatePanel_changed', { ...this.s });
    },
    drawChart: function () {
      if (this.fftFull) return this.drawFFTChart();
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
    // FFT sea: target, the FFT components and the discrete waves, summed in frequency bands
    drawFFTChart: function () {
      const fft = this.fftFull;
      if (!fft || this.isUnmounted || !this.$refs['chart-sea'] || !window.sceneManager) return;
      const C = window.AnalysisCharts.COLORS, bw = this.binWidth;
      const fMax = Math.min(1.2, Math.max(fft.fCut, 2.5 / fft.settings.Tp) * 1.1);
      const nb = Math.ceil(fMax / bw);
      const bin = list => {
        const out = new Float64Array(nb);
        list.forEach(w => { const b = Math.floor((1 / w.T) / bw); if (b >= 0 && b < nb) out[b] += Math.pow(w.hm0 / 2, 2) / 2 / bw; });
        return out;
      };
      const fx = Array.from({ length: nb }, (_, b) => (b + 0.5) * bw);
      const target = window.sceneManager.getSeaSpectralDensity(fx);
      const fftBins = bin(fft.components);
      const discreteBins = bin(this.discreteWaves || []);
      const series = [
        { name: 'Target spectrum', x: fx, y: target, color: C.series[0], type: 'area', unit: 'm²/Hz', digits: 4 },
        { name: 'FFT sea', x: fx, y: Array.from(fftBins), color: C.series[1], unit: 'm²/Hz', digits: 4, width: 1.5 },
      ];
      if (this.discreteWaves && this.discreteWaves.length)
        series.push({ name: 'Discrete Gerstner waves', x: fx, y: Array.from(discreteBins, v => v > 0 ? v : NaN), color: C.series[2], type: 'points', unit: 'm²/Hz', digits: 4 });
      window.AnalysisCharts.lineChart(this.$refs['chart-sea'], {
        height: 220,
        x: { label: 'Frequency (Hz)', domain: [0, fMax] },
        y: { label: 'Energy density (m²/Hz)' },
        series,
        markers: [{ x: 1 / fft.settings.Tp, label: 'Tp' }, { x: fft.fCut, label: 'Ripples' }],
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
  max-width: 760px;
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

/* Fixed width, so the knob does not move while dragging as the text changes ("5° N" vs "158° SSE") */
.knob-value {
  width: 9ch;
  text-align: left;
  font-variant-numeric: tabular-nums;
}

.knob-row button {
  padding: 2px 12px;
}

.segmented {
  gap: 6px;
  flex-wrap: wrap;
}

.segmented button {
  padding: 2px 12px;
}

.methods {
  margin: 0 0 8px;
  padding-left: 18px;
}

.derived {
  font-weight: 600;
}

select {
  border-radius: 5px;
  font-size: small;
  max-width: 100%;
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
