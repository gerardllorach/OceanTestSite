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
          <span title="How much the foam smooths the ripples under it (surfactants and bubbles damp the short waves). 0: off, the ripples stay sharp under the foam">Ripples under foam</span>
          <div><input type="range" min="0" max="1" step="0.05" :value="settings.rippleDamping ?? 0.8"
              @input="change({ rippleDamping: Number($event.target.value) })"><span>{{ Math.round((settings.rippleDamping ?? 0.8) * 100) }}% smoother</span></div>
        </div>
        <div class="container-horizontal">
          <span title="Radius of the collapse and of the trail damping around a breaker, ahead, behind and to the sides, times its wavelength: small breakers soften a small area, large ones a large area">Softening radius</span>
          <div><input type="range" min="0.1" max="1" step="0.05" :value="settings.radius"
              @input="change({ radius: Number($event.target.value) })"><span>×{{ settings.radius.toFixed(2) }} wavelength</span></div>
        </div>
        <div class="container-horizontal">
          <span title="Waves of about 1 to 4 m (the ripple grid) break too, mostly on the front faces of the long waves, from the shape of the waves (not the wind). Their foam (ripple whitecaps) builds up on the crest, stays with the water and fades, leaving a trail. None where the large breakers already have foam">Small breakers</span>
          <div>
            <label class="checkbox-label"><input type="checkbox" :checked="settings.small !== false"
                @change="change({ small: $event.target.checked })"> From the ripples</label>
          </div>
        </div>
        <template v-if="settings.small !== false">
          <div class="container-horizontal">
            <span title="A ripple crest breaks (and makes foam) where the surface is squeezed below this Jacobian J: higher, more ripples break and more foam (J < 1: any squeeze; the Stokes limit of a single wave is J = 0.56). By default (auto) the same threshold as the whitecaps, which the digital twin sets from the wind; ↺ goes back to it">Ripple breaking threshold</span>
            <div><input type="range" min="0.3" max="1" step="0.01" :value="smallThresholdShown"
                @input="change({ smallThreshold: Number($event.target.value) })"><span>J &lt; {{ fmt(smallThresholdShown, 2) }}<template
                v-if="settings.smallThreshold == null"> (auto)</template></span><button v-if="settings.smallThreshold != null"
                class="clickable" title="Back to the threshold of the whitecaps" @click="change({ smallThreshold: null })">↺</button></div>
          </div>
          <div class="container-horizontal">
            <span title="Where a ripple breaks, which part turns white. Crests: inside a breaking patch only the crest lines of the shorter ripples (from ~25 cm) turn white. Patches: the whole zone of the ~1-2 m wave that breaks, as before. Which patches break does not change (Ripple breaking threshold)">Ripple foam shape</span>
            <div><input type="range" min="0" max="1" step="0.05" :value="settings.smallShape ?? 0.25"
                @input="change({ smallShape: Number($event.target.value) })"><span>{{ shapeLabel(settings.smallShape ?? 0.25) }}</span></div>
          </div>
          <div class="container-horizontal">
            <span title="The breaking crest of the small breakers: dense white foam while the crest breaks, travelling with it. Drawn over the whole sea">Ripple breaking crest</span>
            <div><input type="range" min="0" max="1" step="0.05" :value="settings.smallCrest ?? 1"
                @input="change({ smallCrest: Number($event.target.value) })"><span>{{ (settings.smallCrest ?? 1) > 0 ? Math.round((settings.smallCrest ?? 1) * 100) + '%' : 'Off' }}</span></div>
          </div>
          <div class="container-horizontal">
            <span title="The foam trail the small breakers leave: it builds up on the crest, stays with the water and fades (a lace, at most this fraction of the pattern). Near the camera it is tracked; further away the sea gets its mean whitening. Off: no trail">Ripple foam trail</span>
            <div><input type="range" min="0" max="1" step="0.05" :value="settings.smallFoam ?? 1"
                @input="change({ smallFoam: Number($event.target.value) })"><span>{{ (settings.smallFoam ?? 1) > 0 ? Math.round((settings.smallFoam ?? 1) * 100) + '%' : 'Off' }}</span></div>
          </div>
          <template v-if="(settings.smallFoam ?? 1) > 0">
            <div class="container-horizontal">
              <span title="How fast ripple foam builds up where a crest breaks. It saturates: the same spot does not pile up foam">Ripple foam growth</span>
              <div><input type="range" min="0.5" max="30" step="0.5" :value="settings.smallFoamGrow ?? 14"
                  @input="change({ smallFoamGrow: Number($event.target.value) })"><span>{{ (settings.smallFoamGrow ?? 14).toFixed(1) }} /s</span></div>
            </div>
            <div class="container-horizontal">
              <span title="How long the ripple foam lasts after the crest has passed (e-folding time): it stays with the water and leaves a trail behind the crest">Ripple foam lifetime</span>
              <div><input type="range" min="0.1" max="6" step="0.1" :value="settings.smallFoamLifetime ?? 1.5"
                  @input="change({ smallFoamLifetime: Number($event.target.value) })"><span>{{ (settings.smallFoamLifetime ?? 1.5).toFixed(1) }} s</span></div>
            </div>
            <div class="container-horizontal">
              <span title="The fading time varies slowly in space and time, so a patch does not fade evenly: it breaks up and changes shape (0: even fading; 0.5: from half to twice the lifetime; 1: from a quarter to four times)">Ripple foam variation</span>
              <div><input type="range" min="0" max="1" step="0.05" :value="settings.smallFoamVariation ?? 0.5"
                  @input="change({ smallFoamVariation: Number($event.target.value) })"><span>{{ Math.round((settings.smallFoamVariation ?? 0.5) * 100) }}%</span></div>
            </div>
            <div class="container-horizontal">
              <span title="How much the ripple foam spreads as it fades (diffusion)">Ripple foam spread</span>
              <div><input type="range" min="0" max="0.1" step="0.005" :value="settings.smallFoamSpread ?? 0.01"
                  @input="change({ smallFoamSpread: Number($event.target.value) })"><span>{{ (settings.smallFoamSpread ?? 0.01).toFixed(3) }} m²/s</span></div>
            </div>
          </template>
          <div class="container-horizontal" v-if="(settings.smallFoam ?? 1) > 0">
            <span title="Scale of the lace pattern of the ripple whitecaps (x1: the same as the large whitecaps). Coarser: larger holes, which stay visible further away; finer: smaller holes, which blend into a uniform white sooner">Ripple foam lace</span>
            <div><input type="range" min="0.25" max="6" step="0.05" :value="settings.smallFoamScale ?? 2.5"
                @input="change({ smallFoamScale: Number($event.target.value) })"><span>{{ laceLabel(settings.smallFoamScale ?? 2.5) }}</span></div>
          </div>
        </template>

        <!-- SPRAY -->
        <div class="container-horizontal">
          <span title="Droplets thrown off by the breaking crests, more by the large ones (energy ~ c^5), with the crest speed and carried by the wind (light droplets further). Above 7.5 m/s the wind also tears spume off the crests. They fall back into the sea as foam: droplets landing close together merge into one patch. Only made near the camera, where a droplet is at least a pixel wide">Spray</span>
          <div>
            <label class="checkbox-label"><input type="checkbox" :checked="settings.spray !== false"
                @change="change({ spray: $event.target.checked })"> Droplets</label>
          </div>
        </div>
        <template v-if="settings.spray !== false">
          <div class="container-horizontal">
            <span title="Multiplies the emission of droplets from the breakers. The wind sets how far they fly: in a light wind they barely leave the surface">Spray amount</span>
            <div><input type="range" min="0" max="3" step="0.1" :value="settings.sprayAmount ?? 1"
                @input="change({ sprayAmount: Number($event.target.value) })"><span>×{{ (settings.sprayAmount ?? 1).toFixed(1) }}</span></div>
          </div>
          <div class="container-horizontal">
            <span title="Spray from the breaking crests of the large waves too, not only from the small breakers">Spray from</span>
            <div>
              <label class="checkbox-label"><input type="checkbox" :checked="!!settings.sprayLarge"
                  @change="change({ sprayLarge: $event.target.checked })"> Large breakers too</label>
            </div>
          </div>
          <div class="container-horizontal">
            <span title="A droplet falling into the sea leaves a small patch of bubbles. Droplets landing close together merge into one patch of foam, drawn with the same lace as the whitecaps">Spray foam</span>
            <div>
              <label class="checkbox-label"><input type="checkbox" :checked="settings.sprayFoam !== false"
                  @change="change({ sprayFoam: $event.target.checked })"> Landed droplets</label>
            </div>
          </div>
          <template v-if="settings.sprayFoam !== false">
            <div class="container-horizontal">
              <span title="Size of the bubble patch a landed droplet leaves, times the droplet's diameter (its area grows with the square). About 1.25 is realistic; larger exaggerates it">Spray foam size</span>
              <div><input type="range" min="0.5" max="8" step="0.25" :value="settings.sprayFoamPatch ?? 4"
                  @input="change({ sprayFoamPatch: Number($event.target.value) })"><span>×{{ (settings.sprayFoamPatch ?? 4).toFixed(2) }} droplet</span></div>
            </div>
            <div class="container-horizontal">
              <span title="How long the spray foam lasts (e-folding time: thick patches stay visible longer than thin ones)">Spray foam lifetime</span>
              <div><input type="range" min="0.1" max="3" step="0.05" :value="settings.sprayFoamLifetime ?? 0.6"
                  @input="change({ sprayFoamLifetime: Number($event.target.value) })"><span>{{ (settings.sprayFoamLifetime ?? 0.6).toFixed(2) }} s</span></div>
            </div>
            <div class="container-horizontal">
              <span title="The foam of each landed droplet is spread over this radius, so the landings of a breaker group into one patch (like the foam of a breaking wave) instead of separate spots">Spray foam radius</span>
              <div><input type="range" min="0.05" max="1" step="0.05" :value="settings.sprayFoamRadius ?? 0.25"
                  @input="change({ sprayFoamRadius: Number($event.target.value) })"><span>{{ (settings.sprayFoamRadius ?? 0.25).toFixed(2) }} m</span></div>
            </div>
            <div class="container-horizontal">
              <span title="Summed area of the landed droplets (per unit area) that makes the maximum foam. Higher: more droplets are needed to whiten the sea">Spray foam full at</span>
              <div><input type="range" min="0.2" max="10" step="0.1" :value="settings.sprayFoamFull ?? 3"
                  @input="change({ sprayFoamFull: Number($event.target.value) })"><span>{{ (settings.sprayFoamFull ?? 3).toFixed(1) }}× area</span></div>
            </div>
            <div class="container-horizontal">
              <span title="Logarithmic growth: foam = max log(1 + k area / full) / log(1 + k). Higher k: the first droplets already make a good deal of foam, and the rest adds slowly; k near 1: almost linear">Spray foam first drops</span>
              <div><input type="range" min="1" max="200" step="1" :value="settings.sprayFoamLog ?? 30"
                  @input="change({ sprayFoamLog: Number($event.target.value) })"><span>k = {{ settings.sprayFoamLog ?? 30 }} ({{ pct(firstDrops) }} at 1/30 of full)</span></div>
            </div>
            <div class="container-horizontal">
              <span title="Maximum of the spray foam (cap), however many droplets land">Spray foam max</span>
              <div><input type="range" min="0.1" max="1" step="0.05" :value="settings.sprayFoamMax ?? 0.85"
                  @input="change({ sprayFoamMax: Number($event.target.value) })"><span>{{ Math.round((settings.sprayFoamMax ?? 0.85) * 100) }}%</span></div>
            </div>
            <div class="container-horizontal">
              <span title="Scale of the lace pattern of the spray foam (x1: the same as the large whitecaps). Coarser: larger holes; finer: smaller holes">Spray foam lace</span>
              <div><input type="range" min="0.25" max="6" step="0.05" :value="settings.sprayFoamScale ?? 2.5"
                  @input="change({ sprayFoamScale: Number($event.target.value) })"><span>{{ laceLabel(settings.sprayFoamScale ?? 2.5) }}</span></div>
            </div>
          </template>
          <p class="derived" v-if="spray">
            <template v-if="spray.active && spray.distance">Droplets drawn within <b>{{ fmt(spray.distance, 0) }} m</b> of the camera.</template>
            <template v-else-if="spray.active">Droplets drawn in this view.</template>
            <template v-else>No droplets now: the camera is too far from the sea to see them<template v-if="spray.distance"> (closer than {{ fmt(spray.distance, 0) }} m)</template>.</template>
          </p>
        </template>
      </template>
      <p v-else class="hint-low">No whitecaps at this quality: they need the FFT sea (Quality: medium or high).</p>
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
        collapse: 0.6, radius: 0.75, trailDamping: 0.5, rippleDamping: 0.8, surge: 2, small: true, smallThreshold: null, smallShape: 0.25, smallCrest: 1, smallFoam: 1, smallFoamScale: 2.5, smallFoamGrow: 14, smallFoamLifetime: 1.5,
        smallFoamVariation: 0.5, smallFoamSpread: 0.01, spray: false, sprayAmount: 1, sprayLarge: true, sprayFoam: true, sprayFoamPatch: 4, sprayFoamLifetime: 0.6,
        sprayFoamScale: 2.5, sprayFoamRadius: 0.25, sprayFoamFull: 3, sprayFoamLog: 30, sprayFoamMax: 0.85 },
      calibration: null,
      available: true,
      measured: null,
      spray: null,
    }
  },
  computed: {
    // Threshold and lead of the small breakers: their own, or the ones they follow
    smallThresholdShown() {
      if (this.settings.smallThreshold != null) return this.settings.smallThreshold;
      const c = this.calibration;
      return c && c.small && c.small.threshold != null && c.small.threshold > -100 ? c.small.threshold : (this.settings.threshold ?? 0.6);
    },
    // Spray foam made by 1/30 of the droplets that whiten the sea (logarithmic growth)
    firstDrops() {
      const k = this.settings.sprayFoamLog ?? 30;
      return Math.log(1 + k / 30) / Math.log(1 + k);
    },
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
        const ocean = window.sceneManager.ocean;
        this.spray = ocean && ocean.spray ? { ...ocean.spray.status } : null;
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
    // Scale of a lace pattern, relative to the large whitecaps'
    laceLabel: function (v) {
      return v < 1 ? `×${(1 / v).toFixed(1)} coarser` : v > 1 ? `×${v.toFixed(2)} finer` : 'as the whitecaps';
    },
    shapeLabel: function (v) { return v <= 0.02 ? 'Crests' : v >= 0.98 ? 'Patches' : Math.round((1 - v) * 100) + '% crests'; },
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
