// Digital twin (Generation > Digital twin): drives the sliders of Generation > Advanced from what forces the sea.
// For now only from the wind ("Wind driven"): a Pierson-Moskowitz, JONSWAP, TMA (JONSWAP in water of finite depth) or
// Elfouhaily wind sea (Assets/Ocean/WindSea.js, Elfouhaily.js), a directional spreading
// (Assets/Ocean/DirectionalSpreading.js), and the wind of the ripples and the whitecaps.
// Ripples: the constant spectrum scaled to Cox & Munk (RippleSpectrum.js spectrum 'saturation', default), or with
// strictRipples the spectrum of the sea continued (spectrum 'sea'), with no Cox & Munk scaling.
//
// The state is shared (main.js makes it reactive as window.digitalTwin): the panel edits it, the overlay at the
// bottom-left of the screen shows it while the twin is on. Pure module: the conversions and what Generation should have.

import * as WindSea from '/OceanTestSite/Assets/Ocean/WindSea.js';
import { createSpreading, needsWind } from '/OceanTestSite/Assets/Ocean/DirectionalSpreading.js';
import { lightWindFactor } from '/OceanTestSite/Assets/Ocean/RippleSpectrum.js';
import { resolveSeaSettings } from '/OceanTestSite/Assets/Ocean/SeaSpectrum.js';
import { omegaFromFetch } from '/OceanTestSite/Assets/Ocean/Elfouhaily.js';

export const TWIN_MODELS = ['pm', 'jonswap', 'tma', 'elfouhaily'];

export const DEFAULT_TWIN_STATE = {
  enabled: true,       // On (default): the twin drives Generation, and the overlay shows the forcing
  driver: 'wind',      // 'wind' (the others are not available yet: 'waves', 'buoy', 'model')
  initialised: false,  // Started from what Generation had
  model: 'jonswap',    // 'jonswap' (fetch-limited, default), 'pm' (Pierson-Moskowitz, fully developed), 'tma'
                       // (JONSWAP x depth attenuation, Horvath 2015) or 'elfouhaily' (Elfouhaily et al. 1997)
  depthM: 30,          // TMA: water depth (m)
  windSpeed: 8,        // U10, m/s
  windDir: 0,          // Where the wind comes FROM, deg clockwise from north
  fetchKm: 100,        // JONSWAP
  gamma: 3.3,          // JONSWAP peak enhancement
  spreadModel: 'goda', spread: 30, smax: 40, // Directional spreading (see DirectionalSpreading.js): Goda & Suzuki, wind waves
  driveRipples: true,  // The ripples (and so the whitecaps) take the same wind
  strictRipples: false, // The ripples follow the spectrum of the sea (strict); off: constant spectrum, Cox & Munk
  driveStrainFoam: true, // Ripple strain and breaking threshold from the wind (strainFor, breakingThresholdFor)
  calmLightWind: true,   // Ripples: 'onset' in light wind (5% of Cox-Munk up to 1.3 m/s, all of it from 3 m/s), see RippleSpectrum
};

// RIPPLE STRAIN AND BREAKING THRESHOLD FROM THE WIND
// Linear in knots between 5 and 25 kn, constant outside: a calm sea keeps the physical strain (x1) and the usual
// breaking threshold (J < 0.6); a gale exaggerates the ripples on the crests (x10) and breaks more (J < 0.8)
export const KNOTS_PER_MS = 1.94384;
export const RAMP_KNOTS = [5, 25];
export const STRAIN_RANGE = [1, 10];
export const THRESHOLD_RANGE = [0.6, 0.8];
function ramp(U10, [lo, hi]) {
  const kn = U10 * KNOTS_PER_MS;
  const t = Math.min(1, Math.max(0, (kn - RAMP_KNOTS[0]) / (RAMP_KNOTS[1] - RAMP_KNOTS[0])));
  return lo + (hi - lo) * t;
}
export const strainFor = U10 => Math.round(ramp(U10, STRAIN_RANGE) * 100) / 100;
export const breakingThresholdFor = U10 => Math.round(ramp(U10, THRESHOLD_RANGE) * 1000) / 1000;

// Share of the Cox-Munk ripple slopes at the wind of the state (1 unless calm in light wind)
export const lightWindFactorOf = st => lightWindFactor(st.windSpeed, st.calmLightWind ? 'onset' : 'coxMunk');

