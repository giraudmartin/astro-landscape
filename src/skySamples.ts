/**
 * Sky samples for Sun/Moon discs + trajectories.
 * Ported from Photo Sightline `moonTrajectoryPreview.ts` (sampling only).
 */
import {
  Atmosphere,
  Body,
  Equator,
  Horizon,
  Illumination,
  KM_PER_AU,
  MoonPhase,
  Observer,
  Refraction,
} from 'astronomy-engine'
import { isWaxingMoon } from './moonGlobe'

const MOON_MEAN_RADIUS_KM = 1737.4
const RAD2DEG = 180 / Math.PI
/** Dense enough for a smooth full rise→set arc. */
const SAMPLE_STEP_MS = 3 * 60 * 1000

export type SkySample = {
  datetimeUtc: string
  azimuthDeg: number
  altitudeApparentDeg: number
  angularDiameterDeg: number
  /** Apparent solar altitude (deg) at the same instant — drives sky lighting. */
  sunAltitudeDeg: number
  /** Solar azimuth (deg) — places sunset glow / Belt of Venus opposite. */
  sunAzimuthDeg: number
  /** Astronomy Engine Illumination.phase_fraction (0 = new, 1 = full). */
  illuminationFraction: number
  /** N-hemisphere: waxing lit on the right (from MoonPhase elongation). */
  waxing: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function apparentAltitudeDeg(
  geometricAltitudeDeg: number,
  observerElevationMeters: number,
): number {
  const seaLevelLift = Refraction('normal', geometricAltitudeDeg)
  const elevation = clamp(observerElevationMeters, -500, 100_000)
  return geometricAltitudeDeg + seaLevelLift * Atmosphere(elevation).density
}

function angularDiameterDegFromDistanceKm(distanceKm: number): number {
  const denom = Math.sqrt(distanceKm * distanceKm - MOON_MEAN_RADIUS_KM ** 2)
  if (
    !Number.isFinite(distanceKm) ||
    distanceKm <= MOON_MEAN_RADIUS_KM ||
    !Number.isFinite(denom)
  ) {
    return Number.NaN
  }
  return 2 * RAD2DEG * Math.atan(MOON_MEAN_RADIUS_KM / denom)
}

function sampleAt(
  observer: Observer,
  elevationMeters: number,
  utcMs: number,
): SkySample {
  const datetimeUtc = new Date(utcMs)
  const equator = Equator(Body.Moon, datetimeUtc, observer, true, true)
  const geometric = Horizon(datetimeUtc, observer, equator.ra, equator.dec)
  const distanceKm = equator.dist * KM_PER_AU
  const sunEq = Equator(Body.Sun, datetimeUtc, observer, true, true)
  const sunHoriz = Horizon(datetimeUtc, observer, sunEq.ra, sunEq.dec)
  const illum = Illumination(Body.Moon, datetimeUtc)
  return {
    datetimeUtc: datetimeUtc.toISOString(),
    azimuthDeg: geometric.azimuth,
    altitudeApparentDeg: apparentAltitudeDeg(
      geometric.altitude,
      elevationMeters,
    ),
    angularDiameterDeg: angularDiameterDegFromDistanceKm(distanceKm),
    sunAltitudeDeg: apparentAltitudeDeg(sunHoriz.altitude, elevationMeters),
    sunAzimuthDeg: sunHoriz.azimuth,
    illuminationFraction: Math.min(1, Math.max(0, illum.phase_fraction)),
    waxing: isWaxingMoon(MoonPhase(datetimeUtc)),
  }
}

/** Single-instant sample (disc placement at the playhead). */
export function sampleMoonSkyAt(input: {
  latitude: number
  longitude: number
  elevationMeters: number
  utcMs: number
}): SkySample {
  const observer = new Observer(
    input.latitude,
    input.longitude,
    input.elevationMeters,
  )
  return sampleAt(observer, input.elevationMeters, input.utcMs)
}

/** Dense path samples for Sun/Moon trajectory guides (Photo Sightline). */
export function sampleMoonSkyPath(input: {
  latitude: number
  longitude: number
  elevationMeters: number
  startUtc: Date
  endUtc: Date
  stepMs?: number
}): SkySample[] {
  const step = input.stepMs ?? SAMPLE_STEP_MS
  const start = input.startUtc.getTime()
  const end = input.endUtc.getTime()
  if (!(end > start) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return []
  }

  const observer = new Observer(
    input.latitude,
    input.longitude,
    input.elevationMeters,
  )
  const samples: SkySample[] = []
  for (let t = start; t <= end; t += step) {
    samples.push(sampleAt(observer, input.elevationMeters, t))
  }
  return samples
}
