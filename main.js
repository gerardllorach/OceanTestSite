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

// Ocean Analysis (virtual wave buoy) and its charts
import { OceanAnalysis } from "./Assets/Scripts/OceanAnalysis/OceanAnalysis.js";
window.OceanAnalysis = OceanAnalysis;
import * as AnalysisCharts from "./Assets/Scripts/OceanAnalysis/AnalysisCharts.js";
window.AnalysisCharts = AnalysisCharts;
// Wind sea (Pierson-Moskowitz, JONSWAP) for Physics-based
import * as WindSea from "./Assets/Ocean/WindSea.js";
window.WindSea = WindSea;
// Directional spreading models (constant, Mitsuyasu, Hasselmann, Donelan, Banner, Goda)
import * as DirectionalSpreading from "./Assets/Ocean/DirectionalSpreading.js";
window.DirectionalSpreading = DirectionalSpreading;
// Physics-based (wind-driven) sea: shared state of Generation > Quick, Generation > Physics-based and of the overlay
// (bottom-left)
import * as PhysicsBased from "./Assets/Scripts/PhysicsBased.js";
window.PhysicsBased = PhysicsBased;
window.physicsBased = Vue.reactive({ ...PhysicsBased.DEFAULT_PHYSICS_STATE });
// Digital twin (real world): the globe, the wave heights (Copernicus Marine) and the wind (Open-Meteo) of a place.
// Here and not imported by the panel: the .vue loader does not resolve the import map ('three')
import * as DigitalTwinData from "./Assets/DigitalTwin/DigitalTwinData.js";
window.DigitalTwinData = DigitalTwinData;
import { Globe } from "./Assets/DigitalTwin/Globe.js";
window.Globe = Globe;
// Place picked on the globe and what was found there; kept while the panel is closed
window.digitalTwin = Vue.reactive({
  lat: null, lon: null, names: [], // Where, and the names of its sea (Natural Earth), the most precise first
  namesExact: false,               // The point is in that sea (else it is the closest one, e.g. from the land)
  loading: false, error: '',
  Hm0: undefined, waveTime: null,  // m, null on land; time of the CMEMS field
  wind: null,                      // {speed (m/s), dir (from, deg), time}
  applied: null,                   // What was set in Quick (see DigitalTwinPanel.applyToSimulation)
});

// Unit of every wind speed in the app (WindSea.WIND_UNITS), as in VISOC: a click on a wind unit goes to the next one,
// everywhere. Remembered in this browser (when storage is available)
const WIND_UNIT_KEY = 'OceanTestSite.windUnit';
let windUnitIndex = 0;
try { windUnitIndex = Math.max(0, WindSea.WIND_UNITS.findIndex(u => u.unit == localStorage.getItem(WIND_UNIT_KEY))); } catch (e) { }
window.windUnit = Vue.reactive({
  index: windUnitIndex,
  cycle() {
    this.index = (this.index + 1) % WindSea.WIND_UNITS.length;
    try { localStorage.setItem(WIND_UNIT_KEY, WindSea.WIND_UNITS[this.index].unit); } catch (e) { }
  },
});
// Same for the wave heights of the Digital twin (DigitalTwinData.HEIGHT_UNITS: m, ft)
const HEIGHT_UNIT_KEY = 'OceanTestSite.heightUnit';
let heightUnitIndex = 0;
try { heightUnitIndex = Math.max(0, DigitalTwinData.HEIGHT_UNITS.findIndex(u => u.unit == localStorage.getItem(HEIGHT_UNIT_KEY))); } catch (e) { }
window.heightUnit = Vue.reactive({
  index: heightUnitIndex,
  get unit() { return DigitalTwinData.HEIGHT_UNITS[this.index] || DigitalTwinData.HEIGHT_UNITS[0]; },
  cycle() {
    this.index = (this.index + 1) % DigitalTwinData.HEIGHT_UNITS.length;
    try { localStorage.setItem(HEIGHT_UNIT_KEY, DigitalTwinData.HEIGHT_UNITS[this.index].unit); } catch (e) { }
  },
});


// Declare event emitter
// https://github.com/developit/mitt
window.eventBus = window.mitt();

// D3
import d3_timeseries from "./lib/d3-timeseries/d3_timeseries.js";
window.d3_timeseries = d3_timeseries;

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