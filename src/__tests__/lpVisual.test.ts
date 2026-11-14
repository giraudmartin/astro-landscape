import { describe, expect, it } from 'vitest'
import {
  lightPollutionLiveFactor,
  lightPollutionMilkyWayMul,
  lightPollutionSiteFactor,
  lightPollutionStarBrightMul,
  lightPollutionStarMagPenalty,
} from '../lightPollution/lpVisual'

describe('lpVisual', () => {
  it('uses horizon peak under pristine zenith (Spitzkoppe / La Palma)', () => {
    expect(lightPollutionSiteFactor(0, 0.14)).toBeCloseTo(0.14)
    expect(lightPollutionSiteFactor(0, 0.53)).toBeCloseTo(0.53)
    expect(lightPollutionSiteFactor(0, 0)).toBe(0)
  })

  it('lets Bortle-9 zenith dominate flat urban sites', () => {
    expect(lightPollutionSiteFactor(1, 0.4)).toBe(1)
    expect(lightPollutionLiveFactor(1, 1, 0.2)).toBe(1)
  })

  it('cuts faint stars hard in the city, barely in the desert', () => {
    expect(lightPollutionStarMagPenalty(0, 1)).toBe(0)
    expect(lightPollutionStarMagPenalty(0.375, 1)).toBeLessThan(0.4)
    expect(lightPollutionStarMagPenalty(1, 1)).toBeCloseTo(2.2)
  })

  it('hides the Milky Way by suburban/urban Bortle', () => {
    expect(lightPollutionMilkyWayMul(0, 1)).toBe(1)
    expect(lightPollutionMilkyWayMul(0.25, 1)).toBeGreaterThan(0.7)
    // B5 (~0.5): washed
    expect(lightPollutionMilkyWayMul(0.5, 1)).toBeLessThan(0.45)
    // B7+ (~0.75): gone
    expect(lightPollutionMilkyWayMul(0.75, 1)).toBe(0)
    expect(lightPollutionMilkyWayMul(1, 0.85)).toBe(0)
  })

  it('crushes residual star punch under urban wash', () => {
    expect(lightPollutionStarBrightMul(0, 1)).toBe(1)
    expect(lightPollutionStarBrightMul(1, 1)).toBeCloseTo(0.45)
  })
})
