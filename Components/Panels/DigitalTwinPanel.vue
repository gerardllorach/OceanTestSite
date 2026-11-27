<template>
  <div id="digital-twin-panel" class="content">

    <p>The real sea, anywhere in the world, right now. <b>Click anywhere on the ocean</b> to see its current state: its
      wave height and its wind then set <a href="#" @click.prevent="openPanel('Quick')">Quick</a>, and through it
      Physics-based and Graphics-based.</p>

    <!-- GLOBE -->
    <div class="globe-card">
      <canvas ref="canvas" class="globe-canvas" role="img"
        aria-label="Globe of the significant wave height. Drag to turn it, scroll to zoom, click on the ocean to pick a place"></canvas>

      <!-- Marker of the place picked: placed by Globe.js, hidden behind the globe -->
      <div ref="marker" class="marker" :class="{ loading: twin.loading }" aria-hidden="true">
        <span class="marker-pulse"></span>
        <span class="marker-spinner"></span>
        <span class="marker-dot"></span>
      </div>

      <!-- What the layer is, and when -->
      <div class="chip chip-top" :class="{ 'chip-error': mapState == 'error' }" :title="mapTitle">
        <span v-if="mapState == 'loading' || detailLoading" class="spinner" aria-hidden="true"></span>{{ mapStatus }}
      </div>

      <div v-if="twin.lat == null" class="globe-hint" aria-hidden="true">
        <span class="fa">{{ '' }}</span> Click on the ocean
      </div>

      <!-- Legend, as in VISOC: a click on the unit switches it -->
      <div class="globe-legend">
        <div class="legend-title">Significant wave height</div>
        <color-legend :stops="WAVE_LEGEND" :range="WAVE_RANGE" :unit="heightUnit" @cycle-unit="cycleHeightUnit"></color-legend>
      </div>
      <div class="globe-help" aria-hidden="true">Drag to turn · scroll to zoom</div>
    </div>

    <!-- THE PLACE PICKED: what the models say, and what the simulation shows -->
    <div v-if="twin.lat != null" class="readout" aria-live="polite">
      <div class="place">
        <span v-if="twin.loading" class="spinner spinner-dark" aria-label="Loading"></span>
        <span class="place-name">{{ placeName }}</span>
        <span v-if="placeSub" class="place-sub">{{ placeSub }}</span>
      </div>
      <div class="coords">{{ latLon }}</div>

      <div class="compare" role="table" aria-label="Real sea and simulated sea">
        <div class="row-label" role="rowheader">Significant wave height</div>
        <div class="cell" role="cell">
          <span v-if="twin.Hm0 === undefined" class="spinner spinner-dark" aria-label="Loading"></span>
          <span v-else-if="twin.Hm0 === null" class="muted">no data</span>
          <template v-else>
            <i class="swatch" :style="{ background: colorOf(twin.Hm0) }"></i>
            <b><wave-height :value="twin.Hm0"></wave-height></b>
          </template>
        </div>
        <div class="cell sim" role="cell" :class="simClass(hm0Differs)">
          <template v-if="sim">
            <i class="swatch" :style="{ background: colorOf(sim.Hm0) }"></i>
            <b><wave-height :value="sim.Hm0"></wave-height></b> <span class="sim-word">simulated</span>
          </template>
          <span v-else class="muted">–</span>
        </div>

        <div class="row-label" role="rowheader">Wind</div>
        <div class="cell" role="cell">
          <span v-if="twin.wind === null && twin.loading" class="spinner spinner-dark" aria-label="Loading"></span>
          <span v-else-if="!twin.wind" class="muted">–</span>
          <template v-else>
            <!-- Arrow: where the wind blows to; the text says where it comes from, as the weather forecasts -->
            <svg class="wind-arrow" viewBox="-12 -12 24 24" width="22" height="22" :style="arrowStyle(twin.wind.dir)" aria-hidden="true">
              <circle r="11" class="arrow-ring"></circle>
              <path d="M 0 -8 L 5 2 L 1.2 0.6 L 1.2 8 L -1.2 8 L -1.2 0.6 L -5 2 Z" class="arrow-head"></path>
            </svg>
            <b><wind-speed :value="twin.wind.speed"></wind-speed></b>
            <span class="dir" :title="Math.round(twin.wind.dir) + '°'">from {{ cardinal(twin.wind.dir) }}</span>
          </template>
        </div>
        <div class="cell sim" role="cell" :class="simClass(windDiffers)">
          <template v-if="sim">
            <svg class="wind-arrow" viewBox="-12 -12 24 24" width="22" height="22" :style="arrowStyle(sim.windDir)" aria-hidden="true">
              <circle r="11" class="arrow-ring"></circle>
              <path d="M 0 -8 L 5 2 L 1.2 0.6 L 1.2 8 L -1.2 8 L -1.2 0.6 L -5 2 Z" class="arrow-head"></path>
            </svg>
            <b><wind-speed :value="sim.windSpeed"></wind-speed></b> <span class="sim-word">simulated</span>
          </template>
          <span v-else class="muted">–</span>
        </div>
      </div>

      <!-- Why the simulation differs -->
      <p v-if="twin.error" class="note note-error">{{ twin.error }}</p>
      <p v-else-if="!twin.loading && twin.Hm0 === null" class="note">
        No wave data here: land, sea ice, or outside the wave model. Click on the ocean.</p>
      <div v-else-if="twin.applied" class="applied" :class="{ stale: !inSync }">
        <template v-if="inSync">
          <div v-if="twin.applied.note" class="applied-note">{{ twin.applied.note }}</div>
          <div class="applied-how">Simulated as a {{ modelTitle }} wind sea<template v-if="twin.applied.fetchy">,
            fetch {{ fmtFetch(twin.applied.fetchKm) }} km</template>.
            <a href="#" @click.prevent="openPanel('Quick')">Open Quick</a></div>
        </template>
        <template v-else>
          The simulation has been changed since (Quick, Physics-based or Graphics-based): it no longer shows this place.
          <button class="clickable" @click="applyToSimulation">Apply this place again</button>
        </template>
      </div>

      <div class="sources">
        Waves: Copernicus Marine, global analysis and forecast<template v-if="twin.waveTime">, {{ fmtTime(twin.waveTime) }}</template>.
        Wind: Open-Meteo<template v-if="twin.wind">, {{ fmtTime(twin.wind.time) }}</template>.
      </div>
    </div>

    <p class="credits">Wave heights: <a href="https://data.marine.copernicus.eu/product/GLOBAL_ANALYSISFORECAST_WAV_001_027/description"
        target="_blank" rel="noopener noreferrer">Copernicus Marine Service, GLOBAL_ANALYSISFORECAST_WAV_001_027</a> (1/12°, every
      3 hours). Wind at 10 m: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>.
      Land: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>,
      through <a href="https://nasa-gibs.github.io/gibs-api-docs/" target="_blank" rel="noopener noreferrer">NASA GIBS</a>.
      Names of the seas: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a>.
      Colours of the waves: VISOC.</p>
  </div>
