<template>
  <div id="digital-twin-panel" class="content">

    <p>The digital twin drives the sliders of <b>Sea State &gt; Generation</b> from what forces the sea: the wind, measured
      waves, a buoy or a wave model. Changing an option here moves those sliders; you can still adjust them by hand
      afterwards.</p>

    <!-- ON / OFF -->
    <div class="twin-switch">
      <span class="switch-label">Digital twin</span>
      <div class="segmented" role="group" aria-label="Digital twin">
        <button class="clickable" :class="{ 'button-active': st.enabled }" :aria-pressed="st.enabled" @click="setEnabled(true)">On</button>
        <button class="clickable" :class="{ 'button-active': !st.enabled }" :aria-pressed="!st.enabled" @click="setEnabled(false)">Off</button>
      </div>
      <span class="switch-hint">{{ st.enabled ? 'Generation follows the options below. The forcing is shown at the bottom-left of the screen.'
        : 'Generation is not changed. Turn it on to drive it from the options below.' }}</span>
    </div>

    <!-- DRIVER -->
    <div class="segmented drivers" role="group" aria-label="What drives the sea">
      <button v-for="d in drivers" :key="d.id" class="clickable" :class="{ 'button-active': d.id == st.driver }"
        :aria-pressed="d.id == st.driver" :disabled="!d.available" :title="d.available ? '' : 'Not available yet'"
        @click="set({ driver: d.id })">{{ d.title }}</button>
    </div>

    <!-- WIND DRIVEN -->
    <h3 class="layer-title">Wind driven</h3>
    <p class="layer-intro">The FFT sea is the wind sea of a wind blowing at <i>U</i><sub>10</sub> (10 m above the sea),
      with one of two empirical spectra:</p>
    <ul class="models">
      <li><b>Pierson–Moskowitz</b> (1964): a <b>fully developed</b> sea. The wind has blown long enough, over a long enough
        distance, that the waves no longer grow: their height and period depend on the wind speed only.</li>
      <li><b>JONSWAP</b> (Hasselmann et al. 1973): a <b>growing</b>, fetch-limited sea. The waves grow with the
        <b>fetch</b>, the distance over which the wind blows, and the spectrum has a sharper peak (enhancement γ, 3.3 on
        average). Past a long enough fetch the sea is fully developed: the Pierson–Moskowitz sea.</li>
    </ul>
    <p class="layer-intro">Neither spectrum defines how the waves spread in direction. Choose a spreading below: the same
      at every frequency (by hand), or one measured with buoys, narrowest near the peak. Mitsuyasu et al. (1975) and
      Hasselmann et al. (1980) also depend on the wind, through the wave age: they use this wind.</p>

    <div class="container-vertical options">
      <!-- Wind speed -->
      <div class="container-horizontal">
        <span>Wind speed (U<sub>10</sub>)</span>
        <div>
          <input type="range" min="0" max="20" step="0.1" :value="st.windSpeed" @input="set({ windSpeed: Number($event.target.value) })">
          <span class="value"><wind-speed :value="st.windSpeed"></wind-speed></span>
        </div>
      </div>
      <!-- Wind direction -->
      <div class="container-horizontal">
        <span>Wind from</span>
        <div class="knob-row">
          <knob size="50px" :value="st.windDir" @change="v => set({ windDir: Math.round(v) % 360 })"></knob>
          <span class="knob-value">{{ compass(st.windDir) }}</span>
        </div>
      </div>
      <!-- Spectrum -->
      <div class="container-horizontal">
        <span>Spectrum</span>
        <div class="segmented" role="group" aria-label="Spectrum">
          <button class="clickable" :class="{ 'button-active': st.model == 'pm' }" :aria-pressed="st.model == 'pm'"
            @click="set({ model: 'pm' })">Pierson–Moskowitz</button>
          <button class="clickable" :class="{ 'button-active': st.model == 'jonswap' }" :aria-pressed="st.model == 'jonswap'"
            @click="set({ model: 'jonswap' })">JONSWAP</button>
          <button class="clickable" :class="{ 'button-active': st.model == 'tma' }" :aria-pressed="st.model == 'tma'"
            title="JONSWAP times the Kitaigorodskii depth attenuation (Bouws et al. 1985; Horvath 2015): the long waves are damped in shallow water"
            @click="set({ model: 'tma' })">TMA</button>
          <button class="clickable" :class="{ 'button-active': st.model == 'elfouhaily' }" :aria-pressed="st.model == 'elfouhaily'"
            title="Unified spectrum of long and short waves (Elfouhaily et al. 1997): in strong wind the short sharp waves grow much more than the mid-sized ones"
            @click="set({ model: 'elfouhaily' })">Elfouhaily</button>
        </div>
      </div>
      <!-- JONSWAP, TMA, Elfouhaily: fetch; JONSWAP, TMA: gamma; TMA: depth -->
      <template v-if="st.model != 'pm'">
        <div class="container-horizontal">
          <span title="Distance over which the wind blows over the water (from the coast, or the size of the storm)">Fetch</span>
          <div><input type="range" min="0" max="1" step="0.001" :value="fetchToSlider(st.fetchKm)"
              @input="set({ fetchKm: sliderToFetch(Number($event.target.value)) })"><span>{{ fmtFetch(st.fetchKm) }} km</span></div>
        </div>
        <div class="container-horizontal" v-if="st.model != 'elfouhaily'">
          <span title="Peak enhancement of the JONSWAP spectrum: 3.3 on average (Hasselmann et al. 1973), 1 = Pierson-Moskowitz shape">Peak enhancement γ</span>
          <div><input type="range" min="1" max="7" step="0.1" :value="st.gamma" @input="set({ gamma: Number($event.target.value) })"><span>{{ fmt(st.gamma, 1) }}</span></div>
        </div>
        <div class="container-horizontal" v-if="st.model == 'tma'">
          <span title="Water depth: the waves whose frequency is below ~2 sqrt(g / h) / (2 pi) are damped (Kitaigorodskii depth attenuation), and they travel slower (finite-depth dispersion)">Depth</span>
          <div><input type="range" min="5" max="200" step="1" :value="st.depthM ?? 30" @input="set({ depthM: Number($event.target.value) })"><span>{{ fmt(st.depthM ?? 30, 0) }} m</span></div>
        </div>
      </template>
      <!-- Directional spreading -->
      <div class="container-horizontal">
        <span title="How the energy of each frequency spreads in direction. Neither spectrum defines it (references at the end of Generation)">Directional spreading</span>
        <div><select :value="st.spreadModel" aria-label="Directional spreading" @change="set({ spreadModel: $event.target.value })">
            <option v-for="m in spreadModels" :key="m.id" :value="m.id">{{ m.title }}</option>
          </select></div>
      </div>
      <div class="container-horizontal" v-if="st.spreadModel == 'constant'">
        <span title="Directional spread sigma1 (Kuik et al. 1988), the same at every frequency">Directional spread σ<sub>1</sub></span>
        <div><input type="range" min="5" max="80" step="1" :value="st.spread" @input="set({ spread: Number($event.target.value) })"><span>{{ fmt(st.spread, 0) }}°</span></div>
      </div>
      <div class="container-horizontal" v-if="st.spreadModel == 'goda'">
        <span title="Value of s at the peak (Goda & Suzuki 1975): 10 wind waves, 25 young swell, 75 old swell">Peak s<sub>max</sub></span>
        <div><input type="range" min="1" max="100" step="1" :value="st.smax" @input="set({ smax: Number($event.target.value) })"><span>{{ fmt(st.smax, 0) }}</span></div>
      </div>
      <!-- Ripples and whitecaps -->
      <div class="container-horizontal">
        <span title="The ripples (Cox & Munk) and the whitecaps (Monahan & O'Muircheartaigh) follow a wind of their own; the whitecaps take the wind of the ripples">Ripples and whitecaps</span>
        <label class="checkbox-label">
          <input type="checkbox" :checked="st.driveRipples" @change="set({ driveRipples: $event.target.checked })"> Same wind
        </label>
      </div>
      <div class="container-horizontal">
        <span title="On: the ripples continue the spectrum of the sea below its shortest FFT wave, in absolute units (strict, not scaled to Cox & Munk). Off: the constant ripple spectrum (the same slope per octave at any wind, Phillips 1958), scaled to the Cox & Munk slopes">Ripple spectrum</span>
        <label class="checkbox-label">
          <input type="checkbox" :checked="st.strictRipples" @change="set({ strictRipples: $event.target.checked })"> Follow the sea spectrum
        </label>
      </div>
      <!-- Light wind: only with the Cox & Munk ripples (a strict sea spectrum has its own light-wind behaviour) -->
      <div class="container-horizontal" v-if="!st.strictRipples">
        <span title="Cox & Munk keep some slope even with no wind. On: 5% of the Cox & Munk slopes up to 1.3 m/s (onset of wind waves on clean water, Kahma & Donelan 1988), the full Cox & Munk slopes from 3 m/s, a smooth step between">Ripples in light wind</span>
        <label class="checkbox-label">
          <input type="checkbox" :checked="st.calmLightWind" @change="set({ calmLightWind: $event.target.checked })"> Calm
          <span class="derived-inline" v-if="st.calmLightWind">(×{{ fmt(lightFactor, 2) }} of Cox &amp; Munk)</span>
        </label>
      </div>
      <div class="container-horizontal">
        <span title="Ripples strained by the waves: x1 up to 5 kn, x10 from 25 kn. Breaking threshold of the whitecaps: J < 0.6 up to 5 kn, J < 0.8 from 25 kn. Linear in knots between">Strain and breaking</span>
        <label class="checkbox-label">
          <input type="checkbox" :checked="st.driveStrainFoam" @change="set({ driveStrainFoam: $event.target.checked })"> From the wind
          <span class="derived-inline" v-if="st.driveStrainFoam">(×{{ fmt(strain, 1) }}, J &lt; {{ fmt(threshold, 2) }})</span>
        </label>
      </div>
    </div>

    <!-- RESULT -->
    <div class="stats">
      <span>H<sub>m0</sub> <b>{{ fmt(sea.Hm0, 2) }} m</b></span>
      <span>T<sub>p</sub> <b>{{ fmt(sea.Tp, 1) }} s</b></span>
      <span title="Phase speed of the peak waves over the wind speed: ~1.2 for a fully developed sea, under 1 for a young, growing sea">Wave age c<sub>p</sub>/U<sub>10</sub> <b>{{ fmt(age, 2) }}</b></span>
      <span v-if="st.model == 'tma'" title="Hm0 of the JONSWAP sea in deep water, before the depth attenuation">Deep water H<sub>m0</sub> <b>{{ fmt(sea.HmDeep, 2) }} m</b></span>
      <span v-if="st.model == 'elfouhaily'" title="Inverse wave age U10 / cp: 0.84 fully developed, up to 5 for a very young sea">Ω <b>{{ fmt(sea.Omega, 2) }}</b></span>
      <span v-if="st.model != 'pm'" title="g X / U10^2">Dimensionless fetch <b>{{ fmtFetchless(sea.dimensionlessFetch) }}</b></span>
      <span><b>{{ sea.fullyDeveloped ? 'Fully developed' : 'Growing sea' }}</b></span>
    </div>
    <p v-if="(st.model == 'jonswap' || st.model == 'tma') && sea.fullyDeveloped && st.windSpeed > 0" class="note">
      Past ~{{ fmtFetch(fdFetch) }} km, a <wind-speed :value="st.windSpeed"></wind-speed> wind makes a fully developed sea: the JONSWAP
      growth stops and H<sub>m0</sub>, T<sub>p</sub> are the Pierson–Moskowitz ones (γ stays as set).</p>
    <p v-if="belowFFT" class="note">
      T<sub>p</sub> is shorter than the shortest wave of the FFT sea ({{ fmt(fftShortestT, 1) }} s): most of this sea is in
      the range of the ripples, so the FFT sea is nearly flat.</p>
    <p v-if="!st.enabled" class="note out-of-sync">
      The digital twin is off: Generation does not follow these options.
      <button class="clickable" @click="setEnabled(true)">Turn it on</button></p>
    <p v-else-if="!inSync" class="note out-of-sync">
      The sliders of Generation have been changed since (by hand or from a file).
      <button class="clickable" @click="apply">Apply the wind again</button></p>

    <!-- WHAT IS DRIVEN -->
    <h3 class="layer-title">What it sets in Generation</h3>
    <table class="driven">
      <thead>
        <tr>
          <th>Generation slider</th>
          <th :class="{ active: st.model == 'pm' }">Pierson–Moskowitz</th>
          <th :class="{ active: st.model == 'jonswap' || st.model == 'tma' }">JONSWAP (TMA)</th>
          <th :class="{ active: st.model == 'elfouhaily' }">Elfouhaily</th>
          <th>Now</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>FFT sea &gt; H<sub>m0</sub></td>
          <td :class="{ active: st.model == 'pm' }">0.22 U<sub>10</sub><sup>2</sup> / g</td>
          <td :class="{ active: st.model == 'jonswap' || st.model == 'tma' }">1.6·10<sup>−3</sup> √X̃ · U<sub>10</sub><sup>2</sup> / g, with X̃ = g X / U<sub>10</sub><sup>2</sup>
            (X: fetch). Pierson–Moskowitz past X̃ ≈ {{ fmtFetchless(fullyDevelopedFetch) }}. TMA: H<sub>m0</sub> of
            S<sub>JONSWAP</sub>(ω) Φ(ω√(h/g)), Φ = ω<sub>h</sub><sup>2</sup>/2 (ω<sub>h</sub> ≤ 1),
            1 − (2 − ω<sub>h</sub>)<sup>2</sup>/2 (ω<sub>h</sub> &lt; 2), 1 above</td>
          <td :class="{ active: st.model == 'elfouhaily' }">4 √∫ k<sup>−3</sup> (B<sub>l</sub> + B<sub>h</sub>) dk, with
            Ω = 0.84 tanh((X̃/2.2·10<sup>4</sup>)<sup>0.4</sup>)<sup>−0.75</sup></td>
          <td>{{ fmt(sea.Hm0, 2) }} m</td>
        </tr>
        <tr>
          <td>FFT sea &gt; Peak period T<sub>p</sub></td>
          <td :class="{ active: st.model == 'pm' }">“Fully developed” ticked: ω<sub>p</sub> = 0.877 g / U<sub>19.5</sub>,
            from H<sub>m0</sub> (≈ 0.75 U<sub>10</sub> s)</td>
          <td :class="{ active: st.model == 'jonswap' || st.model == 'tma' }">f<sub>p</sub> = 3.5 X̃<sup>−0.33</sup> g / U<sub>10</sub>, so
            T<sub>p</sub> = U<sub>10</sub> X̃<sup>0.33</sup> / (3.5 g)</td>
          <td :class="{ active: st.model == 'elfouhaily' }">k<sub>p</sub> = g (Ω / U<sub>10</sub>)<sup>2</sup></td>
          <td>{{ fmt(sea.Tp, 1) }} s</td>
        </tr>
        <tr>
          <td>FFT sea &gt; Peak enhancement γ</td>
          <td :class="{ active: st.model == 'pm' }">1</td>
          <td :class="{ active: st.model == 'jonswap' || st.model == 'tma' }">γ slider (3.3 on average)</td>
          <td :class="{ active: st.model == 'elfouhaily' }">Its own: 1.7 + 6 log<sub>10</sub> Ω (Ω &gt; 1)</td>
          <td>{{ st.model == 'elfouhaily' ? '–' : fmt(st.model == 'pm' ? 1 : st.gamma, 1) }}</td>
        </tr>
        <tr>
          <td>FFT sea &gt; Mean direction (from)</td>
          <td colspan="3" class="active">Wind from</td>
          <td>{{ compass(st.windDir) }}</td>
        </tr>
        <tr>
          <td>FFT sea &gt; Directional spreading</td>
          <td colspan="3" class="active">The spreading chosen above, and its σ<sub>1</sub> (constant) or s<sub>max</sub>
            (Goda &amp; Suzuki)</td>
          <td>{{ spreadTitle }}</td>
        </tr>
        <tr :class="{ off: !spreadUsesWind }">
          <td>FFT sea &gt; Wind for the spreading</td>
          <td colspan="3" class="active">{{ spreadUsesWind ? 'U10 (sets the wave age U10/cp of the spreading)' : 'Not used by this spreading' }}</td>
          <td><wind-speed v-if="spreadUsesWind" :value="st.windSpeed"></wind-speed><template v-else>–</template></td>
        </tr>
        <tr :class="{ off: !st.driveRipples }">
          <td>Ripples &gt; Source, Wind speed, Wind from</td>
          <td colspan="3" class="active">{{ st.driveRipples ? 'Wind, U10 and the wind direction. The whitecaps take the wind of the ripples' : 'Not changed (“Same wind” off)' }}</td>
          <td><wind-speed v-if="st.driveRipples" :value="st.windSpeed"></wind-speed><template v-else>–</template></td>
        </tr>
        <tr>
          <td>Ripples &gt; Spectrum</td>
          <td colspan="3" class="active"><template v-if="st.strictRipples">The spectrum of the sea, continued (strict): no Cox &amp; Munk
            scaling, no light-wind onset other than the spectrum's own</template><template v-else>Constant (the same slope per
            octave at any wind), scaled to Cox &amp; Munk (“Follow the sea spectrum” off)</template></td>
          <td>{{ st.strictRipples ? 'Sea spectrum' : 'Constant' }}</td>
        </tr>
        <tr :class="{ off: !st.driveStrainFoam }">
          <td>Ripples &gt; Strained by the waves</td>
          <td colspan="3" class="active">×1 at 5 kn or less, ×10 at 25 kn or more, linear in knots between
            (×1 + 9 (U<sub>kn</sub> − 5) / 20)</td>
          <td>{{ st.driveStrainFoam ? '×' + fmt(strain, 1) : '–' }}</td>
        </tr>
        <tr :class="{ off: !st.driveStrainFoam }">
          <td>Whitecaps &gt; Breaking from, Breaking threshold</td>
          <td colspan="3" class="active">Wave shape, with J &lt; 0.6 at 5 kn or less and J &lt; 0.8 at 25 kn or more, linear in
            knots between (0.6 + 0.2 (U<sub>kn</sub> − 5) / 20)</td>
          <td>{{ st.driveStrainFoam ? 'J < ' + fmt(threshold, 2) : '–' }}</td>
        </tr>
      </tbody>
    </table>
    <p class="footnote">Not changed: choppiness and realisation of the FFT sea, the swell, the direction, spread and
      strength of the ripples, and the other whitecap options. U<sub>kn</sub>: wind speed in knots. U<sub>19.5</sub>: wind at 19.5 m, the height of the
      Pierson–Moskowitz measurements (0.21 U<sub>19.5</sub><sup>2</sup> / g ≈ 0.22 U<sub>10</sub><sup>2</sup> / g).</p>
    <p class="footnote">Pierson, W. J. &amp; Moskowitz, L. (1964). A proposed spectral form for fully developed wind seas
      based on the similarity theory of S. A. Kitaigorodskii. J. Geophys. Res. 69(24), 5181–5190.<br>
      Hasselmann, K. et al. (1973). Measurements of wind-wave growth and swell decay during the Joint North Sea Wave
      Project (JONSWAP). Dtsch. Hydrogr. Z. A8(12).<br>
      Bouws, E. et al. (1985). Similarity of the wind wave spectrum in finite depth water. J. Geophys. Res. 90(C1), 975–986.
      Horvath, C. J. (2015). Empirical directional wave spectra for computer graphics. DigiPro '15, 29–39.<br>
      Elfouhaily, T. et al. (1997). A unified directional spectrum for long and short wind-driven waves. J. Geophys. Res.
      102(C7), 15781–15796.</p>
  </div>
