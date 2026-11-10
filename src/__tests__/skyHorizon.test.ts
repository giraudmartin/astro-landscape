import { describe, expect, it } from 'vitest'
import { EARTH_RADIUS_M, geometricHorizonSin } from '../skyDome'

describe('geometricHorizonSin', () => {
  it('is ~0 at tripod height near sea level', () => {
    expect(geometricHorizonSin(0)).toBe(0)
    expect(Math.abs(geometricHorizonSin(2))).toBeLessThan(0.001)
  })

  it('dips ~1.5° at 2275 m (coastal mountain)', () => {
    const s = geometricHorizonSin(2275)
    const deg = (Math.asin(s) * 180) / Math.PI
    expect(deg).toBeLessThan(-1.4)
    expect(deg).toBeGreaterThan(-1.7)
    // Matches √(2h/R) small-angle approx within 5%.
    const approx = (-Math.sqrt((2 * 2275) / EARTH_RADIUS_M) * 180) / Math.PI
    expect(Math.abs(deg - approx)).toBeLessThan(0.05)
  })

  it('deepens with altitude', () => {
    expect(geometricHorizonSin(500)).toBeGreaterThan(geometricHorizonSin(3000))
  })
})
