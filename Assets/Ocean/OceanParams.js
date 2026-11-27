/*
AWAK SENSOR
https://www.youtube.com/watch?v=iP0r-2PaMqE&ab_channel=Nortek
https://www.youtube.com/watch?v=bFV_1t0AFGY&ab_channel=Geo-matching
https://www.youtube.com/watch?v=FBB_qAe2ZwI&ab_channel=VassilisSkanavis

Hm0_ADCPWaves : Spectral significant wave height of waves {Hm0} on the water body by acoustic doppler wave array

avHeightOnethirdADCPWaves : Wave height mean of waves (highest one third) on the water body by acoustic doppler wave array

Hsig_upper_10_per_cent : Wave height mean of waves (highest one tenth) on the water body by acoustic doppler wave array

Hmax_ADCP : Wave height maximum of waves on the water body by acoustic doppler wave array

WaveAvgPer_ADWA : Period mean of waves on the water body by acoustic doppler wave array

WavePeriodSpecMax_ADCP : Period at spectral maximum of waves {peak period Tp} on the water body by acoustic doppler wave array

MeanWavePeriodTz_ADWA : Zero-crossing period of waves {Tz} on the water body by acoustic doppler wave array

Spectral_max_dirn_waveArray : Direction (from) at spectral maximum of waves on the water body by acoustic doppler wave array

directionalSprealADCPwaves : Directional spreading of waves on the water body by acoustic doppler wave array

MeanDir_ADCPWaves : Direction (from) mean of waves {mean wave direction} on the water body by acoustic doppler wave array

Unidir_Ind_ADCP_Waves : Unidirectivity index of waves on the water body by acoustic doppler wave array and computation using protocol of Barstow et al. (1991)
*/

import { generateSea, generateFFTSea, DEFAULT_SEA_SETTINGS, FFT_N } from '/OceanTestSite/Assets/Ocean/SeaSpectrum.js';

// The sea is made of layers:
//  - FFT sea: the spectrum of the sea state (JONSWAP / Pierson-Moskowitz from the sea state parameters, Assets/Ocean/
//    SeaSpectrum.js) on a grid of wavevectors (generateFFTSea), computed on the GPU (Assets/Ocean/FFTOcean.js).
//  - Up to MAX_DISCRETE_WAVES discrete Gerstner waves (this list) added on top of it, e.g. one or two swells: set one
//    by one (discrete waves panel, dropped .json). Sent to the GPU in a float texture (getWaveParamsImageData).
// Only if the browser cannot run the FFT (no float render targets), the spectrum is rendered with Gerstner components
// instead (method 'gerstner', generateSea), which then replace the discrete waves.

// Discrete Gerstner waves on top of the FFT sea (each one is evaluated for every vertex)
export const MAX_DISCRETE_WAVES = 2;
export class OceanParameters{

  oceanParameters = {
    Hm0: 1.04,
    H3: 0.94,
    H10: 1.21,
    hMax: 1.58,
    Mdir: 195.58,
    Spr1: 36.7,
    timestamp: '2019-11-14 02:05h',
    // Spectrum (see SeaSpectrum.js)
    method: DEFAULT_SEA_SETTINGS.method, // 'fft', 'gerstner' or 'none'
    Tp: null,      // Peak period (s). null: fully developed sea for Hm0 (Pierson-Moskowitz)
    gamma: DEFAULT_SEA_SETTINGS.gamma,
    numComponents: DEFAULT_SEA_SETTINGS.count, // Method 'gerstner'
    choppiness: DEFAULT_SEA_SETTINGS.choppiness, // Method 'fft'
    seed: DEFAULT_SEA_SETTINGS.seed,
    // Directional spreading (see DirectionalSpreading.js). 'constant' uses Spr1
    spreadModel: DEFAULT_SEA_SETTINGS.spreadModel,
    spreadWind: DEFAULT_SEA_SETTINGS.spreadWind, // U10 (m/s) of the wind-dependent spreadings, null: from Hm0 and Tp
    spreadSmax: DEFAULT_SEA_SETTINGS.spreadSmax, // Goda & Suzuki
    // Shape of the spectrum (see SeaSpectrum.js): 'jonswap' or 'elfouhaily' (its wind and inverse wave age), depth (TMA)
    spectrum: DEFAULT_SEA_SETTINGS.spectrum,
    spectrumWind: DEFAULT_SEA_SETTINGS.spectrumWind,
    Omega: DEFAULT_SEA_SETTINGS.Omega,
    depth: DEFAULT_SEA_SETTINGS.depth,
    randomAmplitudes: DEFAULT_SEA_SETTINGS.randomAmplitudes,
  }

