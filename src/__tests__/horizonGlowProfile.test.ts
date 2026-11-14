import { describe, expect, it } from 'vitest'
import {
  distanceWeight,
  emptyHorizonGlowProfile,
  highSiteRingScale,
  LP_AZIMUTH_BINS,
  peakIntensity01,
} from '../lightPollution/horizonGlowProfile'

describe('horizonGlowProfile', () => {
  it('starts empty with the expected bin count', () => {
    const p = emptyHorizonGlowProfile()
    expect(p.azimuth.length).toBe(LP_AZIMUTH_BINS)
    expect(p.horizonAltDeg.length).toBe(LP_AZIMUTH_BINS)
    expect(p.mean).toBe(0)
    expect(p.peak).toBe(0)
    expect(p.peakAzDeg).toBe(0)
  })

  it('weights near rings much more than far ones', () => {
    expect(distanceWeight(20)).toBeGreaterThan(distanceWeight(110))
    expect(distanceWeight(110)).toBeGreaterThan(distanceWeight(360))
    expect(distanceWeight(360)).toBeGreaterThan(0)
  })

  it('maps absolute peak to intensity with a noise floor', () => {
    expect(peakIntensity01(0.0018)).toBe(0)
    expect(peakIntensity01(0.14)).toBeGreaterThan(0)
  })

  it('attenuates near valley towns for high observatories, not far lobes', () => {
    expect(highSiteRingScale(200, 15)).toBe(1)
    expect(highSiteRingScale(2400, 15)).toBeLessThan(0.8)
    expect(highSiteRingScale(2400, 15)).toBeLessThan(
      highSiteRingScale(2400, 170),
    )
    expect(highSiteRingScale(2400, 170)).toBeGreaterThan(0.95)
    expect(highSiteRingScale(4200, 40)).toBeGreaterThan(
      highSiteRingScale(4200, 15),
    )
  })
})