// Wind sea of the state: {Hm0 (of the spectrum drawn), Tp, dimensionlessFetch, fullyDeveloped}, and for TMA
// HmDeep (the JONSWAP Hm0 in deep water), for Elfouhaily Omega
export function windSeaOf(st) {
  const U = Math.max(0, Number(st.windSpeed) || 0);
  if (st.model == 'elfouhaily') {
    const Omega = omegaFromFetch(U, st.fetchKm);
    const r = resolveSeaSettings({ spectrum: 'elfouhaily', spectrumWind: Math.max(0.1, U), Omega });
    return { Hm0: r.Hm0, Tp: r.Tp, Omega, dimensionlessFetch: U > 0 ? 9.81 * st.fetchKm * 1000 / (U * U) : Infinity,
      fullyDeveloped: Omega <= 0.8401 };
  }
  if (st.model == 'jonswap' || st.model == 'tma') {
    const sea = WindSea.jonswap(U, st.fetchKm);
    if (st.model != 'tma') return sea;
    const r = resolveSeaSettings({ Hm0: Math.max(0.01, sea.Hm0), Tp: sea.Tp, gamma: st.gamma, depth: depthOf(st) });
    return { ...sea, HmDeep: sea.Hm0, Hm0: r.Hm0Spectrum };
  }
  return { ...WindSea.piersonMoskowitz(U), dimensionlessFetch: NaN };
}
const depthOf = st => Math.max(1, Number(st.depthM) || 30);

// H_M0 <-> FETCH (Generation > Quick: the wave height sets the fetch)
// Hm0 grows with the fetch (JONSWAP, TMA, Elfouhaily) and stops growing once the sea is fully developed; a
// Pierson-Moskowitz sea has no fetch: its Hm0 is the wind's.
export const QUICK_FETCH_KM = [1, 1000];
export const hasFetch = st => st.model != 'pm';
// Hm0 (of the spectrum drawn) of the state with this fetch
export const hm0ForFetch = (st, km) => windSeaOf({ ...st, fetchKm: km }).Hm0;
// Hm0 reachable with a fetch of 1 to 1000 km: [lowest, highest]
export function hm0RangeOf(st) {
  return [hm0ForFetch(st, QUICK_FETCH_KM[0]), hm0ForFetch(st, QUICK_FETCH_KM[1])];
}
// Shortest fetch (km, 1..1000) whose sea reaches Hm0, clamped: past full development a longer fetch adds nothing.
// Bisection on log(fetch); 0.01 km resolution.
export function fetchForHm0(st, Hm0) {
  const [lo, hi] = QUICK_FETCH_KM;
  const [hLo, hHi] = hm0RangeOf(st);
  if (!(Hm0 > hLo)) return lo;
  const target = Math.min(Hm0, hHi * (1 - 1e-6));
  let a = Math.log(lo), b = Math.log(hi);
  for (let i = 0; i < 50; i++) {
    const m = (a + b) / 2;
    if (hm0ForFetch(st, Math.exp(m)) < target) a = m; else b = m;
  }
  return Math.min(hi, Math.max(lo, Math.round(Math.exp(b) * 100) / 100));
}
// Fetch past which the sea is fully developed (km), or null (Elfouhaily, PM: it keeps growing, or no fetch)
export function fullyDevelopedFetchOf(st) {
  if (st.model != 'jonswap' && st.model != 'tma') return null;
  return WindSea.fullyDevelopedFetchKm(st.windSpeed);
}

// Directional spreading of the state for its wind sea (sigma1(f), ...)
export function spreadingOf(st) {
  const sea = windSeaOf(st);
  return createSpreading({ model: st.spreadModel, spread: st.spread, windSpeed: st.windSpeed, smax: st.smax }, sea.Tp > 0 ? 1 / sea.Tp : 1);
}

