// Digital twin (Sea State > Digital twin): drives the sliders of Sea State > Generation from what forces the sea.
// For now only from the wind ("Wind driven"): Pierson-Moskowitz or JONSWAP wind sea (Assets/Ocean/WindSea.js), a
// directional spreading (Assets/Ocean/DirectionalSpreading.js), and the wind of the ripples and the whitecaps.
//
// The state is shared (main.js makes it reactive as window.digitalTwin): the panel edits it, the overlay at the
// bottom-left of the screen shows it while the twin is on. Pure module: the conversions and what Generation should have.

import * as WindSea from '/OceanTestSite/Assets/Ocean/WindSea.js';
import { createSpreading, needsWind } from '/OceanTestSite/Assets/Ocean/DirectionalSpreading.js';

export const DEFAULT_TWIN_STATE = {
  enabled: false,      // On: the twin drives Generation, and the overlay shows the forcing
  driver: 'wind',      // 'wind' (the others are not available yet: 'waves', 'buoy', 'model')
  initialised: false,  // Started from what Generation had
  model: 'pm',         // 'pm' (Pierson-Moskowitz, fully developed) or 'jonswap' (fetch-limited)
  windSpeed: 8,        // U10, m/s
  windDir: 0,          // Where the wind comes FROM, deg clockwise from north
  fetchKm: 100,        // JONSWAP
  gamma: 3.3,          // JONSWAP peak enhancement
  spreadModel: 'constant', spread: 30, smax: 10, // Directional spreading (see DirectionalSpreading.js)
  driveRipples: true,  // The ripples (and so the whitecaps) take the same wind
  driveStrainFoam: true, // Ripple strain and breaking threshold from the wind (strainFor, breakingThresholdFor)
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

// Wind sea of the state: {Hm0, Tp, dimensionlessFetch, fullyDeveloped}
export function windSeaOf(st) {
  return st.model == 'jonswap' ? WindSea.jonswap(st.windSpeed, st.fetchKm)
    : { ...WindSea.piersonMoskowitz(st.windSpeed), dimensionlessFetch: NaN };
}

// Directional spreading of the state for its wind sea (sigma1(f), ...)
export function spreadingOf(st) {
  const sea = windSeaOf(st);
  return createSpreading({ model: st.spreadModel, spread: st.spread, windSpeed: st.windSpeed, smax: st.smax }, sea.Tp > 0 ? 1 / sea.Tp : 1);
}

// What Generation should have: {sea (SeaStatePanel_changed), ripples (SurfaceRipplesPanel_changed) or null,
// foam (FoamPanel_changed) or null}
export function targetOf(st) {
  const sea = windSeaOf(st), pm = st.model == 'pm';
  const U = st.windSpeed;
  const ripples = {};
  if (st.driveRipples) Object.assign(ripples, { mode: 'wind', windSpeed: U, windDir: st.windDir });
  if (st.driveStrainFoam) ripples.strain = strainFor(U);
  return {
    sea: { Hm0: Math.max(0.01, Number(sea.Hm0.toFixed(3))), Tp: pm ? null : Math.max(0.5, Number(sea.Tp.toFixed(2))),
      gamma: pm ? 1 : st.gamma, Mdir: st.windDir, Spr1: st.spread,
      spreadModel: st.spreadModel, spreadSmax: st.smax, spreadWind: needsWind(st.spreadModel) ? Math.max(0.1, U) : null },
    ripples: Object.keys(ripples).length ? ripples : null,
    foam: st.driveStrainFoam ? { mode: 'shape', threshold: breakingThresholdFor(U) } : null,
  };
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
    && (t.sea.spreadModel != 'constant' || close(p.Spr1, t.sea.Spr1, 0.5))
    && (t.sea.spreadModel != 'goda' || close(p.spreadSmax, t.sea.spreadSmax, 0.5))
    && (t.sea.spreadWind == null || close(p.spreadWind, t.sea.spreadWind, 0.01));
  if (ok && t.ripples) {
    const r = sceneManager.getRippleSettings();
    if (t.ripples.mode) ok = r.mode == 'wind' && close(r.windSpeed, t.ripples.windSpeed, 0.01) && close(r.windDir, t.ripples.windDir, 0.5);
    if (ok && t.ripples.strain != null) ok = close(r.strain ?? 1, t.ripples.strain, 0.005);
  }
  if (ok && t.foam) {
    const f = sceneManager.getFoamSettings();
    ok = f.mode == 'shape' && close(f.threshold, t.foam.threshold, 0.0005);
  }
  return ok;
}
