<template>
  <!-- A wind speed in the unit chosen for the whole app (window.windUnit). As in VISOC: the unit is quieter than the
       value, italic, and underlined because a click on it switches every wind speed to the next unit -->
  <span class="wind-speed">{{ text }}&nbsp;<span class="wind-unit" role="button" tabindex="0" title="Click to change units"
      @click.stop="cycle" @keydown.enter.prevent="cycle">{{ unit.unit }}</span></span>
</template>



<script>

export default {
  name: "WindSpeed",
  props: {
    value: Number,      // m/s
    decimals: Number,   // Overrides the unit's decimals
  },
  computed: {
    unit() { return window.WindSea.WIND_UNITS[window.windUnit.index] || window.WindSea.WIND_UNITS[0]; },
    text() {
      if (this.value == null || !isFinite(this.value)) return '–';
      const d = this.unit.unit == 'Bft' ? 0 : (this.decimals ?? this.unit.decimals);
      return Number(this.unit.toDisplay(this.value)).toFixed(d);
    },
  },
  methods: {
    cycle() { window.windUnit.cycle(); },
  },
}
</script>



<style scoped>
/* globalStyle.css paints every span white with a shadow (for the blue panels): take the colours of the context */
.wind-speed,
.wind-unit {
  color: inherit;
  text-shadow: inherit;
  font-size: inherit;
  font-weight: inherit;
  padding: 0;
  white-space: nowrap;
}

.wind-unit {
  font-style: italic;
  opacity: 0.85;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
</style>
