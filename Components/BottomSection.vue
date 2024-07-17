<template>
  <!-- Container -->
  <div id="bottom-section" :class="[isSectionOpen ? isMenuFullscreen ? 'bottom-section-fullscreen' : 'bottom-section-open' : 'bottom-section-closed']">
    <!-- Button to open and close section -->
    <div class="section-opener-container">
      <button class="section-opener-button clickable" @click="bottomSectionClicked">
        <span>Menu</span>
        <span class="fa" :class="[isSectionOpen ? 'rotate180' : 'rotate0']">&#xf106;</span>
      </button>
    </div>

    <div class="menu-section-container" v-show="isSectionOpen">
      
      <!-- Menu left -->
      <div class="menu-list-left">
        <button v-for="el in menu" :key="el.title" 
          class="menu-left-button clickable" :class="[selectedMenu == el.title ? 'menu-left-button-sel' : '']" 
          @click="menuLeftItemClicked(el)">
          <span v-if="el.icon" class="fa" v-html="el.icon"></span>
          <span>{{ el.title }}</span>
        </button>
      </div>
      
      <!-- Submenu center -->
      <div class="submenu-container">
        <div v-for="el in menu" :key="el.title">
          
          <!-- In submenu -->
          <div v-if="selectedMenu == el.title && selectedSubEl.title == ''">
            <!-- Submenu title -->
            <div class="submenu-title">
              <div class="fa" v-html="el.icon"></div>
              {{ el.title }}
            </div>
            <!-- Submenu items -->
            <div class="submenu-items-container">
              <div v-for="subEl in el.children" class="clickable" @click="submenuItemClicked(subEl)">
                <div>
                  <span v-if="subEl.icon" class="fa" v-html="subEl.icon"></span>
                  <span v-else-if="el.icon" class="fa" v-html="el.icon"></span>
                  <span>{{subEl.title }}</span>
                </div>
                <span class="fa">&#xf0da;</span>
              </div>
            </div>
          </div>

          <!-- In item of submenu -->
          <div v-else-if="selectedMenu == el.title &&selectedSubEl.title != ''">
            <!-- Submenu Item title -->
            <div class="submenu-item-title clickable" @click="backToSubmenu()">
              <!-- Return arrow -->
              <div class="fa">&#xf060;</div>
              <!-- Title -->
              <div>
                {{ selectedSubEl.title }}
                <!-- <div v-if="selectedSubEl.icon" class="fa" v-html="selectedSubEl.icon"></div>
                <div v-else-if="el.icon" class="fa" v-html="el.icon"></div> -->
              </div>
              
            </div>
            
            <!-- Component? -->
          </div>


        </div>
      </div>

      <!-- Top-right icons -->
      <div class="top-right-icons">
        <div class="icon-str fa clickable" @click="fullscreenClicked">&#xf065;</div>
        <div class="icon-str fa clickable" @click="closeClicked">&#xf00d;</div>
      </div>
    </div>
  </div>
</template>


<script>

export default {
  name: "BottomSection",
  created() {},
  mounted() {

  },
  data () {
    return {
      isSectionOpen: true,
      isMenuFullscreen: false,
      // Selected menu items
      selectedMenu: 'Waves',
      selectedSubEl: {title: ''},
      // Menu structure
      menu: [
        {
          title: 'Waves',
          icon: '&#xf773',
          children: [
            {
              title: 'Individual waves',
              component: 'IndividualWavesComponent'
            },
            {
              title: 'Sea state analysis',
              icon: '&#xf201',
              component: 'AnalysisWaveComponent'
            }
          ]
        }, // End of waves
        {
          title: 'Export',
          icon: '&#xf56e',
          children: [
            {
              title: 'Export individual waves (.json)',
              // Button
            },
            {
              title: 'Render heights (.png)',
              component: 'RenderHeights',
            },
            {
              title: 'Render stereo cameras (.png)',
              component: 'RenderStereo',
            }
          ]
        }, // End of export
        {
          title: 'Scene',
          icon: '&#xf61f',
          children: [
            {
              title: 'Add/Remove objects',
              component: 'SceneObjects'
            },
            {
              title: 'Colors',
              component: 'SceneColors',
            },
            {
              title: 'Environment',
              component: 'SceneEnvironment'
            }
          ]
        }, // End of scene
        {
          title: 'About',
          icon: '&#xf05a',
          component: 'About'
        } // End of about
      ] // End of menu
    }
  },
  methods: {
    // USER ACTIONS
    // Shows / Hides bottom section
    bottomSectionClicked: function (e){
      this.isSectionOpen = !this.isSectionOpen;
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 750);
    },
    // Menu option on the left clicked
    menuLeftItemClicked: function(el){
      this.selectedMenu = el.title;
      this.selectedSubEl = {title: ''};
    },
    // Submenu item clicked
    submenuItemClicked: function(subEl){
      this.selectedSubEl = subEl;
    },
    // Submenu title clicked
    backToSubmenu: function(){
      this.selectedSubEl = {title: ''};
    },

    // Top-right-icons
    closeClicked: function(){
      this.bottomSectionClicked();
    },
    fullscreenClicked: function(){
      this.isMenuFullscreen = !this.isMenuFullscreen;
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 750);
    },
  }
}


</script>

<style scoped>
#bottom-section {
  position: relative;
  width: 100%;
  background: rgb(200 240 255);;
}

.bottom-section-open {
  height: 100%;
  transition: all 0.7s ease-in-out;
}
.bottom-section-fullscreen{
  height: 900%;
  transition: all 0.7s ease-in-out;
}

.bottom-section-closed {
  height: 0;
  transition: all 0.7s ease-in-out;
}

.section-opener-container {
  display: flex;
  justify-content: center;
  translate: 0px -60px;
  height: 0px;
}
.section-opener-container > button {
  height: 40px;
  padding-left: 20px;
  padding-right: 20px;
  border: solid;
}
.rotate0 {
  rotate: 0deg;
  transition: all 0.7s ease-in-out;
}
.rotate180 {
  rotate: 180deg;
  transition: all 0.7s ease-in-out;
}


.menu-section-container {
  display: flex;
  padding: 20px;
}

.menu-list-left {
  padding: 10px;
}
.menu-list-left > button {
  margin-bottom: 10px;
  width: 100%;
}
.menu-left-button {
  padding-left: 10px;
  padding-right: 10px;
}
.menu-left-button-sel{
  background: var(--blue);
}

.submenu-container {
  width: 100%;
  padding-left: 10px;
  padding-right: 20px;
}
.submenu-container > div >div {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.submenu-title {
  padding-top: 10px;
  padding-bottom: 10px;
  text-align: center;
}

.submenu-items-container {
  box-shadow: 0px 0px 4px rgba(0, 0, 0, 0.304);
  border-radius: 15px;
  background: var(--lightBlue);
  max-width: 500px;
  width: 100%;
}
.submenu-items-container > div {
  padding: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.submenu-items-container > div:hover {
  background: var(--blue);
  border-radius: 15px;
}

.submenu-item-title {
  display: flex;
  align-items: center;
  box-shadow: 0px 0px 4px black;
  border-radius: 20px;
  padding: 10px;
  font-size: small;
}
.submenu-item-title > *{
  padding-left: 10px;
  padding-right: 10px;
}


.top-right-icons {
  position: absolute;
  right: 10px;
  display: flex;
}
</style>