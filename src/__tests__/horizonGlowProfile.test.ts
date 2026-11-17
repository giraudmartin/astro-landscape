import { describe, expect, it } from 'vitest'
import {
  HORIZON_MAX_MAG_DROP,
  HORIZON_PEAK_SOFT,
  allSkyKernelInfo,
  distanceWeight,
  emptyHorizonGlowProfile,
  highSiteRingScale,
  LP_AZIMUTH_BINS,
  peakIntensity01,
} from '../lightPollution/horizonGlowProfile'
import { allSkyKernel } from '../lightPollution/duriscoeZenith'

describe('horizonGlowProfile', () => {
  it('starts empty with the expected bin count', () => {
    const p = emptyHorizonGlowProfile()
    expect(p.azimuth.length).toBe(LP_AZIMUTH_BINS)
    expect(p.horizonAltDeg.length).toBe(LP_AZIMUTH_BINS)
    expect(p.mean).toBe(0)
    expect(p.peak).toBe(0)
    expect(p.peakAzDeg).toBe(0)
  })

  it('uses Duriscoe all-sky α (not First Rig zenith) for lobes', () => {
    const info = allSkyKernelInfo()
    expect(info.scale).toBeCloseTo(2.3, 5)
    expect(info.power).toBeCloseTo(0.28, 5)
    expect(allSkyKernel(10)).toBeGreaterThan(allSkyKernel(100))
    expect(distanceWeight(20)).toBeGreaterThan(distanceWeight(110))
  })

  it('lifts mid-range cities (30–80 km) vs raw all-sky', async () => {
    const { allSkyKernel, horizonDistanceWeight } = await import(
      '../lightPollution/duriscoeZenith'
    )
    // Hilo-scale distance gets a boost; near alpine field stays mild.
    expect(horizonDistanceWeight(50) / allSkyKernel(50)).toBeGreaterThan(2)
    expect(horizonDistanceWeight(10) / allSkyKernel(10)).toBeLessThan(1.5)
  })

  it('maps absolute Duriscoe wedge S to intensity (Mer / Paris / Spitz scale)', () => {
    // Noise / pristine
    expect(peakIntensity01(0)).toBe(0)
    expect(peakIntensity01(0.2)).toBe(0)
    // Spitz-scale S≈0.5 → tiny
    expect(peakIntensity01(0.5)).toBeLessThan(0.05)
    // Mer-scale S≈9 → moderate
    const mer = peakIntensity01(9)
    expect(mer).toBeGreaterThan(0.25)
    expect(mer).toBeLessThan(0.45)
    expect(HORIZON_MAX_MAG_DROP * mer).toBeGreaterThan(0.3)
    expect(HORIZON_MAX_MAG_DROP * mer).toBeLessThan(0.55)
    // Paris-scale S≈115 → strong
    const paris = peakIntensity01(115)
    expect(paris).toBeGreaterThan(0.8)
    expect(HORIZON_MAX_MAG_DROP * paris).toBeGreaterThan(1.0)
    expect(HORIZON_MAX_MAG_DROP * paris).toBeLessThan(1.4)
    expect(HORIZON_PEAK_SOFT).toBe(16)
  })

  it('keeps highSiteRingScale helper for legacy BM callers', () => {
    expect(highSiteRingScale(200, 15)).toBe(1)
    expect(highSiteRingScale(2400, 15)).toBeLessThan(0.8)
  })
})
