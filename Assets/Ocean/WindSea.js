// Wind sea from the wind speed U10 (m/s, 10 m above the sea), for the digital twin (Sea State > Digital twin)
//
// Pierson & Moskowitz (1964): fully developed sea, the waves no longer grow. Only the wind speed matters:
//   Hm0 = 0.21 U19.5^2 / g ~ 0.22 U10^2 / g (Stewart, Introduction to Physical Oceanography, 16.4)
//   wp = 0.877 g / U19.5. The peak period is left to the "Fully developed" option of the FFT sea, which derives it from
//   Hm0 with these same relations (SeaSpectrum.fullyDevelopedPeakPeriod), so both stay consistent.
//
// JONSWAP (Hasselmann et al. 1973): fetch-limited, growing sea. With the dimensionless fetch X~ = g X / U10^2:
//   energy  g^2 m0 / U10^4 = 1.6e-7 X~   ->  Hm0 = 4 sqrt(m0) = 1.6e-3 sqrt(X~) U10^2 / g
//   peak    fp U10 / g = 3.5 X~^-0.33    ->  Tp = U10 / (3.5 g) X~^0.33
//   Peak enhancement gamma = 3.3 on average (the spectrum's shape, not its growth)
// The growth stops at the fully developed sea: past X~ ~ 1.9e4, where the JONSWAP Hm0 reaches the Pierson-Moskowitz
// one, the sea is the Pierson-Moskowitz sea (the peak periods agree within 0.5% there).
//
// Neither defines the directional spreading.

import { fullyDevelopedPeakPeriod } from '/OceanTestSite/Assets/Ocean/SeaSpectrum.js';

export const G = 9.81;
export const PM_HM0 = 0.22;              // Hm0 = PM_HM0 U10^2 / g
export const JONSWAP_ENERGY = 1.6e-7;    // g^2 m0 / U10^4 = JONSWAP_ENERGY X~
export const JONSWAP_PEAK = 3.5;         // fp U10 / g = JONSWAP_PEAK X~^JONSWAP_PEAK_EXP
export const JONSWAP_PEAK_EXP = -0.33;
export const JONSWAP_GAMMA = 3.3;
// Dimensionless fetch where the JONSWAP Hm0 reaches the Pierson-Moskowitz one: 1.6e-3 sqrt(X~) = 0.22
export const FULLY_DEVELOPED_FETCH = Math.pow(PM_HM0 / (4 * Math.sqrt(JONSWAP_ENERGY)), 2);

// Fully developed sea: {Hm0, Tp (from Hm0, as the "Fully developed" option does), fullyDeveloped: true}
export function piersonMoskowitz(U10) {
  const U = Math.max(0, Number(U10) || 0);
  const Hm0 = PM_HM0 * U * U / G;
  return { Hm0, Tp: Hm0 > 0 ? fullyDevelopedPeakPeriod(Hm0) : 0, fullyDeveloped: true };
}

// Fetch (km) where a wind of U10 makes a fully developed sea
export function fullyDevelopedFetchKm(U10) {
  return FULLY_DEVELOPED_FETCH * U10 * U10 / G / 1000;
}

// Fetch-limited sea: {Hm0, Tp, dimensionlessFetch, fullyDeveloped}. Past the fully developed fetch: Pierson-Moskowitz
export function jonswap(U10, fetchKm) {
  const U = Math.max(0, Number(U10) || 0), X = Math.max(0, Number(fetchKm) || 0) * 1000;
  const dimensionlessFetch = U > 0 ? G * X / (U * U) : Infinity;
  if (dimensionlessFetch >= FULLY_DEVELOPED_FETCH) return { ...piersonMoskowitz(U), dimensionlessFetch };
  const Hm0 = 4 * Math.sqrt(JONSWAP_ENERGY * dimensionlessFetch) * U * U / G;
  const fp = JONSWAP_PEAK * Math.pow(dimensionlessFetch, JONSWAP_PEAK_EXP) * G / U;
  return { Hm0, Tp: 1 / fp, dimensionlessFetch, fullyDeveloped: false };
}

// Wave age cp / U10 of the peak (deep water): ~1.2 for a fully developed sea, below 1 for a young, growing sea
export function waveAge(Tp, U10) {
  return U10 > 0 && Tp > 0 ? G * Tp / (2 * Math.PI) / U10 : NaN;
}

// Beaufort force of a wind speed (m/s), WMO upper limits of forces 0..11
const BEAUFORT_LIMITS = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
export function toBeaufort(U) {
  const i = BEAUFORT_LIMITS.findIndex(limit => U < limit);
  return i < 0 ? 12 : i;
}

// Wind speed units, the first one standard (as in VISOC: a click on the unit goes to the next one)
export const WIND_UNITS = [
  { unit: 'm/s',  decimals: 1, toDisplay: v => v },
  { unit: 'kn',   decimals: 0, toDisplay: v => v * 1.94384 },
  { unit: 'km/h', decimals: 0, toDisplay: v => v * 3.6 },
  { unit: 'Bft',  decimals: 0, toDisplay: toBeaufort },
];