// What Generation should have: {sea (SeaStatePanel_changed), ripples (SurfaceRipplesPanel_changed) or null,
// foam (FoamPanel_changed) or null}
export function targetOf(st) {
  const sea = windSeaOf(st), pm = st.model == 'pm', elf = st.model == 'elfouhaily', tma = st.model == 'tma';
  const U = st.windSpeed;
  // The ripples continue the spectrum of the sea (strict), or the constant spectrum scaled to Cox & Munk
  const ripples = { spectrum: st.strictRipples ? 'sea' : 'saturation' };
  // Driven ripples: spread from the wind (RippleSpectrum.js spreadMode 'wind', spreadForWind): narrower with more wind
  if (st.driveRipples) Object.assign(ripples, { mode: 'wind', windSpeed: U, windDir: st.windDir, spreadMode: 'wind' });
  if (st.driveStrainFoam) ripples.strain = strainFor(U);
  ripples.lightWind = st.calmLightWind ? 'onset' : 'coxMunk';
  return {
    sea: { Hm0: Math.max(0.01, Number((tma ? sea.HmDeep : sea.Hm0).toFixed(3))),
      Tp: pm ? null : Math.max(0.5, Number(sea.Tp.toFixed(2))),
      gamma: pm || elf ? 1 : st.gamma, Mdir: st.windDir, Spr1: st.spread,
      spectrum: elf ? 'elfouhaily' : 'jonswap', spectrumWind: elf ? Math.max(0.1, U) : 10,
      Omega: elf ? Number(sea.Omega.toFixed(4)) : null, depth: tma ? depthOf(st) : null,
      spreadModel: st.spreadModel, spreadSmax: st.smax, spreadWind: needsWind(st.spreadModel) ? Math.max(0.1, U) : null },
    ripples: Object.keys(ripples).length ? ripples : null,
    foam: st.driveStrainFoam ? { mode: 'shape', threshold: breakingThresholdFor(U) } : null,
  };
}

// The first time: start from what Generation has (wind direction and spread of the sea, wind of the ripples), so that
// turning the twin on changes the sea as little as possible
export function initialiseFrom(st, sceneManager) {
  if (st.initialised || !sceneManager) return;
  const p = sceneManager.ocean.oceanParams.oceanParameters, r = sceneManager.getRipples();
  Object.assign(st, { initialised: true, windDir: Math.round(p.Mdir) || 0, spread: Math.min(80, Math.max(5, Math.round(p.Spr1) || 30)),
    windSpeed: r ? Math.round(r.windSpeed * 10) / 10 : st.windSpeed });
}

// Send the target to Generation (its panels and the ocean follow these events)
export function apply(st) {
  const t = targetOf(st);
  window.eventBus.emit('SeaStatePanel_changed', { ...t.sea });
  if (t.ripples) window.eventBus.emit('SurfaceRipplesPanel_changed', { ...t.ripples });
  if (t.foam) window.eventBus.emit('FoamPanel_changed', { ...t.foam });
}

// Whether Generation still has what the twin set
export function inSync(st, sceneManager) {
  if (!sceneManager) return true;
  const p = sceneManager.ocean.oceanParams.oceanParameters, t = targetOf(st);
  const close = (a, b, eps) => Math.abs(a - b) <= eps;
  let ok = close(p.Hm0, t.sea.Hm0, 0.006) && close(p.gamma, t.sea.gamma, 0.01) && close(p.Mdir, t.sea.Mdir, 0.5)
    && (t.sea.Tp == null ? !(p.Tp > 0) : close(p.Tp, t.sea.Tp, 0.006))
    && p.spreadModel == t.sea.spreadModel
    && (p.spectrum || 'jonswap') == t.sea.spectrum && (p.depth || null) == t.sea.depth
    && (t.sea.spectrum != 'elfouhaily' || (close(p.spectrumWind, t.sea.spectrumWind, 0.01) && close(p.Omega, t.sea.Omega, 1e-3)))
    && (t.sea.spreadModel != 'constant' || close(p.Spr1, t.sea.Spr1, 0.5))
    && (t.sea.spreadModel != 'goda' || close(p.spreadSmax, t.sea.spreadSmax, 0.5))
    && (t.sea.spreadWind == null || close(p.spreadWind, t.sea.spreadWind, 0.01));
  if (ok && t.ripples) {
    const r = sceneManager.getRippleSettings();
    if (t.ripples.mode) ok = r.mode == 'wind' && close(r.windSpeed, t.ripples.windSpeed, 0.01) && close(r.windDir, t.ripples.windDir, 0.5)
      && r.spreadMode == t.ripples.spreadMode;
    if (ok && t.ripples.strain != null) ok = close(r.strain ?? 1, t.ripples.strain, 0.005);
    if (ok) ok = (r.lightWind || 'coxMunk') == t.ripples.lightWind && r.spectrum == t.ripples.spectrum;
  }
  if (ok && t.foam) {
    const f = sceneManager.getFoamSettings();
    ok = f.mode == 'shape' && close(f.threshold, t.foam.threshold, 0.0005);
  }
  return ok;
}