</template>



<script>

import Knob from '../Knob.vue';
import WindSpeed from '../WindSpeed.vue';

// Fetch slider: log scale
const FETCH_MIN = 0.5, FETCH_MAX = 1000; // km

export default {
  name: "DigitalTwinPanel",
  mounted() {
    window.eventBus.on('OceanEntity_wavesChanged', this.refresh);
    window.eventBus.on('OceanEntity_ripplesChanged', this.refresh);
    window.eventBus.on('OceanEntity_foamChanged', this.refresh);
    // The first time: start from what Generation has, so that turning the twin on changes the sea as little as possible
    window.DigitalTwin.initialiseFrom(window.digitalTwin, window.sceneManager);
    this.refresh();
  },
  unmounted() {
    window.eventBus.off('OceanEntity_wavesChanged', this.refresh);
    window.eventBus.off('OceanEntity_ripplesChanged', this.refresh);
    window.eventBus.off('OceanEntity_foamChanged', this.refresh);
  },
  data() {
    return {
      st: window.digitalTwin, // Shared with the overlay (reactive, main.js)
      drivers: [
        { id: 'wind', title: 'Wind driven', available: true },
        { id: 'waves', title: 'Wave driven', available: false },
        { id: 'buoy', title: 'Buoy driven', available: false },
        { id: 'model', title: 'Model driven', available: false },
      ],
      inSync: true,
      fftShortestT: NaN,
      fullyDevelopedFetch: window.WindSea.FULLY_DEVELOPED_FETCH,
      spreadModels: window.DirectionalSpreading.SPREAD_MODELS,
    }
  },
  computed: {
    sea() { return window.DigitalTwin.windSeaOf(this.st); },
    age() { return window.WindSea.waveAge(this.sea.Tp, this.st.windSpeed); },
    fdFetch() { return window.WindSea.fullyDevelopedFetchKm(this.st.windSpeed); },
    strain() { return window.DigitalTwin.strainFor(this.st.windSpeed); },
    threshold() { return window.DigitalTwin.breakingThresholdFor(this.st.windSpeed); },
    lightFactor() { return window.DigitalTwin.lightWindFactorOf(this.st); },
    spreadUsesWind() { return window.DirectionalSpreading.needsWind(this.st.spreadModel); },
    spreadTitle() {
      const m = this.spreadModels.find(m => m.id == this.st.spreadModel);
      return this.st.spreadModel == 'constant' ? 'σ1 ' + this.fmt(this.st.spread, 0) + '°'
        : this.st.spreadModel == 'goda' ? 's_max ' + this.fmt(this.st.smax, 0) : (m ? m.title : '');
    },
    belowFFT() { return this.sea.Tp > 0 && isFinite(this.fftShortestT) && this.sea.Tp < this.fftShortestT; },
    // What Generation should have (watched: the sync check follows the options)
    target() { return window.DigitalTwin.targetOf(this.st); },
  },
  methods: {
    set: function (partial) {
      Object.assign(this.st, partial);
      if (this.st.enabled) this.apply();
    },
    setEnabled: function (on) {
      this.st.enabled = on;
      if (on) this.apply();
    },
    // Drive the sliders of Generation (they follow the events of the ocean)
    apply: function () {
      window.DigitalTwin.apply(this.st);
    },
    // Whether Generation still has what the twin set, and the shortest period of the FFT sea
    refresh: function () {
      if (!window.sceneManager) return;
      const fft = window.sceneManager.getFFTSea();
      this.fftShortestT = fft ? 1 / fft.fCut : NaN;
      this.inSync = window.DigitalTwin.inSync(this.st, window.sceneManager);
    },
    fetchToSlider: function (km) { return Math.log(km / FETCH_MIN) / Math.log(FETCH_MAX / FETCH_MIN); },
    sliderToFetch: function (pos) {
      const km = FETCH_MIN * Math.pow(FETCH_MAX / FETCH_MIN, pos);
      return km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
    },
    fmtFetch: function (km) { return km < 10 ? km.toFixed(1) : Math.round(km).toString(); },
    fmtFetchless: function (x) { return isFinite(x) ? (x >= 1e4 ? (x / 1e4).toFixed(1) + '·10⁴' : Math.round(x).toString()) : '–'; },
    compass: function (deg) {
      deg = ((deg % 360) + 360) % 360;
      return Math.round(deg) + '° ' + (window.AnalysisCharts ? window.AnalysisCharts.compass(deg) : '');
    },
    fmt: function (v, d = 2) {
      return (v == null || !isFinite(v)) ? '–' : Number(v).toFixed(d);
    },
  },
  watch: {
    // The target moves with the options: check again
    target() { this.$nextTick(this.refresh); },
  },
  components: {
    'knob': Knob,
    'wind-speed': WindSpeed,
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

.twin-switch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin: 4px 0 10px;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(var(--darkBlueRGB), 0.06);
}

.twin-switch .switch-label,
.twin-switch .switch-hint {
  color: #0b0b0b;
  text-shadow: none;
  padding: 0;
  font-size: inherit;
}

.twin-switch .switch-label {
  font-weight: 600;
}

.twin-switch .segmented {
  display: flex;
}

.derived-inline {
  font-weight: 600;
  padding-left: 4px;
}

.drivers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 4px 0 6px;
}

