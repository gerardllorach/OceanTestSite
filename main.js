// https://github.com/FranckFreiburger/vue3-sfc-loader
// https://github.com/FranckFreiburger/vue3-sfc-loader/blob/main/docs/examples.md#use-sfc-custom-blocks-for-i18n

// Load classes
// SceneManager
import SceneManager from "/OceanTestSite/Assets/Scripts/SceneManager.js"
window.SceneManager = SceneManager;
// DataManager
// import DataManager from "/OceanTestSite/data/DataManager.js"
// window.DataManager = DataManager;

// WMS Data Retriever
import WMSDataRetriever from '/OceanTestSite/Assets/Scripts/WMSDataRetriever.js';
window.WMSDataRetriever = WMSDataRetriever;

// Ocean Analsys
import { OceanAnalysis } from "./Assets/Scripts/OceanAnalysis/OceanAnalysis.js";
window.OceanAnalysis = OceanAnalysis;


// Declare event emitter
// https://github.com/developit/mitt
window.eventBus = window.mitt();

const options = {
  moduleCache: { vue: Vue },
  async getFile(url) {
    const res = await fetch(url);
    if (!res.ok)
      throw Object.assign(new Error(res.statusText + ' ' + url), { res });
    return {
      getContentData: asBinary => asBinary ? res.arrayBuffer() : res.text(),
    }
  },
  addStyle: (textContent) => {
    const style = Object.assign(document.createElement('style'), { textContent });
    const ref = document.head.getElementsByTagName('style')[0] || null;
    document.head.insertBefore(style, ref);
  },
}


const { loadModule } = window['vue3-sfc-loader'];

const app = Vue.createApp({
  components: {
    'app-manager': Vue.defineAsyncComponent(() => loadModule('/OceanTestSite/Components/AppManager.vue', options)),
  },
  template: '<app-manager></app-manager>'
});


app.mount(document.body);