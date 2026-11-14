import { describe, expect, it } from 'vitest'
import {
  bortleColorCss,
  bortleFromBlackMarbleRgb,
  bortleFromRadiance,
  bortleFromTileLuminance,
  bortlePollutionFactor,
  glowFromBlackMarbleRgb,
  skyBrightnessMagFromRadiance,
} from '../lightPollution/bortleFromRadiance'

describe('bortleFromRadiance', () => {
  it('maps near-zero radiance to pristine / rural', () => {
    expect(bortleFromRadiance(0)).toBeLessThanOrEqual(2)
    expect(skyBrightnessMagFromRadiance(0)).toBeGreaterThan(21.9)
  })

  it('maps bright city radiance to high Bortle', () => {
    expect(bortleFromRadiance(40)).toBeGreaterThanOrEqual(7)
  })

  it('pollution factor is 0…1', () => {
    expect(bortlePollutionFactor(1)).toBe(0)
    expect(bortlePollutionFactor(9)).toBe(1)
  })

  it('colors green→red across the scale', () => {
    const green = bortleColorCss(1)
    const red = bortleColorCss(9)
    expect(green).toMatch(/^hsl\(/)
    expect(red).toMatch(/^hsl\(/)
    expect(green).not.toBe(red)
  })
})

describe('Black Marble navy floor', () => {
  it('treats Spitzkoppe-like navy as Bortle 1–2 (not 6)', () => {
    // Measured GIBS pixel at Spitzkoppe ≈ rgb(30,28,55)
    expect(glowFromBlackMarbleRgb(30 / 255, 28 / 255, 55 / 255)).toBe(0)
    expect(bortleFromBlackMarbleRgb(30 / 255, 28 / 255, 55 / 255)).toBeLessThanOrEqual(
      2,
    )
  })

  it('treats La Palma / Sahara navy as dark', () => {
    expect(bortleFromBlackMarbleRgb(17 / 255, 17 / 255, 37 / 255)).toBeLessThanOrEqual(
      2,
    )
    expect(bortleFromBlackMarbleRgb(34 / 255, 33 / 255, 65 / 255)).toBeLessThanOrEqual(
      2,
    )
  })

  it('treats white city cores as high Bortle (~Tokyo/Paris zenith, not 16.5)', () => {
    expect(bortleFromBlackMarbleRgb(1, 1, 1)).toBeGreaterThanOrEqual(7)
    // Softened BM→radiance: white ≈ 17.6 mag (LPM Tokyo zenith 17.66).
    expect(skyBrightnessMagFromRadiance(18)).toBeGreaterThan(17.4)
    expect(skyBrightnessMagFromRadiance(18)).toBeLessThan(18.0)
  })

  it('ignores raw navy luma that used to inflate Bortle', () => {
    // Old bug path: luma ~0.12 → Bortle ~6. Floor must kill it.
    expect(bortleFromTileLuminance(0.12)).toBeLessThanOrEqual(2)
    expect(bortleFromTileLuminance(0.14)).toBeLessThanOrEqual(2)
  })
})
