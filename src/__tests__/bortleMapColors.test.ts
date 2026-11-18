import { describe, expect, it } from 'vitest'
import {
  bortleContinuousFromRadianceNw,
  colorizePlMapFromRadianceNw,
  PL_MAP_RADIANCE_FLOOR_NW,
} from '../lightPollution/bortleMapColors'
import { mercatorTilePixelToLonLat } from '../lightPollution/plMapOverlayProtocol'

describe('bortleContinuousFromRadianceNw', () => {
  it('keeps low VIIRS cells blue/cyan', () => {
    const rural = bortleContinuousFromRadianceNw(1.5)
    expect(rural).toBeGreaterThanOrEqual(2)
    expect(rural).toBeLessThan(4.5)
  })

  it('puts Paris (~74 nW) in class 9', () => {
    expect(bortleContinuousFromRadianceNw(74)).toBe(9)
  })
})

describe('colorizePlMapFromRadianceNw', () => {
  it('ignores floor noise', () => {
    expect(colorizePlMapFromRadianceNw(0)).toBeNull()
    expect(
      colorizePlMapFromRadianceNw(PL_MAP_RADIANCE_FLOOR_NW * 0.5),
    ).toBeNull()
  })

  it('paints low radiance blue', () => {
    const pixel = colorizePlMapFromRadianceNw(1.5)!
    expect(pixel.b).toBeGreaterThan(pixel.r)
  })

  it('paints Paris as bright red/white', () => {
    const paris = colorizePlMapFromRadianceNw(74)!
    expect(paris.r).toBeGreaterThan(200)
    expect(paris.a).toBeGreaterThan(180)
  })
})

describe('mercatorTilePixelToLonLat', () => {
  it('meets at shared vertical tile edge', () => {
    const left = mercatorTilePixelToLonLat(7, 63, 44, 255.5, 128)
    const right = mercatorTilePixelToLonLat(7, 64, 44, -0.5, 128)
    expect(left.lon).toBeCloseTo(right.lon, 5)
    expect(left.lat).toBeCloseTo(right.lat, 5)
  })
})
