import { describe, expect, it } from 'vitest'
import {
  demZoomForDistance,
  enhanceOceanPixelData,
  FAR_TERRAIN_RADIUS_M,
  NEAR_TERRAIN_RADIUS_M,
} from '../localTerrainMesh'

describe('demZoomForDistance', () => {
  it('keeps max DEM near the tripod', () => {
    expect(demZoomForDistance(0)).toBe(17)
    expect(demZoomForDistance(1_500)).toBe(17)
  })

  it('stays high through the mid-ground mountain band', () => {
    expect(demZoomForDistance(3_000)).toBe(16)
    expect(demZoomForDistance(6_000)).toBe(14)
    expect(demZoomForDistance(12_000)).toBe(13)
    expect(demZoomForDistance(24_000)).toBe(12)
  })

  it('coarsens past the near disc without collapsing early', () => {
    expect(demZoomForDistance(50_000)).toBe(11)
    expect(demZoomForDistance(100_000)).toBe(10)
    expect(demZoomForDistance(200_000)).toBe(8)
    expect(demZoomForDistance(280_000)).toBe(7)
  })
})

describe('terrain radii', () => {
  it('keeps a compact sharp near disc with far LOD beyond it', () => {
    // 12 km @ 4096 ≈ 6 m/px; 32 km×2048 crushed satellite to ~31 m/px.
    expect(NEAR_TERRAIN_RADIUS_M).toBe(6_000)
    expect(FAR_TERRAIN_RADIUS_M).toBeGreaterThan(NEAR_TERRAIN_RADIUS_M)
    expect(FAR_TERRAIN_RADIUS_M).toBe(300_000)
  })
})

describe('enhanceOceanPixelData', () => {
  it('lifts near-black blue sea pixels and leaves basalt alone', () => {
    const data = new Uint8ClampedArray([
      6, 14, 36, 255, // dark blue ocean
      18, 16, 14, 255, // dark basalt (must stay)
      140, 120, 90, 255, // bright land
    ])
    const basalt = [data[4]!, data[5]!, data[6]!] as const
    const land = [data[8]!, data[9]!, data[10]!] as const
    const oceanR0 = data[0]!

    enhanceOceanPixelData(data)

    expect(data[0]!).toBeGreaterThan(oceanR0)
    expect(data[2]!).toBeGreaterThan(data[0]!)
    expect(data[4]).toBe(basalt[0])
    expect(data[5]).toBe(basalt[1])
    expect(data[6]).toBe(basalt[2])
    expect(data[8]).toBe(land[0])
    expect(data[9]).toBe(land[1])
    expect(data[10]).toBe(land[2])
  })
})