  numWaves = 0;
  waveHeights = [];
  wavePeriods = [];
  waveDirections = [];
  waveSteepness = [];
  wavePhases = [];

  // Spectrum the discrete waves come from (output of generateSea, method 'gerstner'), or null when they were set by hand
  sea = null;
  // FFT sea (output of generateFFTSea, method 'fft'), or null
  fftSea = null;
  // Grid of the FFT sea (rendering quality, see Assets/Ocean/Quality.js)
  fftN = FFT_N;

  // Values are divided by these before going to the GPU (the shader multiplies them back)
  WAVE_MAX = 10;
  PERIOD_MAX = 20;

  constructor(oceanParameters, numWaves, fftN = FFT_N){
    this.fftN = fftN;
    // Assign given ocean parameters (if any)
    let keys = Object.keys(oceanParameters);
    keys.forEach(kk => this.oceanParameters[kk] = oceanParameters[kk]);
    if (numWaves) this.oceanParameters.numComponents = numWaves;

    this.generateDistributions();
    this.createHTMLGidget();
    this.updateHTMLGidget();
  }



  // Sea state settings for the spectrum generator
  getSeaSettings = function(){
    const p = this.oceanParameters;
    return { method: p.method, Hm0: p.Hm0, Tp: p.Tp, gamma: p.gamma, Mdir: p.Mdir, spread: p.Spr1,
      spreadModel: p.spreadModel, spreadWind: p.spreadWind, spreadSmax: p.spreadSmax,
      count: p.numComponents, choppiness: p.choppiness, seed: p.seed, spectrum: p.spectrum, spectrumWind: p.spectrumWind,
      Omega: p.Omega, depth: p.depth, randomAmplitudes: p.randomAmplitudes };
  }

  // Generate the sea from the spectrum of the sea state, with the current method
  generateDistributions = function(){
    const settings = this.getSeaSettings();
    if (settings.method == 'gerstner') {
      const sea = generateSea(settings);
      this.sea = sea;
      this.fftSea = null;
      this.setWaves(sea.waves);
      return;
    }
    // FFT or none: the generated Gerstner components (if any) go away, the hand-set waves stay
    if (this.sea) {
      this.sea = null;
      this.setWaves([]);
    }
    this.fftSea = settings.method == 'fft' ? generateFFTSea(settings, this.fftN) : null;
  }

  // Waves: [{hm0, T, dir, phase}]
  setWaves = function(waves){
    this.numWaves = waves.length;
    this.waveHeights = waves.map(w => Math.abs(w.hm0));
    this.wavePeriods = waves.map(w => w.T);
    this.waveDirections = waves.map(w => w.dir || 0);
    this.wavePhases = waves.map(w => w.phase || 0);
    // Steepness k a (kept for compatibility)
    this.waveSteepness = waves.map(w => 4 * Math.PI * Math.PI * Math.abs(w.hm0) * 0.5 / (w.T * w.T * 9.8));
  }

  // Waves set one by one, added to the FFT sea (at most MAX_DISCRETE_WAVES: the largest ones are kept)
  setDiscreteWaves = function(waves){
    this.sea = null;
    if (waves.length > MAX_DISCRETE_WAVES)
      waves = waves.slice().sort((a, b) => Math.abs(b.hm0) - Math.abs(a.hm0)).slice(0, MAX_DISCRETE_WAVES);
    this.setWaves(waves);
  }

  // Sea state settings, e.g. {Hm0, Tp, gamma, Mdir, Spr1, choppiness, seed}. Regenerates the sea.
  // The method is always the FFT (only the fallback for browsers without float render targets changes it)
  setSeaSettings = function(settings, allowMethod = false){
    Object.keys(settings).forEach(key => { if (key != 'method' || allowMethod) this.oceanParameters[key] = settings[key]; });
    this.generateDistributions();
    this.updateHTMLGidget();
  }



  // Given parameters by the csv
  updateParams = function(params){
    this.oceanParameters.Hm0 = params.Hm0;
    this.oceanParameters.H3 = params.H3 < 0 ? params.Hm0 : params.H3; // Could have invalid number (-999.99);
    this.oceanParameters.H10 = params.H10;
    this.oceanParameters.hMax = params.Hmax;

    this.oceanParameters.Mdir = params.Mdir;
    this.oceanParameters.Spr1 = params.Spr1 < 0 ? 90 : params.Spr1; // Could have invalid number (-999.99);
    if (params.Tp > 0) this.oceanParameters.Tp = params.Tp;

    this.oceanParameters.timestamp = params.timestamp;

    this.generateDistributions();
    this.updateHTMLGidget();
  }

