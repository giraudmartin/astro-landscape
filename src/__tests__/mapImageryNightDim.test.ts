import { describe, expect, it } from 'vitest'
import {
  mapImageryNightDim,
  mapImageryNightPaint,
} from '../applyMapSky'
import { nightShadeOpacityAtZoom } from '../globeSun'

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
    expect(dusk).toBeGreaterThan(0.1)
    expect(nautical).toBeGreaterThan(dusk)
    expect(night).toBeGreaterThan(nautical)
    expect(night).toBeGreaterThan(0.65)
    expect(night).toBeLessThanOrEqual(1)
  })

  it('keeps deep-night imagery navigable but not noon-bright', () => {
    const dim = mapImageryNightDim(1, -20, 1)
    const paint = mapImageryNightPaint(dim, 1)
    expect(paint.opacity).toBeGreaterThanOrEqual(0.78)
    expect(paint.opacity).toBeLessThan(0.9)
    expect(paint.brightnessMax).toBeGreaterThanOrEqual(0.42)
    expect(paint.brightnessMax).toBeLessThan(0.65)
  })

  it('mid-ground framing dims less than full ground (no early blackout)', () => {
    const mid = mapImageryNightDim(1, -20, 0.5)
    const full = mapImageryNightDim(1, -20, 1)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(full)
    expect(mid).toBeLessThan(full * 0.6)
    const midPaint = mapImageryNightPaint(mid, 0.5)
    expect(midPaint.opacity).toBeGreaterThan(0.88)
    expect(midPaint.brightnessMax).toBeGreaterThan(0.55)
  })
})

describe('nightShadeOpacityAtZoom', () => {
  it('is full on the globe and gone by map mid-zoom', () => {
    expect(nightShadeOpacityAtZoom(3, 1)).toBe(1)
    expect(nightShadeOpacityAtZoom(4.5, 1)).toBe(1)
    expect(nightShadeOpacityAtZoom(6.5, 1)).toBeCloseTo(0.4, 5)
    expect(nightShadeOpacityAtZoom(7.5, 1)).toBe(0)
    expect(nightShadeOpacityAtZoom(10, 1)).toBe(0)
    expect(nightShadeOpacityAtZoom(14, 1)).toBe(0)
  })

  it('scales with strength', () => {
    expect(nightShadeOpacityAtZoom(4.5, 0.5)).toBeCloseTo(0.5, 5)
    expect(nightShadeOpacityAtZoom(7.5, 0.5)).toBe(0)
  })
})
