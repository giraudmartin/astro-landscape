/**
 * Legacy personal-events shape kept for cadrages migration only.
 * Active storage is `personalFramings` — do not build new UI on this module.
 */

export const PERSONAL_EVENTS_STORAGE_KEY = 'astro-landscape.personal-events.v1'

export type PersonalEventSource = 'immersive' | 'manual'

export type PersonalEvent = {
  id: string
  name: string
  lat: number
  lon: number
  /** Absolute shot time (ISO UTC). */
  peakUtc: string
  /** Civil wall-clock `YYYY-MM-DDTHH:MM:SS` at observer lon. */
  peakLocal: string
  /** YYYY-MM-DD civil date. */
  localDate: string
  spotId: string | null
  spotName: string | null
  heightM: number | null
  bearingDeg: number
  pitchDeg: number
  source: PersonalEventSource
  note: string | null
  createdAtIso: string
}
