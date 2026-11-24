<template>

  <div id="sea-state-analysis-panel" ref="sea-state-analysis-panel" class="content">

    <p>A virtual directional wave buoy is moored at position 0,0. It follows the water surface and records its
      vertical (heave), north and west displacements, as a Datawell Waverider does. The record is analysed the way
      <a href="https://cdip.ucsd.edu/" target="_blank">CDIP</a> analyses buoy data: Welch spectra, directional Fourier
      coefficients (a1, b1, a2, b2), Maximum Entropy Method for the polar spectrum, and zero-crossing statistics.
    </p>

    <!-- RECORD SETTINGS -->
    <div class="container-vertical options">
      <div class="container-horizontal">
        <span>Duration</span>
        <div><input type="range" min="30" max="180" step="10" :value="duration" @input="duration = Number($event.target.value)" @change="update"><span>{{ formatDuration(duration) }}</span></div>
      </div>
      <div class="container-horizontal">
        <span>Sampling rate</span>
        <div><input type="range" step="0.1" min="0.5" max="5" :value="samplingRate" @input="samplingRate = Number($event.target.value)" @change="update"><span>{{ samplingRate }} Hz</span></div>
      </div>
      <div class="container-horizontal">
        <label class="checkbox-label" title="Analyse the wave parameters as encoded in the 8-bit texture sent to the GPU (what is rendered), instead of the exact values in the table">
          <input type="checkbox" :checked="matchGPU" @change="matchGPU = $event.target.checked; update()"> Match rendered (8-bit) wave parameters
        </label>
        <div class="buttons">
          <button class="clickable" @click="update">Re-run <span class="fa">&#xf2f1;</span></button>
          <button class="clickable" @click="exportAnalysis" :disabled="!hasResult">Export (.json) <span class="fa">&#xf56d;</span></button>
        </div>
      </div>
    </div>

    <p v-if="hasResult" class="record-info">
      {{ info.numSamples }} samples · {{ info.numSegments }} Welch segments of {{ info.segmentSeconds }} s (Hann, 50% overlap) ·
      Δf {{ fmt(info.df, 4) }} Hz · {{ info.degreesOfFreedom }} degrees of freedom · Nyquist {{ fmt(info.nyquist, 2) }} Hz
    </p>
    <p class="warning" v-for="w in warnings" :key="w">{{ w }}</p>
    <p v-if="!hasResult && message">{{ message }}</p>

    <!-- TABS -->
    <div v-if="hasResult" class="oa-tabs" role="tablist">
      <button v-for="t in tabs" :key="t.id" role="tab" class="clickable" :class="{ 'oa-tab-sel': tab == t.id }"
        :aria-selected="tab == t.id" @click="selectTab(t.id)">{{ t.title }}</button>
    </div>

    <!-- OVERVIEW -->
    <div v-if="hasResult" v-show="tab == 'overview'">
      <div class="cards">
        <div class="card">
          <div class="card-title">Significant wave height</div>
          <div class="card-value">{{ fmt(bulk.Hm0, 2) }} <small>m</small></div>
        </div>
        <div class="card">
          <div class="card-title">Peak period</div>
          <div class="card-value">{{ fmt(bulk.Tp, 1) }} <small>s</small></div>
        </div>
        <div class="card">
          <div class="card-title">Peak direction</div>
          <div class="card-value">
            <svg class="dir-arrow" viewBox="-10 -10 20 20" :style="{ transform: 'rotate(' + (bulk.Dp + 180) + 'deg)' }"
              aria-hidden="true"><path d="M0,-8 L5,4 L0,1 L-5,4 Z" /></svg>
            {{ fmt(bulk.Dp, 0) }}° <small>{{ compass(bulk.Dp) }}</small>
          </div>
          <div class="card-note">Waves from {{ compass(bulk.Dp) }}, arrow points where they travel</div>
        </div>
        <div class="card">
          <div class="card-title">Average period</div>
          <div class="card-value">{{ fmt(bulk.Tm01, 1) }} <small>s</small></div>
        </div>
      </div>

      <p class="footnote">
        <b>Analytical</b>: measured by the virtual buoy (spectrum and zero-crossing analysis of its displacements).
        <b>Theoretical</b>: calculated directly from the discrete input waves with linear wave theory
        ({{ matchGPU ? 'as encoded for the GPU' : 'exact values of the wave table' }}). Each wave is a sinusoid of
        amplitude H/2, so it adds a variance of (H/2)²/2 at frequency 1/T, from its direction.
        Statistics of individual waves (zero-crossing) have no theoretical equivalent for a sum of a few waves (–).
      </p>
      <p v-if="theoryInterfering > 0" class="warning">{{ theoryInterfering }} group(s) of waves share exactly the same
        period{{ matchGPU ? ' (the 8-bit encoding rounds periods to steps of 0.078 s)' : '' }}. They interfere, so their
        combined height and direction depend on their phases. The theoretical values include this interference.</p>

      <div v-for="group in paramGroups" :key="group.title" class="param-group">
        <table class="param-table">
          <thead>
            <tr>
              <th colspan="2" class="param-group-title">{{ group.title }}</th>
              <th class="param-value">Analytical</th>
              <th class="param-value">Theoretical</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in group.rows" :key="row.symbol">
              <td class="param-symbol" v-html="row.symbol"></td>
              <td class="param-desc">{{ row.name }}<div v-if="row.cf" class="param-cf">{{ row.cf }}</div></td>
              <td class="param-value">{{ row.measured }} <small v-if="row.measured != '–'">{{ row.unit }}</small></td>
              <td class="param-value">{{ row.theoretical }} <small v-if="row.theoretical != '–'">{{ row.unit }}</small></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="footnote">Directions are degrees clockwise from north and describe where waves come from (CDIP convention).
        Mean directions are energy-weighted circular means, atan2(Σ E·sin θ, Σ E·cos θ). Small differences between the
        columns come from the record length and spectral resolution, and from the non-linear interaction of the Gerstner waves.</p>
    </div>

    <!-- DISPLACEMENT -->
    <div v-if="hasResult" v-show="tab == 'displacement'">
      <div class="container-horizontal options compact">
        <span>Window</span>
        <div>
          <select :value="dispWindow" @change="dispWindow = Number($event.target.value); dispStart = Math.min(dispStart, Math.max(0, info.seconds - dispWindow)); drawDisplacement()">
            <option v-for="w in [60, 120, 300, 600]" :key="w" :value="w">{{ w }} s</option>
            <option :value="info.seconds">Full record</option>
          </select>
        </div>
        <span>Start</span>
        <div><input type="range" min="0" :max="Math.max(0, info.seconds - dispWindow)" step="1" :value="dispStart"
            @input="dispStart = Number($event.target.value); drawDisplacement()"><span>{{ dispStart }} s</span></div>
      </div>
      <div class="stats">
        <span>Vertical RMS <b>{{ fmt(dispStats.zRms, 2) }} m</b></span>
        <span>Vertical extremes <b>+{{ fmt(dispStats.zMax, 2) }} / {{ fmt(dispStats.zMin, 2) }} m</b></span>
        <span>Horizontal RMS <b>{{ fmt(dispStats.hRms, 2) }} m</b></span>
        <span>Samples <b>{{ info.numSamples }}</b></span>
      </div>
      <p class="chart-title">Vertical (Z)</p>
      <div class="chart" ref="chart-heave"></div>
      <p class="chart-title">South / North (X)</p>
      <div class="chart" ref="chart-north"></div>
      <p class="chart-title">East / West (Y)</p>
      <div class="chart" ref="chart-west"></div>
      <p class="footnote">Displacements are excursions from the average position. North, west and up are positive.</p>
    </div>

    <!-- WAVE HISTOGRAM -->
    <div v-if="hasResult" v-show="tab == 'histogram'">
      <div class="stats">
        <span>Waves <b>{{ zc.numWaves }}</b></span>
        <span>H<sub>1/3</sub> <b>{{ fmt(zc.H3, 2) }} m</b></span>
        <span>H<sub>1/10</sub> <b>{{ fmt(zc.H10, 2) }} m</b></span>
        <span>H<sub>max</sub> <b>{{ fmt(zc.Hmax, 2) }} m</b></span>
      </div>
      <p class="chart-title">Individual wave heights (zero up-crossing)</p>
      <div class="chart" ref="chart-hist-height"></div>
      <p class="chart-title">Individual wave periods (zero up-crossing)</p>
      <div class="chart" ref="chart-hist-period"></div>
      <p class="footnote">The dashed line is the Rayleigh distribution for the measured H<sub>rms</sub>, expected for a
        narrow-banded random sea. A few discrete waves do not form a random sea, so expect differences.</p>
    </div>

    <!-- WAVE SPECTRUM -->
    <div v-if="hasResult" v-show="tab == 'spectrum'">
      <div class="stats">
        <span>Peak period <b>{{ fmt(bulk.Tp, 1) }} s</b> ({{ fmt(bulk.fp, 3) }} Hz)</span>
        <span>Peak direction <b>{{ fmt(bulk.Dp, 0) }}° {{ compass(bulk.Dp) }}</b></span>
        <span>Spectrum Hs <b>{{ fmt(bulk.Hm0, 2) }} m</b></span>
        <span>Spread at peak <b>{{ fmt(bulk.spreadPeak, 0) }}°</b></span>
      </div>
      <p class="chart-title">Energy density
        <button class="unit-toggle clickable" @click="toggleSpectrumUnits"
          title="Switch between density per frequency (m²/Hz) and per period (m²/s). You can also click the y-axis.">
          {{ spectrumUnits == 'Hz' ? 'm²/Hz' : 'm²/s' }} <span class="fa">&#xf0ec;</span></button>
      </p>
      <div class="chart" ref="chart-spectrum"></div>
      <p class="chart-title">Mean direction per band (waves from)</p>
      <div class="chart" ref="chart-spectrum-dir"></div>
      <p class="footnote">The area under the curve is the variance m0, so Hs = 4·√m0. Click the y-axis to switch between
        m²/Hz against frequency and m²/s against period (S(T) = S(f)/T²).</p>
    </div>

    <!-- POLAR SPECTRUM -->
    <div v-if="hasResult" v-show="tab == 'polar'">
      <div class="stats">
        <span>Peak in this range <b>{{ fmt(1 / polarPeak.f, 1) }} s @ {{ fmt(polarPeak.dir, 0) }}° {{ compass(polarPeak.dir) }}</b></span>
        <span>Spectrum Hs <b>{{ fmt(bulk.Hm0, 2) }} m</b></span>
        <span>Frequency bands <b>{{ polarInfo.bands }}</b> of {{ fmt(polarInfo.df, 4) }} Hz</span>
        <span>Direction bins <b>{{ polarInfo.dirs }}</b> at {{ polarInfo.binWidth }}°</span>
      </div>
      <div class="chart polar" ref="chart-polar"></div>
      <!-- Period range (zoom). Also: click the inner half of the plot to zoom in, the outer half to zoom out -->
      <div class="polar-levels" role="group" aria-label="Period range">
        <button v-for="(level, i) in polarLevels" :key="level.id" class="clickable"
          :class="{ 'button-active': polarLevel == i }" @click="setPolarLevel(i)">
          <span>{{ level.title }} ({{ level.minPeriod }}–{{ level.maxPeriod }} s)</span>
        </button>
      </div>
      <p class="footnote">Radius runs from {{ polarLevels[polarLevel].maxPeriod }} s on the inner circle to
        {{ polarLevels[polarLevel].minPeriod }} s at the rim (linear in frequency). Click the inner half of the plot to zoom in to longer periods, the outer half to zoom out.
        Angles show where wave energy comes from. Colour: Maximum Entropy Method (Lygre &amp; Krogstad 1986) estimate of
        energy density in m²/Hz/deg, scaled to the strongest cell of the period range shown. Cells under 1% of it are not
        painted.</p>
    </div>

    <!-- FOURIER COEFFICIENTS -->
    <div v-if="hasResult" v-show="tab == 'fourier'">
      <div class="stats">
        <span>At peak: a1 <b>{{ fmt(bulk.a1p, 3) }}</b></span>
        <span>b1 <b>{{ fmt(bulk.b1p, 3) }}</b></span>
        <span>a2 <b>{{ fmt(bulk.a2p, 3) }}</b></span>
        <span>b2 <b>{{ fmt(bulk.b2p, 3) }}</b></span>
      </div>
      <p class="chart-title">Normalised directional Fourier coefficients</p>
      <div class="chart" ref="chart-fourier"></div>
      <p class="chart-title">Directional spread σ1 (Kuik et al. 1988)</p>
      <div class="chart" ref="chart-spread"></div>
      <p class="chart-title">Check factor (horizontal / vertical displacement)</p>
      <div class="chart" ref="chart-check"></div>
      <p class="footnote">a1 = Q<sub>zn</sub>/√(C<sub>zz</sub>(C<sub>nn</sub>+C<sub>ee</sub>)), b1 = Q<sub>ze</sub>/√(C<sub>zz</sub>(C<sub>nn</sub>+C<sub>ee</sub>)),
        a2 = (C<sub>nn</sub>−C<sub>ee</sub>)/(C<sub>nn</sub>+C<sub>ee</sub>), b2 = 2C<sub>ne</sub>/(C<sub>nn</sub>+C<sub>ee</sub>).
        Mean direction θ1 = atan2(b1, a1), spread σ1 = √(2(1 − √(a1²+b1²))). Gerstner waves are deep-water waves, so the
        check factor should be 1. Bands with less than 1% of the peak energy are hidden.</p>
    </div>

  </div>

