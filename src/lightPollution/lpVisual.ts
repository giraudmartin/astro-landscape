/**
 * Immersive light-pollution visuals — Bortle / horizon-peak → glow strength
 * and naked-eye extinction (stars + Milky Way).
 *
 * Reality check (Bortle / LPM):
 * - Dark zenith (B1–2) can still show yellow city domes on the horizon.
 * - Suburban (B5–6): MW washed / zenith-only; NELM ~5–6.
 * - Urban (B7–9): no MW, few stars, gray–amber sky wash — not a thin airglow rim.
 */

import { clampLightPollutionAmount } from '../skyLighting'

/**
 * Site pollution driving the dome: zenith Bortle class OR absolute horizon-peak
 * intensity (distant cities under a pristine zenith — Spitzkoppe / La Palma).
 * No artificial floor: zero peak + B1 → no invent glow.
 */
export function lightPollutionSiteFactor(
  bortleFactor01: number,
  peakIntensity01: number,
): number {
  const b = Number.isFinite(bortleFactor01)
    ? Math.min(1, Math.max(0, bortleFactor01))
    : 0
  const p = Number.isFinite(peakIntensity01)
    ? Math.min(1, Math.max(0, peakIntensity01))
    : 0
  return Math.max(b, p)
}

/** Slider × site → live immersive LP amount 0…1. */
export function lightPollutionLiveFactor(
  amount: number,
  bortleFactor01: number,
  peakIntensity01: number,
): number {
  return (
    clampLightPollutionAmount(amount) *
    lightPollutionSiteFactor(bortleFactor01, peakIntensity01)
  )
}

/**
 * Mag cut applied to the FOV star limit (higher = fewer stars).
 * B4 starts gently; B9 removes ~2.2 mag so only the brightest remain.
 */
export function lightPollutionStarMagPenalty(
  bortleFactor01: number,
  amount: number,
): number {
  const t =
    Math.min(1, Math.max(0, bortleFactor01)) * clampLightPollutionAmount(amount)
  // Quadratic: rural barely moves; city kills faint stars hard.
  return t * t * 2.2
}

/**
 * Milky Way opacity multiplier from local zenith pollution.
 * B5 washed; B6 zenith-ghost; B7+ gone — matches Bortle descriptions.
 */
export function lightPollutionMilkyWayMul(
  bortleFactor01: number,
  amount: number,
): number {
  const t =
    Math.min(1, Math.max(0, bortleFactor01)) * clampLightPollutionAmount(amount)
  if (t <= 0.02) return 1
  if (t < 0.35) return 1 - t * 0.55
  if (t < 0.55) return Math.max(0, 0.81 - (t - 0.35) * 2.8)
  // B7 (0.75) and up: invisible.
  const urban = 0.25 - (t - 0.55) * 1.25
  return urban < 0.02 ? 0 : urban
}

/**
 * Extra sky-comp / brightness crush so remaining stars don't punch through
 * a bright urban wash like deep-sky pinpricks.
 */
export function lightPollutionStarBrightMul(
  bortleFactor01: number,
  amount: number,
): number {
  const t =
    Math.min(1, Math.max(0, bortleFactor01)) * clampLightPollutionAmount(amount)
  return Math.max(0.35, 1 - t * 0.55)
}
