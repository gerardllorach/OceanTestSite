<template>
  <div class="side-ui" :style="{ '--panel-width': panelWidth }">

    <!-- TOP RIGHT: menu button and sections. They move left when the side panel opens -->
    <nav class="top-right" :class="{ shifted: isOpen }">
      <div class="menu-button clickable" role="button" :aria-expanded="isOpen" :title="isOpen ? 'Close' : 'Menu'"
        @click="menuButtonClicked">
        <span v-if="!isOpen" class="menu-text">Menu</span>
        <span class="fa menu-icon" :class="{ 'menu-icon-close': isOpen }">{{ isOpen ? '' : '' }}</span>
      </div>

      <!-- Section button; its options slide out below it (the sections below move down) -->
      <div v-for="section in sections" :key="section.id" class="section-group"
        @mouseenter="pauseCollapse" @mouseleave="resumeCollapse(section)">
        <div class="section-button clickable" role="button" :aria-expanded="isExpanded(section)"
          :class="{ selected: openId == section.id }" :title="section.title" @click="sectionClicked(section)">
          <span class="section-text">{{ section.title }}</span>
          <span class="fa section-icon">{{ section.icon }}</span>
        </div>
        <div class="sub-buttons" :class="{ expanded: isExpanded(section) }">
          <div class="sub-buttons-inner">
            <div v-for="child in section.children" :key="child.title" class="sub-button" role="button"
              :class="[child.unavailable ? 'sub-unavailable' : 'clickable', { selected: item === child }]"
              :title="child.unavailable ? 'Not available yet' : child.title" @click="subClicked(section, child)">
              <span class="sub-text">{{ child.title }}</span>
              <span class="fa sub-icon">{{ child.isClickEvent ? '' : (child.icon || section.icon) }}</span>
            </div>
          </div>
        </div>
      </div>
    </nav>

    <!-- BOTTOM RIGHT: camera. Moves left when the side panel opens -->
    <div class="bottom-right" :class="{ shifted: isOpen }">
      <button class="round-button clickable" title="Center the camera on the buoy (0,0)" @click="centerCameraClicked">
        <span class="fa">{{ '' }}</span>
      </button>
      <button class="round-button clickable" title="Face north" @click="faceNorthClicked">
        <svg ref="compass-icon" xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 512 512" aria-hidden="true">
          <path class="south"
            d="M332.782,253.277a25.947,25.947,0,0,1,0,15.446L261.812,461.8c-1.567,4.265-4.109,4.265-5.677,0l-70.97-193.073a25.947,25.947,0,0,1,0-15.446H332.782Z" />
          <path class="north"
            d="M261.812,52.2l70.97,193.073a25.947,25.947,0,0,1,0,15.446H185.165a25.947,25.947,0,0,1,0-15.446L256.135,52.2C257.7,47.939,260.245,47.939,261.812,52.2Z" />
          <circle class="center" cx="260" cy="257" r="10" />
        </svg>
      </button>
    </div>

    <!-- SIDE PANEL -->
    <Transition name="slide-fade" @after-enter="notifyResize">
      <aside class="side-panel" v-show="isOpen">
        <!-- Header: back arrow, title, widen -->
        <div class="panel-header">
          <span v-if="item" class="fa header-icon back-arrow clickable" title="Back to the menu" @click="back">{{ '' }}</span>
          <span class="panel-title">{{ panelTitle }}</span>
          <span class="fa header-icon clickable" :title="isWide ? 'Narrow panel' : 'Wide panel'" @click="toggleWide">{{ isWide ? '' : '' }}</span>
        </div>

        <div class="panel-content">
          <!-- Menu: source code, sections and their options, about -->
          <menu-panel v-if="openId == 'menu'" :sections="sections" @select="optionSelected"></menu-panel>
          <!-- Content of an option -->
          <component v-else-if="item" :is="item.component"></component>
        </div>
      </aside>
    </Transition>
  </div>
</template>


<script>

import MenuPanel from './Panels/MenuPanel.vue';
import SeaStateAnalysisPanel from './Panels/SeaStateAnalysisPanel.vue';
import RenderStereoPanel from './Panels/RenderStereoPanel.vue';
import RenderHeightPanel from './Panels/RenderHeightPanel.vue';
import EnvironmentPanel from './Panels/EnvironmentPanel.vue';
import SeaStateGenerationPanel from './Panels/SeaStateGenerationPanel.vue';

