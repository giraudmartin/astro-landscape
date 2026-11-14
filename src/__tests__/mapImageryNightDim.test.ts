import { describe, expect, it } from 'vitest'
import { mapImageryNightDim } from '../applyMapSky'

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
  })
})
