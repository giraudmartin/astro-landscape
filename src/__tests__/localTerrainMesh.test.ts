import { afterEach, describe, expect, it } from 'vitest'
import {
  clearParkedLocalTerrain,
  demZoomForDistance,
  enhanceOceanPixelData,
  FAR_TERRAIN_RADIUS_M,
  hasParkedLocalTerrainForTests,
  NEAR_TERRAIN_RADIUS_M,
  parkLocalTerrain,
  pruneTileCachesToWorkingSet,
  resetParkedLocalTerrainForTests,
  resetTerrainTileCachesForTests,
  seedTerrainTileCachesForTests,
  takeParkedLocalTerrain,
  terrainTileCacheKeysForTests,
  type LocalTerrainHandle,
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

describe('terrain tile working set', () => {
  afterEach(() => {
    resetTerrainTileCachesForTests()
  })

  it('evicts the previous spot and keeps only the new working set', () => {
    seedTerrainTileCachesForTests({
      dem: ['17/1/1', '17/2/2', '12/0/0'],
      esri: ['15/10/10', '14/3/3'],
    })

    pruneTileCachesToWorkingSet(['17/2/2', '12/0/0'], ['15/10/10'])

    expect(terrainTileCacheKeysForTests()).toEqual({
      dem: ['12/0/0', '17/2/2'],
      esri: ['15/10/10'],
      decoded: [],
    })
  })

  it('keeps overlapping keys when the new spot reuses the old footprint', () => {
    const shared = ['17/100/200', '14/50/50']
    seedTerrainTileCachesForTests({
      dem: [...shared, '17/999/999'],
      esri: [...shared, '13/1/1'],
    })

    pruneTileCachesToWorkingSet(shared, shared)

    expect(terrainTileCacheKeysForTests().dem).toEqual(shared.slice().sort())
    expect(terrainTileCacheKeysForTests().esri).toEqual(shared.slice().sort())
  })

  it('clears everything when the new working set is empty', () => {
    seedTerrainTileCachesForTests({
      dem: ['10/1/1'],
      esri: ['11/2/2'],
    })
    pruneTileCachesToWorkingSet([], [])
    expect(terrainTileCacheKeysForTests()).toEqual({
      dem: [],
      esri: [],
      decoded: [],
    })
  })
})

describe('parked local terrain', () => {
  afterEach(() => {
    resetParkedLocalTerrainForTests()
  })

  function stubHandle(ready: boolean): {
    handle: LocalTerrainHandle
    disposed: { value: boolean }
  } {
    const disposed = { value: false }
    const handle: LocalTerrainHandle = {
      mesh: {
        removeFromParent() {},
        traverse() {},
      } as unknown as LocalTerrainHandle['mesh'],
      farMesh: null,
      materials: [],
      adaptToEye: () => {},
      groundYAt: () => 0,
      groundElevationMslAt: () => 0,
      ready,
      stats: {
        minH: 0,
        maxH: 1,
        tiles: 1,
        demMaxZ: 17,
        farRadiusM: 0,
        phase: 'ready',
        progress: 1,
      },
      dispose: () => {
        disposed.value = true
      },
    }
    return { handle, disposed }
  }

  it('returns the parked handle for the same spot and forgets the slot', () => {
    const { handle } = stubHandle(true)
    parkLocalTerrain(45.1, 6.2, 1000, handle)
    expect(hasParkedLocalTerrainForTests()).toBe(true)
    const taken = takeParkedLocalTerrain(45.1, 6.2, 1000)
    expect(taken).toBe(handle)
    expect(hasParkedLocalTerrainForTests()).toBe(false)
  })

  it('does not return a parked handle for a different spot', () => {
    const { handle } = stubHandle(true)
    parkLocalTerrain(45.1, 6.2, 1000, handle)
    expect(takeParkedLocalTerrain(45.2, 6.2, 1000)).toBeNull()
    expect(hasParkedLocalTerrainForTests()).toBe(true)
    clearParkedLocalTerrain()
    expect(hasParkedLocalTerrainForTests()).toBe(false)
  })

  it('still hits park when only DEM height changed', () => {
    const { handle } = stubHandle(true)
    parkLocalTerrain(45.1, 6.2, 1000, handle)
    expect(takeParkedLocalTerrain(45.1, 6.2, 1125)).toBe(handle)
  })

  it('disposes incomplete (not ready) terrain instead of parking', () => {
    const { handle, disposed } = stubHandle(false)
    parkLocalTerrain(45.1, 6.2, 1000, handle)
    expect(hasParkedLocalTerrainForTests()).toBe(false)
    expect(disposed.value).toBe(true)
  })
})
