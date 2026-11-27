<template>
  <div id="quick-panel" class="content">

    <p>The sea from three numbers: the wind and the wave height. They set the options of <b>Physics-based</b>
      (wind driven), which set every slider of <b>Graphics-based</b>. The <b>Digital twin</b> sets them from a real
      place. <a href="#" @click.prevent="openPanel('Physics-based')">Spectrum and spreading: Physics-based</a>.</p>

    <p v-if="st.driver != 'wind'" class="note">
      Physics-based is not driven by the wind.
      <button class="clickable" @click="set({ driver: 'wind' })">Switch to wind driven</button></p>
    <p v-else-if="!st.enabled" class="note">
      Physics-based is off: the sea is set by hand in Graphics-based. Moving a slider here turns it on.</p>
    <p v-else-if="!inSync" class="note">
      Graphics-based has been changed since (by hand or from a file): the sea does not follow these values.
      <button class="clickable" @click="set({})">Apply them again</button></p>

    <div class="container-vertical options">
      <!-- Wind speed -->
      <div class="container-horizontal">
        <span>Wind speed (U<sub>10</sub>)</span>
        <div>
          <input type="range" min="0" max="20" step="0.1" :value="st.windSpeed" @input="windChanged(Number($event.target.value))">
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
      <!-- Wave height: sets the fetch -->
      <div class="container-horizontal">
        <span>Wave height (H<sub>m0</sub>)</span>
        <div v-if="fetchy" class="hm0-cell">
          <div class="hm0-slider">
            <!-- Spans only what this wind can make (fetch 1 to 1000 km): the thumb cannot leave it, nothing corrects it -->
            <input type="range" min="0" :max="STEPS" step="1" :value="hm0Pos" :disabled="!(band[1] > band[0])"
              aria-label="Wave height" :aria-valuetext="fmt(sea.Hm0, 2) + ' m'" @input="hm0Changed(Number($event.target.value))">
            <div class="ends" aria-hidden="true"><span>{{ fmt(band[0], 2) }}</span><span>{{ fmt(band[1], 2) }} m</span></div>
          </div>
          <span class="value hm0-value">{{ fmt(sea.Hm0, 2) }} m
            <span class="fetch">fetch {{ fmtFetch(st.fetchKm) }} km</span></span>
        </div>
        <div v-else>
          <span class="value">{{ fmt(sea.Hm0, 2) }} m</span>
        </div>
      </div>
    </div>

    <p v-if="!fetchy" class="note">
      Pierson–Moskowitz: a fully developed sea, so the wave height is set by the wind.
      To choose it, change the spectrum in <a href="#" @click.prevent="openPanel('Physics-based')">Physics-based</a>.</p>
    <p v-else-if="st.windSpeed > 0" class="band-text">
      At <wind-speed :value="st.windSpeed"></wind-speed>: H<sub>m0</sub> {{ fmt(band[0], 2) }}–{{ fmt(band[1], 2) }} m
      (fetch 1–{{ fdFetch != null && fdFetch < 1000 ? fmtFetch(fdFetch) + ' km; fully developed beyond' : '1000 km' }}).
      Changing the wind keeps H<sub>m0</sub> if it can, otherwise it moves to the nearest end.</p>
    <p v-else class="band-text">No wind, no wind sea.</p>

    <div class="stats">
      <span>T<sub>p</sub> <b>{{ fmt(sea.Tp, 1) }} s</b></span>
      <span>{{ modelTitle }}</span>
      <span><b>{{ fullyDeveloped ? 'Fully developed' : 'Growing sea' }}</b></span>
    </div>
  </div>
</template>



<script>

import Knob from '../Knob.vue';
import WindSpeed from '../WindSpeed.vue';

// H_m0 slider: STEPS steps, linear in H_m0, from the lowest to the highest H_m0 of this wind (arrow keys: 0.5% of it)
const STEPS = 200;

