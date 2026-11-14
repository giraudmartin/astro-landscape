import { describe, expect, it } from 'vitest'
import { mapImageryNightDim } from '../applyMapSky'

/** Matches applyMapSky imagery paint: `raster-opacity = 1 - dim * 0.65`. */
function imageryOpacityFromDim(dim: number): number {
  return 1 - Math.min(1, Math.max(0, dim)) * 0.65
}

describe('mapImageryNightDim', () => {
  it('stays clear on the globe even at local night', () => {
    expect(mapImageryNightDim(1, -20, 0)).toBe(0)
  })

  it('stays clear at noon in ground view', () => {
    expect(mapImageryNightDim(0, 45, 1)).toBe(0)
  })

  it('dims after sunset and deeper by nautical twilight', () => {
    const dusk = mapImageryNightDim(0.06, -3, 1)
    const nautical = mapImageryNightDim(0.44, -9, 1)
    const night = mapImageryNightDim(1, -20, 1)
    expect(dusk).toBeGreaterThan(0.15)
    expect(nautical).toBeGreaterThan(dusk)
    expect(night).toBeGreaterThan(nautical)
    expect(nautical).toBeGreaterThan(0.5)
    // Deep night must nearly max out — weak dim leaves noon ortho looking like day.
    expect(night).toBeGreaterThan(0.85)
    expect(night).toBeLessThanOrEqual(1)
  })

  it('maps deep-night dim to readable imagery opacity (~0.35, not day/void)', () => {
    const dim = mapImageryNightDim(1, -20, 1)
    const opacity = imageryOpacityFromDim(dim)
    expect(opacity).toBeGreaterThan(0.3)
    expect(opacity).toBeLessThan(0.45)
    expect(opacity).toBeCloseTo(1 - dim * 0.65, 5)
  })
})