  // Update wave significant height
  updateWaveSignificantHeight = function(Hm0){
    this.oceanParameters.Hm0 = Hm0;
    this.generateDistributions();
    //this.updateHTMLGidget();
  }
  updateMeanWaveDirection = function(mdir){
    this.oceanParameters.Mdir = mdir;
    this.generateDistributions();
    //this.updateHTMLGidget();
  }
  updateDirectionalSpread = function(spr1){
    this.oceanParameters.Spr1 = spr1;
    this.generateDistributions();
  }






  createHTMLGidget = function(){
    this.canvas = document.createElement("canvas");
    let canvas = this.canvas;
    canvas.width = 300;
    canvas.height = 500;
    canvas.style.position = "absolute";
    canvas.style.bottom = "0px";
    canvas.style.right = "0px";
    //document.body.append(canvas);
  }


  updateHTMLGidget = function(){
    let canvas = this.canvas;
    let context = canvas.getContext('2d');

    // Background
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(0,0,0,0.7)";
    context.fillRect(0, 0, canvas.width, canvas.height);

    // WAVE HEIGHTS
    context.translate(30, 200);
    context.scale(1, -1);
    let xFactor = 80;
    // Axis
    context.strokeStyle = "rgb(255,255,255)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, 100);
    context.lineTo(0, 0);
    context.lineTo((this.oceanParameters.hMax*1.2) * xFactor, 0);
    context.stroke();
    // Hm0
    context.strokeStyle = "rgba(255, 255, 0, 0.8)";
    context.beginPath();
    context.moveTo(this.oceanParameters.Hm0 * xFactor, 100);
    context.lineTo(this.oceanParameters.Hm0 * xFactor, 0);
    context.stroke();
    // H3
    context.strokeStyle = "rgba(255, 0, 255, 0.8)";
    context.beginPath();
    context.moveTo(this.oceanParameters.H3 * xFactor, 100);
    context.lineTo(this.oceanParameters.H3 * xFactor, 0);
    context.stroke();
    // H10
    context.strokeStyle = "rgba(0, 255, 0, 0.8)";
    context.beginPath();
    context.moveTo(this.oceanParameters.H10 * xFactor, 100);
    context.lineTo(this.oceanParameters.H10 * xFactor, 0);
    context.stroke();
    // hMax
    context.strokeStyle = "rgba(255, 0, 0, 0.8)";
    context.beginPath();
    context.moveTo(this.oceanParameters.hMax * xFactor, 100);
    context.lineTo(this.oceanParameters.hMax * xFactor, 0);
    context.stroke();
    // Gaussian histogram
    context.lineWidth = 2;
    context.strokeStyle = "rgba(255, 255, 255, 0.8)";
    context.beginPath();
    context.moveTo(0, 0);
    for (let i = 0; i < Math.max(...this.waveHeights); i = i + 0.5) {
      let filtered = this.waveHeights.filter(el => (el < i + 0.5) && (el > i));
      context.lineTo((i + 0.25) * xFactor, filtered.length / this.waveHeights.length * 200);
    }
    context.stroke();
    context.resetTransform();

    context.translate(10, 20);
    // Informative text
    let textSeparation = 15;
    context.font = '12pt Calibri';
    context.textAlign = 'left';
    context.fillStyle = 'white';
    context.fillText('Wave heights. Num. waves: ' + this.waveHeights.length, 0, 0);
    context.fillText('Timestamp: ' + this.oceanParameters.timestamp, 0, textSeparation)
    context.font = '10pt Calibri';
    context.fillStyle = "rgba(255, 255, 0, 0.8)";
    context.fillText('Hm0: ' + this.oceanParameters.Hm0 + "m", 0, textSeparation*2);
    context.fillStyle = "rgba(255, 0, 255, 0.8)";
    context.fillText("H3: " + this.oceanParameters.H3 + "m", 0, textSeparation * 3);
    context.fillStyle = "rgba(127, 255, 127, 0.8)";
    context.fillText("H10: " + this.oceanParameters.H10, 0, textSeparation * 4);
    context.fillStyle = "rgba(255, 127, 127, 0.8)";
    context.fillText('Hmax: ' + this.oceanParameters.hMax + "m", 0, textSeparation * 5);

    context.resetTransform();


    // WAVE DIRECTIONS
    context.translate(canvas.width / 2, 380);
    // Circle
    let radius = 50;
    context.lineWidth = 1;
    context.beginPath();
    context.arc(0, 0, radius, 0, 2 * Math.PI);
    context.stroke();
    // Axis
    context.strokeStyle = "rgba(255,255,255,0.2)";
    context.beginPath();
    context.moveTo(0, 0);
    for (let i = 0; i < 360; i += 360 / 12) {
      context.lineTo(Math.cos(i * Math.PI / 180) * radius, Math.sin(i * Math.PI / 180) * radius);
      context.lineTo(0, 0);
    }
    context.stroke();

    context.rotate(-Math.PI / 2)
    // Selected orientation
    context.lineWidth = 5;
    context.strokeStyle = "rgba(0,255,0,1)";
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(Math.cos(this.oceanParameters.Mdir * Math.PI / 180) * radius * 1.2, Math.sin(this.oceanParameters.Mdir * Math.PI / 180) * radius * 1.2);
    context.stroke();
    // Histogram
    context.lineWidth = 2;
    let step = 15;
    let histSizeFactor = 7;
    context.strokeStyle = "rgba(255, 255, 255, 0.8)";
    context.beginPath();
    context.moveTo(0, 0);
    for (let i = 0; i < 360 + step; i = i + step) {
      let filtered = this.waveDirections.filter(el => {
        el = (el + 360 * 10) % 360; // Transform to 0-360 space
        return ((el < i % 360 + step) && (el > i % 360))
      });
      let amount = histSizeFactor * radius * filtered.length / this.waveDirections.length;
      if (i == 0)
        context.moveTo(Math.cos((i + step / 2) * Math.PI / 180) * amount, Math.sin((i + step / 2) * Math.PI / 180) * amount);
      else
        context.lineTo(Math.cos((i + step / 2) * Math.PI / 180) * amount, Math.sin((i + step / 2) * Math.PI / 180) * amount);
    }
    context.stroke();
    context.resetTransform();

    context.translate(10, 280);
    // Informative text
    textSeparation = 15;
    context.font = '12pt Calibri';
    context.textAlign = 'left';
    context.fillStyle = 'white';
    context.fillText('Wave directions', 0, 0)
    context.font = '10pt Calibri';
    context.fillText('Mdir: ' + this.oceanParameters.Mdir + " º", 0, textSeparation);
    context.fillText("Spr1: " + this.oceanParameters.Spr1 + " º", 0, textSeparation * 2);
    context.resetTransform();
  }




