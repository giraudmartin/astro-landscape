import { describe, expect, it } from 'vitest'
import {
  elevFromTerrariumRgb,
  elevationAngleDeg,
  ridgeTransmission,
} from '../lightPollution/sampleElevation'

describe('sampleElevation helpers', () => {
  it('decodes Terrarium RGB to metres', () => {
    // Sea level ≈ 32768 encoded → elev 0
    expect(elevFromTerrariumRgb(128, 0, 0)).toBeCloseTo(0, 5)
    // 1000 m ≈ 33768 → R=131, G=208 (131*256+208=33744) close enough
    expect(elevFromTerrariumRgb(131, 208, 0)).toBeCloseTo(976, 0)
  })

  it('computes elevation angles', () => {
    expect(elevationAngleDeg(1000, 1000, 10)).toBeCloseTo(0, 5)
    expect(elevationAngleDeg(0, 1000, 10)).toBeGreaterThan(5)
    expect(elevationAngleDeg(2000, 500, 20)).toBeLessThan(0)
  })

  it('attenuates glow behind a high ridge', () => {
    // Source at ~0° elev, ridge at +5° → mostly blocked
    const buried = ridgeTransmission(1000, 1000, 50, 5)
    const clear = ridgeTransmission(1000, 1200, 50, -1)
    expect(buried).toBeLessThan(0.35)
    expect(clear).toBeGreaterThan(0.9)
    expect(clear).toBeGreaterThan(buried)
  })
})