// Options of a section hide again if none is clicked within this time
const COLLAPSE_MS = 4000;

export default {
  name: "SidePanel",
  mounted() {
    // Drag and drop a .json with discrete waves anywhere on the page
    document.body.addEventListener('dragover', this.onDragOver);
    document.body.addEventListener('drop', this.onDropFile);
    // Compass follows the camera orientation
    window.eventBus.on('Canvas3D_cameraChange', this.onCameraChange);
  },
  unmounted() {
    document.body.removeEventListener('dragover', this.onDragOver);
    document.body.removeEventListener('drop', this.onDropFile);
    window.eventBus.off('Canvas3D_cameraChange', this.onCameraChange);
    clearTimeout(this.collapseTimer);
  },
  data() {
    return {
      // What the side panel shows: '' (closed), 'menu', or the id of the section of the open option
      openId: '',
      // Open option (shown in the panel when openId is a section)
      item: null,
      // Section whose options are shown below its top-right button
      expandedId: '',
      isWide: false,
      sections: [
        {
          id: 'seastate', title: 'Sea State', icon: '',
          children: [
            { title: 'Generation', icon: '', component: 'sea-state-generation' },
            { title: 'Analysis', icon: '', component: 'sea-state-analysis' },
          ]
        },
        {
          id: 'export', title: 'Export', icon: '',
          children: [
            { title: 'Export discrete waves (.json)', isClickEvent: true,
              event: () => window.eventBus.emit('SidePanel_ExportWavesClicked') },
            { title: 'Render heights (.png)', icon: '', component: 'render-heights' },
            { title: 'Render stereo cameras (.png)', icon: '', component: 'render-stereo' },
          ]
        },
        {
          id: 'scene', title: 'Scene', icon: '',
          children: [
            { title: 'Add/Remove objects', unavailable: true },
            { title: 'Colors', unavailable: true },
            { title: 'Environment', component: 'environment' },
          ]
        },
      ],
    }
  },
  computed: {
    isOpen() {
      return this.openId != '';
    },
    panelTitle() {
      if (this.openId == 'menu') return 'Menu';
      return this.item ? this.item.title : '';
    },
    // Leaves room for the column of buttons on narrow screens
    panelWidth() {
      return this.isWide ? 'min(1000px, calc(100vw - 56px))' : 'min(680px, calc(100vw - 56px))';
    },
  },
  watch: {
    // Tell the app how much of the window the panel covers (AppManager shifts the 3D view)
    isOpen() { this.emitLayout(); },
    isWide() { this.emitLayout(); },
  },
  methods: {
    emitLayout: function () {
      window.eventBus.emit('SidePanel_layoutChanged', { isOpen: this.isOpen, width: this.panelWidth });
    },

    // USER ACTIONS
    // Menu button: opens the menu, or closes whatever is open (red cross)
    menuButtonClicked: function () {
      this.collapse();
      this.open(this.isOpen ? '' : 'menu');
    },
    // Section button: shows / hides its options below it. It never closes the panel
    // Options of a section shown below its button: while one of them is open in the panel, they stay (to switch to
    // another option of the same section); the others show for a while after clicking their section
    isExpanded: function (section) {
      return this.expandedId == section.id || (this.item != null && this.openId == section.id);
    },
    sectionClicked: function (section) {
      if (this.item != null && this.openId == section.id) return this.collapse(); // Its options stay open anyway
      if (this.expandedId == section.id) {
        this.collapse();
      } else {
        this.expandedId = section.id;
        this.startCollapseTimer();
      }
    },
    // Option below a section button
    subClicked: function (section, child) {
      if (child.unavailable) return;
      this.collapse();
      this.optionSelected(section, child);
    },
    // Option chosen (top-right buttons or menu): open it in the panel, or run its action (e.g. download)
    optionSelected: function (section, child) {
      if (!child || child.unavailable) return;
      if (child.isClickEvent) return child.event();
      this.open(section.id, child.title);
    },
    // Back arrow: from an option to the menu
    back: function () {
      this.open('menu');
    },
    toggleWide: function () {
      this.isWide = !this.isWide;
      setTimeout(this.notifyResize, 550); // After the width transition
    },
    faceNorthClicked: function () {
      window.eventBus.emit('SidePanel_faceNorthClicked');
    },
    centerCameraClicked: function () {
      window.eventBus.emit('SidePanel_centerCameraClicked');
    },

    // Open the panel: '' closes, 'menu', or a section id with the title of one of its options
    open: function (id, itemTitle) {
      const section = this.sections.find(s => s.id == id);
      const item = section ? section.children.find(c => c.title == itemTitle && c.component) : null;
      if (section && !item) return; // Sections have no page of their own, only their options
      this.openId = id;
      this.item = item || null;
    },

    // OPTIONS BELOW THE SECTION BUTTONS: hide after a while, but not while the pointer is over them
    startCollapseTimer: function () {
      clearTimeout(this.collapseTimer);
      this.collapseTimer = setTimeout(this.collapse, COLLAPSE_MS);
    },
    pauseCollapse: function () {
      clearTimeout(this.collapseTimer);
    },
    resumeCollapse: function (section) {
      if (this.expandedId == section.id) this.startCollapseTimer();
    },
    collapse: function () {
      clearTimeout(this.collapseTimer);
      this.expandedId = '';
    },

    // Charts inside the panel size themselves to its width
    notifyResize: function () {
      window.dispatchEvent(new Event('resize'));
    },

    // Compass rotates opposite to the camera
    onCameraChange: function (sceneManager) {
      const target = sceneManager.controls.target, camPos = sceneManager.camera.position;
      const angle = Math.atan2(camPos.x - target.x, camPos.z - target.z) * 180 / Math.PI;
      const icon = this.$refs['compass-icon'];
      if (icon) icon.style.transform = 'rotate(' + angle + 'deg)';
    },

    // DRAG & DROP A .JSON WITH DISCRETE WAVES (format: see "Export discrete waves (.json)")
    onDragOver: function (event) {
      event.preventDefault();
      event.stopPropagation();
    },
    onDropFile: function (event) {
      event.preventDefault();
      event.stopPropagation();
      let files = event.dataTransfer.files;
      if (!files || files.length == 0) return;
      let file = files[files.length - 1]; // Latest file
      let reader = new FileReader();
      reader.addEventListener('load', () => {
        let waves;
        try {
          waves = JSON.parse(reader.result);
          if (!Array.isArray(waves))
            throw new Error('Expected a list of waves: [{"hm0": 1, "T": 10, "dir": 0, "phase": 0}, ...]');
          waves = waves.map((w, i) => {
            const wave = { hm0: Number(w.hm0), T: Number(w.T), dir: Number(w.dir) || 0, phase: Number(w.phase) || 0 };
            if (!(wave.hm0 > 0) || !(wave.T > 0))
              throw new Error('Wave ' + (i + 1) + ' needs a positive "hm0" (m) and "T" (s)');
            return wave;
          });
        } catch (e) {
          console.error(e);
          alert('Could not read ' + file.name + '\n' + e.message);
          return;
        }
        // The sea is the FFT sea plus up to 2 discrete Gerstner waves (Assets/Ocean/OceanParams.js MAX_DISCRETE_WAVES)
        if (waves.length > 2)
          alert(file.name + ' has ' + waves.length + ' waves. The sea is the FFT sea plus up to 2 discrete Gerstner waves: the 2 highest are used.');
        // Same event as editing the discrete waves table: the scene, the table and the analysis update
        window.eventBus.emit('DiscreteWavesPanel_setDiscreteWaves', waves);
        this.open('seastate', 'Generation');
      });
      reader.addEventListener('error', e => {
        console.error('Could not read file ' + file.name, e);
      });
      reader.readAsText(file);
    },
  },
  components: {
    'menu-panel': MenuPanel,
    'sea-state-analysis': SeaStateAnalysisPanel,
    'render-heights': RenderHeightPanel,
    'render-stereo': RenderStereoPanel,
    'environment': EnvironmentPanel,
    'sea-state-generation': SeaStateGenerationPanel,
  }
}
</script>


