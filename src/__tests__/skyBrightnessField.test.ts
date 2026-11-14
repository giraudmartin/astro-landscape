import { describe, expect, it } from 'vitest'
import {
  emptyHorizonGlowProfile,
  peakIntensity01,
} from '../lightPollution/horizonGlowProfile'
import {
  buildSkyBrightnessField,
  elevFalloff,
  horizonWorthDrawing,
  legendRangeForField,
  magToRgb,
  sampleFieldMag,
} from '../lightPollution/skyBrightnessField'

describe('peakIntensity01', () => {
  it('kills Spitzkoppe-scale noise that used to fake a city dome', () => {
    // Old path: peakAbs ≈ 0.002 still normalized to shape=1 → Max 20.91@96°.
    expect(peakIntensity01(0)).toBe(0)
    expect(peakIntensity01(0.002)).toBe(0)
    expect(peakIntensity01(0.02)).toBe(0)
    expect(peakIntensity01(0.024)).toBe(0)
  })

  it('rises for real town / city ring sums', () => {
    expect(peakIntensity01(0.08)).toBeGreaterThan(0.15)
    expect(peakIntensity01(0.08)).toBeLessThan(0.45)
    expect(peakIntensity01(0.5)).toBeGreaterThan(0.55)
    expect(peakIntensity01(1.5)).toBeGreaterThan(0.85)
    expect(peakIntensity01(4)).toBe(1)
  })
})

describe('skyBrightnessField', () => {
  it('keeps zenith darker than a city horizon lobe when intensity is real', () => {
    const profile = emptyHorizonGlowProfile()
    profile.azimuth[0] = 1
    profile.azimuth[1] = 0.85
    profile.azimuth[profile.azimuth.length - 1] = 0.85
    profile.peak = 0.55
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
    // Shape says “city due east” — exactly the old false Az≈96° lobe.
    const east = Math.round((96 / 360) * profile.azimuth.length)
    profile.azimuth[east] = 1
    profile.azimuth[(east + 1) % profile.azimuth.length] = 0.8
    profile.azimuth[(east - 1 + profile.azimuth.length) % profile.azimuth.length] =
      0.8
    profile.peak = 0.0018 // measured Black Marble noise at Spitzkoppe
    profile.mean = 0.05
    profile.peakAzDeg = 96

    const field = buildSkyBrightnessField(21.99, profile)
    const eastHorizon = sampleFieldMag(field, 96, 1)
    const zenith = sampleFieldMag(field, 0, 90)

    // Must stay within natural airmass of zenith — never the old Max 20.91.
    expect(field.intensity).toBe(0)
    expect(eastHorizon).toBeGreaterThan(21.7)
    expect(zenith - eastHorizon).toBeLessThan(0.2)
    expect(field.minMag).toBeGreaterThan(21.7)
  })

  it('applies a modest lobe for Spitzkoppe-scale real towns (Usakos / coast)', () => {
    const profile = emptyHorizonGlowProfile()
    const ssw = Math.round((191 / 360) * profile.azimuth.length)
    profile.azimuth[ssw] = 1
    profile.azimuth[(ssw + 1) % profile.azimuth.length] = 0.85
    profile.peak = 0.08
    profile.mean = 0.2
    profile.peakAzDeg = 191

    const field = buildSkyBrightnessField(21.99, profile)
    const lobe = sampleFieldMag(field, 191, 1)
    const zenith = sampleFieldMag(field, 0, 90)

    // LPM Spitzkoppe max ≈ 21.08 — ballpark, not the old fake 20.91 yellow.
    expect(field.intensity).toBeGreaterThan(0.15)
    expect(lobe).toBeGreaterThan(20.9)
    expect(lobe).toBeLessThan(21.7)
    expect(zenith).toBeGreaterThan(lobe)
    expect(zenith - lobe).toBeLessThan(1.2)
  })

  it('allows multi-mag lobes under a dark zenith (Mauna Kea / Joshua Tree)', () => {
    const profile = emptyHorizonGlowProfile()
    profile.azimuth[28] = 1 // ~157°
    profile.peak = 0.35
    profile.mean = 0.15
    const field = buildSkyBrightnessField(21.93, profile)
    const lobe = sampleFieldMag(field, 157, 1)
    // LPM Mauna Kea max ≈ 19.15 — must not stay capped near 21.0.
    expect(lobe).toBeLessThan(20.6)
    expect(field.zenithMag - lobe).toBeGreaterThan(1.2)
  })

  it('keeps urban wash flatter than a lone rural city lobe', () => {
    const rural = emptyHorizonGlowProfile()
    rural.azimuth[0] = 1
    rural.peak = 0.5
    rural.mean = 0.12
    const urban = emptyHorizonGlowProfile()
    urban.azimuth.fill(0.9)
    urban.azimuth[0] = 1
    urban.peak = 1.5
    urban.mean = 0.85
    const ruralField = buildSkyBrightnessField(21.5, rural)
    const urbanField = buildSkyBrightnessField(18.1, urban)
    const ruralContrast =
      sampleFieldMag(ruralField, 180, 1) - sampleFieldMag(ruralField, 0, 1)
    const urbanContrast =
      sampleFieldMag(urbanField, 180, 1) - sampleFieldMag(urbanField, 0, 1)
    expect(ruralContrast).toBeGreaterThan(urbanContrast)
  })

  it('hugs the horizon — little excess left at 55° altitude', () => {
    expect(elevFalloff(0)).toBeGreaterThan(0.95)
    expect(elevFalloff(55)).toBeLessThan(0.08)
    expect(elevFalloff(90)).toBe(0)
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
