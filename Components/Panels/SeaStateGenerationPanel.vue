<template>
  <div id="sea-state-generation-panel" class="content">

    <p>The sea surface is the sum of three layers: the <b>FFT sea</b> (a wave spectrum), up to two <b>swells</b>
      (discrete Gerstner waves) and the <b>ripples</b> (the short waves, down to a few centimetres). The spectra at the
      end of the page show the three together.</p>

    <!-- FFT SEA -->
    <h3 class="layer-title"><i class="layer-key" :style="{ background: colors[0] }"></i>FFT sea</h3>
    <p class="layer-intro">JONSWAP spectrum (Hasselmann et al. 1973; γ = 1 is Pierson–Moskowitz) with a directional
      spreading, constant or changing with the frequency (references at the end of the page), rendered with an FFT (Tessendorf): tens of thousands of trochoidal components computed on
      the GPU. It stops where the ripples take over.</p>
    <sea-state-panel embedded></sea-state-panel>

    <!-- SWELL -->
    <h3 class="layer-title"><i class="layer-key" :style="{ background: colors[1] }"></i>Swell</h3>
    <p class="layer-intro">Up to two discrete Gerstner waves on top of the FFT sea, e.g. swells from other directions
      (height up to 10 m, period up to 20 s). You can also drag and drop a .json file with the waves anywhere on the
      page; export them to see the format.</p>
    <discrete-waves-panel embedded></discrete-waves-panel>

    <!-- RIPPLES -->
    <h3 class="layer-title"><i class="layer-key" :style="{ background: colors[2] }"></i>Ripples</h3>
    <p class="layer-intro">The short waves, from where the FFT sea stops (~4 m) down to a few centimetres, on a second
      FFT cascade. Their slopes follow the Cox &amp; Munk (1954) relation between wind speed and sea surface roughness.</p>
    <surface-ripples-panel embedded></surface-ripples-panel>

    <!-- WHITECAPS -->
    <h3 class="layer-title">Whitecaps</h3>
    <p class="layer-intro">Foam left by the breaking crests of the FFT sea. A crest breaks where it squeezes the surface
      too much (Jacobian of the horizontal displacement); how often depends on the wind, after the whitecap coverage of
      Monahan &amp; O'Muircheartaigh (1980).</p>
    <foam-panel></foam-panel>

    <!-- SPECTRA -->
    <h3 class="layer-title">Spectrum of the generated sea</h3>
    <div class="stats">
      <span>H<sub>m0</sub> <b>{{ fmt(hm0.total, 2) }} m</b></span>
      <span><i class="layer-key" :style="{ background: colors[0] }"></i>FFT sea {{ fmt(hm0.sea, 2) }} m</span>
      <span><i class="layer-key" :style="{ background: colors[1] }"></i>Swell {{ fmt(hm0.swell, 2) }} m</span>
      <span><i class="layer-key" :style="{ background: colors[2] }"></i>Ripples {{ fmt(hm0.ripples * 100, 1) }} cm</span>
    </div>

    <!-- Polar -->
    <p class="chart-title">Polar spectrum</p>
    <div class="stats">
      <span>Peak in this range <b>{{ fmt(1 / polarPeak.f, polarPeak.f > 1 ? 2 : 1) }} s @ {{ fmt(polarPeak.dir, 0) }}° {{ compass(polarPeak.dir) }}</b></span>
      <div class="segmented" role="group" aria-label="Colour scale">
        <span class="segmented-label">Colours</span>
        <button v-for="scale in ['log', 'linear']" :key="scale" class="clickable" :class="{ 'button-active': polarScale == scale }"
          :aria-pressed="polarScale == scale" @click="setPolarScale(scale)">{{ scale == 'log' ? 'Log' : 'Linear' }}</button>
      </div>
    </div>
    <div class="chart polar" ref="chart-polar"></div>
    <div class="polar-levels" role="group" aria-label="Period range">
      <button v-for="(level, i) in polarLevels" :key="level.id" class="clickable"
        :class="{ 'button-active': polarLevel == i }" @click="setPolarLevel(i)">
        <span>{{ level.title }} ({{ level.minPeriod }}–{{ level.maxPeriod }} s)</span>
      </button>
    </div>
    <p class="footnote">Input directional spectrum E(f, θ) of the three layers, in m²/Hz/deg: where the energy comes from
      (angle) and its period (radius, from {{ level.maxPeriod }} s on the inner circle to {{ level.minPeriod }} s at the
      rim, linear in frequency). Click the inner half of the plot to zoom in to longer periods, the outer half to zoom
      out. The FFT sea and the ripples are the continuous spectra their grids sample. A swell is a single wave, all its
      energy at one period and one direction: it fills one cell ({{ fmt(polarInfo.df, 4) }} Hz × {{ polarInfo.binWidth }}°)
      and is usually the strongest one. <template v-if="polarScale == 'log'">Log colours span {{ logDecades }} decades
      below the strongest cell of the range shown, so that the weaker layers stay visible.</template><template v-else>
      Colours are scaled to the strongest cell of the range shown; cells under 1% of it are not painted.</template>
      The sea state analysis measures the same surface with a virtual buoy.</p>

    <!-- Frequency spectrum -->
    <p class="chart-title">Frequency spectrum</p>
    <div class="segmented chart-options" role="group" aria-label="Axes">
      <span class="segmented-label">Axes</span>
      <button v-for="scale in ['log', 'linear']" :key="scale" class="clickable" :class="{ 'button-active': spectrumScale == scale }"
        :aria-pressed="spectrumScale == scale" @click="setSpectrumScale(scale)">{{ scale == 'log' ? 'Log–log' : 'Linear' }}</button>
    </div>
    <div class="chart" ref="chart-spectrum"></div>
    <p class="footnote">Variance density S(f) of each layer. The area under the curves is the variance m0, so
      H<sub>m0</sub> = 4·√m0. Each swell is a line: its point is its variance (H/2)²/2 in a band of
      1/{{ swellBandSeconds }} Hz, the frequency resolution of the sea state analysis, where the buoy measures it.
      <template v-if="spectrumScale == 'log'">The ripples carry little variance (centimetres) but most of the slope:
        their saturation range falls as f<sup>−5</sup>.</template>
      <template v-else>On linear axes the ripples are too small to see: use log–log.</template></p>

    <!-- REFERENCES -->
    <h3 class="layer-title">References: directional spreading</h3>
    <ul class="references">
      <li><b>Constant σ<sub>1</sub></b>: cos<sup>2s</sup>(θ/2) with the same s at every frequency, s = 2/σ<sub>1</sub>² − 1.
        Longuet-Higgins, M. S., Cartwright, D. E. &amp; Smith, N. D. (1963). Observations of the directional spectrum of
        sea waves using the motions of a floating buoy. In <i>Ocean Wave Spectra</i>, Prentice-Hall, 111–136.
        σ<sub>1</sub> as in Kuik, A. J., van Vledder, G. P. &amp; Holthuijsen, L. H. (1988). A method for the routine
        analysis of pitch-and-roll buoy wave data. <i>J. Phys. Oceanogr.</i> 18, 1020–1034.</li>
      <li><b>Mitsuyasu et al. (1975)</b>: cos<sup>2s</sup>(θ/2), s = s<sub>p</sub>(f/f<sub>p</sub>)<sup>5</sup> below the
        peak and s<sub>p</sub>(f/f<sub>p</sub>)<sup>−2.5</sup> above, s<sub>p</sub> = 11.5 (U<sub>10</sub>/c<sub>p</sub>)<sup>−2.5</sup>.
        Mitsuyasu, H., Tasai, F., Suhara, T., Mizuno, S., Ohkusu, M., Honda, T. &amp; Rikiishi, K. (1975). Observations
        of the directional spectrum of ocean waves using a cloverleaf buoy. <i>J. Phys. Oceanogr.</i> 5, 750–760.</li>
      <li><b>Hasselmann et al. (1980)</b>: cos<sup>2s</sup>(θ/2), s = 6.97 (f/f<sub>p</sub>)<sup>4.06</sup> below
        1.05 f<sub>p</sub> and 9.77 (f/f<sub>p</sub>)<sup>μ</sup> above, μ = −2.33 − 1.45 (U<sub>10</sub>/c<sub>p</sub> − 1.17).
        Hasselmann, D. E., Dunckel, M. &amp; Ewing, J. A. (1980). Directional wave spectra observed during JONSWAP 1973.
        <i>J. Phys. Oceanogr.</i> 10, 1264–1280.</li>
      <li><b>Donelan et al. (1985)</b>: sech²(βθ), β = 2.61 (f/f<sub>p</sub>)<sup>1.3</sup> for 0.56 &lt; f/f<sub>p</sub> &lt; 0.95,
        2.28 (f/f<sub>p</sub>)<sup>−1.3</sup> for 0.95 ≤ f/f<sub>p</sub> &lt; 1.6, 1.24 otherwise.
        Donelan, M. A., Hamilton, J. &amp; Hui, W. H. (1985). Directional spectra of wind-generated waves.
        <i>Phil. Trans. R. Soc. Lond. A</i> 315, 509–562.</li>
      <li><b>Banner (1990)</b>, above 1.6 f<sub>p</sub>: β = 10^(−0.4 + 0.8393 exp(−0.567 ln((f/f<sub>p</sub>)²))).
        Banner, M. L. (1990). Equilibrium spectra of wind waves. <i>J. Phys. Oceanogr.</i> 20, 966–984.</li>
      <li><b>Goda &amp; Suzuki (1975)</b>: the Mitsuyasu shape with a chosen peak value s<sub>max</sub>: 10 for wind
        waves, 25 for swell with a short decay distance, 75 for swell with a long decay distance.
        Goda, Y. &amp; Suzuki, Y. (1975). Computation of refraction and diffraction of sea waves with Mitsuyasu's
        directional spectrum. <i>Tech. Note Port Harbour Res. Inst.</i> 230 (in Japanese); in English in Goda, Y.,
        <i>Random Seas and Design of Maritime Structures</i>, World Scientific.</li>
      <li>Wind of the wind-dependent spreadings, when not given: the wind of a JONSWAP sea with the same H<sub>m0</sub> and
        T<sub>p</sub>, from the fetch-limited growth laws of Hasselmann, K. et al. (1973). Measurements of wind-wave growth
        and swell decay during the Joint North Sea Wave Project (JONSWAP). <i>Dtsch. Hydrogr. Z.</i> A8(12).</li>
    </ul>
  </div>