</template>



<script>

import ColorLegend from '../ColorLegend.vue';
import WaveHeight from '../WaveHeight.vue';
import WindSpeed from '../WindSpeed.vue';

// Strongest wind the simulation takes (Quick's slider): stronger winds are capped
const WIND_MAX = 20; // m/s
// Measured and simulated H_m0 further apart than this: say why
const HM0_TOLERANCE = 0.05;
// The sea of Graphics-based changed
const SEA_EVENTS = ['OceanEntity_wavesChanged', 'OceanEntity_ripplesChanged', 'OceanEntity_foamChanged'];

export default {
  name: "DigitalTwinPanel",
  mounted() {
    const RW = window.DigitalTwinData, twin = this.twin;
    // As Quick: the wind-driven sea starts from what Generation has
    window.PhysicsBased.initialiseFrom(window.physicsBased, window.sceneManager);

    const view = twin.lat != null ? { lat: twin.lat, lon: twin.lon } : {};
    this.globe = new window.Globe(this.$refs.canvas, { marker: this.$refs.marker, onPick: this.pick, ...view,
      onLoading: s => { this.mapState = s.base; this.detailLoading = s.detail; } });
    this.mapTime = this.globe.time;
    if (twin.lat != null) this.globe.setPicked(twin.lat, twin.lon);

    // Whether Graphics-based still has what Physics-based sets (it can be changed by hand)
    SEA_EVENTS.forEach(e => window.eventBus.on(e, this.refreshSync));
    this.refreshSync();
  },
  unmounted() {
    SEA_EVENTS.forEach(e => window.eventBus.off(e, this.refreshSync));
    if (this.globe) this.globe.dispose();
    this.globe = null;
  },
  data() {
    return {
      twin: window.digitalTwin,     // Shared: kept while the panel is closed (main.js)
      st: window.physicsBased,   // Wind-driven sea of Quick and Physics-based
      WAVE_LEGEND: window.DigitalTwinData.WAVE_LEGEND,
      WAVE_RANGE: window.DigitalTwinData.WAVE_RANGE,
      mapState: 'loading',      // The world: 'loading', 'ready', 'error'
      detailLoading: false,     // The sharper map of the part in view
      mapTime: null,
      generationInSync: true,   // Graphics-based has what Physics-based sets
    }
  },
  computed: {
    heightUnit() { return window.heightUnit.unit; },
    mapStatus() {
      if (this.mapState == 'error') return 'Wave heights not available';
      const when = this.mapTime ? this.fmtTime(this.mapTime) : '';
      if (this.mapState == 'loading') return 'Loading wave heights…';
      return this.detailLoading ? 'Loading details…' : 'Waves · ' + when;
    },
    mapTitle() {
      return this.mapState == 'error' ? 'Copernicus Marine did not answer: try again later'
        : 'Significant wave height of the Copernicus Marine global wave model, closest 3-hourly field to now';
    },
    latLon() { return window.DigitalTwinData.formatLatLon(this.twin.lat, this.twin.lon); },
    // What the simulation shows: the wind-driven sea of Physics-based, while it drives Graphics-based. null: the sea
    // is set by hand (no wind behind it)
    sim() {
      const st = this.st;
      if (!st.enabled || st.driver != 'wind' || !this.generationInSync) return null;
      return { Hm0: window.PhysicsBased.windSeaOf(st).Hm0, windSpeed: st.windSpeed, windDir: st.windDir };
    },
    hm0Differs() {
      const real = this.twin.Hm0;
      return this.sim && real > 0 ? Math.abs(this.sim.Hm0 - real) > real * HM0_TOLERANCE : false;
    },
    windDiffers() {
      const w = this.twin.wind, s = this.sim;
      if (!w || !s) return false;
      const dDir = Math.abs((((s.windDir - w.dir) % 360) + 540) % 360 - 180);
      return Math.abs(s.windSpeed - w.speed) > 0.1 || dDir > 1;
    },
    modelTitle() {
      return { pm: 'Pierson–Moskowitz', jonswap: 'JONSWAP', tma: 'TMA', elfouhaily: 'Elfouhaily' }[this.twin.applied?.model] || '';
    },
    // No wave data, and not in a sea of Natural Earth: land (or ice), near the closest sea if there is one
    onLand() { return this.twin.Hm0 === null && !this.twin.namesExact; },
    placeName() {
      if (this.twin.loading) return this.twin.names[0] || '…';
      return this.onLand ? 'Land' : (this.twin.names[0] || 'Open ocean');
    },
    placeSub() {
      const names = this.twin.names;
      if (this.onLand) return names.length ? 'near the ' + names[0] : '';
      return names.slice(1).join(' · ');
    },
    // The wind-driven sea still has what this place set
    inSync() {
      const a = this.twin.applied, st = this.st;
      return !!a && this.generationInSync && st.enabled && st.driver == 'wind' && st.model == a.model
        && st.windSpeed == a.windSpeed && st.windDir == a.windDir && Math.abs(st.fetchKm - a.fetchKm) < 1e-6;
    },
  },
  methods: {
    // CLICK ON THE GLOBE: names, wave height and wind of the place, then into the simulation
    pick: async function (lat, lon) {
      const RW = window.DigitalTwinData, twin = this.twin;
      const id = this.requestId = (this.requestId || 0) + 1;
      Object.assign(twin, { lat, lon, names: [], namesExact: false, loading: true, error: '', Hm0: undefined, waveTime: null, wind: null, applied: null });
      this.globe.setPicked(lat, lon);

      const [names, waves, wind] = await Promise.allSettled([RW.seaNamesAt(lat, lon), RW.fetchWaveHeight(lat, lon), RW.fetchWind(lat, lon)]);
      if (id != this.requestId) return; // Another place was clicked meanwhile
      twin.loading = false;
      if (names.status == 'fulfilled') Object.assign(twin, { names: names.value.names, namesExact: names.value.exact });
      else console.error('Could not name the sea', names.reason);
      if (wind.status == 'fulfilled') twin.wind = wind.value;
      else console.error(wind.reason);
      if (waves.status == 'fulfilled') Object.assign(twin, { Hm0: waves.value.Hm0, waveTime: waves.value.time });
      else { console.error(waves.reason); twin.Hm0 = null; }

      if (waves.status == 'rejected' || wind.status == 'rejected') {
        twin.error = 'Could not load the ' + (waves.status == 'rejected' ? 'wave height' : 'wind')
          + ' of this place: check the connection and click again.';
        return;
      }
      if (twin.Hm0 != null) this.applyToSimulation();
    },

    // Wind and wave height of the place into Quick: the wind as is (up to WIND_MAX), and the fetch whose wind sea
    // has the measured H_m0, within what this wind can make (fetch 1 to 1000 km; Generation > Quick)
    applyToSimulation: function () {
      const DT = window.PhysicsBased, twin = this.twin, st = this.st;
      this.generationInSync = true; // DT.apply sets Graphics-based (its events confirm it)
      if (twin.Hm0 == null || !twin.wind) return;
      const windSpeed = Math.round(Math.min(WIND_MAX, twin.wind.speed) * 10) / 10;
      const windDir = Math.round(twin.wind.dir) % 360;
      const next = { ...st, enabled: true, driver: 'wind', windSpeed, windDir };
      const fetchy = DT.hasFetch(next) && windSpeed > 0;
      const fetchKm = fetchy ? DT.fetchForHm0(next, twin.Hm0) : st.fetchKm;
      Object.assign(st, { enabled: true, driver: 'wind', windSpeed, windDir, fetchKm });
      DT.apply(st);

      const simHm0 = DT.windSeaOf(st).Hm0;
      twin.applied = { windSpeed, windDir, fetchKm, fetchy, model: st.model, simHm0,
        note: this.noteFor(twin.Hm0, simHm0, twin.wind.speed, fetchy) };
    },
    // Why the simulated sea is not the measured one, or ''
    noteFor: function (measured, simulated, U, fetchy) {
      const parts = [];
      if (U > WIND_MAX) parts.push(`The wind is capped at ${WIND_MAX} m/s, the strongest the simulation takes.`);
      const h = v => this.fmtHeight(v);
      if (U < 0.05) parts.push('No wind, so no wind sea: the measured waves are swell, which this simulation does not make.');
      else if (simulated < measured * (1 - HM0_TOLERANCE))
        parts.push(`This wind can raise at most ${h(simulated)}${fetchy ? '' : ' (Pierson–Moskowitz: the wind alone sets the height)'}; `
          + `the rest of the measured ${h(measured)} is likely swell from distant storms, which this simulation does not make.`);
      else if (simulated > measured * (1 + HM0_TOLERANCE))
        parts.push(`This wind raises at least ${h(simulated)}${fetchy ? ' even over 1 km of fetch' : ' (Pierson–Moskowitz: the wind alone sets the height)'}; `
          + `the real sea is calmer (${h(measured)}): sheltered, or the wind has only just picked up.`);
      return parts.join(' ');
    },

    refreshSync: function () {
      this.generationInSync = window.PhysicsBased.inSync(this.st, window.sceneManager);
    },
    colorOf: function (Hm0) {
      const [r, g, b] = window.DigitalTwinData.waveColor(Hm0);
      return `rgb(${r}, ${g}, ${b})`;
    },
    // Where the wind blows to
    arrowStyle: function (fromDeg) { return { transform: 'rotate(' + (fromDeg + 180) + 'deg)' }; },
    // A simulated value: the same as the models' (match), or not (differs)
    simClass: function (differs) {
      if (!this.sim || this.twin.loading || this.twin.Hm0 == null) return '';
      return differs ? 'differs' : 'match';
    },
    openPanel: function (title) {
      window.eventBus.emit('SidePanel_open', { section: 'generation', title });
    },
    cycleHeightUnit: function () { window.heightUnit.cycle(); },
    cardinal: function (deg) { return window.DigitalTwinData.cardinal(deg); },
    fmtFetch: function (km) { return km < 10 ? km.toFixed(1) : Math.round(km).toString(); },
    fmtHeight: function (m) {
      const u = window.heightUnit.unit;
      return u.toDisplay(m).toFixed(u.decimals) + ' ' + u.unit;
    },
    // 27 Nov, 15:00 UTC
    fmtTime: function (date) {
      return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) + ', '
        + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
    },
  },
  components: {
    'color-legend': ColorLegend,
    'wave-height': WaveHeight,
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

/* globalStyle.css paints every span white with a shadow (for the blue panels): not here */
.content span {
  color: inherit;
  text-shadow: none;
  font-size: inherit;
  padding: 0;
}

/* GLOBE: black card, rounded corners */
.globe-card {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 0.92;
  max-height: 70vh;
  border-radius: 18px;
  overflow: hidden;
  background: #000;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  margin-bottom: 14px;
}

.globe-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
}

