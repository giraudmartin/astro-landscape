import { describe, expect, it } from 'vitest'
import {
  groundAlbedoFromSky,
  skyPaletteFromSunAltitude,
} from '../skyLighting'

function luminance(c: { r: number; g: number; b: number }): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

describe('groundAlbedoFromSky', () => {
  it('stays near white and bright at noon', () => {
    const palette = skyPaletteFromSunAltitude(45)
    const tint = groundAlbedoFromSky(palette, 45)
    expect(luminance(tint)).toBeGreaterThan(0.9)
    expect(Math.abs(tint.r - tint.g)).toBeLessThan(0.08)
    expect(Math.abs(tint.g - tint.b)).toBeLessThan(0.08)
  })

  it('warms and soft-dims at golden hour', () => {
    const palette = skyPaletteFromSunAltitude(2)
    const tint = groundAlbedoFromSky(palette, 2)
    expect(tint.r).toBeGreaterThan(tint.b)
    expect(luminance(tint)).toBeGreaterThan(0.7)
  })

  it('darkens right after sunset, deeper at night', () => {
    const day = groundAlbedoFromSky(skyPaletteFromSunAltitude(30), 30)
    const dusk = groundAlbedoFromSky(skyPaletteFromSunAltitude(-3), -3)
    const night = groundAlbedoFromSky(skyPaletteFromSunAltitude(-20), -20)
    expect(luminance(dusk)).toBeLessThan(luminance(day) * 0.85)
    expect(luminance(night)).toBeLessThan(luminance(dusk))
    expect(luminance(night)).toBeLessThan(luminance(day) * 0.55)
    expect(night.b / Math.max(night.r, 1e-6)).toBeGreaterThan(
      day.b / Math.max(day.r, 1e-6),
    )
  })

  it('stays neutral when atmosphere is off', () => {
    const tint = groundAlbedoFromSky(skyPaletteFromSunAltitude(-15), -15, {
      atmosphereOn: false,
    })
    expect(Math.abs(tint.r - tint.g)).toBeLessThan(0.04)
    expect(Math.abs(tint.g - tint.b)).toBeLessThan(0.04)
  })

  it('nightBrightness scales night only, not noon', () => {
    const noonHi = groundAlbedoFromSky(skyPaletteFromSunAltitude(45), 45, {
      nightBrightness: 1.4,
    })
    const noonLo = groundAlbedoFromSky(skyPaletteFromSunAltitude(45), 45, {
      nightBrightness: 0.4,
    })
    expect(Math.abs(luminance(noonHi) - luminance(noonLo))).toBeLessThan(0.02)

    const nightHi = groundAlbedoFromSky(skyPaletteFromSunAltitude(-20), -20, {
      nightBrightness: 1.2,
    })
    const nightLo = groundAlbedoFromSky(skyPaletteFromSunAltitude(-20), -20, {
      nightBrightness: 0.4,
    })
    expect(luminance(nightLo)).toBeLessThan(luminance(nightHi) * 0.7)
  })

  it('nightContrast and temperature leave noon alone', () => {
    const base = groundAlbedoFromSky(skyPaletteFromSunAltitude(40), 40)
    const dialed = groundAlbedoFromSky(skyPaletteFromSunAltitude(40), 40, {
      nightContrast: 1.6,
      nightTemperature: 0.8,
    })
    expect(Math.abs(base.r - dialed.r)).toBeLessThan(0.02)
    expect(Math.abs(base.b - dialed.b)).toBeLessThan(0.02)
  })

  it('warm temperature raises R over B at night', () => {
    const cool = groundAlbedoFromSky(skyPaletteFromSunAltitude(-18), -18, {
      nightTemperature: -0.8,
    })
    const warm = groundAlbedoFromSky(skyPaletteFromSunAltitude(-18), -18, {
      nightTemperature: 0.8,
    })
    expect(warm.r / warm.b).toBeGreaterThan(cool.r / cool.b)
  })
})
