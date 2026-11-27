<template>
  <!-- A wave height in the unit chosen for the whole app (window.heightUnit: m, ft), as WindSpeed.vue: a click on the
       unit switches every wave height to the next one -->
  <span class="wave-height">{{ text }}&nbsp;<span class="height-unit" role="button" tabindex="0" title="Click to change units"
      @click.stop="cycle" @keydown.enter.prevent="cycle">{{ unit.unit }}</span></span>
</template>



<script>

export default {
  name: "WaveHeight",
  props: {
    value: Number,      // m
    decimals: Number,   // Overrides the unit's decimals
  },
  computed: {
    unit() { return window.heightUnit.unit; },
    text() {
      if (this.value == null || !isFinite(this.value)) return '–';
      return Number(this.unit.toDisplay(this.value)).toFixed(this.decimals ?? this.unit.decimals);
    },
  },
  methods: {
    cycle() { window.heightUnit.cycle(); },
  },
}
</script>



<style scoped>
/* globalStyle.css paints every span white with a shadow (for the blue panels): take the colours of the context */
.wave-height,
.height-unit {
  color: inherit;
  text-shadow: inherit;
  font-size: inherit;
  font-weight: inherit;
  padding: 0;
  white-space: nowrap;
}

.height-unit {
  font-style: italic;
  opacity: 0.85;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
</style>