.globe-canvas:active {
  cursor: grabbing;
}

/* Marker: a white dot ringed in the app's red, with a ring that pulses out from it */
.marker {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  visibility: hidden;
  pointer-events: none;
}

.marker-dot,
.marker-pulse {
  position: absolute;
  left: 0;
  top: 0;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.marker-dot {
  width: 14px;
  height: 14px;
  background: #fff;
  border: 3px solid var(--red);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.55), 0 0 12px rgba(var(--redRGB), 0.9);
}

.marker-pulse {
  width: 14px;
  height: 14px;
  border: 2px solid var(--red);
  animation: pulse 1.8s ease-out infinite;
}

@keyframes pulse {
  from { width: 14px; height: 14px; opacity: 0.9; }
  to { width: 54px; height: 54px; opacity: 0; }
}

/* While the place loads: a ring turning round the dot instead of the pulse */
.marker-spinner {
  position: absolute;
  left: -15px;
  top: -15px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.25);
  border-top-color: #fff;
  display: none;
  animation: spin 0.8s linear infinite;
}

.marker.loading .marker-spinner {
  display: block;
}

.marker.loading .marker-pulse {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .marker-pulse { animation: none; opacity: 0; }
}

/* Labels over the globe */
.chip,
.globe-hint,
.globe-help,
.legend-title {
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.72rem;
  pointer-events: none;
}

