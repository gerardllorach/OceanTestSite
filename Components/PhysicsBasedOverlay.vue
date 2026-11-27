<template>
  <!-- Forcing of the physics-based sea (Generation > Physics-based), bottom-left of the screen while it is on. While
       it has the wind and the waves of a real place (Generation > Digital twin), the title is that place -->
  <div v-if="pb.enabled && pb.driver == 'wind'" class="twin-overlay" role="status" :aria-label="title">
    <div class="twin-title" :title="place ? 'Wind and wave height of this place, now (Generation > Digital twin)' : ''">{{ title }}</div>
    <div class="twin-main">
      <!-- Compass, north up. Wedge: where the waves come from (±σ1 at the peak), arrow: where the wind blows to -->
      <svg class="twin-compass" viewBox="-30 -30 60 60" width="60" height="60" aria-hidden="true">
        <circle r="27" class="ring"></circle>
        <g>
          <text class="north" x="0" y="-18.5" text-anchor="middle" dominant-baseline="middle">N</text>
          <path class="wedge" :d="wedgePath"></path>
          <g :transform="'rotate(' + (pb.windDir + 180) + ')'">
            <line x1="0" y1="16" x2="0" y2="-12" class="shaft"></line>
            <path d="M -6 -9 L 0 -19 L 6 -9 Z" class="head"></path>
          </g>
        </g>
      </svg>
      <div class="twin-values">
        <div class="twin-wind"><wind-speed :value="pb.windSpeed"></wind-speed></div>
        <div class="twin-line">from {{ compass(pb.windDir) }}</div>
        <div class="twin-line" :title="spreadTitle">spread {{ fmt(sigmaPeak, 0) }}°<template v-if="pb.spreadModel != 'constant'"> at T<sub>p</sub></template></div>
      </div>
    </div>
    <!-- Derived from the wind: less visible -->
    <div class="twin-derived">
      H<sub>m0</sub> {{ fmt(sea.Hm0, 2) }} m · T<sub>p</sub> {{ fmt(sea.Tp, 1) }} s ·
      {{ pb.model == 'pm' ? 'Pierson–Moskowitz' : pb.model == 'tma' ? 'TMA, ' + fmtFetch(pb.fetchKm) + ' km, ' + (pb.depthM ?? 30) + ' m deep'
        : (pb.model == 'elfouhaily' ? 'Elfouhaily, ' : 'JONSWAP, ') + fmtFetch(pb.fetchKm) + ' km' }}
    </div>
    <div v-if="!inSync" class="twin-derived twin-warning" title="Generation > Graphics-based was changed by hand since: the sea does not follow this wind">
      Graphics-based edited by hand
    </div>
  </div>
</template>



<script>

import WindSpeed from './WindSpeed.vue';

export default {
  name: "PhysicsBasedOverlay",
  mounted() {
    ['OceanEntity_wavesChanged', 'OceanEntity_ripplesChanged', 'OceanEntity_foamChanged'].forEach(e => window.eventBus.on(e, this.refresh));
    this.refresh();
  },
  unmounted() {
    ['OceanEntity_wavesChanged', 'OceanEntity_ripplesChanged', 'OceanEntity_foamChanged'].forEach(e => window.eventBus.off(e, this.refresh));
  },
  data() {
    return {
      pb: window.physicsBased,
      twin: window.digitalTwin,
      inSync: true,
    }
  },
  computed: {
    // The real place whose wind and waves the sea still has, or ''
    place() {
      const a = this.twin.applied, pb = this.pb;
      if (!a || pb.windSpeed != a.windSpeed || pb.windDir != a.windDir || Math.abs(pb.fetchKm - a.fetchKm) > 1e-6 || pb.model != a.model) return '';
      return this.twin.names[0] || window.DigitalTwinData.formatLatLon(this.twin.lat, this.twin.lon, 1);
    },
    title() { return this.place ? 'Digital twin · ' + this.place : 'Physics-based · wind driven'; },
    sea() { return window.PhysicsBased.windSeaOf(this.pb); },
    // Spread at the peak (the same at every frequency for the constant spreading)
    sigmaPeak() {
      const sp = window.PhysicsBased.spreadingOf(this.pb);
      return sp.sigma1(sp.fp);
    },
    spreadTitle() {
      const m = window.DirectionalSpreading.SPREAD_MODELS.find(m => m.id == this.pb.spreadModel);
      return 'Directional spreading: ' + (m ? m.title : '') + '. σ1 at the peak period.';
    },
    // Sector of ±sigma1 around the direction the waves come from, in the compass (radius 24)
    wedgePath() {
      const half = Math.min(170, Math.max(2, this.sigmaPeak)) * Math.PI / 180, from = this.pb.windDir * Math.PI / 180, r = 24;
      const pt = a => `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
      return `M 0 0 L ${pt(from - half)} A ${r} ${r} 0 ${half > Math.PI / 2 ? 1 : 0} 1 ${pt(from + half)} Z`;
    },
    target() { return window.PhysicsBased.targetOf(this.pb); },
  },
  watch: {
    target() { this.$nextTick(this.refresh); },
    'pb.enabled'() { this.$nextTick(this.refresh); },
  },
  methods: {
    refresh() {
      this.inSync = !this.pb.enabled || window.PhysicsBased.inSync(this.pb, window.sceneManager);
    },
    compass(deg) {
      deg = ((deg % 360) + 360) % 360;
      return Math.round(deg) + '° ' + (window.AnalysisCharts ? window.AnalysisCharts.compass(deg) : '');
    },
    fmt(v, d = 2) { return (v == null || !isFinite(v)) ? '–' : Number(v).toFixed(d); },
    fmtFetch(km) { return km < 10 ? km.toFixed(1) : Math.round(km).toString(); },
  },
  components: {
    'wind-speed': WindSpeed,
  },
}
</script>



<style scoped>
.twin-overlay {
  position: fixed;
  left: 12px;
  bottom: 12px;
  z-index: 5;
  max-width: calc(100vw - 32px);
  padding: 8px 12px 8px 10px;
  border-radius: 14px;
  /* No backdrop-filter: over the canvas, which changes every frame, the browser would blur that region every frame */
  background: rgba(0, 28, 48, 0.75);
  color: white;
  text-shadow: 0 0 4px black;
  font-size: 0.8rem;
  pointer-events: auto;
}

.twin-title {
  font-size: 0.7rem;
  opacity: 0.75;
  margin-bottom: 4px;
}

.twin-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.twin-values {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.twin-wind {
  font-size: 1.15rem;
  font-weight: 600;
}

.twin-line {
  font-size: 0.8rem;
}

/* Less visible: derived from the wind */
.twin-derived {
  margin-top: 6px;
  font-size: 0.72rem;
  opacity: 0.7;
}

.twin-warning {
  margin-top: 2px;
  opacity: 0.9;
  color: #ffd27a;
}

.twin-compass .ring {
  fill: rgba(255, 255, 255, 0.08);
  stroke: rgba(255, 255, 255, 0.5);
  stroke-width: 1;
}

.twin-compass .north {
  fill: rgba(255, 255, 255, 0.85);
  font-size: 8px;
  font-weight: 700;
}

.twin-compass .wedge {
  fill: rgba(120, 200, 255, 0.35);
  stroke: rgba(160, 220, 255, 0.7);
  stroke-width: 0.8;
}

.twin-compass .shaft {
  stroke: white;
  stroke-width: 2.5;
  stroke-linecap: round;
}

.twin-compass .head {
  fill: white;
}
</style>
