import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  collectHaloSources,
  computeHaloFieldFloat,
  groundKmAt,
  HALO_FIELD_SPEC,
  haloFieldCacheKey,
  haloReferenceAltitudeKm,
  haloVolumeBounds,
  halfBitsToFloat,
  packHalfField,
  toHalfBits,
  type HaloGroundGrid,
  type HaloProjector,
  type HaloRaster,
} from '../lightPollution/localHalo/haloFieldCore'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pub = path.join(root, 'public/light-pollution/reference/chamonix-viirs-2025')
const fix = path.join(root, 'src/__tests__/fixtures/chamonix-viirs-2025')

type Meta = {
  projector: HaloProjector
  dem: { size: number; extentKm: number }
  viirs: {
    geotransform: HaloRaster['geotransform']
    width: number
    height: number
    nodata: number
    sourceCount: number
  }
}

function bytes(file: string): ArrayBuffer {
  const b = readFileSync(file)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

const meta = JSON.parse(readFileSync(path.join(pub, 'meta.json'), 'utf8')) as Meta
const raster: HaloRaster = {
  values: new Float32Array(bytes(path.join(pub, 'viirs.f32'))),
  width: meta.viirs.width,
  height: meta.viirs.height,
  geotransform: meta.viirs.geotransform,
  nodata: meta.viirs.nodata,
}
const demU16 = new Uint16Array(bytes(path.join(pub, 'dem.u16')))
const ground: HaloGroundGrid = {
  heightsKm: Float32Array.from(demU16, (v) => v / 10000),
  size: meta.dem.size,
  extentKm: meta.dem.extentKm,
}
const refSources = JSON.parse(
  readFileSync(path.join(fix, 'sources.json'), 'utf8'),
) as Array<{ x: number; y: number; z: number; rad: number; area: number; row: number; col: number }>

describe('local halo — Chamonix reference sources', () => {
  const sources = collectHaloSources(raster, meta.projector, ground)

  it('keeps every positive native pixel of the 24 km zone (446)', () => {
    expect(sources.length).toBe(446)
    expect(meta.viirs.sourceCount).toBe(446)
  })

  it('matches the prototype position, altitude, radiance and area per pixel', () => {
    const byKey = new Map(sources.map((s) => [`${s.row}/${s.col}`, s]))
    for (const r of refSources) {
      const s = byKey.get(`${r.row}/${r.col}`)!
      expect(s).toBeDefined()
      expect(s.xKm).toBeCloseTo(r.x, 9)
      expect(s.zKm).toBeCloseTo(r.z, 9)
      expect(s.yKm).toBeCloseTo(r.y, 5)
      expect(s.radiance).toBeCloseTo(r.rad, 6)
      expect(s.areaKm2).toBeCloseTo(r.area, 9)
      expect(s.weight).toBeCloseTo((r.rad * r.area) / 10, 9)
    }
  })

  it('skips zero and NoData pixels', () => {
    expect(sources.every((s) => s.radiance > 0)).toBe(true)
    const values = raster.values.slice()
    const first = refSources[0]!
    values[first.row * raster.width + first.col] = raster.nodata
    const second = refSources[1]!
    values[second.row * raster.width + second.col] = 0
    const withHoles = collectHaloSources({ ...raster, values }, meta.projector, ground)
    expect(withHoles.length).toBe(444)
  })

  it('keeps the 1.03 km density reference and 0.3–8.3 km bounds at Chamonix', () => {
    expect(haloReferenceAltitudeKm(sources)).toBeCloseTo(1.03, 9)
    const b = haloVolumeBounds(ground)
    expect(b.yMinKm).toBeCloseTo(HALO_FIELD_SPEC.yMinKm, 9)
    expect(b.yMaxKm).toBeCloseTo(HALO_FIELD_SPEC.yMaxKm, 9)
  })

  it('samples ground like the prototype (source = ground + 20 m)', () => {
    for (const r of refSources.slice(0, 40)) {
      expect(groundKmAt(ground, r.x, r.z) + 0.02).toBeCloseTo(r.y, 5)
    }
  })
})

describe('local halo — field equals the prototype volume', () => {
  it(
    'reproduces R (screened) and G (unscreened) for all 96×48×96 voxels',
    () => {
      const sources = collectHaloSources(raster, meta.projector, ground)
      const field = computeHaloFieldFloat({
        sources,
        ground,
        bounds: haloVolumeBounds(ground),
      })
      const ours = packHalfField(field)
      const ref = new Uint16Array(bytes(path.join(fix, 'volume.f16')))
      expect(ours.length).toBe(ref.length)
      let worstRel = 0
      let worstAbs = 0
      for (let i = 0; i < ref.length; i++) {
        const a = halfBitsToFloat(ours[i]!)
        const b = halfBitsToFloat(ref[i]!)
        const abs = Math.abs(a - b)
        worstAbs = Math.max(worstAbs, abs)
        if (b > 1e-3) worstRel = Math.max(worstRel, abs / b)
      }
      // fp16 has 11 significant bits: one ulp ≈ 0.1 %.
      expect(worstRel).toBeLessThan(2e-3)
      expect(worstAbs).toBeLessThan(5e-3)
    },
    120_000,
  )
})

describe('local halo — helpers', () => {
  it('rounds float16 like numpy (nearest even)', () => {
    for (const v of [0, 1, 0.1, 6.875, 7.296875, 1e-5, 65504, 0.000061035]) {
      expect(Math.abs(halfBitsToFloat(toHalfBits(v)) - v)).toBeLessThanOrEqual(
        Math.max(Math.abs(v) * 1e-3, 6e-8),
      )
    }
    expect(toHalfBits(1)).toBe(0x3c00)
    expect(toHalfBits(-2)).toBe(0xc000)
  })

  it('invalidates the cache key when raster, relief or zone change', () => {
    const base = haloFieldCacheKey({ raster, ground, projector: meta.projector })
    const r2 = { ...raster, values: raster.values.slice() }
    r2.values[100] = r2.values[100]! + 1
    const g2 = { ...ground, heightsKm: ground.heightsKm.slice() }
    g2.heightsKm[5] = g2.heightsKm[5]! + 0.001
    expect(haloFieldCacheKey({ raster: r2, ground, projector: meta.projector })).not.toBe(base)
    expect(haloFieldCacheKey({ raster, ground: g2, projector: meta.projector })).not.toBe(base)
    expect(
      haloFieldCacheKey({
        raster,
        ground,
        projector: { kind: 'enu', lat0: 45.9237, lon0: 6.8694 },
      }),
    ).not.toBe(base)
    expect(haloFieldCacheKey({ raster, ground, projector: meta.projector })).toBe(base)
  })
})