.drivers button {
  padding: 4px 14px;
}

.drivers button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.layer-title {
  margin: 18px 0 4px;
  padding-top: 12px;
  border-top: 1px solid rgba(var(--darkBlueRGB), 0.15);
  color: var(--darkBlue);
  font-size: 0.95rem;
  font-weight: 600;
}

.layer-intro {
  margin: 0 0 8px;
}

.models {
  margin: 0 0 8px;
  padding-left: 18px;
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

select {
  border-radius: 5px;
  font-size: small;
  max-width: 100%;
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

/* Fixed width, so the knob does not move while dragging as the text changes */
.knob-value {
  width: 9ch;
  text-align: left;
  font-variant-numeric: tabular-nums;
}

/* Fixed width, so the slider does not move as the value and its unit change */
.value {
  min-width: 10ch;
  font-variant-numeric: tabular-nums;
}

.segmented {
  gap: 6px;
  flex-wrap: wrap;
}

.segmented button {
  padding: 2px 12px;
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

.note {
  background: #fcfcfb;
  border-radius: 10px;
  padding: 6px 12px;
}

.out-of-sync button {
  margin-left: 8px;
  padding: 2px 12px;
}

.driven {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 8px;
}

.driven th,
.driven td {
  text-align: left;
  vertical-align: top;
  padding: 5px 8px;
  border-bottom: 1px solid rgba(var(--darkBlueRGB), 0.12);
}

.driven th {
  font-weight: 600;
  color: var(--darkBlue);
}

.driven td:last-child,
.driven th:last-child {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* The spectrum in use */
.driven .active {
  background: rgba(var(--darkBlueRGB), 0.06);
}

.driven th.active {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.driven tr.off td {
  opacity: 0.55;
}

.footnote {
  color: #3d3c39;
  font-size: x-small;
  margin-top: 8px;
}
</style>
