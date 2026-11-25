<template>
  <div id="quality-panel" class="content">

    <p>Rendering quality. Lower it if the animation is slow on this device. Phones and tablets start in Low,
      computers in High; the choice is remembered in this browser.</p>

    <div class="container-vertical options">
      <p class="section-title">Quality</p>
      <div class="segmented" role="radiogroup" aria-label="Rendering quality">
        <button v-for="p in presets" :key="p.id" class="clickable" role="radio" :aria-checked="quality.name == p.id"
          :class="{ 'button-active': quality.name == p.id }" @click="select(p.id)">{{ p.label }}</button>
      </div>

      <dl class="preset-list">
        <template v-for="p in presets" :key="p.id">
          <dt :class="{ current: quality.name == p.id }">{{ p.label }}{{ p.id == deviceDefault ? ' (default here)' : '' }}</dt>
          <dd>{{ p.description }}</dd>
        </template>
      </dl>

      <!-- Options of the simple shading: realism added back one step at a time -->
      <div v-if="quality.simpleShading" class="shading-options">
        <p class="section-title">Low: shading options</p>
        <label v-for="o in shadingOptions" :key="o.id" class="checkbox-label">
          <input type="checkbox" :checked="quality.shadingOptions[o.id]" @change="setOption(o.id, $event.target.checked)">
          {{ o.label }}
        </label>
        <p class="hint">Turn them off to see what each one costs on this device.</p>
      </div>

      <p class="status" role="status">Now: {{ statusText }}</p>
      <p v-if="fftUnavailable" class="warning">This browser cannot render to float textures: the sea is drawn with
        Gerstner components in every quality.</p>
    </div>
  </div>
</template>



<script>

const DESCRIPTIONS = {
  high: 'FFT sea on a 512² grid (waves down to 4 m) and FFT ripples on a 256² grid (down to ~9 cm), 1M-vertex mesh.',
  medium: 'FFT sea on a 256² grid (waves down to 8 m), FFT ripples on a 256² grid, half-float FFT, 500k-vertex mesh.',
  low: 'The first version: 10 Gerstner waves and simple shading (Fresnel against the sky, one sun highlight), ' +
    'ripples from a precomputed loop, with optional sky cube map and rough Fresnel. 300k-vertex mesh. For phones.',
};

export default {
  name: "QualityPanel",
  mounted() {
    window.eventBus.on('OceanEntity_qualityChanged', this.onQualityChanged);
    if (window.sceneManager) {
      const { presets, shadingOptions, deviceDefault } = window.sceneManager.getQualityPresets();
      this.shadingOptions = Object.keys(shadingOptions).map(id => ({ id, label: shadingOptions[id].label }));
      this.presetSettings = presets;
      this.deviceDefault = deviceDefault;
      this.presets = Object.keys(presets).map(id => ({ id, label: presets[id].label, description: DESCRIPTIONS[id] }));
      this.onQualityChanged(window.sceneManager.getQuality());
    }
  },
  unmounted() {
    window.eventBus.off('OceanEntity_qualityChanged', this.onQualityChanged);
  },
  data() {
    return {
      quality: { name: '', fft: false, simpleShading: false, shadingOptions: {} },
      shadingOptions: [],
      deviceDefault: '',
      presets: [],
      presetSettings: {},
    }
  },
  computed: {
    // The preset wants the FFT but it is not running: the browser cannot do it
    fftUnavailable() {
      const preset = this.presetSettings[this.quality.name];
      return preset && preset.fft && !this.quality.fft;
    },
    statusText() {
      const q = this.quality;
      if (!q.name) return '';
      const mesh = `${Math.round(q.gridVertices / 1000)}k-vertex mesh`;
      if (!q.fft) {
        const on = this.shadingOptions.filter(o => q.shadingOptions[o.id]).map(o => o.label.toLowerCase());
        const shading = q.simpleShading ? 'simple shading' + (on.length ? ' + ' + on.join(', ') : '') : 'full shading';
        return `Gerstner sea (${q.numWaves} waves), ${shading}${q.rippleLoop ? ', ripple loop' : ''}, ${mesh}`;
      }
      return `FFT sea ${q.seaN}², ripples ${q.rippleN}², ${q.halfFloat ? 'half float' : 'float32'}, ${mesh}`;
    },
  },
  methods: {
    onQualityChanged(quality) {
      this.quality = quality;
    },
    setOption(id, value) {
      window.eventBus.emit('QualityPanel_shadingOptionsChanged', { [id]: value });
    },
    select(name) {
      if (name != this.quality.name) window.eventBus.emit('QualityPanel_changed', name);
    },
  },
}
</script>



<style scoped>
.content {
  padding: 20px;
  overflow: auto;
  font-size: small;
  max-width: 700px;
}

.container-vertical {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  gap: 8px;
}

.options {
  padding: 16px 20px;
  background: var(--lightBlue);
  border-radius: 20px;
}

.section-title {
  font-weight: 600;
  margin: 0;
}

.segmented {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.segmented button {
  padding: 4px 14px;
}

.preset-list {
  margin: 4px 0 0;
}

.preset-list dt {
  font-weight: 600;
  margin-top: 6px;
}

.preset-list dt.current::before {
  content: '▸ ';
}

.preset-list dd {
  margin: 2px 0 0 0;
  font-size: x-small;
}

.status {
  margin: 4px 0 0;
  font-size: x-small;
}

.warning {
  margin: 0;
  font-size: x-small;
  color: #8a3b12;
}
.shading-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hint {
  margin: 0;
  font-size: x-small;
}
</style>