<style scoped>
/* Buttons sit next to the panel when it is open */
.top-right,
.bottom-right {
  position: fixed;
  z-index: 21;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  pointer-events: none;
  transition: right 0.5s ease-out;
}

.top-right {
  top: 10px;
  right: 0;
}

.top-right.shifted {
  right: var(--panel-width);
}

.bottom-right {
  bottom: 16px;
  right: 12px;
  gap: 8px;
}

.bottom-right.shifted {
  right: calc(var(--panel-width) + 12px);
}

/* Menu button: text + bars icon; red cross when a panel is open */
.menu-button,
.section-button,
.sub-button {
  display: flex;
  align-items: center;
  pointer-events: auto;
  background: var(--darkBlue);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
}

.menu-button {
  height: 50px;
  padding: 4px;
  margin-bottom: 16px;
  border-radius: 30px 0 0 30px;
}

.menu-text,
.section-text,
.sub-text {
  color: white;
  text-shadow: 0 0 4px black;
  padding: 0 14px 0 16px;
  font-size: 0.85rem;
}

.menu-icon,
.section-icon,
.sub-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: white;
  text-shadow: 0 0 4px black;
  background: var(--lightBlue);
  box-shadow: 0 0 5px black;
  padding: 0;
  margin: 0 3px;
}

