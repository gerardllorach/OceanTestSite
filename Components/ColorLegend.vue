<template>
  <!-- A colour scale labelled where its colours change, as VISOC's DTColorLegend: every stop gets an equal share of
       the bar (so close values stay readable: the scale is not linear), the unit sits inside the bar on its first
       colour, and a click on it switches to the next unit. The colours mean the same in any unit: only the numbers
       change. -->
  <div class="legend">
    <span class="legend-unit-cap" :style="{ background: endColor(0) }" role="button" tabindex="0" title="Click to change units"
      @click.stop="$emit('cycle-unit')" @keydown.enter.prevent="$emit('cycle-unit')">{{ unit.unit }}</span>
    <span class="legend-cap" :style="{ background: endColor(0) }"></span>
    <div class="legend-scale" :style="{ background: gradient }">
      <span v-for="tick in ticks" :key="tick.percent" class="legend-tick" :style="{ left: tick.percent + '%' }">{{ tick.label }}</span>
    </div>
    <span class="legend-cap" :style="{ background: endColor(1) }"></span>
  </div>
</template>


<script>

export default {
  name: "ColorLegend",
  props: {
    stops: { type: Array, required: true }, // [[t (0..1), [r, g, b]], ...]
    range: { type: Array, required: true }, // [min, max] in standard units (what t = 0 and 1 are)
    unit: { type: Object, required: true },  // {unit, toDisplay(standard value)}
  },
  emits: ['cycle-unit'],
  methods: {
    // Flat run of the end colours: room for the first and last labels, over their own colour
    endColor(end) {
      const [, [r, g, b]] = end === 0 ? this.stops[0] : this.stops[this.stops.length - 1];
      return `rgb(${r}, ${g}, ${b})`;
    },
  },
  computed: {
    // Each distinct stop at an equal share of the bar: {t: percent}
    positions() {
      const values = [...new Set(this.stops.map(([t]) => t))];
      return new Map(values.map((t, i) => [t, values.length > 1 ? (i / (values.length - 1)) * 100 : 0]));
    },
    gradient() {
      const colors = this.stops.map(([t, [r, g, b]]) => `rgb(${r}, ${g}, ${b}) ${this.positions.get(t)}%`);
      return `linear-gradient(to right, ${colors.join(', ')})`;
    },
    // One label per stop: whole numbers when the top of the scale is above 25 (in the unit shown), else one decimal
    ticks() {
      const [min, max] = this.range, { toDisplay } = this.unit;
      const top = toDisplay(max);
      const label = v => top > 25 ? String(Math.round(v)) : String(Number((v + 1e-9).toFixed(1)));
      return [...this.positions].map(([t, percent]) => ({ percent, label: label(toDisplay(min + t * (max - min))) }));
    },
  },
}

</script>


<style scoped>
.legend {
  display: flex;
  width: 100%;
  height: 16px;
  border-radius: 9px;
  overflow: hidden;
}

/* globalStyle.css paints every span white with a shadow: dark text on the light colours of the scale */
.legend span {
  color: rgba(0, 0, 0, 0.8);
  text-shadow: none;
  padding: 0;
}

.legend-unit-cap {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  padding: 0 4px 0 9px !important;
  font-size: 0.65rem;
  font-style: italic;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.legend-cap {
  flex: 0 0 12px;
  height: 100%;
}

.legend-scale {
  position: relative;
  flex: 1;
  height: 100%;
}

.legend-tick {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 0.65rem;
  white-space: nowrap;
  pointer-events: none;
}
</style>
