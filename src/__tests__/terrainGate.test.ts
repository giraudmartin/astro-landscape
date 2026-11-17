import { describe, expect, it } from 'vitest'
import { elevationAngleDeg, ridgeTransmission } from '../lightPollution/sampleElevation'
import {
  highObserverNearFade,
  terrainGateAt,
  type TerrainGateLut,
} from '../lightPollution/terrainGate'

describe('ridgeTransmission', () => {
  it('is clear when the source sits above the ridge line', () => {
    expect(ridgeTransmission(1900, 1000, 20, -5)).toBe(1)
  })

  it('stays soft (not binary) when buried', () => {
    const t = ridgeTransmission(1900, 1000, 15, 10)
    expect(t).toBeGreaterThan(0.05)
    expect(t).toBeLessThan(0.5)
  })
})

describe('highObserverNearFade', () => {
  it('leaves flat/low sites alone', () => {
    expect(highObserverNearFade(200, 10)).toBe(1)
    expect(highObserverNearFade(undefined, 10)).toBe(1)
  })

  it('attenuates nearby valley lights for high observers', () => {
    const near = highObserverNearFade(1900, 5, 1000)
    const far = highObserverNearFade(1900, 90, 1000)
    expect(near).toBeLessThan(0.85)
    expect(far).toBe(1)
    expect(near).toBeGreaterThan(0.3)
  })
})

describe('terrainGateAt', () => {
  it('returns 1 without a LUT or for far sources', () => {
    expect(terrainGateAt(null, 270, 20)).toBe(1)
    const lut: TerrainGateLut = {
      byAz: new Float32Array(32).fill(0.4),
      eyeElevM: 1900,
      azBins: 32,
    }
    expect(terrainGateAt(lut, 270, 120)).toBe(1)
    expect(terrainGateAt(lut, 270, 10)).toBeCloseTo(0.4, 5)
  })
})

describe('elevationAngleDeg', () => {
  it('is negative when looking down into a valley', () => {
    expect(elevationAngleDeg(1900, 1000, 10)).toBeLessThan(0)
  })
})