</template>



<script>

import SeaStatePanel from './SeaStatePanel.vue';
import DiscreteWavesPanel from './DiscreteWavesPanel.vue';
import SurfaceRipplesPanel from './SurfaceRipplesPanel.vue';
import FoamPanel from './FoamPanel.vue';

export default {
  name: "SeaStateGenerationPanel",
  mounted() {
    // The waves change the ripples too (slope budget), which come right after: one refresh for both
    window.eventBus.on('OceanEntity_wavesChanged', this.scheduleRefresh);
    window.eventBus.on('OceanEntity_ripplesChanged', this.scheduleRefresh);
    window.addEventListener('resize', this.draw);
    this.refresh();
  },
  unmounted() {
    window.eventBus.off('OceanEntity_wavesChanged', this.scheduleRefresh);
    window.eventBus.off('OceanEntity_ripplesChanged', this.scheduleRefresh);
    window.removeEventListener('resize', this.draw);
    this.isUnmounted = true;
  },
  data() {
    return {
      colors: ['#2a78d6', '#eb6834', '#1baf7a'], // Fixed per layer: sea, swell, ripples (AnalysisCharts.COLORS.series)
      hm0: { total: NaN, sea: NaN, swell: NaN, ripples: NaN },
      // Period ranges of the polar spectrum (zoom levels): maxPeriod on the inner circle, minPeriod on the rim
      polarLevels: [
        { id: 'ripples', title: 'Ripples', minPeriod: 0.2, maxPeriod: 2, periods: [0.2, 0.25, 0.3, 0.5, 2] },
        { id: 'high', title: 'High freq', minPeriod: 2, maxPeriod: 20, periods: [2, 3, 4, 6, 8, 12, 20] },
        { id: 'normal', title: 'Normal', minPeriod: 4, maxPeriod: 20, periods: [4, 6, 8, 12, 20] },
        { id: 'swell', title: 'Swell only', minPeriod: 8, maxPeriod: 20, periods: [8, 10, 12, 15, 20] },
      ],
      polarLevel: 2,
      polarScale: 'log',
      logDecades: 4,
      polarPeak: {},
      polarInfo: {},
      spectrumScale: 'log',
      swellBandSeconds: 256, // Segment length of the analysis (OceanAnalysis.segmentSeconds)
    }
  },
  computed: {
    level() { return this.polarLevels[this.polarLevel]; },
  },
  methods: {
    // Several events in a row (waves, then ripples) -> one refresh
    scheduleRefresh: function () {
      if (this.refreshPending) return;
      this.refreshPending = true;
      this.$nextTick(() => { this.refreshPending = false; this.refresh(); });
    },
    refresh: function () {
      if (this.isUnmounted || !window.sceneManager) return;
      this.polarCache = [];
      const v = window.sceneManager.getInputLayerVariances();
      const H = m0 => 4 * Math.sqrt(Math.max(0, m0));
      this.hm0 = { total: H(v.sea + v.swell + v.ripples), sea: H(v.sea), swell: H(v.swell), ripples: H(v.ripples) };
      this.draw();
    },
    draw: function () {
      this.drawPolar();
      this.drawSpectrum();
    },

    // POLAR SPECTRUM
    polarForLevel: function (i) {
      if (!this.polarCache) this.polarCache = [];
      if (!this.polarCache[i]) {
        const level = this.polarLevels[i];
        this.polarCache[i] = window.sceneManager.getInputDirectionalSpectrum({
          fmin: 1 / level.maxPeriod, fmax: 1 / level.minPeriod, numFreqs: 60, numDirections: 72 });
      }
      return this.polarCache[i];
    },
    drawPolar: function () {
      if (this.isUnmounted || !window.sceneManager || !this.$refs['chart-polar']) return;
      const level = this.level, polar = this.polarForLevel(this.polarLevel);
      this.polarPeak = { ...polar.peak };
      this.polarInfo = { df: polar.df, binWidth: polar.binWidth };
      window.AnalysisCharts.polarChart(this.$refs['chart-polar'], polar, {
        fmin: 1 / level.maxPeriod, fmax: 1 / level.minPeriod, periods: level.periods,
        centerLabel: level.minPeriod + '–' + level.maxPeriod + ' s',
        logDecades: this.polarScale == 'log' ? this.logDecades : 0,
        canZoomIn: this.polarLevel < this.polarLevels.length - 1,
        canZoomOut: this.polarLevel > 0,
        onZoom: step => this.setPolarLevel(this.polarLevel + step),
      });
    },
    setPolarLevel: function (i) {
      this.polarLevel = Math.max(0, Math.min(this.polarLevels.length - 1, i));
      this.drawPolar();
    },
    setPolarScale: function (scale) {
      this.polarScale = scale;
      this.drawPolar();
    },

    // FREQUENCY SPECTRUM
    setSpectrumScale: function (scale) {
      this.spectrumScale = scale;
      this.drawSpectrum();
    },
    drawSpectrum: function () {
      const el = this.$refs['chart-spectrum'];
      if (this.isUnmounted || !window.sceneManager || !el) return;
      const log = this.spectrumScale == 'log';
      const probe = window.sceneManager.getInputFrequencySpectrum([]);
      const sb = probe.seaBand, rb = probe.rippleBand;
      const fTop = Math.max(rb ? rb[1] : 0, sb ? sb[1] : 0, ...probe.swell.map(w => w.f), 0.5);
      const fLow = 0.03;
      const domain = log ? [fLow, fTop * 1.1] : [0, Math.max(sb ? sb[1] : 0.6, ...probe.swell.map(w => w.f)) * 1.05];
      const n = 600;
      const freqs = Array.from({ length: n }, (_, i) => log
        ? Math.exp(Math.log(domain[0]) + (Math.log(domain[1]) - Math.log(domain[0])) * i / (n - 1))
        : domain[0] + (domain[1] - domain[0]) * (i + 0.5) / n);
      const spec = window.sceneManager.getInputFrequencySpectrum(freqs);
      const swellBand = 1 / this.swellBandSeconds;
      const swellY = spec.swell.map(w => w.variance / swellBand);
      const nanIfZero = v => v > 0 ? v : NaN;
      const sea = spec.sea.map(nanIfZero), ripples = spec.ripples.map(nanIfZero);
      const peak = Math.max(0, ...spec.sea, ...spec.ripples, ...swellY);
      const exp = v => v.toExponential(2);
      const series = [
        { name: 'FFT sea', x: freqs, y: sea, color: this.colors[0], type: 'area', unit: 'm²/Hz', format: exp },
        { name: 'Swell', x: spec.swell.map(w => w.f), y: swellY, color: this.colors[1], type: 'points', radius: 4, unit: 'm²/Hz', format: exp },
        { name: 'Ripples', x: freqs, y: ripples, color: this.colors[2], type: 'area', unit: 'm²/Hz', format: exp },
      ];
      const markers = [];
      const fft = window.sceneManager.getFFTSea();
      if (fft) markers.push({ x: 1 / fft.settings.Tp, label: 'Tp' });
      if (rb) markers.push({ x: rb[0], label: 'Ripples' });
      window.AnalysisCharts.lineChart(el, {
        height: 240,
        x: log
          ? { label: 'Frequency (Hz)', type: 'log', domain, tickValues: [0.05, 0.1, 0.2, 0.5, 1, 2, 5].filter(t => t >= domain[0] && t <= domain[1]), tickFormat: d => String(d) }
          : { label: 'Frequency (Hz)', domain },
        y: log
          ? { label: 'Energy density (m²/Hz)', type: 'log', domain: peak > 0 ? [peak * 1e-8, peak * 3] : [1e-8, 1] }
          : { label: 'Energy density (m²/Hz)' },
        series,
        markers,
        directLabels: false,
        hoverAll: true,
        tooltipX: v => `${v.toFixed(3)} Hz (${(1 / v).toFixed(v > 1 ? 2 : 1)} s)`,
      });
    },

    compass: function (deg) {
      return isFinite(deg) && window.AnalysisCharts ? window.AnalysisCharts.compass(deg) : '';
    },
    fmt: function (v, d = 2) {
      return (v == null || !isFinite(v)) ? '–' : Number(v).toFixed(d);
    },
  },
  components: {
    'sea-state-panel': SeaStatePanel,
    'discrete-waves-panel': DiscreteWavesPanel,
    'surface-ripples-panel': SurfaceRipplesPanel,
    'foam-panel': FoamPanel,
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

/* One heading per layer, with the colour key of the layer in the spectra */
.layer-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 22px 0 4px;
  padding-top: 14px;
  border-top: 1px solid rgba(var(--darkBlueRGB), 0.15);
  color: var(--darkBlue);
  font-size: 0.95rem;
  font-weight: 600;
}

.layer-key {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 4px;
  flex-shrink: 0;
}

.layer-intro {
  margin: 0 0 10px;
}

/* globalStyle.css paints every span white with a shadow (for the blue panels); not on light backgrounds */
.stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 18px;
  margin-bottom: 10px;
}

.stats span,
.segmented-label {
  color: #0b0b0b;
  text-shadow: none;
  padding: 0;
  font-size: inherit;
}

.segmented {
  display: flex;
  align-items: center;
  gap: 6px;
}

.segmented button {
  padding: 2px 12px;
}

.chart-options {
  margin-bottom: 6px;
}

.chart-title {
  font-weight: 600;
  margin: 14px 0 4px;
}

.chart {
  background: #fcfcfb;
  border-radius: 15px;
  padding: 6px 4px;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
}

.chart.polar {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px;
}

.polar-levels {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-top: 10px;
}

.polar-levels button {
  padding: 4px 14px;
}

.footnote {
  color: #3d3c39;
  font-size: x-small;
  margin-top: 8px;
}

.references {
  color: #3d3c39;
  font-size: x-small;
  padding-left: 18px;
}

.references li {
  margin-bottom: 6px;
}
</style>