.chip {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 11px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(4px);
  pointer-events: auto;
}

.chip-error {
  background: rgba(var(--redRGB), 0.35);
}

.spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  animation: spin 0.8s linear infinite;
}

.spinner-dark {
  display: inline-block;
  width: 16px;
  height: 16px;
  border-color: rgba(var(--blueRGB), 0.2);
  border-top-color: var(--blue);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.globe-hint {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 74px;
  padding: 6px 14px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 0.8rem;
  white-space: nowrap;
  animation: hint 2.4s ease-in-out infinite;
}

.globe-hint .fa {
  color: #fff;
  margin-right: 4px;
}

@keyframes hint {
  50% { opacity: 0.6; }
}

.globe-legend {
  position: absolute;
  left: 14px;
  bottom: 12px;
  width: min(300px, calc(100% - 28px));
  pointer-events: auto;
}

.legend-title {
  margin: 0 0 4px 2px;
}

.globe-help {
  position: absolute;
  right: 14px;
  top: 16px;
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.5);
}

/* THE PLACE PICKED */
.readout {
  background: #fcfcfb;
  border-radius: 18px;
  padding: 14px 18px 12px;
  margin-bottom: 12px;
  box-shadow: 0 1px 4px rgba(var(--darkBlueRGB), 0.15);
}