  // Wave parameters for the GPU: a float RGBA texture of dataTextureSize x dataTextureSize, one texel per wave:
  // (period / PERIOD_MAX, height / WAVE_MAX, direction / 360, phase / 360). The shader multiplies them back.
  // Float, not 8 bits: the small components of a spectrum (a few cm) would round to zero in steps of WAVE_MAX / 255.
  getWaveParamsImageData = function(dataTextureSize, out){
    const data = out || new Float32Array(dataTextureSize * dataTextureSize * 4);
    data.fill(0);
    const wrap360 = deg => ((deg % 360) + 360) % 360;
    for (let i = 0; i < Math.min(this.numWaves, dataTextureSize * dataTextureSize); i++) {
      data[i * 4] = this.wavePeriods[i] / this.PERIOD_MAX;
      data[i * 4 + 1] = Math.abs(this.waveHeights[i]) / this.WAVE_MAX;
      data[i * 4 + 2] = wrap360(this.waveDirections[i]) / 360;
      data[i * 4 + 3] = wrap360(this.wavePhases[i] || 0) / 360;
    }
    return data;
  }


  // Generate a JSON with wave parameters
  getDiscreteWavesJSON = function(){
    let out = [];
    for (let i = 0; i < this.numWaves; i++){
      let wave = {
        hm0: this.waveHeights[i],
        dir: this.waveDirections[i],
        T: this.wavePeriods[i],
        phase: this.wavePhases[i] || 0,
      };
      out.push(wave);
    }
    return out;
  }


   // Export ocean parameters
   exportOceanParameters = function(){
    return new Promise((resolve) => {
      const link = document.createElement('a');
      link.download = 'discreteWaves.json';
      let data = this.getDiscreteWavesJSON();
      link.href = window.URL.createObjectURL(new Blob([JSON.stringify(data)], {type: 'text/json'}));
      link.click();
      link.delete;
      setTimeout(resolve, 10);
    })
  }

}
