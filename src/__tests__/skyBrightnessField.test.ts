import { describe, expect, it } from 'vitest'
import {
  emptyHorizonGlowProfile,
  peakIntensity01,
} from '../lightPollution/horizonGlowProfile'
import {
  blurAzimuthCircular,
  buildSkyBrightnessField,
  elevFalloff,
  horizonWorthDrawing,
  legendRangeForField,
  magToRgb,
  sampleFieldMag,
} from '../lightPollution/skyBrightnessField'

describe('peakIntensity01 (Duriscoe wedge S)', () => {
  it('kills Spitzkoppe-scale noise that used to fake a city dome', () => {
    expect(peakIntensity01(0)).toBe(0)
    expect(peakIntensity01(0.002)).toBe(0)
    expect(peakIntensity01(0.2)).toBe(0)
  })

  it('rises for real town / city wedge sums', () => {
    expect(peakIntensity01(9)).toBeGreaterThan(0.25) // Mer-like
    expect(peakIntensity01(9)).toBeLessThan(0.45)
    expect(peakIntensity01(30)).toBeGreaterThan(0.5)
    expect(peakIntensity01(115)).toBeGreaterThan(0.8) // Paris-like
  })
})

describe('skyBrightnessField', () => {
  it('keeps zenith darker than a city horizon lobe when intensity is real', () => {
    const profile = emptyHorizonGlowProfile()
    profile.azimuth[0] = 1
    profile.azimuth[1] = 0.85
    profile.azimuth[profile.azimuth.length - 1] = 0.85
    profile.peak = 30
    profile.mean = 0.2

    const field = buildSkyBrightnessField(21.85, profile)
    const zenith = sampleFieldMag(field, 0, 90)
    const cityHorizon = sampleFieldMag(field, 0, 2)
    const oppositeHorizon = sampleFieldMag(field, 180, 2)

    expect(zenith).toBeGreaterThan(cityHorizon)
    expect(oppositeHorizon).toBeGreaterThan(cityHorizon)
    expect(field.minMag).toBeLessThan(field.maxMag)
    expect(field.intensity).toBeGreaterThan(0.5)
  })

  it('does not invent a bright dome from tiny absolute peak (Spitzkoppe regression)', () => {
    const profile = emptyHorizonGlowProfile()
    const east = Math.round((96 / 360) * profile.azimuth.length)
    profile.azimuth[east] = 1
    profile.azimuth[(east + 1) % profile.azimuth.length] = 0.8
    profile.azimuth[(east - 1 + profile.azimuth.length) % profile.azimuth.length] =
      0.8
    profile.peak = 0.2
    profile.mean = 0.05
    profile.peakAzDeg = 96

    const field = buildSkyBrightnessField(21.99, profile)
    const eastHorizon = sampleFieldMag(field, 96, 1)
    const zenith = sampleFieldMag(field, 0, 90)

    expect(field.intensity).toBe(0)
    expect(eastHorizon).toBeGreaterThan(21.7)
    expect(zenith - eastHorizon).toBeLessThan(0.2)
    expect(field.minMag).toBeGreaterThan(21.7)
  })

  it('applies a modest lobe for Mer-scale alpine town glow', () => {
    const profile = emptyHorizonGlowProfile()
    const nw = Math.round((280 / 360) * profile.azimuth.length)
    profile.azimuth[nw] = 1
    profile.azimuth[(nw + 1) % profile.azimuth.length] = 0.85
    profile.peak = 9 // Mer Duriscoe all-sky wedge S
    profile.mean = 0.25
    profile.peakAzDeg = 280

    const field = buildSkyBrightnessField(21.25, profile)
    const lobe = sampleFieldMag(field, 280, 1)
    const zenith = sampleFieldMag(field, 0, 90)

    // LPM/App Mer max ≈ 20.6–20.9 from our zenith 21.25 → drop ~0.3–0.7
    expect(field.intensity).toBeGreaterThan(0.25)
    expect(lobe).toBeGreaterThan(20.5)
    expect(lobe).toBeLessThan(21.1)
    expect(zenith).toBeGreaterThan(lobe)
    expect(zenith - lobe).toBeGreaterThan(0.2)
    expect(zenith - lobe).toBeLessThan(0.75)
  })

  it('spreads a city into a wide dome, not a vertical pillar', () => {
    const profile = emptyHorizonGlowProfile()
    // Single-bin spike — old path drew a chimney here.
    profile.azimuth[0] = 1
    profile.peak = 40
    profile.mean = 0.05
    const field = buildSkyBrightnessField(21.5, profile)
    const peak = sampleFieldMag(field, 0, 2)
    const near = sampleFieldMag(field, 25, 2)
    const far = sampleFieldMag(field, 180, 2)
    const midPeak = sampleFieldMag(field, 0, 30)
    // Mag: higher = darker. Peak brightest; ±25° still on the mound (not a
    // 1-bin pillar), but domes stay directional (not a flat wash).
    expect(near).toBeGreaterThan(peak)
    expect(near - peak).toBeLessThan(0.85)
    expect(far).toBeGreaterThan(near)
    expect(far - near).toBeGreaterThan(0.12)
    // Soft rise into the sky — still some glow at 30°, not only alt=0.
    expect(midPeak).toBeLessThan(field.zenithMag)
    expect(field.zenithMag - midPeak).toBeGreaterThan(0.05)
  })

  it('blurs azimuth into a mound (Gaussian helper)', () => {
    const spike = new Float32Array(64)
    spike[0] = 1
    const wide = blurAzimuthCircular(spike, 4)
    expect(wide[0]).toBeCloseTo(1, 5) // renormalized peak
    expect(wide[3]!).toBeGreaterThan(0.2)
    expect(wide[32]!).toBeLessThan(0.05)
  })

  it('allows strong lobes for dense-city wedge sums (Paris-scale)', () => {
    const profile = emptyHorizonGlowProfile()
    profile.azimuth[1] = 1 // ~5°
    profile.azimuth[0] = 0.75
    profile.azimuth[2] = 0.75
    profile.peak = 115
    profile.mean = 0.55
    const field = buildSkyBrightnessField(17.95, profile)
    const lobe = sampleFieldMag(field, 5, 1)
    expect(lobe).toBeLessThan(17.2)
    expect(field.zenithMag - lobe).toBeGreaterThan(0.9)
  })

  it('keeps urban wash flatter than a lone rural city lobe', () => {
    const rural = emptyHorizonGlowProfile()
    rural.azimuth[0] = 1
    rural.peak = 25
    rural.mean = 0.12
    const urban = emptyHorizonGlowProfile()
    urban.azimuth.fill(0.9)
    urban.azimuth[0] = 1
    urban.peak = 120
    urban.mean = 0.85
    const ruralField = buildSkyBrightnessField(21.5, rural)
    const urbanField = buildSkyBrightnessField(18.1, urban)
    const ruralContrast =
      sampleFieldMag(ruralField, 180, 1) - sampleFieldMag(ruralField, 0, 1)
    const urbanContrast =
      sampleFieldMag(urbanField, 180, 1) - sampleFieldMag(urbanField, 0, 1)
    expect(ruralContrast).toBeGreaterThan(urbanContrast)
  })

  it('keeps a soft mid-sky wash (LPM-like), not only a razor horizon lobe', () => {
    expect(elevFalloff(0)).toBeGreaterThan(0.95)
    expect(elevFalloff(35)).toBeGreaterThan(0.28)
    expect(elevFalloff(55)).toBeGreaterThan(0.12)
    expect(elevFalloff(55)).toBeLessThan(0.35)
    expect(elevFalloff(90)).toBe(0)
  })

  it('applies a regional wash, not only a pinpoint city contrast', () => {
    const profile = emptyHorizonGlowProfile()
    profile.azimuth.fill(0.35)
    profile.azimuth[0] = 1
    profile.peak = 20
    profile.mean = 0.35
    const field = buildSkyBrightnessField(21.7, profile)
    const midAway = sampleFieldMag(field, 180, 35)
    const zenith = sampleFieldMag(field, 0, 90)
    expect(zenith - midAway).toBeGreaterThan(0.08)
    expect(zenith - midAway).toBeLessThan(0.9)
  })

  it('maps brighter mag to warmer rgb than darker mag', () => {
    const bright = magToRgb(20.9, 20.8, 21.8)
    const dark = magToRgb(21.8, 20.8, 21.8)
    expect(bright[0] + bright[1]).toBeGreaterThan(dark[0] + dark[1])
  })

  it('anchors legend on zenith instead of stretching noise', () => {
    const profile = emptyHorizonGlowProfile()
    profile.peak = 0
    const field = buildSkyBrightnessField(21.99, profile)
    const legend = legendRangeForField(field)
    expect(legend.max).toBeGreaterThanOrEqual(21.99)
    expect(legend.max - legend.min).toBeGreaterThanOrEqual(1.0)
    expect(legend.min).toBeGreaterThan(20.5)
  })

  it('only draws terrain when the DEM horizon is material', () => {
    const flat = new Float32Array(64)
    flat.fill(0.4)
    expect(horizonWorthDrawing(flat)).toBe(false)
    flat[10] = 8
    expect(horizonWorthDrawing(flat)).toBe(true)
    const field = buildSkyBrightnessField(21.9, emptyHorizonGlowProfile())
    expect(field.horizonAltDeg.length).toBe(field.azBins)
  })
})