export default {
  name: "QuickPanel",
  mounted() {
    ['OceanEntity_wavesChanged', 'OceanEntity_ripplesChanged', 'OceanEntity_foamChanged'].forEach(e => window.eventBus.on(e, this.refresh));
    // The first time: start from what Generation has (as the Physics-based panel)
    window.PhysicsBased.initialiseFrom(window.physicsBased, window.sceneManager);
    this.setHm0(this.sea.Hm0);
    this.refresh();
  },
  unmounted() {
    ['OceanEntity_wavesChanged', 'OceanEntity_ripplesChanged', 'OceanEntity_foamChanged'].forEach(e => window.eventBus.off(e, this.refresh));
  },
  data() {
    return {
      st: window.physicsBased, // Shared with the Physics-based and Digital twin panels and the overlay (reactive, main.js)
      STEPS,
      hm0: NaN,    // Wave height chosen, within the band of the wind (the fetch follows it)
      hm0Pos: 0,   // Its slider position (0..STEPS): set by the slider, or when the wind moves the band
      inSync: true,
    }
  },
  computed: {
    sea() { return window.PhysicsBased.windSeaOf(this.st); },
    fetchy() { return window.PhysicsBased.hasFetch(this.st); },
    band() { return window.PhysicsBased.hm0RangeOf(this.st); },
    // At the top of the band the fetch is the fully developed one (the bisection stops just short of it)
    fullyDeveloped() { return !this.fetchy || this.sea.fullyDeveloped || (this.fdFetch != null && this.sea.Hm0 >= this.band[1] * 0.999); },
    fdFetch() { return window.PhysicsBased.fullyDevelopedFetchOf(this.st); },
    modelTitle() {
      return { pm: 'Pierson–Moskowitz', jonswap: 'JONSWAP', tma: 'TMA, ' + (this.st.depthM ?? 30) + ' m deep', elfouhaily: 'Elfouhaily' }[this.st.model] || '';
    },
    target() { return window.PhysicsBased.targetOf(this.st); },
  },
  watch: {
    target() { this.$nextTick(this.refresh); },
  },
  methods: {
    // Every change drives Physics-based (wind driven, on), which drives Graphics-based
    set: function (partial) {
      Object.assign(this.st, { enabled: true, driver: 'wind' }, partial);
      window.PhysicsBased.apply(this.st);
    },
    // Wind: H_m0 stays if this wind can make it, otherwise it moves to the nearest end of the new band; the fetch follows
    windChanged: function (U) {
      const partial = { windSpeed: U };
      if (this.fetchy && U > 0 && isFinite(this.hm0)) {
        const st = { ...this.st, windSpeed: U };
        this.setHm0(this.hm0, window.PhysicsBased.hm0RangeOf(st));
        partial.fetchKm = window.PhysicsBased.fetchForHm0(st, this.hm0);
      }
      this.set(partial);
    },
    // Slider: position -> H_m0 in the band -> fetch
    hm0Changed: function (pos) {
      const [lo, hi] = this.band;
      this.hm0Pos = pos;
      this.hm0 = lo + (hi - lo) * pos / STEPS;
      this.set({ fetchKm: window.PhysicsBased.fetchForHm0(this.st, this.hm0) });
    },
    // H_m0 clamped to the band, and the slider position that shows it
    setHm0: function (h, [lo, hi] = this.band) {
      this.hm0 = Math.min(hi, Math.max(lo, h));
      this.hm0Pos = hi > lo ? Math.round((this.hm0 - lo) / (hi - lo) * STEPS) : 0;
    },
    refresh: function () {
      this.inSync = !this.st.enabled || window.PhysicsBased.inSync(this.st, window.sceneManager);
    },
    openPanel: function (title) {
      window.eventBus.emit('SidePanel_open', { section: 'generation', title });
    },
    fmtFetch: function (km) { return km < 10 ? km.toFixed(1) : Math.round(km).toString(); },
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

.hm0-cell {
  gap: 4px;
}

.hm0-slider {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

/* Lowest and highest H_m0 of this wind, under the ends of the slider */
.ends {
  display: flex;
  justify-content: space-between;
  font-size: 0.8em;
  line-height: 1;
}

.ends span {
  padding: 0 4px;
  opacity: 0.85;
}

.hm0-value {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 10ch;
  padding: 0 0 0 4px;
}

.hm0-value .fetch {
  padding: 0;
  font-size: 0.85em;
  opacity: 0.85;
}

.band-text {
  margin: 0 0 8px;
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

.note button {
  margin-left: 8px;
  padding: 2px 12px;
}
</style>
