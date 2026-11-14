import { describe, expect, it } from 'vitest'
import { sunPositionAt } from '../celestial'
import {
  eclipticNorthPoleThreeLocal,
  sunDirectionFromAltAz,
} from '../skyDome'
import {
  clampZodiacalAmount,
  ZODIACAL_AMOUNT_DEFAULT,
} from '../skyLighting'

describe('clampZodiacalAmount', () => {
  it('clamps and falls back', () => {
    expect(clampZodiacalAmount(-1)).toBe(0)
    expect(clampZodiacalAmount(2)).toBe(1)
    expect(clampZodiacalAmount(0.4)).toBe(0.4)
    expect(clampZodiacalAmount(Number.NaN)).toBe(ZODIACAL_AMOUNT_DEFAULT)
  })
})

describe('eclipticNorthPoleThreeLocal', () => {
  it('keeps the Sun near the ecliptic plane in local ENU', () => {
    const when = new Date('2026-03-20T20:00:00Z')
    const lat = 45.5
    const lon = 6.5
    const pole = eclipticNorthPoleThreeLocal(when, lat, lon, 1000)
    expect(pole.length()).toBeCloseTo(1, 5)

    const sun = sunPositionAt(lat, lon, 1000, when.getTime())
    const sunDir = sunDirectionFromAltAz(sun.altitudeDeg, sun.azimuthDeg)
    const betaDeg = (Math.asin(Math.max(-1, Math.min(1, sunDir.dot(pole)))) * 180) / Math.PI
    // Mean ecliptic; residual from EQD/refraction should stay tiny.
    expect(Math.abs(betaDeg)).toBeLessThan(1.5)
  })
})
