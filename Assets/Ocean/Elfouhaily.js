// ELFOUHAILY ET AL. (1997), "A unified directional spectrum for long and short wind-driven waves", JGR 102(C7),
// 15781-15796. One omnidirectional wavenumber spectrum from the peak of the wind sea down to the capillary waves:
//   S(k) = k^-3 B(k),  B = B_l + B_h  (B: saturation / curvature spectrum, slope variance per unit ln k)
//   B_l = 1/2 alpha_p (c_p / c) F_p,  F_p = L_PM J_p exp(-Omega / sqrt(10) (sqrt(k / k_p) - 1))
//     L_PM = exp(-5/4 (k_p / k)^2), J_p = gamma^Gamma, Gamma = exp(-(sqrt(k / k_p) - 1)^2 / (2 sigma^2)),
//     gamma = 1.7 (0.84 < Omega < 1), 1.7 + 6 log10(Omega) (1 < Omega < 5), sigma = 0.08 (1 + 4 Omega^-3),
//     alpha_p = 0.006 sqrt(Omega), k_p = g (Omega / U10)^2
//   B_h = 1/2 alpha_m (c_m / c) F_m,  F_m = exp(-1/4 (k / k_m - 1)^2) L_PM J_p (the last two ~1 at these k)
//     alpha_m = 0.01 (1 + ln(u* / c_m)) for u* <= c_m, 0.01 (1 + 3 ln(u* / c_m)) above; k_m = 370 rad/m, c_m = 0.23
//     m/s: the gravity-capillary peak (1.7 cm)
//   c = sqrt(g / k (1 + (k / k_m)^2)): phase speed with surface tension
// Omega = U10 / c_p, the inverse wave age: 0.84 for a fully developed sea, larger for a young sea. From the fetch,
// Omega = 0.84 tanh((X~ / 2.2e4)^0.4)^-0.75, X~ = g X / U10^2.
// In light wind the 1-4 m waves (B_l) carry most of the short-wave slope; in strong wind the short sharp waves (B_h)
// do, and the mid-sized waves are few (Jahne & Riemer 1990: the decimetre waves barely grow with the wind).
// Pure module (no imports): used by SeaSpectrum.js (the whole sea) and RippleSpectrum.js (the ripples).

const G = 9.8; // Same gravity as SeaSpectrum.js and RippleSpectrum.js
const TWO_PI = 2 * Math.PI;
export const ELF_KM = 370;      // rad/m, gravity-capillary peak
export const ELF_CM = 0.23;     // m/s, its phase speed
export const ELF_K_END = 4000;  // rad/m: B_h is negligible beyond (the end of the spectrum)
export const ELF_OMEGA_DEVELOPED = 0.84;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Friction velocity (m/s) for U10: drag coefficient of Wu (1982), Cd = (0.8 + 0.065 U10) 1e-3
export function frictionVelocity(U) {
  return U * Math.sqrt((0.8 + 0.065 * U) * 1e-3);
}

// Inverse wave age of a fetch-limited sea (fetch in km), Elfouhaily et al. eq. 37
export function omegaFromFetch(U, fetchKm) {
  const X = Math.max(1e-6, Number(fetchKm) || 0) * 1000;
  const Xd = U > 0 ? G * X / (U * U) : Infinity;
  if (!isFinite(Xd)) return ELF_OMEGA_DEVELOPED;
  return clamp(ELF_OMEGA_DEVELOPED * Math.pow(Math.tanh(Math.pow(Xd / 2.2e4, 0.4)), -0.75), ELF_OMEGA_DEVELOPED, 5);
}

// Parameters of the spectrum for U10 and Omega (null: fully developed)
export function elfouhailyParams(U, Omega = null) {
  U = Math.max(0.1, Number(U) || 0);
  Omega = clamp(Number(Omega) || ELF_OMEGA_DEVELOPED, ELF_OMEGA_DEVELOPED, 5);
  const cp = U / Omega, kp = G / (cp * cp);
  const ustar = frictionVelocity(U);
  const alphaM = ustar < ELF_CM ? 0.01 * (1 + Math.log(ustar / ELF_CM)) : 0.01 * (1 + 3 * Math.log(ustar / ELF_CM));
  const gamma = Omega < 1 ? 1.7 : 1.7 + 6 * Math.log10(Omega);
  const sigma = 0.08 * (1 + 4 * Math.pow(Omega, -3));
  return { U, Omega, kp, cp, ustar, alphaP: 0.006 * Math.sqrt(Omega), alphaM: Math.max(0, alphaM), gamma, sigma,
    Tp: TWO_PI / Math.sqrt(G * kp) };
}

// Saturation B(k) (dimensionless)
export function elfouhailyB(k, p) {
  if (!(k > 0)) return 0;
  const c = Math.sqrt(G / k * (1 + (k / ELF_KM) * (k / ELF_KM)));
  const r = Math.sqrt(k / p.kp);
  const Lpm = Math.exp(-1.25 * (p.kp / k) * (p.kp / k));
  const Jp = Math.pow(p.gamma, Math.exp(-(r - 1) * (r - 1) / (2 * p.sigma * p.sigma)));
  const Bl = 0.5 * p.alphaP * (p.cp / c) * Lpm * Jp * Math.exp(-p.Omega / Math.sqrt(10) * (r - 1));
  const Bh = 0.5 * p.alphaM * (ELF_CM / c) * Math.exp(-0.25 * Math.pow(k / ELF_KM - 1, 2)) * Lpm * Jp;
  return Bl + Bh;
}

// Omnidirectional wavenumber spectrum S(k) = B(k) k^-3 (m^3)
export function elfouhailyS(k, p) {
  return elfouhailyB(k, p) * Math.pow(k, -3);
}
