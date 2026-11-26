import { civilDayStartUtcMs } from '../celestial'

/**
 * Demo site for the interactive onboarding tour — Mirador de Los Andenes (La Palma).
 * Look matches the Mirador night composition used in the immersive guide
 * (valley to the south, Milky Way up).
 */
export const TOUR_DEMO_SPOT = {
  lat: 28.7611,
  lon: -17.8673,
  heightM: 2276,
  bearingDeg: 165,
  pitchDeg: 12,
  zoom: 13.5,
} as const

/** Civil night for the tour scene + example framing (local at Mirador). */
export const TOUR_DEMO_DATE = '2027-05-08'
export const TOUR_DEMO_LOCAL_HOUR = 1

/**
 * Airglow look for the immersive guide: on, green hue, structured waves.
 * Matches Settings → Ciel (Amount / Teinte Vert / Structure Vagues).
 */
export const TOUR_DEMO_AIRGLOW = {
  amount: 0.8,
  hue: 0,
  waves: 0.85,
} as const

/** UTC ms for TOUR_DEMO_DATE at TOUR_DEMO_LOCAL_HOUR, civil local at lon. */
export function tourDemoUtcMs(lon: number = TOUR_DEMO_SPOT.lon): number {
  return (
    civilDayStartUtcMs(TOUR_DEMO_DATE, lon) + TOUR_DEMO_LOCAL_HOUR * 3600_000
  )
}

/** ~11 m — same place as rounded UI coords, not a whole cliff neighborhood. */
const SAME_PLACE_EPS = 1e-4

/** True when lat/lon is the tour Mirador (same place). */
export function isSameTourDemoPlace(lat: number, lon: number): boolean {
  return (
    Math.abs(lat - TOUR_DEMO_SPOT.lat) < SAME_PLACE_EPS &&
    Math.abs(lon - TOUR_DEMO_SPOT.lon) < SAME_PLACE_EPS
  )
}

/** Existing personal spot at the tour Mirador, if any. */
export function findExistingTourDemoSpot<
  T extends { lat: number; lon: number },
>(spots: readonly T[]): T | null {
  return spots.find((row) => isSameTourDemoPlace(row.lat, row.lon)) ?? null
}