/* Name and position, centred */
.place {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 2px 10px;
  text-align: center;
}

.place-name {
  font-size: 1.15rem !important;
  font-weight: 600;
  color: var(--darkBlue) !important;
}

.place-sub {
  color: rgba(var(--darkBlueRGB), 0.7) !important;
}

.coords {
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--darkBlueRGB), 0.75);
  margin: 2px 0 10px;
}

/* Models | simulated, side by side and close together: a compact table in the middle of the card */
.compare {
  display: grid;
  grid-template-columns: auto auto auto;
  justify-content: center;
  align-items: center;
  row-gap: 6px;
  font-variant-numeric: tabular-nums;
}

.row-label {
  text-align: right;
  padding-right: 14px;
  color: rgba(var(--darkBlueRGB), 0.75);
}

.cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  padding: 0 14px;
  border-left: 1px solid rgba(var(--darkBlueRGB), 0.18);
  white-space: nowrap;
}

.cell b {
  font-size: 1rem;
}

/* Simulated: green when it is what the models say, amber when not (the note below says why) */
.sim {
  border-radius: 0 10px 10px 0;
}

.sim.match {
  background: rgba(60, 170, 110, 0.12);
}

.sim.differs {
  background: rgba(240, 160, 40, 0.18);
}

.sim-word {
  font-size: 0.8em !important;
  font-style: italic;
  opacity: 0.75;
}

