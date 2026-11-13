import {
  Body,
  Equator,
  EquatorFromVector,
  Horizon,
  Observer,
  RotateVector,
  Rotation_EQJ_EQD,
  Rotation_HOR_EQJ,
  Spherical,
  VectorFromHorizon,
  VectorFromSphere,
} from 'astronomy-engine'
import type { CelestialObject, HorizontalPosition } from './types'

export type EquatorialJ2000 = {
  raHours: number
  decDeg: number
}

/**
 * Convert J2000 RA/Dec to of-date equatorial (precession via EQJ→EQD),
 * then to local horizontal coordinates.
 *
 * Matches Astronomy Engine conventions used elsewhere in the app
 * (see galactic-center DefineStar + Equator/Horizon path in celestial.ts).
 * Proper motion is not applied (catalogues ship epoch J2000 positions).
 */
export function j2000ToHorizontal(
  raHours: number,
  decDeg: number,
  lat: number,
  lon: number,
  elevationM: number,
  utcMs: number,
): HorizontalPosition {
  const at = new Date(utcMs)
  const observer = new Observer(lat, lon, elevationM / 1000)
  // Spherical: lat=Dec, lon=RA degrees, dist arbitrary.
  const eqj = VectorFromSphere(new Spherical(decDeg, raHours * 15, 1e6), at)
  const eqdVec = RotateVector(Rotation_EQJ_EQD(at), eqj)
  const eqd = EquatorFromVector(eqdVec)
  const horiz = Horizon(at, observer, eqd.ra, eqd.dec, 'normal')
  return { altitudeDeg: horiz.altitude, azimuthDeg: horiz.azimuth }
}

export function bodyToHorizontal(
  body: Body,
  lat: number,
  lon: number,
  elevationM: number,
  utcMs: number,
): HorizontalPosition {
  const at = new Date(utcMs)
  const observer = new Observer(lat, lon, elevationM / 1000)
  const eq = Equator(body, at, observer, true, true)
  const horiz = Horizon(at, observer, eq.ra, eq.dec, 'normal')
  return { altitudeDeg: horiz.altitude, azimuthDeg: horiz.azimuth }
}

const BODY_BY_ID: Record<string, Body> = {
  sun: Body.Sun,
  moon: Body.Moon,
  mercury: Body.Mercury,
  venus: Body.Venus,
  mars: Body.Mars,
  jupiter: Body.Jupiter,
  saturn: Body.Saturn,
  uranus: Body.Uranus,
  neptune: Body.Neptune,
}

export function objectHorizontalAt(
  object: CelestialObject,
  lat: number,
  lon: number,
  elevationM: number,
  utcMs: number,
): HorizontalPosition | null {
  if (object.catalogIds.body) {
    const body = BODY_BY_ID[object.catalogIds.body]
    if (!body) return null
    return bodyToHorizontal(body, lat, lon, elevationM, utcMs)
  }
  if (object.raHours == null || object.decDeg == null) return null
  return j2000ToHorizontal(
    object.raHours,
    object.decDeg,
    lat,
    lon,
    elevationM,
    utcMs,
  )
}

/**
 * Invert local horizontal (MapLibre-style az from north, alt) → J2000 RA/Dec.
 * Used to lock an equatorial mount on the current look centre.
 */
export function horizontalToJ2000(
  altitudeDeg: number,
  azimuthDeg: number,
  lat: number,
  lon: number,
  elevationM: number,
  utcMs: number,
): EquatorialJ2000 {
  const at = new Date(utcMs)
  const observer = new Observer(lat, lon, elevationM / 1000)
  // Spherical: lat=altitude, lon=azimuth (clockwise from north — engine toggles).
  const hor = VectorFromHorizon(
    new Spherical(altitudeDeg, azimuthDeg, 1),
    at,
    'normal',
  )
  const eqj = EquatorFromVector(
    RotateVector(Rotation_HOR_EQJ(at, observer), hor),
  )
  return { raHours: eqj.ra, decDeg: eqj.dec }
}

/** Sample altitude only — used by rise/set search. */
export function objectAltitudeDegAt(
  object: CelestialObject,
  lat: number,
  lon: number,
  elevationM: number,
  utcMs: number,
): number | null {
  const pos = objectHorizontalAt(object, lat, lon, elevationM, utcMs)
  return pos ? pos.altitudeDeg : null
}