.menu-icon {
  width: 40px;
  height: 40px;
  font-size: 1.1rem;
}

.menu-icon-close {
  background: var(--red);
}

/* Section buttons */
.section-group {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  margin-bottom: 6px;
}

.section-button {
  padding: 4px;
  border-radius: 20px 0 0 20px;
}

.section-icon {
  width: 28px;
  height: 28px;
  font-size: 0.8rem;
}

.section-button.selected,
.sub-button.selected {
  background: var(--blue);
}

/* Options of a section, below its button. The grid row animates from 0 to its height,
   which pushes the sections below down smoothly */
.sub-buttons {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.35s ease-out;
}

.sub-buttons.expanded {
  grid-template-rows: 1fr;
}

.sub-buttons-inner {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding-left: 8px; /* Room for the shadows */
}

.sub-button {
  margin-top: 4px;
  padding: 3px;
  border-radius: 16px 0 0 16px;
  background: rgba(var(--darkBlueRGB), 0.9);
  opacity: 0;
  transform: translateX(30px);
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
  pointer-events: none;
}

.sub-buttons.expanded .sub-button {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}

.sub-buttons.expanded .sub-button:last-child {
  margin-bottom: 4px;
}

.sub-text {
  font-size: 0.75rem;
  padding: 0 10px 0 14px;
}

.sub-icon {
  width: 22px;
  height: 22px;
  font-size: 0.65rem;
}

.sub-button.sub-unavailable {
  cursor: not-allowed;
}

.sub-buttons.expanded .sub-button.sub-unavailable {
  opacity: 0.55;
}

/* Bottom-right round buttons */
.round-button {
  pointer-events: auto;
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 50%;
  background: var(--lightBlue);
  box-shadow: 0 0 5px black;
}

.round-button:hover {
  background: var(--blue);
}

.round-button>.fa {
  font-size: 1.2rem;
  padding: 0;
}

.north {
  stroke: #1a1a1a;
  stroke-width: 20px;
  fill-rule: evenodd;
  fill: #ed1c24;
}

.south {
  stroke: #1a1a1a;
  stroke-width: 20px;
  fill-rule: evenodd;
  fill: #ebebeb;
}

.center {
  stroke: #1a1a1a;
  stroke-width: 20px;
  fill: #1a1a1a;
}

/* Side panel */
.side-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--panel-width);
  z-index: 20;
  display: flex;
  flex-direction: column;
  background: rgb(200 240 255);
  box-shadow: -4px 0 12px rgba(0, 0, 0, 0.35);
  transition: width 0.5s ease-out;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(var(--darkBlueRGB), 0.15);
}

.panel-title {
  flex-grow: 1;
  color: var(--darkBlue);
  text-shadow: none;
  font-size: 1rem;
  font-weight: 600;
}

.header-icon {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--lightBlue);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
  padding: 0;
}

.panel-content {
  flex-grow: 1;
  overflow: auto;
}

/* Slide in from the right (as VISOC) */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: transform 0.5s ease-out, opacity 0.3s ease, width 0.5s ease-out;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

/* Narrow screens: section buttons show icons only (labels in the tooltips). Options keep their text */
@media screen and (max-width: 700px) {
  .section-text {
    display: none;
  }
}
</style>