</template>






<script>

export default {
  name: "SeaStateAnalysisPanel",
  created() {
    this.oceanAnalysis = new window.OceanAnalysis(this.samplingRate, this.duration * 60);
    this.result = null; // Not reactive: large typed arrays
    this.polarCache = [];
  },
  mounted() {
    // Events
    window.eventBus.on('DiscreteWavesPanel_setDiscreteWaves', this.onWavesChanged);
    window.addEventListener('resize', this.windowResize);
    // If scene exists, analyse waves
    if (window.sceneManager != undefined)
      this.update();
    else
      this.message = 'Waiting for the 3D scene to load...';
  },
  unmounted() {
    window.eventBus.off('DiscreteWavesPanel_setDiscreteWaves', this.onWavesChanged);
    window.removeEventListener('resize', this.windowResize);
    // A redraw may still be pending (resize, tab change) when the panel closes
    cancelAnimationFrame(this.resizeFrame);
    this.isUnmounted = true;
  },
  data() {
    return {
      duration: 60, // minutes
      samplingRate: 3,
      matchGPU: true,
      hasResult: false,
      message: '',
      warnings: [],
      tab: 'overview',
      tabs: [
        { id: 'overview', title: 'Overview' },
        { id: 'displacement', title: 'Displacement' },
        { id: 'histogram', title: 'Wave histogram' },
        { id: 'spectrum', title: 'Wave spectrum' },
        { id: 'polar', title: 'Polar spectrum' },
        { id: 'fourier', title: 'Fourier coefficients' },
      ],
      // Small reactive summaries for the template (the full result is kept in this.result)
      info: {},
      bulk: {},
      zc: {},
      paramGroups: [],
      theoryInterfering: 0,
      polarPeak: {},
      polarInfo: {},
      // Period ranges of the polar spectrum (zoom levels): maxPeriod on the inner circle, minPeriod on the rim
      // One ring per frequency bin of the spectrum (its resolution), 72 direction bins of 5 degrees (as CDIP)
      polarLevels: [
        { id: 'high', title: 'High freq', minPeriod: 2, maxPeriod: 20, periods: [2, 3, 4, 6, 8, 12, 20], numDirections: 72 },
        { id: 'normal', title: 'Normal', minPeriod: 4, maxPeriod: 20, periods: [4, 6, 8, 12, 20], numDirections: 72 },
        { id: 'swell', title: 'Swell only', minPeriod: 8, maxPeriod: 20, periods: [8, 10, 12, 15, 20], numDirections: 72 },
      ],
      polarLevel: 1,
      dispWindow: 120,
      dispStart: 0,
      dispStats: {},
      spectrumUnits: 'Hz',
    }
  },
  methods: {

    // EVENTS
    onWavesChanged: function (waves) {
      this.update(waves);
    },

    // USER INPUT
    selectTab: function (id) {
      this.tab = id;
      this.$nextTick(() => this.drawActiveTab());
    },
    toggleSpectrumUnits: function () {
      this.spectrumUnits = this.spectrumUnits == 'Hz' ? 's' : 'Hz';
      this.drawSpectrum();
    },

    // ANALYSIS
    update: function (waves) {
      if (!Array.isArray(waves)) {
        if (window.sceneManager == undefined) return;
        waves = window.sceneManager.getDiscreteWaves();
      }
      waves = waves.filter(w => w && w.hm0 > 0 && w.T > 0);
      if (waves.length == 0) {
        this.hasResult = false;
        this.message = 'There are no waves to analyse.';
        return;
      }

      const r = this.oceanAnalysis.analyze(waves, {
        samplingRate: this.samplingRate, seconds: this.duration * 60, matchGPU: this.matchGPU });
      this.result = r;

      const s = r.settings;
      this.info = { ...s, segmentSeconds: Math.round(s.segmentLength / s.samplingRate) };
      this.bulk = { ...r.bulk };
      const { waves: _ignored, ...zcStats } = r.zeroCrossing;
      this.zc = zcStats;
      this.polarCache = []; // Polar spectrum per zoom level, computed when shown
      this.warnings = r.expected.aliased.length ?
        [`${r.expected.aliased.length} wave(s) have periods shorter than ${(1 / s.nyquist).toFixed(2)} s (2 / sampling rate) and are aliased. Increase the sampling rate.`] : [];

      // Plot ranges, from the frequency that holds 99.5% of the energy
      const spec = r.spectrum;
      let cumulative = 0, f995 = spec.freq[spec.freq.length - 1];
      for (let k = 1; k < spec.freq.length; k++) {
        cumulative += spec.Czz[k] * spec.df;
        if (cumulative >= 0.995 * r.bulk.m0) { f995 = spec.freq[k]; break; }
      }
      this.plotFmax = Math.min(s.nyquist, Math.max(0.6, 1.15 * f995));
      this.updatePolarInfo();

      this.paramGroups = this.buildParamGroups(r);
      this.theoryInterfering = r.theoretical ? r.theoretical.interferingLines : 0;
      this.dispStart = Math.min(this.dispStart, Math.max(0, Math.floor(s.seconds - this.dispWindow)));
      this.hasResult = true;
      this.$nextTick(() => this.drawActiveTab());
    },

    // Parameter table: analytical (measured by the buoy) and theoretical (from the input waves) columns
    buildParamGroups: function (r) {
      const b = r.bulk, z = r.zeroCrossing, t = r.theoretical || {}, f = this.fmt;
      const NA = '–';
      const row = (symbol, measured, theoretical, unit, name, cf) => ({ symbol, measured, theoretical, unit, name, cf });
      const pair = (x, y, d) => (isFinite(x) && isFinite(y)) ? f(x, d) + ', ' + f(y, d) : NA;
      const peak2D = (T, dir) => (isFinite(T) && isFinite(dir)) ? f(T, 1) + ' s @ ' + f(dir, 0) + '°' : NA;
      return [
        { title: 'Wave heights', rows: [
          row('H<sub>m0</sub>', f(b.Hm0, 2), f(t.Hm0, 2), 'm', 'Spectral significant wave height, 4·√m0', 'sea_surface_wave_significant_height'),
          row('H<sub>1/3</sub>', f(z.H3, 2), NA, 'm', 'Mean height of the highest third of waves (zero-crossing)', ''),
          row('H<sub>1/10</sub>', f(z.H10, 2), NA, 'm', 'Mean height of the highest tenth of waves (zero-crossing)', 'sea_surface_wave_mean_height_of_highest_tenth'),
          row('H<sub>max</sub>', f(z.Hmax, 2), NA, 'm', 'Maximum wave height (zero-crossing)', 'sea_surface_wave_maximum_height'),
          row('H<sub>mean</sub>', f(z.Hmean, 2), NA, 'm', 'Mean wave height (zero-crossing)', 'sea_surface_wave_mean_height'),
          row('H<sub>rms</sub>', f(z.Hrms, 2), NA, 'm', 'Root-mean-square wave height (zero-crossing)', ''),
          row('η<sub>max</sub>', f(z.maxCrest, 2), NA, 'm', 'Maximum crest height', 'sea_surface_wave_maximum_crest_height'),
          row('η<sub>min</sub>', f(z.minTrough, 2), NA, 'm', 'Maximum trough depth', 'sea_surface_wave_maximum_trough_depth'),
        ]},
        { title: 'Wave periods', rows: [
          row('T<sub>p</sub>', f(b.Tp, 2), f(t.Tp, 2), 's', 'Peak period, at the spectral maximum', 'sea_surface_wave_period_at_variance_spectral_density_maximum'),
          row('T<sub>m01</sub>', f(b.Tm01, 2), f(t.Tm01, 2), 's', 'Mean period m0/m1 (CDIP average period Ta)', 'sea_surface_wave_mean_period_from_variance_spectral_density_first_frequency_moment'),
          row('T<sub>m02</sub>', f(b.Tm02, 2), f(t.Tm02, 2), 's', 'Spectral zero-crossing period √(m0/m2)', 'sea_surface_wave_mean_period_from_variance_spectral_density_second_frequency_moment'),
          row('T<sub>m-10</sub>', f(b.Tm_10, 2), f(t.Tm_10, 2), 's', 'Energy period m-1/m0', 'sea_surface_wave_mean_period_from_variance_spectral_density_inverse_frequency_moment'),
          row('T<sub>z</sub>', f(z.Tz, 2), NA, 's', 'Mean zero up-crossing period (zero-crossing)', ''),
          row('T<sub>1/3</sub>', f(z.T3, 2), NA, 's', 'Mean period of the highest third of waves (zero-crossing)', 'sea_surface_wave_significant_period'),
          row('T<sub>1/10</sub>', f(z.T10, 2), NA, 's', 'Mean period of the highest tenth of waves (zero-crossing)', 'sea_surface_wave_mean_period_of_highest_tenth'),
          row('T<sub>max</sub>', f(z.Tmax, 2), NA, 's', 'Period of the highest wave (zero-crossing)', 'sea_surface_wave_period_of_highest_wave'),
        ]},
        { title: 'Wave direction', rows: [
          row('D<sub>p</sub>', f(b.Dp, 1), f(t.Dp, 1), '°', 'Peak direction: mean direction at the spectral peak, atan2(b1, a1)', 'sea_surface_wave_from_direction_at_variance_spectral_density_maximum'),
          row('M<sub>dir</sub>', f(b.Mdir, 1), f(t.Mdir, 1), '°', 'Mean direction over the whole spectrum, atan2(b̄1, ā1)', 'sea_surface_wave_from_direction'),
          row('σ<sub>p</sub>', f(b.spreadPeak, 1), f(t.spreadPeak, 1), '°', 'Directional spread at the spectral peak, σ1 = √(2(1−r1))', 'sea_surface_wave_directional_spread_at_variance_spectral_density_maximum'),
          row('σ', f(b.spreadMean, 1), f(t.spreadMean, 1), '°', 'Directional spread over the whole spectrum, from ā1, b̄1', 'sea_surface_wave_directional_spread'),
          row('2D peak', peak2D(1 / r.polar.peak.f, r.polar.peak.dir),
            t.largestWave ? peak2D(t.largestWave.T, t.largestWave.dir) : NA, '',
            'Maximum of the directional spectrum (MEM). Theoretical: the largest input wave', ''),
          row('a1, b1', pair(b.a1p, b.b1p, 3), pair(t.a1p, t.b1p, 3), '', 'First-order Fourier coefficients at the peak', ''),
          row('a2, b2', pair(b.a2p, b.b2p, 3), pair(t.a2p, t.b2p, 3), '', 'Second-order Fourier coefficients at the peak', ''),
          row('ā1, b̄1', pair(b.a1, b.b1, 3), pair(t.a1, t.b1, 3), '', 'First-order coefficients, energy-weighted over the spectrum', ''),
          row('ā2, b̄2', pair(b.a2, b.b2, 3), pair(t.a2, t.b2, 3), '', 'Second-order coefficients, energy-weighted over the spectrum', ''),
        ]},
        { title: 'Spectral shape', rows: [
          row('m<sub>0</sub>', f(b.m0, 4), f(t.m0, 4), 'm²', 'Variance of the sea surface (zeroth spectral moment)', ''),
          row('f<sub>p</sub>', f(b.fp, 4), f(t.fp, 4), 'Hz', 'Peak frequency', ''),
          row('ε', f(b.bandwidthEpsilon, 3), f(t.bandwidthEpsilon, 3), '', 'Spectral width, √(1 − m2²/(m0·m4)) (Cartwright & Longuet-Higgins)', ''),
          row('ν', f(b.bandwidthNu, 3), f(t.bandwidthNu, 3), '', 'Spectral narrowness, √(m0·m2/m1² − 1) (Longuet-Higgins)', ''),
          row('Q<sub>p</sub>', f(b.peakedness, 2), NA, '', 'Goda peakedness parameter (undefined for a spectrum of single lines)', ''),
          row('S<sub>p</sub>', f(b.steepness, 4), f(t.steepness, 4), '', 'Significant steepness, 2π·Hm0/(g·Tp²)', ''),
          row('Check', f(b.checkFactorPeak, 3), f(t.checkFactorPeak, 3), '', 'Check factor at the peak, √((Cnn+Cee)/Czz): horizontal / vertical, 1 for deep water', ''),
        ]},
      ];
    },

    // DRAWING
    drawActiveTab: function () {
      if (!this.result || this.isUnmounted) return;
      if (this.tab == 'displacement') this.drawDisplacement();
      else if (this.tab == 'histogram') this.drawHistograms();
      else if (this.tab == 'spectrum') this.drawSpectrum();
      else if (this.tab == 'polar') this.drawPolar();
      else if (this.tab == 'fourier') this.drawFourier();
    },

    drawDisplacement: function () {
      const r = this.result;
      if (!r || this.tab != 'displacement') return;
      const fs = r.buoy.samplingRate;
      const i0 = Math.floor(this.dispStart * fs);
      const i1 = Math.min(r.buoy.heave.length, i0 + Math.round(this.dispWindow * fs));
      const t = [];
      for (let i = i0; i < i1; i++) t.push(i / fs);

      // Statistics over the full record
      const { heave, north, west } = r.buoy;
      let zz = 0, hh = 0, zMax = -Infinity, zMin = Infinity, maxAbs = 0;
      for (let i = 0; i < heave.length; i++) {
        zz += heave[i] * heave[i];
        hh += north[i] * north[i] + west[i] * west[i];
        zMax = Math.max(zMax, heave[i]); zMin = Math.min(zMin, heave[i]);
        maxAbs = Math.max(maxAbs, Math.abs(heave[i]), Math.abs(north[i]), Math.abs(west[i]));
      }
      this.dispStats = { zRms: Math.sqrt(zz / heave.length), hRms: Math.sqrt(hh / heave.length), zMax, zMin };

      // Same scale on the three axes, so the orbits can be compared
      const lim = Math.ceil(maxAbs * 1.1 * 10) / 10 || 1;
      const draw = (ref, values, name) => window.AnalysisCharts.lineChart(this.$refs[ref], {
        height: 170,
        x: { label: 'Time (s)', domain: [t[0], t[t.length - 1]] },
        y: { label: 'Displacement (m)', domain: [-lim, lim], ticks: 4 },
        series: [{ name, x: t, y: Array.from(values.subarray(i0, i1)), color: window.AnalysisCharts.COLORS.series[0], unit: 'm', digits: 2, width: 1.5 }],
        tooltipX: v => v.toFixed(1) + ' s',
      });
      draw('chart-heave', heave, 'Vertical');
      draw('chart-north', north, 'North');
      draw('chart-west', west, 'West');
    },

    drawHistograms: function () {
      const r = this.result, zc = r.zeroCrossing;
      if (!zc.waves.length) return;
      const C = window.AnalysisCharts.COLORS;
      const histogram = (values, binWidth) => {
        const nb = Math.max(1, Math.ceil(Math.max(...values) / binWidth) + 1);
        const x0 = [], x1 = [], y = [];
        for (let i = 0; i < nb; i++) { x0.push(i * binWidth); x1.push((i + 1) * binWidth); y.push(0); }
        values.forEach(v => y[Math.min(nb - 1, Math.floor(v / binWidth))]++);
        return { x0, x1, y };
      };

      // Heights, with the Rayleigh distribution
      const heights = zc.waves.map(w => w.H);
      const hBin = niceStep(zc.Hmax / 20);
      const hh = histogram(heights, hBin);
      const rx = [], ry = [];
      for (let i = 0; i <= 200; i++) {
        const H = i * hh.x1[hh.x1.length - 1] / 200;
        rx.push(H);
        ry.push(heights.length * hBin * 2 * H / (zc.Hrms * zc.Hrms) * Math.exp(-(H * H) / (zc.Hrms * zc.Hrms)));
      }
      window.AnalysisCharts.lineChart(this.$refs['chart-hist-height'], {
        height: 220,
        x: { label: 'Wave height H (m)', domain: [0, hh.x1[hh.x1.length - 1]] },
        y: { label: 'Number of waves' },
        bars: { ...hh, color: C.series[0], name: 'Waves', unit: '' },
        series: [{ name: 'Rayleigh', x: rx, y: ry, color: C.ink2, dashed: true, width: 1.5, digits: 1 }],
        markers: [{ x: zc.H3, label: 'H1/3' }, { x: zc.H10, label: 'H1/10' }, { x: zc.Hmax, label: 'Hmax' }],
        legend: false, directLabels: false,
        tooltipX: v => v.toFixed(2) + ' m',
      });

      // Periods
      const periods = zc.waves.map(w => w.T);
      const tBin = niceStep(Math.max(...periods) / 20);
      const th = histogram(periods, tBin);
      window.AnalysisCharts.lineChart(this.$refs['chart-hist-period'], {
        height: 200,
        x: { label: 'Wave period T (s)', domain: [0, th.x1[th.x1.length - 1]] },
        y: { label: 'Number of waves' },
        bars: { ...th, color: C.series[0], name: 'Waves', unit: '' },
        markers: [{ x: zc.Tz, label: 'Tz' }, { x: zc.T3, label: 'T1/3' }],
        tooltipX: v => v.toFixed(1) + ' s',
      });
    },

    // Spectrum in the selected units: m2/Hz vs frequency, or m2/s vs period
    spectrumAxis: function () {
      const r = this.result, spec = r.spectrum;
      const ks = [];
      for (let k = 1; k < spec.freq.length; k++) if (spec.freq[k] <= this.plotFmax) ks.push(k);
      if (this.spectrumUnits == 'Hz') {
        return { ks, x: ks.map(k => spec.freq[k]), density: ks.map(k => spec.Czz[k]),
          axis: { label: 'Frequency (Hz)', domain: [0, this.plotFmax] }, unit: 'm²/Hz',
          tooltipX: v => `${v.toFixed(3)} Hz (${(1 / v).toFixed(1)} s)` };
      }
      const rev = ks.slice().reverse(); // Ascending period
      const tMax = 30, tMin = Math.max(1 / this.plotFmax, 0.5);
      return { ks: rev, x: rev.map(k => 1 / spec.freq[k]), density: rev.map(k => spec.Czz[k] * spec.freq[k] * spec.freq[k]),
        axis: { label: 'Period (s)', type: 'log', domain: [tMin, tMax],
          tickValues: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30].filter(T => T >= tMin && T <= tMax), tickFormat: d3.format('d') },
        unit: 'm²/s', tooltipX: v => `${v.toFixed(1)} s (${(1 / v).toFixed(3)} Hz)` };
    },

    drawSpectrum: function () {
      const r = this.result;
      if (!r || this.tab != 'spectrum') return;
      const C = window.AnalysisCharts.COLORS;
      const a = this.spectrumAxis();
      const peakX = this.spectrumUnits == 'Hz' ? r.bulk.fp : r.bulk.Tp;
      window.AnalysisCharts.lineChart(this.$refs['chart-spectrum'], {
        height: 240,
        x: a.axis,
        y: { label: 'Energy density (' + a.unit + ')' },
        series: [{ name: 'Energy density', x: a.x, y: a.density, color: C.series[0], type: 'area', unit: a.unit, digits: 4 }],
        markers: [{ x: peakX, label: 'Tp ' + r.bulk.Tp.toFixed(1) + ' s' }],
        onYAxisClick: this.toggleSpectrumUnits,
        yAxisTitle: 'Click to switch between m²/Hz and m²/s',
        tooltipX: a.tooltipX,
      });

      // Mean direction per band, only where there is energy
      const maxS = Math.max(...a.ks.map(k => r.spectrum.Czz[k]));
      const dirs = a.ks.map(k => r.spectrum.Czz[k] > 0.01 * maxS ? r.directional.meanDir[k] : NaN);
      window.AnalysisCharts.lineChart(this.$refs['chart-spectrum-dir'], {
        height: 180,
        x: a.axis,
        y: { label: 'Direction from (°)', domain: [0, 360], tickValues: [0, 90, 180, 270, 360], tickFormat: d => ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W', 360: 'N' })[d] },
        series: [{ name: 'Mean direction', x: a.x, y: dirs, color: C.series[0], type: 'points', unit: '°', digits: 0 }],
        tooltipX: a.tooltipX,
      });
    },

    drawPolar: function () {
      const r = this.result;
      if (!r || this.tab != 'polar') return;
      const level = this.polarLevels[this.polarLevel];
      window.AnalysisCharts.polarChart(this.$refs['chart-polar'], this.polarForLevel(this.polarLevel), {
        fmin: 1 / level.maxPeriod, fmax: 1 / level.minPeriod, periods: level.periods,
        centerLabel: level.minPeriod + '–' + level.maxPeriod + ' s',
        canZoomIn: this.polarLevel < this.polarLevels.length - 1,
        canZoomOut: this.polarLevel > 0,
        onZoom: step => this.setPolarLevel(this.polarLevel + step),
      });
    },
    // Zoom level of the polar spectrum: 0 = high frequencies ... last = swell only
    setPolarLevel: function (i) {
      this.polarLevel = Math.max(0, Math.min(this.polarLevels.length - 1, i));
      this.updatePolarInfo();
      this.drawPolar();
    },
    // Directional spectrum with the bands of a zoom level (cached until the next analysis)
    polarForLevel: function (i) {
      if (!this.polarCache[i]) {
        const level = this.polarLevels[i];
        this.polarCache[i] = this.oceanAnalysis.directionalSpectrum(this.result.spectrum, {
          numDirections: level.numDirections, fmin: 1 / level.maxPeriod, fmax: 1 / level.minPeriod });
      }
      return this.polarCache[i];
    },
    // Readouts above the polar plot, for the zoom level shown
    updatePolarInfo: function () {
      if (!this.result) return;
      const p = this.polarForLevel(this.polarLevel);
      const level = this.polarLevels[this.polarLevel];
      this.polarPeak = { ...p.peak };
      this.polarInfo = { dirs: p.dirs.length, binWidth: p.binWidth, df: p.df,
        bands: Array.from(p.freq).filter(f => f >= 1 / level.maxPeriod && f <= 1 / level.minPeriod).length };
    },

    drawFourier: function () {
      const r = this.result;
      if (!r || this.tab != 'fourier') return;
      const C = window.AnalysisCharts.COLORS, spec = r.spectrum, d = r.directional;
      const ks = [];
      for (let k = 1; k < spec.freq.length; k++) if (spec.freq[k] <= this.plotFmax) ks.push(k);
      const maxS = Math.max(...ks.map(k => spec.Czz[k]));
      const mask = (arr) => ks.map(k => spec.Czz[k] > 0.01 * maxS ? arr[k] : NaN);
      const x = ks.map(k => spec.freq[k]);
      const axis = { label: 'Frequency (Hz)', domain: [0, this.plotFmax] };
      const tooltipX = v => `${v.toFixed(3)} Hz (${(1 / v).toFixed(1)} s)`;
      window.AnalysisCharts.lineChart(this.$refs['chart-fourier'], {
        height: 240, x: axis, y: { label: 'Coefficient', domain: [-1, 1] },
        series: ['a1', 'b1', 'a2', 'b2'].map((name, i) => ({ name, x, y: mask(d[name]), color: C.series[i], digits: 3 })),
        hlines: [{ y: 0 }],
        tooltipX,
      });
      window.AnalysisCharts.lineChart(this.$refs['chart-spread'], {
        height: 180, x: axis, y: { label: 'Spread (°)' },
        series: [{ name: 'σ1', x, y: mask(d.spread), color: C.series[0], unit: '°', digits: 1 }],
        tooltipX,
      });
      window.AnalysisCharts.lineChart(this.$refs['chart-check'], {
        height: 180, x: axis, y: { label: 'Check factor', domain: [0, 2], ticks: 4 },
        series: [{ name: 'Check factor', x, y: mask(d.checkFactor), color: C.series[0], digits: 3 }],
        hlines: [{ y: 1, label: 'deep water' }],
        tooltipX,
      });
    },

    // EXPORT
    exportAnalysis: function () {
      const r = this.result;
      if (!r) return;
      const toArray = a => Array.from(a, v => isFinite(v) ? +v.toPrecision(6) : null);
      const data = {
        generated: new Date().toISOString(),
        conventions: 'Directions in degrees clockwise from north, where waves come from. Buoy at rest position (0,0).',
        settings: r.settings,
        waves: r.waves,
        bulk: r.bulk,
        theoretical: r.theoretical,
        zeroCrossing: { ...this.zc, waves: r.zeroCrossing.waves },
        spectrum: {
          frequency: toArray(r.spectrum.freq), energyDensity: toArray(r.spectrum.Czz),
          a1: toArray(r.directional.a1), b1: toArray(r.directional.b1), a2: toArray(r.directional.a2), b2: toArray(r.directional.b2),
          meanDirection: toArray(r.directional.meanDir), spread: toArray(r.directional.spread), checkFactor: toArray(r.directional.checkFactor),
        },
      };
      const link = document.createElement('a');
      link.download = 'OceanTestSite_SeaStateAnalysis_' + data.generated.substring(0, 10) + '.json';
      link.href = window.URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      link.click();
    },

    // HELPERS
    formatDuration: function (minutes) {
      const h = Math.floor(minutes / 60), m = minutes % 60;
      return (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : '');
    },
    fmt: function (v, d = 2) {
      return (v == null || !isFinite(v)) ? '–' : Number(v).toFixed(d);
    },
    compass: function (deg) {
      return isFinite(deg) ? window.AnalysisCharts.compass(deg) : '';
    },

    // WINDOW RESIZE
    windowResize: function () {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => this.drawActiveTab());
    },

  },
}

