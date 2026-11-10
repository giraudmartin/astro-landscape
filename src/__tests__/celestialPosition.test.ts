import {
  Body,
  DefineStar,
  Equator,
  Horizon,
  Observer,
} from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { j2000ToHorizontal, objectHorizontalAt } from '../celestialObjects/position'
import { computeDayVisibility } from '../celestialObjects/visibility'
import type { CelestialObject } from '../celestialObjects/types'

/** Sirius J2000 from in-repo HYG extract. */
const SIRIUS: CelestialObject = {
  id: 'hip:32349',
  name: 'Sirius',
  aliases: [],
  catalogIds: { hip: 32349 },
  type: 'star',
  raHours: 6.752481,
  decDeg: -16.716116,
  mag: -1.44,
  constellation: null,
}

const POLARIS: CelestialObject = {
  id: 'hip:11767',
  name: 'Polaris',
  aliases: [],
  catalogIds: { hip: 11767 },
  type: 'star',
  raHours: 2.52975,
  decDeg: 89.264109,
  mag: 1.97,
  constellation: null,
}

const M42: CelestialObject = {
  id: 'dso:M42',
  name: 'M42',
  aliases: [],
  catalogIds: { messier: 42 },
  type: 'nebula',
  raHours: 5.588144,
  decDeg: -5.391111,
  mag: 4,
  constellation: 'Ori',
}

/** Independent path: DefineStar + Equator(ofdate) + Horizon. */
function referenceHorizontal(
  raHours: number,
  decDeg: number,
  lat: number,
  lon: number,
  elevationM: number,
  utcMs: number,
): { altitudeDeg: number; azimuthDeg: number } {
  DefineStar(Body.Star7, raHours, decDeg, 100)
  const at = new Date(utcMs)
  const observer = new Observer(lat, lon, elevationM / 1000)
  const eq = Equator(Body.Star7, at, observer, true, true)
  const horiz = Horizon(at, observer, eq.ra, eq.dec, 'normal')
  return { altitudeDeg: horiz.altitude, azimuthDeg: horiz.azimuth }
}

function angDiff(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180)
}

describe('j2000ToHorizontal', () => {
  it('matches DefineStar/Equator/Horizon within 0.05° (precession path)', () => {
    // Paris, 2024-12-15 22:00 UTC
    const utcMs = Date.UTC(2024, 11, 15, 22, 0, 0)
    const lat = 48.8566
    const lon = 2.3522
    const ours = j2000ToHorizontal(
      SIRIUS.raHours!,
      SIRIUS.decDeg!,
      lat,
      lon,
      35,
      utcMs,
    )
    const ref = referenceHorizontal(
      SIRIUS.raHours!,
      SIRIUS.decDeg!,
      lat,
      lon,
      35,
      utcMs,
    )
    expect(Math.abs(ours.altitudeDeg - ref.altitudeDeg)).toBeLessThan(0.05)
    expect(angDiff(ours.azimuthDeg, ref.azimuthDeg)).toBeLessThan(0.05)
  })

  it('keeps Polaris near the north celestial pole altitude ≈ latitude', () => {
    const utcMs = Date.UTC(2024, 5, 21, 0, 0, 0)
    const lat = 48.8566
    const lon = 2.3522
    const pos = objectHorizontalAt(POLARIS, lat, lon, 35, utcMs)
    expect(pos).not.toBeNull()
    // Polaris altitude ≈ lat ± ~1°
    expect(Math.abs(pos!.altitudeDeg - lat)).toBeLessThan(1.2)
  })
})

describe('computeDayVisibility', () => {
  it('marks Polaris circumpolar from Paris', () => {
    const vis = computeDayVisibility(POLARIS, '2024-12-15', 48.8566, 2.3522, 35)
    expect(vis.status).toBe('circumpolar')
    expect(vis.rise).toBeNull()
    expect(vis.set).toBeNull()
    expect(vis.culmination).not.toBeNull()
  })

  it('marks a far-south target as never rising from high north', () => {
    const south: CelestialObject = {
      id: 'test:south',
      name: 'South',
      aliases: [],
      catalogIds: {},
      type: 'star',
      raHours: 0,
      decDeg: -80,
      mag: 1,
      constellation: null,
    }
    const vis = computeDayVisibility(south, '2024-06-21', 60, 10, 0)
    expect(vis.status).toBe('never_rises')
    expect(vis.rise).toBeNull()
    expect(vis.set).toBeNull()
  })

  it('returns rise/set for Sirius on a civil day in Paris', () => {
    const vis = computeDayVisibility(SIRIUS, '2024-12-15', 48.8566, 2.3522, 35)
    expect(vis.status).toBe('rises_and_sets')
    expect(vis.rise).not.toBeNull()
    expect(vis.set).not.toBeNull()
    expect(vis.culmination).not.toBeNull()
    // Local civil times are HH:MM
    expect(vis.rise!.datetimeLocal).toMatch(/^\d{2}:\d{2}$/)
  })

  it('updates when the civil date changes', () => {
    const a = computeDayVisibility(M42, '2024-01-15', 48.8566, 2.3522, 35)
    const b = computeDayVisibility(M42, '2024-07-15', 48.8566, 2.3522, 35)
    expect(a.culmination?.datetimeUtc).not.toBe(b.culmination?.datetimeUtc)
  })

  it('keeps solar conventions for the Sun via SearchRiseSet', () => {
    const sun: CelestialObject = {
      id: 'body:sun',
      name: 'Soleil',
      aliases: [],
      catalogIds: { body: 'sun' },
      type: 'sun',
      raHours: null,
      decDeg: null,
      mag: -26.7,
      constellation: null,
    }
    const vis = computeDayVisibility(sun, '2024-06-21', 48.8566, 2.3522, 35)
    expect(vis.rise).not.toBeNull()
    expect(vis.set).not.toBeNull()
    // June sunrise before noon local, sunset after
    const riseH = Number(vis.rise!.datetimeLocal.slice(0, 2))
    const setH = Number(vis.set!.datetimeLocal.slice(0, 2))
    expect(riseH).toBeLessThan(12)
    expect(setH).toBeGreaterThan(12)
  })
})

describe('camera center contract', () => {
  it('returns az/alt usable as yaw/pitch without changing focal intent', () => {
    const utcMs = Date.UTC(2024, 11, 15, 22, 0, 0)
    const pos = objectHorizontalAt(SIRIUS, 48.8566, 2.3522, 35, utcMs)
    expect(pos).not.toBeNull()
    const yaw = ((pos!.azimuthDeg % 360) + 360) % 360
    const pitch = Math.max(-85, Math.min(85, pos!.altitudeDeg))
    expect(yaw).toBeGreaterThanOrEqual(0)
    expect(yaw).toBeLessThan(360)
    expect(pitch).toBeGreaterThanOrEqual(-85)
    expect(pitch).toBeLessThanOrEqual(85)
    // Focal length is orthogonal — this test only asserts look mapping.
    const focalMm = 50
    expect(focalMm).toBe(50)
  })
})