.dir {
  opacity: 0.85;
}

@media (max-width: 520px) {
  .compare { grid-template-columns: auto auto; }
  .row-label { grid-column: 1 / -1; text-align: center; padding: 6px 0 0; }
  .cell:not(.sim) { border-left: none; }
}

.muted {
  opacity: 0.6;
}

.swatch {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
}

.wind-arrow {
  flex-shrink: 0;
  transition: transform 0.6s ease-out;
}

.arrow-ring {
  fill: rgba(var(--blueRGB), 0.12);
}

.arrow-head {
  fill: var(--blue);
}

.dir small {
  opacity: 0.7;
}

.applied {
  margin: 10px 0 6px;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(var(--blueRGB), 0.1);
}

.applied.stale {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  background: rgba(var(--redRGB), 0.15);
}

.applied.stale button {
  padding: 2px 12px;
}

.applied-how {
  margin-top: 2px;
}

.applied-title {
  font-weight: 600;
  color: var(--darkBlue);
  margin-bottom: 2px;
}

.check {
  color: var(--blue) !important;
}

.applied-note {
  margin-top: 4px;
  opacity: 0.85;
}

.note {
  background: #fcfcfb;
  border-radius: 10px;
  padding: 6px 12px;
}

.readout .note {
  margin: 10px 0 6px;
  background: rgba(var(--darkBlueRGB), 0.06);
}

.note-error {
  background: rgba(var(--redRGB), 0.15) !important;
}

.sources {
  font-size: 0.72rem;
  opacity: 0.7;
  margin-top: 6px;
}

.credits {
  font-size: 0.72rem;
  opacity: 0.75;
}
</style>
