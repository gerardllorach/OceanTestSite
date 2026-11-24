<template>
  <!-- Sun position on a vertical semicircle: drag the sun (or click the arc) anywhere above the horizon.
       Angle: 0 = right horizon, 90 = zenith, 180 = left horizon -->
  <div class="sun-arc">
    <svg ref="svg" :viewBox="`0 0 ${W} ${H}`" class="sun-arc-svg" role="slider" tabindex="0"
      aria-label="Sun position on its arc" aria-valuemin="0" aria-valuemax="180" :aria-valuenow="Math.round(angle)"
      :aria-valuetext="valueText" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
      @pointercancel="onPointerUp" @keydown="onKeyDown">
      <!-- Sky and horizon -->
      <path class="sky" :d="`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY} Z`" />
      <line class="horizon" :x1="CX - R - 14" :y1="CY" :x2="CX + R + 14" :y2="CY" />
      <!-- Elevation guides every 30 degrees -->
      <line v-for="a in [30, 60, 90, 120, 150]" :key="a" class="guide" :x1="CX" :y1="CY"
        :x2="CX + R * Math.cos(a * Math.PI / 180)" :y2="CY - R * Math.sin(a * Math.PI / 180)" />
      <!-- Path of the sun -->
      <path class="arc" :d="`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`" />
      <path class="arc-done" :d="arcFromRight" />
      <!-- Sun -->
      <g class="sun" :transform="`translate(${sunX}, ${sunY})`">
        <circle r="13" class="sun-halo" />
        <circle r="8" class="sun-disc" />
      </g>
      <!-- Labels: compass bearing of each horizon -->
      <text class="label" :x="CX + R" :y="CY + 16" text-anchor="middle">{{ rightLabel }}</text>
      <text class="label" :x="CX - R" :y="CY + 16" text-anchor="middle">{{ leftLabel }}</text>
      <text class="label muted" :x="CX" :y="CY - R - 8" text-anchor="middle">Zenith</text>
    </svg>
  </div>
</template>



<script>

const W = 260, H = 150, CX = 130, CY = 122, R = 100;

export default {
  name: "SunArcControl",
  props: {
    value: { type: Number, default: 90 },   // Angle on the arc (deg): 0 right horizon, 90 zenith, 180 left horizon
    azimuth: { type: Number, default: 90 }, // Compass bearing of the right horizon (deg, clockwise from north)
  },
  emits: ['change'],
  data() {
    return { W, H, CX, CY, R, angle: this.value, dragging: false };
  },
  watch: {
    value(v) { if (!this.dragging) this.angle = v; },
  },
  computed: {
    sunX() { return CX + R * Math.cos(this.angle * Math.PI / 180); },
    sunY() { return CY - R * Math.sin(this.angle * Math.PI / 180); },
    // Arc from the right horizon to the sun
    arcFromRight() {
      return `M ${CX + R} ${CY} A ${R} ${R} 0 0 0 ${this.sunX} ${this.sunY}`;
    },
    rightLabel() { return this.compass(this.azimuth); },
    leftLabel() { return this.compass(this.azimuth + 180); },
    valueText() {
      const elevation = this.angle <= 90 ? this.angle : 180 - this.angle;
      return `Elevation ${Math.round(elevation)} degrees, towards ${this.angle < 90 ? this.rightLabel : this.angle > 90 ? this.leftLabel : 'zenith'}`;
    },
  },
  methods: {
    compass: function (deg) {
      deg = ((deg % 360) + 360) % 360;
      const name = window.AnalysisCharts ? window.AnalysisCharts.compass(deg) : '';
      return Math.round(deg) + '° ' + name;
    },
    // Angle of the pointer seen from the centre of the arc, clamped to the upper half (0..180)
    angleFromEvent: function (e) {
      const svg = this.$refs.svg;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      let a = Math.atan2(CY - p.y, p.x - CX) * 180 / Math.PI;
      if (a < 0) a = p.x >= CX ? 0 : 180; // Below the horizon: stick to the nearest end
      return Math.min(180, Math.max(0, a));
    },
    setAngle: function (a) {
      a = Math.round(Math.min(180, Math.max(0, a)) * 10) / 10;
      if (a == this.angle) return;
      this.angle = a;
      this.$emit('change', a);
    },
    onPointerDown: function (e) {
      e.preventDefault();
      this.$refs.svg.focus();
      this.$refs.svg.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.setAngle(this.angleFromEvent(e));
    },
    onPointerMove: function (e) {
      if (this.dragging) this.setAngle(this.angleFromEvent(e));
    },
    onPointerUp: function (e) {
      this.dragging = false;
      if (this.$refs.svg.hasPointerCapture(e.pointerId)) this.$refs.svg.releasePointerCapture(e.pointerId);
    },
    // Arrows: left / up move the sun towards the left horizon, right / down towards the right one. Shift: 10 degrees
    onKeyDown: function (e) {
      const step = e.shiftKey ? 10 : 1;
      if (e.key == 'ArrowLeft' || e.key == 'ArrowUp') this.setAngle(this.angle + step);
      else if (e.key == 'ArrowRight' || e.key == 'ArrowDown') this.setAngle(this.angle - step);
      else if (e.key == 'Home') this.setAngle(0);
      else if (e.key == 'End') this.setAngle(180);
      else return;
      e.preventDefault();
    },
  },
}
</script>



<style scoped>
.sun-arc {
  display: flex;
  justify-content: center;
}

.sun-arc-svg {
  width: 100%;
  max-width: 340px;
  touch-action: none; /* Dragging the sun does not scroll the panel on touch screens */
  cursor: pointer;
  user-select: none;
}

.sun-arc-svg:focus-visible {
  outline: 2px solid var(--darkBlue);
  outline-offset: 2px;
  border-radius: 8px;
}

.sky {
  fill: rgba(255, 255, 255, 0.18);
}

.horizon {
  stroke: var(--darkBlue);
  stroke-width: 2;
}

.guide {
  stroke: rgba(255, 255, 255, 0.35);
  stroke-width: 1;
  stroke-dasharray: 2 3;
}

.arc {
  fill: none;
  stroke: rgba(255, 255, 255, 0.7);
  stroke-width: 3;
}

.arc-done {
  fill: none;
  stroke: #ffd34d;
  stroke-width: 3;
}

.sun-halo {
  fill: rgba(255, 211, 77, 0.35);
}

.sun-disc {
  fill: #ffd34d;
  stroke: #b07800;
  stroke-width: 1.5;
}

.label {
  fill: white;
  font-size: 11px;
}

.label.muted {
  fill: rgba(255, 255, 255, 0.8);
}
</style>