// 1, 2 or 5 times a power of ten
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
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

.options.compact {
  padding: 8px 16px;
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
  min-height: 25px;
}

.checkbox-label {
  gap: 6px;
  cursor: pointer;
}

.buttons {
  gap: 8px;
}

input {
  border-radius: 5px;
  text-align: center;
  font-size: small;
}

.record-info {
  color: #3d3c39;
  font-size: x-small;
}

.warning {
  background: var(--red);
  border-radius: 10px;
  padding: 6px 12px;
}

/* Tabs */
.oa-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 14px;
}

.oa-tabs>button {
  padding: 4px 12px;
  border-radius: 15px;
  font-size: small;
}

.oa-tab-sel {
  background: var(--blue);
  color: white;
}

/* Overview cards */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.card {
  background: #fcfcfb;
  border-radius: 15px;
  padding: 10px 14px;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
}

.card-title {
  color: #52514e;
}

.card-value {
  font-size: x-large;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.card-value small {
  font-size: small;
  font-weight: normal;
  color: #52514e;
}

.card-note {
  color: #52514e;
  font-size: x-small;
}

.dir-arrow {
  width: 22px;
  height: 22px;
  fill: var(--darkBlue);
}

/* Parameter table */
.param-group {
  background: #fcfcfb;
  border-radius: 15px;
  padding: 8px 14px;
  margin-bottom: 12px;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
}

.param-table th {
  padding: 4px 6px;
  text-align: left;
  font-weight: 600;
}

.param-table th.param-value {
  color: #52514e;
}

.param-group-title {
  font-size: small;
}

.param-table {
  width: 100%;
  border-collapse: collapse;
}

.param-table tbody tr {
  border-top: 1px solid #e6e5e0;
}

.param-table td {
  padding: 4px 6px;
  vertical-align: top;
}

.param-symbol {
  width: 70px;
  font-weight: 600;
  white-space: nowrap;
}

.param-value {
  width: 115px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.param-value small {
  color: #52514e;
}

.param-cf {
  font-family: ui-monospace, Menlo, monospace;
  font-size: x-small;
  color: #6b6a66;
  word-break: break-all;
}

/* Charts */
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin-bottom: 10px;
}

/* globalStyle.css paints every span white with a shadow (for the blue panels); not on light cards */
.stats span {
  color: #0b0b0b;
  text-shadow: none;
  padding: 0;
  font-size: inherit;
}

.chart-title {
  font-weight: 600;
  margin: 10px 0 4px;
  display: flex;
  align-items: center;
  gap: 8px;
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

.unit-toggle {
  padding: 0 10px;
  border-radius: 12px;
  font-size: small;
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
</style>

<!-- Not scoped: these elements are created by d3 -->
<style>
.oa-chart {
  position: relative;
  font-family: Poppins, sans-serif;
}

.oa-chart svg {
  display: block;
  overflow: visible;
}

.oa-chart span {
  color: inherit;
  text-shadow: none;
  padding: 0;
  font-size: inherit;
}

.oa-grid line {
  stroke: #e6e5e0;
}

.oa-grid path {
  display: none;
}

.oa-axis path,
.oa-axis line {
  stroke: #b5b4ae;
}

.oa-axis text {
  fill: #52514e;
  font-size: 11px;
}

.oa-axis-label {
  fill: #52514e;
  font-size: 12px;
}

.oa-axis-label-clickable {
  fill: #1c5cab;
  text-decoration: underline dotted;
}

.oa-ref {
  stroke: #8a8984;
  stroke-dasharray: 3 3;
}

.oa-ref-label,
.oa-direct-label {
  fill: #52514e;
  font-size: 11px;
}

.oa-crosshair {
  stroke: #8a8984;
  stroke-width: 1;
  pointer-events: none;
}

.oa-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  padding: 2px 10px 4px 60px;
  color: #52514e;
}

.oa-legend i,
.oa-tooltip i {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 5px;
}

.oa-tooltip {
  display: none;
  position: absolute;
  pointer-events: none;
  background: #fcfcfb;
  color: #0b0b0b;
  border: 1px solid #d5d4ce;
  border-radius: 8px;
  padding: 6px 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  white-space: nowrap;
  z-index: 2;
}

.oa-tooltip-title {
  color: #52514e;
  margin-bottom: 2px;
}

.oa-colorbar {
  width: 200px;
  margin-top: 6px;
  color: #52514e;
}

.oa-colorbar-ramp {
  height: 12px;
  border-radius: 3px;
}

.oa-colorbar-labels {
  display: flex;
  justify-content: space-between;
  font-variant-numeric: tabular-nums;
}

.oa-colorbar-unit {
  text-align: center;
  font-size: x-small;
}
</style>
