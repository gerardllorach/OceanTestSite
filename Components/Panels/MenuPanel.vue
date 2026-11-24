<template>
  <div id="menu-panel" class="content">

    <!-- Links and options -->
    <div class="menu-links">
      <a href="https://github.com/gerardllorach/OceanTestSite" target="_blank" rel="noopener noreferrer"
        title="Open the source code on GitHub (external page)">
        <button class="clickable">
          <svg height="16" width="16" viewBox="0 0 16 16" aria-hidden="true">
            <path fill="currentColor"
              d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
          </svg>
          <span>Source code</span>
          <span class="fa">{{ '' }}</span>
        </button>
      </a>
      <button class="clickable" :class="{ 'button-active': showFPS }" @click="fpsClicked" title="Show the frames per second of the 3D view">
        <span>Frame rate (fps)</span>
      </button>
    </div>

    <!-- One row per section: a square tile (label only) and its options on the right -->
    <div class="sections">
      <div v-for="section in sections" :key="section.id" class="section-row">
        <div class="section-tile">
          <div class="tile-square"><span class="fa">{{ section.icon }}</span></div>
          <div class="tile-text">{{ section.title }}</div>
        </div>
        <div class="options">
          <button v-for="child in section.children" :key="child.title" class="option"
            :class="child.unavailable ? 'option-unavailable' : 'clickable'" :disabled="child.unavailable"
            :title="child.unavailable ? 'Not available yet' : (child.isClickEvent ? 'Download' : 'Open ' + child.title)"
            @click="$emit('select', section, child)">
            <span class="fa option-icon">{{ child.icon || section.icon }}</span>
            <span class="option-title">{{ child.title }}</span>
            <!-- Right: opens a page, or does an action (download) -->
            <span v-if="child.isClickEvent" class="fa option-end">{{ '\uf019' }}</span>
            <span v-else-if="!child.unavailable" class="fa option-end">{{ '\uf0da' }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <!-- About -->
    <about-panel></about-panel>
  </div>
</template>


<script>
import AboutPanel from './AboutPanel.vue';

export default {
  name: "MenuPanel",
  props: {
    // Sections of the side panel: [{id, title, icon, children: [{title, icon, component | isClickEvent, unavailable}]}]
    sections: { type: Array, required: true },
  },
  // select(section, child): an option was chosen (opens its page, or runs its action)
  emits: ['select'],
  mounted() {
    if (window.sceneManager) this.showFPS = !!window.sceneManager.stats.isVisible;
  },
  data() {
    return {
      showFPS: false,
    }
  },
  methods: {
    fpsClicked: function () {
      window.eventBus.emit('MenuPanel_fpsClicked');
      this.showFPS = !this.showFPS;
    },
  },
  components: {
    'about-panel': AboutPanel,
  }
}
</script>


<style scoped>
.content {
  padding: 10px 20px;
}

.menu-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.menu-links a {
  text-decoration: none;
}

.menu-links button {
  padding: 4px 12px;
  gap: 4px;
}

/* Sections: one row each (as VISOC dashboards) */
.sections {
  margin-top: 12px;
}

.section-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(var(--darkBlueRGB), 0.15);
}

/* Square tile: only a label, the options do the navigation */
.section-tile {
  flex-shrink: 0;
  width: 72px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.tile-square {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: linear-gradient(160deg, var(--blue), var(--darkBlue));
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.4);
}

.tile-square>.fa {
  font-size: 1.6rem;
  padding: 0;
}

.tile-text {
  margin-top: 4px;
  color: var(--darkBlue);
  font-size: 0.75rem;
  font-weight: 600;
  text-align: center;
}

/* Options: same width, icon at the right (> opens a page, or the action) */
.options {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.option {
  width: 100%;
  justify-content: flex-start;
  gap: 2px;
  padding: 5px 12px;
}

.option-title {
  flex-grow: 1;
  text-align: left;
}

.option-end {
  margin-left: 6px;
}

.option-unavailable {
  opacity: 0.5;
  cursor: not-allowed;
}

.option-unavailable:hover {
  background-color: var(--darkBlue);
}

.divider {
  height: 1px;
  background: rgba(var(--darkBlueRGB), 0.25);
  margin: 16px 0 0;
}
</style>
