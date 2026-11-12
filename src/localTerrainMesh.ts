import * as THREE from 'three'
import {
  DEM_MAX_ZOOM,
  EARTH_RADIUS_M,
  IMAGERY_MAX_ZOOM,
} from './globeConstants'
import { TRIPOD_HEIGHT_M } from './presets'
import { attachStelProjector } from './stelProjector'

const MAPTERHORN = 'https://tiles.mapterhorn.com'
const ESRI =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'

const TILE_SIZE = 512
const VERTICAL_EXAGGERATION = 1.1

/** Parallel Esri/DEM fetches — MapLibre streams; we batch hard for first paint. */
const FETCH_CONCURRENCY = 28

/**
 * High-detail core. 6 km @ 4096 ˜ 3 m/px — summit FOV ridges stay readable.
 * (12 km @ 4096 was ~6 m/px and read as muddy when filling the frame.)
 */
export const NEAR_TERRAIN_RADIUS_M = 6_000
/**
 * Outermost background relief radius — high-mountain clear-air silhouettes.
 * Must stay inside the sky-dome / camera far plane, and inside the celestial
 * shell (CELESTIAL_SKY_DISTANCE_M) so the Milky Way stays behind all terrain.
 */
export const FAR_TERRAIN_RADIUS_M = 300_000
/**
 * Far LOD must start PAST the wide detail disc. Overlapping coarse far rings
 * with mid/wide detail caused a bright horizontal z-fight seam through ridges.
 */
const FAR_TERRAIN_INNER_M = 30_000
const DEM_MIN_FALLBACK_Z = 7

/**
 * Detail annuli (own DEM + ortho) — MUST NOT cover the near disc again.
 * Full stacked discs z-fought into glass shards on steep cliff pans.
 *   mid   ~5.4–14 km
 *   wide  ~12.6–32 km
 */
const WIDE_DETAIL_RADIUS_M = 32_000
const MID_DETAIL_RADIUS_M = 14_000
const MID_DETAIL_INNER_M = NEAR_TERRAIN_RADIUS_M * 0.9
const WIDE_DETAIL_INNER_M = MID_DETAIL_RADIUS_M * 0.9

/**
 * Progressive LOD annuli ? only beyond the wide detail disc.
 */
type TerrainLodRing = {
  name: string
  innerM: number
  outerM: number
  resolution: number
  /** Coarsest Esri zoom painted for this ring's atlas. */
  imageryZooms: number[]
  atlasSize?: number
}

const TERRAIN_LOD_RINGS: readonly TerrainLodRing[] = [
  {
    name: 'second',
    // Starts inside wide outer edge for overlap, stays coarser past 32 km.
    innerM: FAR_TERRAIN_INNER_M,
    outerM: 55_000,
    resolution: 480,
    imageryZooms: [12, 13],
    atlasSize: 2048,
  },
  {
    name: 'mid',
    innerM: 48_000,
    outerM: 95_000,
    resolution: 300,
    imageryZooms: [11, 12],
    atlasSize: 2048,
  },
  {
    name: 'far',
    innerM: 80_000,
    outerM: 180_000,
    resolution: 260,
    imageryZooms: [9, 10, 11],
    atlasSize: 2048,
  },
  {
    name: 'horizon',
    innerM: 150_000,
    outerM: FAR_TERRAIN_RADIUS_M,
    resolution: 240,
    imageryZooms: [8, 9],
    atlasSize: 1536,
  },
]

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function latLonToTile(lat: number, lon: number, z: number) {
  const n = 2 ** z
  const x = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const y =
    ((1 -
      Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
      2) *
    n
  return { x, y, n }
}

function enuToLatLon(
  eastM: number,
  northM: number,
  lat0: number,
  lon0: number,
): { lat: number; lon: number } {
  const lat = lat0 + northM / 111_320
  const lon = lon0 + eastM / (111_320 * Math.cos((lat0 * Math.PI) / 180))
  return { lat, lon }
}

type DemTile = {
  z: number
  x: number
  y: number
  data: Uint8ClampedArray
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  )
  return out
}

async function fetchDemBytes(
  z: number,
  x: number,
  y: number,
): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`${MAPTERHORN}/${z}/${x}/${y}.webp`)
    if (res.status === 404 || !res.ok) return null
    return res.arrayBuffer()
  } catch {
    return null
  }
}

const rawDemCache = new Map<string, Promise<ArrayBuffer | null>>()

function fetchDemBytesCached(z: number, x: number, y: number) {
  const key = `${z}/${x}/${y}`
  let p = rawDemCache.get(key)
  if (!p) {
    p = fetchDemBytes(z, x, y)
    rawDemCache.set(key, p)
  }
  return p
}

async function decodeTerrarium(bytes: ArrayBuffer): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }))
  const canvas = document.createElement('canvas')
  canvas.width = TILE_SIZE
  canvas.height = TILE_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    bitmap.close()
    throw new Error('no 2d')
  }
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data
}

/** Max zoom DEM with parent overzoom (same strategy as MapLibre protocol). */
async function resolveDemTile(
  z: number,
  x: number,
  y: number,
): Promise<DemTile | null> {
  const direct = await fetchDemBytesCached(z, x, y)
  if (direct) {
    return { z, x, y, data: await decodeTerrarium(direct) }
  }

  for (let parentZ = z - 1; parentZ >= 0; parentZ--) {
    const shift = z - parentZ
    const parentX = x >> shift
    const parentY = y >> shift
    const parentBytes = await fetchDemBytesCached(parentZ, parentX, parentY)
    if (!parentBytes) continue
    const parentBmp = await createImageBitmap(
      new Blob([parentBytes], { type: 'image/webp' }),
    )
    try {
      const span = 1 << shift
      const localX = x - (parentX << shift)
      const localY = y - (parentY << shift)
      const srcSize = TILE_SIZE / span
      const canvas = document.createElement('canvas')
      canvas.width = TILE_SIZE
      canvas.height = TILE_SIZE
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return null
      // Nearest overzoom — same as MapLibre mapterhornSafeDem (no soft seams).
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(
        parentBmp,
        localX * srcSize,
        localY * srcSize,
        srcSize,
        srcSize,
        0,
        0,
        TILE_SIZE,
        TILE_SIZE,
      )
      return {
        z,
        x,
        y,
        data: ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data,
      }
    } finally {
      parentBmp.close()
    }
  }
  return null
}

function sampleTerrarium(tile: DemTile, fx: number, fy: number): number {
  const x0 = clamp(Math.floor(fx), 0, TILE_SIZE - 2)
  const y0 = clamp(Math.floor(fy), 0, TILE_SIZE - 2)
  const tx = fx - x0
  const ty = fy - y0
  const elev = (ix: number, iy: number) => {
    const i = (iy * TILE_SIZE + ix) * 4
    return (
      tile.data[i]! * 256 + tile.data[i + 1]! + tile.data[i + 2]! / 256 - 32768
    )
  }
  return (
    elev(x0, y0) * (1 - tx) * (1 - ty) +
    elev(x0 + 1, y0) * tx * (1 - ty) +
    elev(x0, y0 + 1) * (1 - tx) * ty +
    elev(x0 + 1, y0 + 1) * tx * ty
  )
}

/** Distance ? DEM zoom: max near tripod, coarser far away. */
export function demZoomForDistance(distM: number): number {
  if (distM < 2_000) return DEM_MAX_ZOOM // 17
  if (distM < 4_500) return 16
  if (distM < 8_000) return 14
  if (distM < 16_000) return 13
  if (distM < 32_000) return 12
  if (distM < 70_000) return 11
  if (distM < 140_000) return 10
  if (distM < 220_000) return 8
  return 7
}

/** Drop of the sphere below the ENU tangent plane at distance d. */
function earthCurvatureDropM(distM: number): number {
  return (distM * distM) / (2 * EARTH_RADIUS_M)
}

function elevationFromCache(
  lat: number,
  lon: number,
  distM: number,
  cache: Map<string, DemTile | null>,
  fallback: number,
): number {
  const z = demZoomForDistance(distM)
  const { x, y } = latLonToTile(lat, lon, z)
  const tx = Math.floor(x)
  const ty = Math.floor(y)
  const tile = cache.get(`${z}/${tx}/${ty}`)
  if (!tile) {
    // Fall back through lower zooms already in cache.
    for (let zz = z - 1; zz >= DEM_MIN_FALLBACK_Z; zz--) {
      const t = latLonToTile(lat, lon, zz)
      const parent = cache.get(`${zz}/${Math.floor(t.x)}/${Math.floor(t.y)}`)
      if (parent) {
        return sampleTerrarium(
          parent,
          (t.x - Math.floor(t.x)) * TILE_SIZE,
          (t.y - Math.floor(t.y)) * TILE_SIZE,
        )
      }
    }
    return fallback
  }
  return sampleTerrarium(tile, (x - tx) * TILE_SIZE, (y - ty) * TILE_SIZE)
}

const ESRI_TILE_PX = 256
const ESRI_STUB_PROBE = 16_000
const ESRI_MIN_FALLBACK_Z = 7

const esriCache = new Map<string, Promise<ArrayBuffer | null>>()

async function fetchEsriBytes(
  z: number,
  x: number,
  y: number,
): Promise<ArrayBuffer | null> {
  const key = `${z}/${x}/${y}`
  const hit = esriCache.get(key)
  if (hit) return hit
  const pending = (async () => {
    try {
      const res = await fetch(`${ESRI}/${z}/${y}/${x}`)
      if (!res.ok) return null
      return res.arrayBuffer()
    } catch {
      return null
    }
  })()
  esriCache.set(key, pending)
  return pending
}

/** Esri gray "Map data not yet available" plates — same detector as MapLibre. */
async function isEsriStubTile(bytes: ArrayBuffer): Promise<boolean> {
  if (bytes.byteLength === 0) return true
  if (bytes.byteLength >= ESRI_STUB_PROBE) return false
  try {
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: 'image/jpeg' }),
    )
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      bitmap.close()
      return false
    }
    ctx.drawImage(bitmap, 0, 0, 8, 8)
    bitmap.close()
    const { data } = ctx.getImageData(0, 0, 8, 8)
    let sum = 0
    let sumSq = 0
    const n = data.length / 4
    for (let i = 0; i < data.length; i += 4) {
      const g = (data[i]! + data[i + 1]! + data[i + 2]!) / 3
      sum += g
      sumSq += g * g
    }
    const mean = sum / n
    const variance = sumSq / n - mean * mean
    return mean > 185 && mean < 245 && variance < 90
  } catch {
    return false
  }
}

async function resolveEsriBitmap(
  z: number,
  x: number,
  y: number,
): Promise<ImageBitmap | null> {
  const direct = await fetchEsriBytes(z, x, y)
  if (direct && !(await isEsriStubTile(direct))) {
    return createImageBitmap(new Blob([direct], { type: 'image/jpeg' }))
  }

  // Missing tile or gray stub: climb to a real parent and overzoom it.
  for (let parentZ = z - 1; parentZ >= ESRI_MIN_FALLBACK_Z; parentZ--) {
    const shift = z - parentZ
    const parentX = x >> shift
    const parentY = y >> shift
    const parentBytes = await fetchEsriBytes(parentZ, parentX, parentY)
    if (!parentBytes || (await isEsriStubTile(parentBytes))) continue
    const parent = await createImageBitmap(
      new Blob([parentBytes], { type: 'image/jpeg' }),
    )
    try {
      const span = 1 << shift
      const localX = x - (parentX << shift)
      const localY = y - (parentY << shift)
      const srcSize = ESRI_TILE_PX / span
      const canvas = document.createElement('canvas')
      canvas.width = ESRI_TILE_PX
      canvas.height = ESRI_TILE_PX
      const ctx = ortho2d(canvas)
      if (!ctx) return null
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(
        parent,
        localX * srcSize,
        localY * srcSize,
        srcSize,
        srcSize,
        0,
        0,
        ESRI_TILE_PX,
        ESRI_TILE_PX,
      )
      return createImageBitmap(canvas)
    } finally {
      parent.close()
    }
  }
  return null
}

async function paintImageryLayer(
  ctx: CanvasRenderingContext2D,
  size: number,
  lat0: number,
  lon0: number,
  radiusM: number,
  zoom: number,
  clipRadiusM: number,
): Promise<number> {
  const corners = [
    enuToLatLon(-clipRadiusM, -clipRadiusM, lat0, lon0),
    enuToLatLon(clipRadiusM, clipRadiusM, lat0, lon0),
  ]
  const t0 = latLonToTile(corners[0]!.lat, corners[0]!.lon, zoom)
  const t1 = latLonToTile(corners[1]!.lat, corners[1]!.lon, zoom)
  const minX = Math.floor(Math.min(t0.x, t1.x))
  const maxX = Math.floor(Math.max(t0.x, t1.x))
  const minY = Math.floor(Math.min(t0.y, t1.y))
  const maxY = Math.floor(Math.max(t0.y, t1.y))

  let painted = 0
  const jobs: { tx: number; ty: number }[] = []
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      jobs.push({ tx, ty })
    }
  }

  await mapPool(jobs, FETCH_CONCURRENCY, async ({ tx, ty }) => {
    try {
      const bmp = await resolveEsriBitmap(zoom, tx, ty)
      if (!bmp) return
      const n = 2 ** zoom
      const lonW = (tx / n) * 360 - 180
      const lonE = ((tx + 1) / n) * 360 - 180
      const latN =
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI
      const latS =
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + 1)) / n))) * 180) /
        Math.PI
      const cosLat = Math.cos((lat0 * Math.PI) / 180)
      const eastW = (lonW - lon0) * 111_320 * cosLat
      const eastE = (lonE - lon0) * 111_320 * cosLat
      const northN = (latN - lat0) * 111_320
      const northS = (latS - lat0) * 111_320
      const x0 = ((eastW + radiusM) / (radiusM * 2)) * size
      const x1 = ((eastE + radiusM) / (radiusM * 2)) * size
      const y0 = ((radiusM - northN) / (radiusM * 2)) * size
      const y1 = ((radiusM - northS) / (radiusM * 2)) * size
      ctx.drawImage(bmp, x0, y0, x1 - x0, y1 - y0)
      bmp.close()
      painted++
    } catch {
      // skip
    }
  })
  return painted
}

/** Imagery atlases call getImageData (ocean / exposure) — avoid GPU sync stalls. */
function ortho2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext('2d', { willReadFrequently: true })
}

function canvasToTerrainTexture(
  canvas: HTMLCanvasElement,
  opts: {
    anisotropy: number
    mipmaps: boolean
    clamp?: boolean
  },
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  // Mesh / atlas UVs put north at v=0 (canvas top). Default flipY mirrors N/S.
  tex.flipY = false
  tex.anisotropy = opts.anisotropy
  if (opts.clamp) {
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
  }
  if (opts.mipmaps) {
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = true
  } else {
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
  }
  tex.needsUpdate = true
  return tex
}

/** Fast first-paint atlas — coarse Esri only, then upgraded in place. */
async function buildPreviewImageryTexture(
  lat0: number,
  lon0: number,
  radiusM: number,
): Promise<THREE.CanvasTexture | null> {
  try {
    const size = 1024
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = ortho2d(canvas)
    if (!ctx) return null
    ctx.fillStyle = '#6b5a42'
    ctx.fillRect(0, 0, size, size)
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 11, radiusM)
    enhanceOceanPixels(ctx, size)
    return canvasToTerrainTexture(canvas, { anisotropy: 4, mipmaps: true })
  } catch {
    return null
  }
}

/**
 * Near-disc base atlas for the compact 8 km core (~4 m/px @ 4096).
 * Higher zooms still feed nested feet overlays / detail discs.
 */
async function buildImageryTexture(
  lat0: number,
  lon0: number,
  radiusM: number,
): Promise<THREE.CanvasTexture | null> {
  try {
    // Prefer 4096 for =16 km cores (~3–8 m/px). Fall back to 2048 if alloc fails.
    let size = radiusM <= 16_000 ? 4096 : 2048
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    let ctx = ortho2d(canvas)
    if (!ctx || canvas.width !== size) {
      size = 2048
      canvas.width = size
      canvas.height = size
      ctx = ortho2d(canvas)
    }
    if (!ctx) return null

    ctx.fillStyle = '#6b5a42'
    ctx.fillRect(0, 0, size, size)

    // Coarse base first so empty atlas never stays solid fill brown.
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 12, radiusM)
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 13, radiusM)
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 14, radiusM)
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 15, radiusM)
    await paintImageryLayer(
      ctx,
      size,
      lat0,
      lon0,
      radiusM,
      16,
      Math.min(radiusM, 4_000),
    )
    await paintImageryLayer(
      ctx,
      size,
      lat0,
      lon0,
      radiusM,
      17,
      Math.min(radiusM, 2_000),
    )
    enhanceOceanPixels(ctx, size)
    liftImageryExposure(ctx, size, 0.12)
    // No mips on the core atlas — cliff UVs were picking blurry levels.
    // (DEM hillshade bake on 4096² killed the WebGL context — do NOT restore.)
    return canvasToTerrainTexture(canvas, { anisotropy: 16, mipmaps: false })
  } catch {
    return null
  }
}

/** Mid-ground nested atlas (14 km) — summit second-plan ridges ~7 m/px. */
async function buildMidDetailImageryTexture(
  lat0: number,
  lon0: number,
): Promise<THREE.CanvasTexture | null> {
  try {
    const radiusM = MID_DETAIL_RADIUS_M
    // Prefer 4096 (~7 m/px); fall back to 2048 if allocation fails.
    let size = 4096
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    let ctx = ortho2d(canvas)
    if (!ctx || canvas.width !== size) {
      size = 2048
      canvas.width = size
      canvas.height = size
      ctx = ortho2d(canvas)
    }
    if (!ctx) return null
    ctx.fillStyle = '#6b5a42'
    ctx.fillRect(0, 0, size, size)
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 12, radiusM)
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 13, radiusM)
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 14, radiusM)
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 15, radiusM)
    await paintImageryLayer(
      ctx,
      size,
      lat0,
      lon0,
      radiusM,
      16,
      Math.min(radiusM, 6_000),
    )
    await paintImageryLayer(
      ctx,
      size,
      lat0,
      lon0,
      radiusM,
      17,
      Math.min(radiusM, 3_000),
    )
    enhanceOceanPixels(ctx, size)
    return canvasToTerrainTexture(canvas, {
      anisotropy: 16,
      mipmaps: true,
      clamp: true,
    })
  } catch {
    return null
  }
}

/** Wide nested atlas (32 km) — island context at ~16 m/px. */
async function buildWideDetailImageryTexture(
  lat0: number,
  lon0: number,
): Promise<THREE.CanvasTexture | null> {
  try {
    const radiusM = WIDE_DETAIL_RADIUS_M
    let size = 4096
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    let ctx = ortho2d(canvas)
    if (!ctx || canvas.width !== size) {
      size = 2048
      canvas.width = size
      canvas.height = size
      ctx = ortho2d(canvas)
    }
    if (!ctx) return null
    ctx.fillStyle = '#6b5a42'
    ctx.fillRect(0, 0, size, size)
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 11, radiusM)
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 12, radiusM)
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 13, radiusM)
    await paintImageryLayer(
      ctx,
      size,
      lat0,
      lon0,
      radiusM,
      14,
      Math.min(radiusM, 14_000),
    )
    enhanceOceanPixels(ctx, size)
    liftImageryExposure(ctx, size, 0.14)
    return canvasToTerrainTexture(canvas, {
      anisotropy: 12,
      mipmaps: true,
      clamp: true,
    })
  } catch {
    return null
  }
}

/**
 * Foreground atlases mixed onto the near mesh. Must reach the ridges that fill
 * a 16 mm Mirador FOV (~1–3 km), not just the 110–480 m feet discs.
 */
const NEAR_RADIUS_M = 3_200
const ULTRA_NEAR_RADIUS_M = 1_100

async function buildForegroundImageryTexture(
  lat0: number,
  lon0: number,
  radiusM: number,
): Promise<THREE.CanvasTexture | null> {
  try {
    let size = radiusM <= 1_500 ? 4096 : 4096
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    let ctx = ortho2d(canvas)
    if (!ctx || canvas.width !== size) {
      size = 2048
      canvas.width = size
      canvas.height = size
      ctx = ortho2d(canvas)
    }
    if (!ctx) return null
    ctx.fillStyle = '#6b5a42'
    ctx.fillRect(0, 0, size, size)
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 13, radiusM)
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 15, radiusM)
    await paintImageryLayer(ctx, size, lat0, lon0, radiusM, 16, radiusM)
    await paintImageryLayer(
      ctx,
      size,
      lat0,
      lon0,
      radiusM,
      IMAGERY_MAX_ZOOM,
      radiusM,
    )
    // No mipmaps — grazing cliff UVs were sampling blurry mips.
    return canvasToTerrainTexture(canvas, {
      anisotropy: 16,
      mipmaps: false,
      clamp: true,
    })
  } catch {
    return null
  }
}

function buildNearImageryTexture(lat0: number, lon0: number) {
  return buildForegroundImageryTexture(lat0, lon0, NEAR_RADIUS_M)
}

function buildUltraNearImageryTexture(lat0: number, lon0: number) {
  return buildForegroundImageryTexture(lat0, lon0, ULTRA_NEAR_RADIUS_M)
}

async function buildRingImageryTexture(
  lat0: number,
  lon0: number,
  radiusM: number,
  zooms: number[],
  atlasSize?: number,
): Promise<THREE.CanvasTexture | null> {
  try {
    const size = atlasSize ?? (radiusM > 150_000 ? 1536 : 2048)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = ortho2d(canvas)
    if (!ctx) return null
    ctx.fillStyle = '#5a6a4a'
    ctx.fillRect(0, 0, size, size)
    const sorted = [...zooms].sort((a, b) => a - b)
    for (const z of sorted) {
      await paintImageryLayer(ctx, size, lat0, lon0, radiusM, z, radiusM)
    }
    // Real Esri pixels — shadow lift so mid/far LOD matches near readability.
    enhanceOceanPixels(ctx, size)
    // Keep far rings readable without blowing a white horizon band.
    liftImageryExposure(ctx, size, radiusM > 80_000 ? 0.18 : 0.14)
    return canvasToTerrainTexture(canvas, { anisotropy: 8, mipmaps: true })
  } catch {
    return null
  }
}

// Fine phases reduce stereographic pan tears without offscreen parking.
const EDGE_PHASES_DEG = [20, 10, 5, 2.5, 1.25, 0.6, 0.35]
const MAX_TERRAIN_EXTRA_VERTS = 750_000

function edgeCos(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const la = Math.hypot(ax, ay, az)
  const lb = Math.hypot(bx, by, bz)
  if (la < 1e-8 || lb < 1e-8) return 1
  return Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (la * lb)))
}

/**
 * Split edges that cover too much angle from the tripod, and steep
 * treads that read as stairs. The new point bisects the angle — a
 * geometric midpoint leaves the near half just as wide.
 */
function refineTerrainEdges(
  srcPos: Float32Array,
  srcUv: Float32Array,
  srcIdx: number[],
  sampleY: (east: number, north: number) => number,
): { positions: Float32Array; uvs: Float32Array; indices: number[] } {
  const pos = Array.from(srcPos)
  const uv = Array.from(srcUv)
  let indices = srcIdx
  const vertCap = srcPos.length / 3 + MAX_TERRAIN_EXTRA_VERTS
  let cosLimit = Math.cos((EDGE_PHASES_DEG[0]! * Math.PI) / 180)
  let phaseDeg = EDGE_PHASES_DEG[0]!

  const rel = (i: number) =>
    [
      pos[i * 3]!,
      pos[i * 3 + 1]! - TRIPOD_HEIGHT_M,
      pos[i * 3 + 2]!,
    ] as const

  const wide = (i: number, j: number): boolean => {
    const [ax, ay, az] = rel(i)
    const [bx, by, bz] = rel(j)
    const horiz = Math.hypot(bx - ax, bz - az)
    if (horiz < 1.4) return false
    if (edgeCos(ax, ay, az, bx, by, bz) < cosLimit) return true
    if (phaseDeg > 1.25) return false
    const dy = Math.abs(pos[i * 3 + 1]! - pos[j * 3 + 1]!)
    return dy > 4 && horiz > 9
  }

  const bisectT = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): number => {
    let lo = 0.04
    let hi = 0.96
    for (let step = 0; step < 8; step += 1) {
      const t = (lo + hi) * 0.5
      const mx = ax + (bx - ax) * t
      const my = ay + (by - ay) * t
      const mz = az + (bz - az) * t
      const ca = edgeCos(ax, ay, az, mx, my, mz)
      const cb = edgeCos(mx, my, mz, bx, by, bz)
      if (ca < cb) hi = t
      else lo = t
    }
    return (lo + hi) * 0.5
  }

  for (const nextPhase of EDGE_PHASES_DEG) {
    if (pos.length / 3 >= vertCap) break
    phaseDeg = nextPhase
    cosLimit = Math.cos((phaseDeg * Math.PI) / 180)
    for (let pass = 0; pass < 6; pass += 1) {
      if (pos.length / 3 >= vertCap) break
      const mid = new Map<string, number>()
      const midpoint = (i: number, j: number): number => {
        const key = i < j ? `${i},${j}` : `${j},${i}`
        const found = mid.get(key)
        if (found != null) return found
        const [ax, ay, az] = rel(i)
        const [bx, by, bz] = rel(j)
        const t = bisectT(ax, ay, az, bx, by, bz)
        const east = ax + (bx - ax) * t
        const z = az + (bz - az) * t
        const north = -z
        const y0 = pos[i * 3 + 1]!
        const y1 = pos[j * 3 + 1]!
        const yLin = y0 + (y1 - y0) * t
        const yDem = sampleY(east, north)
        const parent = Math.acos(edgeCos(ax, ay, az, bx, by, bz))
        let y = yLin
        let lo = 0
        let hi = 1
        for (let step = 0; step < 6; step += 1) {
          const k = (lo + hi) * 0.5
          const yt = yLin + (yDem - yLin) * k
          const my = yt - TRIPOD_HEIGHT_M
          const ca = Math.acos(edgeCos(ax, ay, az, east, my, z))
          const cb = Math.acos(edgeCos(bx, by, bz, east, my, z))
          if (ca < parent * 0.72 && cb < parent * 0.72) {
            y = yt
            lo = k
          } else {
            hi = k
          }
        }
        const n = pos.length / 3
        pos.push(east, y, z)
        uv.push(
          uv[i * 2]! + (uv[j * 2]! - uv[i * 2]!) * t,
          uv[i * 2 + 1]! + (uv[j * 2 + 1]! - uv[i * 2 + 1]!) * t,
        )
        mid.set(key, n)
        return n
      }
      const next: number[] = []
      let grew = false
      for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t]!
        const b = indices[t + 1]!
        const c = indices[t + 2]!
        const room = pos.length / 3 < vertCap
        const ab = room && wide(a, b) ? midpoint(a, b) : -1
        const bc = room && wide(b, c) ? midpoint(b, c) : -1
        const ca = room && wide(c, a) ? midpoint(c, a) : -1
        const mask = (ab >= 0 ? 1 : 0) | (bc >= 0 ? 2 : 0) | (ca >= 0 ? 4 : 0)
        if (mask === 0) {
          next.push(a, b, c)
          continue
        }
        grew = true
        if (mask === 7) next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca)
        else if (mask === 1) next.push(a, ab, c, ab, b, c)
        else if (mask === 2) next.push(a, b, bc, a, bc, c)
        else if (mask === 4) next.push(a, b, ca, ca, b, c)
        else if (mask === 3) next.push(a, ab, c, ab, b, bc, ab, bc, c)
        else if (mask === 5) next.push(a, ab, ca, ab, b, c, ab, c, ca)
        else next.push(a, b, bc, a, bc, ca, bc, c, ca)
      }
      indices = next
      if (!grew) break
    }
  }

  return {
    positions: Float32Array.from(pos),
    uvs: Float32Array.from(uv),
    indices,
  }
}

const ADAPT_EXTRA_VERTS = 220_000
// Pitch-down puts mid-cliff cells on-screen — reach past the old 280 m bubble.
const ADAPT_REACH_M = 520
const ADAPT_COS = Math.cos((1.25 * Math.PI) / 180)
const ADAPT_CELL_M = 64

/**
 * Keep splitting edges that become wide once the camera leaves the spot.
 * The static mesh is refined around the origin only.
 */
function createAdaptiveRefine(
  geometry: THREE.BufferGeometry,
  radiusM: number,
  sampleY: (east: number, north: number) => number,
): (ex: number, ey: number, ez: number) => void {
  const tightPos = geometry.getAttribute('position').array as Float32Array
  const tightUv = geometry.getAttribute('uv').array as Float32Array
  const tightNor = geometry.getAttribute('normal').array as Float32Array
  const tightIndex = geometry.getIndex()
  if (!tightIndex) return () => {}
  const srcIndex = tightIndex.array

  const baseVerts = tightPos.length / 3
  const maxVerts = baseVerts + ADAPT_EXTRA_VERTS
  const baseTris = srcIndex.length / 3
  const maxTris = baseTris + ADAPT_EXTRA_VERTS * 6

  const posBuf = new Float32Array(maxVerts * 3)
  const uvBuf = new Float32Array(maxVerts * 2)
  const norBuf = new Float32Array(maxVerts * 3)
  posBuf.set(tightPos)
  uvBuf.set(tightUv)
  norBuf.set(tightNor)
  let vertCount = baseVerts

  const indexBuf = new Uint32Array(maxTris * 3)
  for (let i = 0; i < srcIndex.length; i += 1) indexBuf[i] = srcIndex[i]!
  const alive = new Uint8Array(maxTris)
  alive.fill(1, 0, baseTris)
  let triCount = baseTris

  const posAttr = new THREE.BufferAttribute(posBuf, 3)
  const uvAttr = new THREE.BufferAttribute(uvBuf, 2)
  const norAttr = new THREE.BufferAttribute(norBuf, 3)
  const indexAttr = new THREE.BufferAttribute(indexBuf, 1)
  posAttr.setUsage(THREE.DynamicDrawUsage)
  uvAttr.setUsage(THREE.DynamicDrawUsage)
  norAttr.setUsage(THREE.DynamicDrawUsage)
  indexAttr.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', posAttr)
  geometry.setAttribute('uv', uvAttr)
  geometry.setAttribute('normal', norAttr)
  geometry.setIndex(indexAttr)
  geometry.setDrawRange(0, triCount * 3)

  const gridN = Math.ceil((radiusM * 2) / ADAPT_CELL_M) + 1
  const gridOrigin = -radiusM
  const buckets: number[][] = new Array(gridN * gridN)
  for (let i = 0; i < buckets.length; i += 1) buckets[i] = []
  const cenX = new Float32Array(maxTris)
  const cenZ = new Float32Array(maxTris)
  const maxEdge = new Float32Array(maxTris)

  const clampCell = (v: number) => (v < 0 ? 0 : v >= gridN ? gridN - 1 : v)

  const measure = (id: number) => {
    const o = id * 3
    const ia = indexBuf[o]! * 3
    const ib = indexBuf[o + 1]! * 3
    const ic = indexBuf[o + 2]! * 3
    const ax = posBuf[ia]!
    const ay = posBuf[ia + 1]!
    const az = posBuf[ia + 2]!
    const bx = posBuf[ib]!
    const by = posBuf[ib + 1]!
    const bz = posBuf[ib + 2]!
    const cx = posBuf[ic]!
    const cy = posBuf[ic + 1]!
    const cz = posBuf[ic + 2]!
    cenX[id] = (ax + bx + cx) / 3
    cenZ[id] = (az + bz + cz) / 3
    const ab =
      (bx - ax) * (bx - ax) + (by - ay) * (by - ay) + (bz - az) * (bz - az)
    const bc =
      (cx - bx) * (cx - bx) + (cy - by) * (cy - by) + (cz - bz) * (cz - bz)
    const ca =
      (ax - cx) * (ax - cx) + (ay - cy) * (ay - cy) + (az - cz) * (az - cz)
    maxEdge[id] = Math.sqrt(Math.max(ab, bc, ca))
    const minX = Math.min(ax, bx, cx)
    const maxX = Math.max(ax, bx, cx)
    const minZ = Math.min(az, bz, cz)
    const maxZ = Math.max(az, bz, cz)
    let i0 = clampCell(Math.floor((minX - gridOrigin) / ADAPT_CELL_M))
    let i1 = clampCell(Math.floor((maxX - gridOrigin) / ADAPT_CELL_M))
    let j0 = clampCell(Math.floor((minZ - gridOrigin) / ADAPT_CELL_M))
    let j1 = clampCell(Math.floor((maxZ - gridOrigin) / ADAPT_CELL_M))
    if (i1 - i0 > 5) {
      const mid = (i0 + i1) >> 1
      i0 = Math.max(0, mid - 2)
      i1 = Math.min(gridN - 1, mid + 2)
    }
    if (j1 - j0 > 5) {
      const mid = (j0 + j1) >> 1
      j0 = Math.max(0, mid - 2)
      j1 = Math.min(gridN - 1, mid + 2)
    }
    for (let j = j0; j <= j1; j += 1) {
      const row = j * gridN
      for (let i = i0; i <= i1; i += 1) buckets[row + i]!.push(id)
    }
  }

  for (let id = 0; id < baseTris; id += 1) measure(id)

  const rel = (i: number, ex: number, ey: number, ez: number) =>
    [posBuf[i * 3]! - ex, posBuf[i * 3 + 1]! - ey, posBuf[i * 3 + 2]! - ez] as const

  const edgeLen2 = (i: number, j: number) => {
    const dx = posBuf[i * 3]! - posBuf[j * 3]!
    const dy = posBuf[i * 3 + 1]! - posBuf[j * 3 + 1]!
    const dz = posBuf[i * 3 + 2]! - posBuf[j * 3 + 2]!
    return dx * dx + dy * dy + dz * dz
  }

  const segNear = (
    i: number,
    j: number,
    ex: number,
    ey: number,
    ez: number,
    reach2: number,
  ) => {
    const [ax, ay, az] = rel(i, ex, ey, ez)
    const [bx, by, bz] = rel(j, ex, ey, ez)
    const abx = bx - ax
    const aby = by - ay
    const abz = bz - az
    const ab2 = abx * abx + aby * aby + abz * abz
    let t = ab2 < 1e-8 ? 0 : -(ax * abx + ay * aby + az * abz) / ab2
    if (t < 0) t = 0
    else if (t > 1) t = 1
    const dx = ax + abx * t
    const dy = ay + aby * t
    const dz = az + abz * t
    return dx * dx + dy * dy + dz * dz <= reach2
  }

  const bisectT = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ) => {
    const abx = bx - ax
    const aby = by - ay
    const abz = bz - az
    const ab2 = abx * abx + aby * aby + abz * abz
    let closest = 0.5
    if (ab2 > 1e-8) {
      closest = -(ax * abx + ay * aby + az * abz) / ab2
      const dx = ax + abx * closest
      const dy = ay + aby * closest
      const dz = az + abz * closest
      if (dx * dx + dy * dy + dz * dz < 4) {
        return Math.min(0.92, Math.max(0.08, closest))
      }
    }
    let lo = 0.04
    let hi = 0.96
    for (let step = 0; step < 8; step += 1) {
      const t = (lo + hi) * 0.5
      const mx = ax + (bx - ax) * t
      const my = ay + (by - ay) * t
      const mz = az + (bz - az) * t
      const ca = edgeCos(ax, ay, az, mx, my, mz)
      const cb = edgeCos(mx, my, mz, bx, by, bz)
      if (ca < cb) hi = t
      else lo = t
    }
    return (lo + hi) * 0.5
  }

  let pending = true
  let lastX = Number.NaN
  let lastY = Number.NaN
  let lastZ = Number.NaN
  let uploadedVerts = baseVerts
  let uploadedTris = baseTris
  const seen = new Uint32Array(maxTris)
  let adaptStamp = 1
  let scanGen = 1
  let cellCursor = 0
  let bucketCursor = 0
  const cellIds: number[] = []
  const candIds: number[] = []
  const candCos: number[] = []

  return (ex, ey, ez) => {
    const moved =
      !Number.isFinite(lastX) ||
      (ex - lastX) * (ex - lastX) + (ez - lastZ) * (ez - lastZ) > 0.16 ||
      Math.abs(ey - lastY) > 0.35
    if (!pending && !moved) return
    if (moved) {
      lastX = ex
      lastY = ey
      lastZ = ez
      pending = true
    }
    if (vertCount >= maxVerts - 16 || triCount >= maxTris - 16) {
      pending = false
      return
    }

    const reach2 = ADAPT_REACH_M * ADAPT_REACH_M
    if (moved) {
      scanGen = (adaptStamp += 1)
      if (scanGen === 0xffffffff) {
        seen.fill(0)
        scanGen = adaptStamp = 1
      }
      cellIds.length = 0
      candIds.length = 0
      candCos.length = 0
      cellCursor = 0
      bucketCursor = 0
      const i0 = clampCell(
        Math.floor((ex - ADAPT_REACH_M - gridOrigin) / ADAPT_CELL_M),
      )
      const i1 = clampCell(
        Math.floor((ex + ADAPT_REACH_M - gridOrigin) / ADAPT_CELL_M),
      )
      const j0 = clampCell(
        Math.floor((ez - ADAPT_REACH_M - gridOrigin) / ADAPT_CELL_M),
      )
      const j1 = clampCell(
        Math.floor((ez + ADAPT_REACH_M - gridOrigin) / ADAPT_CELL_M),
      )
      for (let j = j0; j <= j1; j += 1) {
        const row = j * gridN
        for (let i = i0; i <= i1; i += 1) cellIds.push(row + i)
      }
    }

    const tScan = performance.now()
    while (cellCursor < cellIds.length && performance.now() - tScan < 6) {
      const bucket = buckets[cellIds[cellCursor]!]!
      const limit = bucket.length
      let n = bucketCursor
      for (; n < limit; n += 1) {
        if ((n & 2047) === 0 && performance.now() - tScan > 6) break
        const id = bucket[n]!
        if (alive[id] === 0 || seen[id] === scanGen) continue
        seen[id] = scanGen
        const dx = cenX[id]! - ex
        const dz = cenZ[id]! - ez
        const d2 = dx * dx + dz * dz
        const edge = maxEdge[id]!
        const reachEdge = ADAPT_REACH_M + edge
        if (d2 > reachEdge * reachEdge) continue
        if (edge * edge < d2 * 0.0036 + 0.2) continue
        const o = id * 3
        const a = indexBuf[o]!
        const b = indexBuf[o + 1]!
        const c = indexBuf[o + 2]!
        let worst = 1
        const consider = (p: number, q: number) => {
          if (edgeLen2(p, q) < 0.42) return
          if (!segNear(p, q, ex, ey, ez, reach2)) return
          const [ax, ay, az] = rel(p, ex, ey, ez)
          const [bx, by, bz] = rel(q, ex, ey, ez)
          const cos = edgeCos(ax, ay, az, bx, by, bz)
          if (cos < worst) worst = cos
        }
        consider(a, b)
        consider(b, c)
        consider(c, a)
        if (worst < ADAPT_COS) {
          candIds.push(id)
          candCos.push(worst)
        }
      }
      if (n >= limit) {
        cellCursor += 1
        bucketCursor = 0
      } else {
        bucketCursor = n
        break
      }
    }

    if (candIds.length === 0) {
      pending = cellCursor < cellIds.length
      return
    }

    const order = candIds.map((_, index) => index)
    order.sort((p, q) => candCos[p]! - candCos[q]!)
    const budget = Math.min(2200, maxVerts - vertCount, maxTris - triCount)
    const mid = new Map<string, number>()
    const dirty: number[] = []
    const failed = new Set<number>()
    let added = 0

    const midpoint = (i: number, j: number): number => {
      const key = i < j ? `${i},${j}` : `${j},${i}`
      const found = mid.get(key)
      if (found != null) return found
      const [ax, ay, az] = rel(i, ex, ey, ez)
      const [bx, by, bz] = rel(j, ex, ey, ez)
      const t = bisectT(ax, ay, az, bx, by, bz)
      const east = posBuf[i * 3]! + (posBuf[j * 3]! - posBuf[i * 3]!) * t
      const z = posBuf[i * 3 + 2]! + (posBuf[j * 3 + 2]! - posBuf[i * 3 + 2]!) * t
      const y0 = posBuf[i * 3 + 1]!
      const y1 = posBuf[j * 3 + 1]!
      const yLin = y0 + (y1 - y0) * t
      const yDem = sampleY(east, -z)
      const parent = Math.acos(edgeCos(ax, ay, az, bx, by, bz))
      let y = yLin
      let lo = 0
      let hi = 1
      for (let step = 0; step < 6; step += 1) {
        const k = (lo + hi) * 0.5
        const yt = yLin + (yDem - yLin) * k
        const my = yt - ey
        const ca = Math.acos(Math.min(1, edgeCos(ax, ay, az, east - ex, my, z - ez)))
        const cb = Math.acos(Math.min(1, edgeCos(bx, by, bz, east - ex, my, z - ez)))
        if (ca < parent * 0.72 && cb < parent * 0.72) {
          y = yt
          lo = k
        } else hi = k
      }
      const n = vertCount
      vertCount += 1
      posBuf[n * 3] = east
      posBuf[n * 3 + 1] = y
      posBuf[n * 3 + 2] = z
      uvBuf[n * 2] = uvBuf[i * 2]! + (uvBuf[j * 2]! - uvBuf[i * 2]!) * t
      uvBuf[n * 2 + 1] =
        uvBuf[i * 2 + 1]! + (uvBuf[j * 2 + 1]! - uvBuf[i * 2 + 1]!) * t
      norBuf[n * 3] = (norBuf[i * 3]! + norBuf[j * 3]!) * 0.5
      norBuf[n * 3 + 1] = (norBuf[i * 3 + 1]! + norBuf[j * 3 + 1]!) * 0.5
      norBuf[n * 3 + 2] = (norBuf[i * 3 + 2]! + norBuf[j * 3 + 2]!) * 0.5
      mid.set(key, n)
      added += 1
      return n
    }

    const emit = (a: number, b: number, c: number) => {
      if (triCount >= maxTris) return
      const id = triCount
      triCount += 1
      const o = id * 3
      indexBuf[o] = a
      indexBuf[o + 1] = b
      indexBuf[o + 2] = c
      alive[id] = 1
      measure(id)
    }

    const kill = (id: number) => {
      alive[id] = 0
      const o = id * 3
      indexBuf[o + 1] = indexBuf[o]!
      indexBuf[o + 2] = indexBuf[o]!
      dirty.push(o)
    }

    for (let k = 0; k < order.length && added < budget; k += 1) {
      const id = candIds[order[k]!]!
      if (alive[id] === 0) continue
      const o = id * 3
      const a = indexBuf[o]!
      const b = indexBuf[o + 1]!
      const c = indexBuf[o + 2]!
      const room = vertCount < maxVerts - 4 && triCount < maxTris - 6
      const wide = (p: number, q: number) => {
        if (!room || edgeLen2(p, q) < 0.42) return false
        if (!segNear(p, q, ex, ey, ez, reach2)) return false
        const [ax, ay, az] = rel(p, ex, ey, ez)
        const [bx, by, bz] = rel(q, ex, ey, ez)
        return edgeCos(ax, ay, az, bx, by, bz) < ADAPT_COS
      }
      const ab = wide(a, b) ? midpoint(a, b) : -1
      const bc = wide(b, c) ? midpoint(b, c) : -1
      const ca = wide(c, a) ? midpoint(c, a) : -1
      const mask = (ab >= 0 ? 1 : 0) | (bc >= 0 ? 2 : 0) | (ca >= 0 ? 4 : 0)
      if (mask === 0) {
        failed.add(id)
        continue
      }
      if (mask === 7) {
        emit(a, ab, ca)
        emit(b, bc, ab)
        emit(c, ca, bc)
        emit(ab, bc, ca)
      } else if (mask === 1) {
        emit(a, ab, c)
        emit(ab, b, c)
      } else if (mask === 2) {
        emit(a, b, bc)
        emit(a, bc, c)
      } else if (mask === 4) {
        emit(a, b, ca)
        emit(ca, b, c)
      } else if (mask === 3) {
        emit(a, ab, c)
        emit(ab, b, bc)
        emit(ab, bc, c)
      } else if (mask === 5) {
        emit(a, ab, ca)
        emit(ab, b, c)
        emit(ab, c, ca)
      } else {
        emit(a, b, bc)
        emit(a, bc, ca)
        emit(bc, c, ca)
      }
      kill(id)
    }

    let write = 0
    for (let k = 0; k < candIds.length; k += 1) {
      const id = candIds[k]!
      if (alive[id] === 0 || failed.has(id)) continue
      candIds[write] = id
      candCos[write] = candCos[k]!
      write += 1
    }
    candIds.length = write
    candCos.length = write

    if (added > 0 && cellCursor >= cellIds.length && candIds.length === 0) {
      cellCursor = 0
      bucketCursor = 0
    }

    if (added > 0) {
      posAttr.addUpdateRange(uploadedVerts * 3, (vertCount - uploadedVerts) * 3)
      uvAttr.addUpdateRange(uploadedVerts * 2, (vertCount - uploadedVerts) * 2)
      norAttr.addUpdateRange(uploadedVerts * 3, (vertCount - uploadedVerts) * 3)
      for (let d = 0; d < dirty.length; d += 1) {
        indexAttr.addUpdateRange(dirty[d]!, 3)
      }
      indexAttr.addUpdateRange(uploadedTris * 3, (triCount - uploadedTris) * 3)
      uploadedVerts = vertCount
      uploadedTris = triCount
      posAttr.needsUpdate = true
      uvAttr.needsUpdate = true
      norAttr.needsUpdate = true
      indexAttr.needsUpdate = true
      geometry.setDrawRange(0, triCount * 3)
    }
    pending = cellCursor < cellIds.length || candIds.length > 0
  }
}

/** Mild exposure lift on far ortho (keeps hue — no blue wash). */
function liftImageryExposure(
  ctx: CanvasRenderingContext2D,
  size: number,
  lift = 0.22,
): void {
  const img = ctx.getImageData(0, 0, size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!
    const g = d[i + 1]!
    const b = d[i + 2]!
    // Lift shadows more than highlights so dark ocean/ortho stays readable.
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    const t = lift * (1 - lum) * (1 - lum)
    d[i] = Math.min(255, r + (255 - r) * t)
    d[i + 1] = Math.min(255, g + (255 - g) * t)
    d[i + 2] = Math.min(255, b + (255 - b) * t)
  }
  ctx.putImageData(img, 0, 0)
}

/**
 * Open-ocean Esri tiles crush to near-black in mid/far atlases. Lift dark,
 * cool pixels toward a readable sea tone without inventing inland water.
 */
export function enhanceOceanPixelData(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!
    const g = data[i + 1]!
    const b = data[i + 2]!
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    // Strict sea only — loose "cool+dark" painted basalt ridges blue.
    const seaBlue = b > r + 12 && b > g + 8
    if (lum >= 0.13 || !seaBlue) continue
    const targetR = 58
    const targetG = 96
    const targetB = 118
    const w = 0.55 * (1 - lum / 0.13)
    data[i] = Math.round(r + (targetR - r) * w)
    data[i + 1] = Math.round(g + (targetG - g) * w)
    data[i + 2] = Math.round(b + (targetB - b) * w)
  }
}

export function enhanceOceanPixels(
  ctx: CanvasRenderingContext2D,
  size: number,
): void {
  const img = ctx.getImageData(0, 0, size, size)
  enhanceOceanPixelData(img.data)
  ctx.putImageData(img, 0, 0)
}


/**
 * One curved DEM annulus. Square grid over outer diameter; cells fully inside
 * inner radius are skipped (no z-fight with nearer rings / near disc).
 */
async function buildTerrainLodRing(input: {
  lat: number
  lon: number
  baseElev: number
  cache: Map<string, DemTile | null>
  ring: TerrainLodRing
  renderOrder: number
}): Promise<{
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  dispose: () => void
  tiles: number
}> {
  const { ring, cache } = input
  const radiusM = ring.outerM
  const resolution = ring.resolution
  const fallbackZooms = [10, 9, 8, 7]

  const tileKeys = new Set<string>()
  const addKey = (east: number, north: number, forceZ?: number) => {
    const dist = Math.hypot(east, north)
    if (dist < ring.innerM * 0.8) return
    if (dist > ring.outerM * 1.02) return
    const { lat, lon } = enuToLatLon(east, north, input.lat, input.lon)
    const z = forceZ ?? demZoomForDistance(dist)
    const { x, y } = latLonToTile(lat, lon, z)
    tileKeys.add(`${z}/${Math.floor(x)}/${Math.floor(y)}`)
  }

  for (let j = 0; j <= resolution; j++) {
    for (let i = 0; i <= resolution; i++) {
      const east = -radiusM + (i / resolution) * radiusM * 2
      const north = -radiusM + (j / resolution) * radiusM * 2
      addKey(east, north)
    }
  }
  const step = Math.max(1, Math.floor(resolution / 20))
  for (let j = 0; j <= resolution; j += step) {
    for (let i = 0; i <= resolution; i += step) {
      const east = -radiusM + (i / resolution) * radiusM * 2
      const north = -radiusM + (j / resolution) * radiusM * 2
      for (const z of fallbackZooms) addKey(east, north, z)
    }
  }

  const missing = [...tileKeys].filter((key) => !cache.has(key))
  await mapPool(missing, FETCH_CONCURRENCY, async (key) => {
    const parts = key.split('/')
    const tile = await resolveDemTile(
      Number(parts[0]),
      Number(parts[1]),
      Number(parts[2]),
    )
    cache.set(key, tile)
  })

  const vertCount = (resolution + 1) * (resolution + 1)
  const positions = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)
  const indices: number[] = []

  for (let j = 0; j <= resolution; j++) {
    for (let i = 0; i <= resolution; i++) {
      const u = i / resolution
      const v = j / resolution
      const east = -radiusM + u * radiusM * 2
      const north = -radiusM + v * radiusM * 2
      const dist = Math.hypot(east, north)
      const { lat, lon } = enuToLatLon(east, north, input.lat, input.lon)
      const elev = elevationFromCache(lat, lon, dist, cache, input.baseElev)
      // Curvature: sphere sits below the ENU tangent plane — critical past ~20 km.
      const h =
        (elev - input.baseElev) * VERTICAL_EXAGGERATION - earthCurvatureDropM(dist)
      const idx = j * (resolution + 1) + i
      positions[idx * 3] = east
      positions[idx * 3 + 1] = h
      positions[idx * 3 + 2] = -north
      uvs[idx * 2] = u
      uvs[idx * 2 + 1] = 1 - v
    }
  }

  const inner2 = ring.innerM * ring.innerM
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const a = j * (resolution + 1) + i
      const b = a + 1
      const c = a + (resolution + 1)
      const d = c + 1
      const ax = positions[a * 3]!
      const az = positions[a * 3 + 2]!
      const bx = positions[b * 3]!
      const bz = positions[b * 3 + 2]!
      const cx = positions[c * 3]!
      const cz = positions[c * 3 + 2]!
      const dx = positions[d * 3]!
      const dz = positions[d * 3 + 2]!
      const maxR2 = Math.max(
        ax * ax + az * az,
        bx * bx + bz * bz,
        cx * cx + cz * cz,
        dx * dx + dz * dz,
      )
      if (maxR2 < inner2) continue
      indices.push(a, b, c, b, d, c)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  const texture = await buildRingImageryTexture(
    input.lat,
    input.lon,
    radiusM,
    ring.imageryZooms,
    ring.atlasSize,
  )
  // Exact same material recipe as the near disc (only DEM/ortho resolution differs).
  const material = new THREE.MeshBasicMaterial({
    color: texture ? 0xffffff : 0xc4a574,
    map: texture ?? null,
    // FrontSide — DoubleSide on overlapping LOD/detail layers = glass shards.
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  })
  material.userData.isOrthoTerrain = true
  // Overlap bands ? hard outer*0.995 left black slits between LOD rings on pan.
  attachRadiusBandDiscard(material, ring.innerM * 0.88, ring.outerM)
  attachWorldXZOrthoMap(material, radiusM)
  // Match sky stereographic — terrain without stel = yellow disk + sea shards.
  attachStelProjector(material, { terrainSafe: true })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.name = `terrain-lod-${ring.name}`
  mesh.renderOrder = input.renderOrder

  return {
    mesh,
    material,
    tiles: missing.filter((k) => cache.get(k)).length,
    dispose: () => {
      geometry.dispose()
      material.dispose()
      texture?.dispose()
    },
  }
}

/**
 * High-res DEM+ortho annulus outside the previous layer. Full stacked discs
 * over the near mesh z-fought into glass shards on cliff pans.
 */
async function buildDetailTerrainDisc(input: {
  lat: number
  lon: number
  baseElev: number
  cache: Map<string, DemTile | null>
  radiusM: number
  /** Skip quads fully inside this radius (annulus, not a stacked disc). */
  innerRadiusM: number
  resolution: number
  imageryZooms: number[]
  atlasSize: number
  name: string
  renderOrder: number
  buildTexture?: (
    lat: number,
    lon: number,
  ) => Promise<THREE.CanvasTexture | null>
}): Promise<{
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  dispose: () => void
}> {
  const { radiusM, resolution, cache } = input
  const innerM = Math.max(0, input.innerRadiusM)
  const tileKeys = new Set<string>()
  for (let j = 0; j <= resolution; j++) {
    for (let i = 0; i <= resolution; i++) {
      const east = -radiusM + (i / resolution) * radiusM * 2
      const north = -radiusM + (j / resolution) * radiusM * 2
      const dist = Math.hypot(east, north)
      if (dist > radiusM * 1.02 || dist < innerM * 0.85) continue
      const { lat, lon } = enuToLatLon(east, north, input.lat, input.lon)
      const z = demZoomForDistance(dist)
      const { x, y } = latLonToTile(lat, lon, z)
      tileKeys.add(`${z}/${Math.floor(x)}/${Math.floor(y)}`)
    }
  }
  const missing = [...tileKeys].filter((key) => !cache.has(key))
  await mapPool(missing, FETCH_CONCURRENCY, async (key) => {
    const parts = key.split('/')
    const tile = await resolveDemTile(
      Number(parts[0]),
      Number(parts[1]),
      Number(parts[2]),
    )
    cache.set(key, tile)
  })

  const vertCount = (resolution + 1) * (resolution + 1)
  const positions = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)
  const indices: number[] = []
  for (let j = 0; j <= resolution; j++) {
    for (let i = 0; i <= resolution; i++) {
      const u = i / resolution
      const v = j / resolution
      const east = -radiusM + u * radiusM * 2
      const north = -radiusM + v * radiusM * 2
      const dist = Math.hypot(east, north)
      const { lat, lon } = enuToLatLon(east, north, input.lat, input.lon)
      const elev = elevationFromCache(lat, lon, dist, cache, input.baseElev)
      // Same height formula as the near disc — any lift here opened a sky slit
      // at the radius-band handoff under log-depth.
      const h =
        (elev - input.baseElev) * VERTICAL_EXAGGERATION -
        earthCurvatureDropM(dist)
      const idx = j * (resolution + 1) + i
      positions[idx * 3] = east
      positions[idx * 3 + 1] = h
      positions[idx * 3 + 2] = -north
      uvs[idx * 2] = u
      uvs[idx * 2 + 1] = 1 - v
    }
  }
  const inner2 = innerM * innerM
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const a = j * (resolution + 1) + i
      const b = a + 1
      const c = a + (resolution + 1)
      const d = c + 1
      const ax = positions[a * 3]!
      const az = positions[a * 3 + 2]!
      const bx = positions[b * 3]!
      const bz = positions[b * 3 + 2]!
      const cx = positions[c * 3]!
      const cz = positions[c * 3 + 2]!
      const dx = positions[d * 3]!
      const dz = positions[d * 3 + 2]!
      // Keep a quad if ANY corner is outside the hole — seals the seam.
      const maxR2 = Math.max(
        ax * ax + az * az,
        bx * bx + bz * bz,
        cx * cx + cz * cz,
        dx * dx + dz * dz,
      )
      if (maxR2 < inner2) continue
      indices.push(a, b, c, b, d, c)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  // Prefer a dedicated nested bake (with clipped high zooms) when provided.
  const texture =
    (await input.buildTexture?.(input.lat, input.lon)) ??
    (await buildRingImageryTexture(
      input.lat,
      input.lon,
      radiusM,
      input.imageryZooms,
      input.atlasSize,
    ))
  const material = new THREE.MeshBasicMaterial({
    color: texture ? 0xffffff : 0xc4a574,
    map: texture ?? null,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  material.userData.isOrthoTerrain = true
  attachRadiusBandDiscard(
    material,
    input.innerRadiusM * 0.88,
    input.radiusM,
  )
  attachWorldXZOrthoMap(material, radiusM)
  attachStelProjector(material, { terrainSafe: true })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.name = `terrain-detail-${input.name}`
  mesh.renderOrder = input.renderOrder
  return {
    mesh,
    material,
    dispose: () => {
      geometry.dispose()
      material.dispose()
      texture?.dispose()
    },
  }
}

/**
 * Curved MSL sea disc under DEM. Quads under land (DEM » 0) are omitted so the
 * blue mesh can't z-fight through ridges (the salt-and-pepper overlay).
 */
function buildSeaMesh(input: {
  baseElev: number
  radiusM: number
  lat: number
  lon: number
  cache: Map<string, DemTile | null>
}): {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  dispose: () => void
} {
  const { baseElev, radiusM, cache } = input
  const resolution = 320
  const vertCount = (resolution + 1) * (resolution + 1)
  const positions = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)
  const elevs = new Float32Array(vertCount)
  const indices: number[] = []
  for (let j = 0; j <= resolution; j++) {
    for (let i = 0; i <= resolution; i++) {
      const u = i / resolution
      const v = j / resolution
      const east = -radiusM + u * radiusM * 2
      const north = -radiusM + v * radiusM * 2
      const dist = Math.hypot(east, north)
      const { lat, lon } = enuToLatLon(east, north, input.lat, input.lon)
      const elev = elevationFromCache(lat, lon, dist, cache, 0)
      const idx = j * (resolution + 1) + i
      elevs[idx] = elev
      // Well below MSL so land always wins even with coarse depth at range.
      const h =
        (0 - baseElev) * VERTICAL_EXAGGERATION -
        earthCurvatureDropM(dist) -
        2.5
      positions[idx * 3] = east
      positions[idx * 3 + 1] = h
      positions[idx * 3 + 2] = -north
      uvs[idx * 2] = u
      uvs[idx * 2 + 1] = 1 - v
    }
  }
  const rMax2 = radiusM * radiusM * 1.02 * 1.02
  // Keep a sea quad only if at least one corner is open water (= ~3 m ASL).
  const LAND_CUT_M = 3
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const a = j * (resolution + 1) + i
      const b = a + 1
      const c = a + (resolution + 1)
      const d = c + 1
      const ax = positions[a * 3]!
      const az = positions[a * 3 + 2]!
      const bx = positions[b * 3]!
      const bz = positions[b * 3 + 2]!
      const cx = positions[c * 3]!
      const cz = positions[c * 3 + 2]!
      const dx = positions[d * 3]!
      const dz = positions[d * 3 + 2]!
      const minR2 = Math.min(
        ax * ax + az * az,
        bx * bx + bz * bz,
        cx * cx + cz * cz,
        dx * dx + dz * dz,
      )
      if (minR2 > rMax2) continue
      const minElev = Math.min(elevs[a]!, elevs[b]!, elevs[c]!, elevs[d]!)
      if (minElev > LAND_CUT_M) continue
      indices.push(a, b, c, b, d, c)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  const material = new THREE.MeshBasicMaterial({
    color: 0x4a7a96,
    side: THREE.FrontSide,
    // No depth write — never punch holes / flicker through land depth.
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: 16,
    polygonOffsetUnits: 16,
  })
  material.userData.isSea = true
  attachStelProjector(material, { terrainSafe: true })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.name = 'terrain-sea'
  mesh.renderOrder = -5
  return {
    mesh,
    material,
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}

/**
 * Background LOD rings with Earth curvature — mid ridges ? far ? horizon
 * silhouettes out to ~300 km, plus a curved MSL sea underlay.
 */
async function buildFarTerrainMesh(input: {
  lat: number
  lon: number
  baseElev: number
  cache: Map<string, DemTile | null>
}): Promise<{
  mesh: THREE.Group
  materials: Array<THREE.MeshBasicMaterial | THREE.MeshStandardMaterial>
  dispose: () => void
  tiles: number
}> {
  const group = new THREE.Group()
  group.name = 'far-terrain-lod'
  group.frustumCulled = false

  // Sea underlay — carved under land so blue never z-fights ridges.
  const sea = buildSeaMesh({
    baseElev: input.baseElev,
    radiusM: FAR_TERRAIN_RADIUS_M,
    lat: input.lat,
    lon: input.lon,
    cache: input.cache,
  })
  group.add(sea.mesh)

  const builtRings = await Promise.all(
    TERRAIN_LOD_RINGS.map((ring, i) =>
      buildTerrainLodRing({
        ...input,
        ring,
        renderOrder: -3 + i,
      }),
    ),
  )

  const materials: Array<THREE.MeshBasicMaterial | THREE.MeshStandardMaterial> = [
    sea.material,
  ]
  const disposers: Array<() => void> = [sea.dispose]
  let tiles = 0
  for (const built of builtRings) {
    group.add(built.mesh)
    materials.push(built.material)
    disposers.push(built.dispose)
    tiles += built.tiles
  }

  return {
    mesh: group,
    materials,
    tiles,
    dispose: () => {
      for (const d of disposers) d()
    },
  }
}

function mixAtlasGlsl(
  uniformName: string,
  radiusM: number,
): { decl: string; mix: string } {
  const diam = (radiusM * 2).toFixed(1)
  const inner = (radiusM * 0.72).toFixed(1)
  const outer = (radiusM * 0.96).toFixed(1)
  return {
    decl: `\n           uniform sampler2D ${uniformName};`,
    mix: `
           {
             vec2 tuv = vTerrainXZ / ${diam} + vec2(0.5);
             // Circular radius fade + UV-edge fade ? without the edge fade the
             // square atlas prints a visible rectangle on hillsides (the
             // "carr� noir / qualit� diff�rente" artifact).
             float tw = 1.0 - smoothstep(${inner}, ${outer}, length(vTerrainXZ));
             float edge = min(min(tuv.x, tuv.y), min(1.0 - tuv.x, 1.0 - tuv.y));
             tw *= smoothstep(0.0, 0.1, edge);
             if (tw > 0.001) {
               vec4 sampleTex = texture2D(${uniformName}, clamp(tuv, 0.0, 1.0));
               diffuseColor.rgb = mix(diffuseColor.rgb, sampleTex.rgb * diffuse, tw);
             }
           }`,
  }
}

/**
 * Sample the base ortho map from ENU XZ (not mesh UVs). Stereographic warps
 * gl_Position; interpolated vUv then smears cliffs into mud. World-XZ lookup
 * stays tied to geography even when verts move on the projection plane.
 */
function attachWorldXZOrthoMap(
  material: THREE.Material,
  radiusM: number,
): void {
  if (material.userData.worldXZOrtho) return
  material.userData.worldXZOrtho = radiusM
  const diam = (radiusM * 2).toFixed(1)
  const previous = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey?.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer)
    if (shader.fragmentShader.includes('ASTRO_WORLD_XZ_ORTHO')) return
    if (!shader.fragmentShader.includes('#include <map_fragment>')) return
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec2 vWorldOrthoXZ;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vWorldOrthoXZ = position.xz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         #define ASTRO_WORLD_XZ_ORTHO 1
         varying vec2 vWorldOrthoXZ;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         #ifdef USE_MAP
         {
           vec2 wuv = vWorldOrthoXZ / ${diam} + vec2(0.5);
           float edge = min(min(wuv.x, wuv.y), min(1.0 - wuv.x, 1.0 - wuv.y));
           float ew = smoothstep(0.0, 0.08, edge);
           if (ew > 0.001) {
             vec4 worldTex = texture2D(map, clamp(wuv, 0.0, 1.0));
             diffuseColor.rgb = mix(diffuseColor.rgb, worldTex.rgb * diffuse, ew);
             diffuseColor.a = mix(diffuseColor.a, worldTex.a, ew);
           }
         }
         #endif`,
      )
  }
  material.customProgramCacheKey = () =>
    `world-xz-ortho-v2|${radiusM}|${previousKey?.() ?? ''}`
}

/**
 * Log-depth kills polygonOffset — layers must discard outside their radius
 * band or they z-fight into glass/noise.
 * ENU: length(position.xz) == horizontal range (z = -north).
 */
function attachRadiusBandDiscard(
  material: THREE.Material,
  innerM: number,
  outerM: number,
): void {
  if (material.userData.radiusBand) return
  material.userData.radiusBand = { innerM, outerM }
  const previous = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey?.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer)
    if (shader.fragmentShader.includes('ASTRO_RADIUS_BAND')) return
    const lo = Math.max(0, innerM).toFixed(1)
    const hi = Math.max(innerM + 1, outerM).toFixed(1)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec2 vAstroXZ;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vAstroXZ = position.xz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         #define ASTRO_RADIUS_BAND 1
         varying vec2 vAstroXZ;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         {
           float rr = length(vAstroXZ);
           if (rr < ${lo} || rr > ${hi}) discard;
         }`,
      )
  }
  material.customProgramCacheKey = () =>
    `rad-band|${innerM}|${outerM}|${previousKey?.() ?? ''}`
}

/**
 * Max-detail local ENU terrain (Mapterhorn up to z17 + Esri up to z18 near spot)
 * plus curved LOD rings for background ridges out to ~300 km.
 * Origin = spot ground; +X east, +Y up, +Z south.
 */
export type TerrainLoadPhase =
  | 'dem'
  | 'preview'
  | 'ortho'
  | 'detail'
  | 'far'
  | 'ready'

export type LocalTerrainHandle = {
  mesh: THREE.Mesh
  /** LOD background rings (~6–300 km); may be null if build failed. */
  farMesh: THREE.Group | null
  /** Materials tinted by day/night in ImmersiveView. */
  materials: Array<THREE.MeshBasicMaterial | THREE.MeshStandardMaterial>
  adaptToEye: (ex: number, ey: number, ez: number) => void
  /**
   * Mesh Y of the DEM surface at local ENU (east, north). Spot center ≈ 0.
   * Used to keep the camera a fixed eye-height above the ground while walking.
   */
  groundYAt: (east: number, north: number) => number
  /** True MSL elevation (m) of the DEM surface at local ENU. */
  groundElevationMslAt: (east: number, north: number) => number
  dispose: () => void
  /** False while preview ortho is up; true after nested atlases + far LOD. */
  ready: boolean
  stats: {
    minH: number
    maxH: number
    tiles: number
    demMaxZ: number
    farRadiusM: number
    /** Human-readable load stage for the immersive loader. */
    phase: TerrainLoadPhase
    /** 0?1 overall load progress (ready ? 1). */
    progress: number
  }
}

export const TERRAIN_PHASE_LABEL: Record<TerrainLoadPhase, string> = {
  dem: 'Relief DEM...',
  preview: 'Apercu satellite...',
  ortho: 'Ortho haute resolution...',
  detail: 'Relief moyen...',
  far: 'Horizon 300 km...',
  ready: 'Pret',
}

export async function createLocalTerrainMesh(input: {
  lat: number
  lon: number
  centerElevationM: number
  radiusM?: number
  resolution?: number
  /** Fires as soon as a coarse mesh+ortho is drawable (progressive load). */
  onPreview?: (handle: LocalTerrainHandle) => void
  /** Fires again when sharp core / detail / far layers attach. */
  onUpgrade?: (handle: LocalTerrainHandle) => void
  /** Lightweight load stages for the immersive loader UI. */
  onProgress?: (info: {
    phase: TerrainLoadPhase
    progress: number
  }) => void
}): Promise<LocalTerrainHandle> {
  const radiusM = input.radiusM ?? NEAR_TERRAIN_RADIUS_M
  const resolution = input.resolution ?? 416
  const cache = new Map<string, DemTile | null>()

  const tileKeys = new Set<string>()
  for (let j = 0; j <= resolution; j++) {
    for (let i = 0; i <= resolution; i++) {
      const u = i / resolution
      const v = j / resolution
      const east = -radiusM + u * radiusM * 2
      const north = -radiusM + v * radiusM * 2
      const dist = Math.hypot(east, north)
      const { lat, lon } = enuToLatLon(east, north, input.lat, input.lon)
      const z = demZoomForDistance(dist)
      const { x, y } = latLonToTile(lat, lon, z)
      tileKeys.add(`${z}/${Math.floor(x)}/${Math.floor(y)}`)
    }
  }

  // Coarse fallback coverage so missing high-z tiles never punch holes.
  for (let j = 0; j <= resolution; j += Math.max(1, Math.floor(resolution / 32))) {
    for (let i = 0; i <= resolution; i += Math.max(1, Math.floor(resolution / 32))) {
      const u = i / resolution
      const v = j / resolution
      const east = -radiusM + u * radiusM * 2
      const north = -radiusM + v * radiusM * 2
      const { lat, lon } = enuToLatLon(east, north, input.lat, input.lon)
      for (const z of [12, 10, 8] as const) {
        const { x, y } = latLonToTile(lat, lon, z)
        tileKeys.add(`${z}/${Math.floor(x)}/${Math.floor(y)}`)
      }
    }
  }

  let progressHandle: LocalTerrainHandle | null = null
  const notifyProgress = (phase: TerrainLoadPhase, progress: number) => {
    if (progressHandle) {
      progressHandle.stats.phase = phase
      progressHandle.stats.progress = progress
      if (phase === 'ready') progressHandle.ready = true
    }
    input.onProgress?.({ phase, progress })
  }
  notifyProgress('dem', 0.08)

  await mapPool([...tileKeys], FETCH_CONCURRENCY, async (key) => {
    const parts = key.split('/')
    const tile = await resolveDemTile(
      Number(parts[0]),
      Number(parts[1]),
      Number(parts[2]),
    )
    cache.set(key, tile)
  })
  notifyProgress('dem', 0.22)

  const demAtSpot = elevationFromCache(
    input.lat,
    input.lon,
    0,
    cache,
    input.centerElevationM,
  )

  const positions = new Float32Array((resolution + 1) * (resolution + 1) * 3)
  const uvs = new Float32Array((resolution + 1) * (resolution + 1) * 2)
  const indices: number[] = []
  let minH = Infinity
  let maxH = -Infinity

  for (let j = 0; j <= resolution; j++) {
    for (let i = 0; i <= resolution; i++) {
      const u = i / resolution
      const v = j / resolution
      const east = -radiusM + u * radiusM * 2
      const north = -radiusM + v * radiusM * 2
      const dist = Math.hypot(east, north)
      const { lat, lon } = enuToLatLon(east, north, input.lat, input.lon)
      const elev = elevationFromCache(lat, lon, dist, cache, demAtSpot)
      const h = (elev - demAtSpot) * VERTICAL_EXAGGERATION
      if (h < minH) minH = h
      if (h > maxH) maxH = h
      const idx = j * (resolution + 1) + i
      positions[idx * 3] = east
      positions[idx * 3 + 1] = h
      positions[idx * 3 + 2] = -north
      uvs[idx * 2] = east / (radiusM * 2) + 0.5
      uvs[idx * 2 + 1] = 0.5 - north / (radiusM * 2)
    }
  }

  const mid = Math.floor(resolution / 2)
  const spotIdx = mid * (resolution + 1) + mid
  const spotGridElev =
    positions[spotIdx * 3 + 1]! / VERTICAL_EXAGGERATION + demAtSpot
  if (Number.isFinite(spotGridElev)) {
    for (let k = 0; k < positions.length; k += 3) {
      const elev = positions[k + 1]! / VERTICAL_EXAGGERATION + demAtSpot
      positions[k + 1] = (elev - spotGridElev) * VERTICAL_EXAGGERATION
    }
  }
  // Same curvature as far LOD — without this, a ~70 m vertical crack opens at
  // the seam and the sunset sky leaks through as a yellow “hole”.
  minH = Infinity
  maxH = -Infinity
  for (let k = 0; k < positions.length; k += 3) {
    const dist = Math.hypot(positions[k]!, positions[k + 2]!)
    const h = positions[k + 1]! - earthCurvatureDropM(dist)
    positions[k + 1] = h
    if (h < minH) minH = h
    if (h > maxH) maxH = h
  }

  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const a = j * (resolution + 1) + i
      const b = a + 1
      const c = a + (resolution + 1)
      const d = c + 1
      indices.push(a, b, c, b, d, c)
    }
  }

  const baseElev = Number.isFinite(spotGridElev) ? spotGridElev : demAtSpot
  const sampleTerrainElevMsl = (east: number, north: number) => {
    const dist = Math.hypot(east, north)
    const { lat, lon } = enuToLatLon(east, north, input.lat, input.lon)
    return elevationFromCache(lat, lon, dist, cache, demAtSpot)
  }
  const sampleTerrainY = (east: number, north: number) => {
    const dist = Math.hypot(east, north)
    const elev = sampleTerrainElevMsl(east, north)
    return (
      (elev - baseElev) * VERTICAL_EXAGGERATION - earthCurvatureDropM(dist)
    )
  }

  // Preview mesh first (no edge refine yet) so the view isn't blocked ~10× longer
  // than MapLibre's progressive tiles.
  const previewTexture = await buildPreviewImageryTexture(
    input.lat,
    input.lon,
    radiusM,
  )

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  // Nested atlas textures — filled after preview; shader always declares slots.
  const atlasSlots = {
    wide: null as THREE.CanvasTexture | null,
    mid: null as THREE.CanvasTexture | null,
    near: null as THREE.CanvasTexture | null,
    ultra: null as THREE.CanvasTexture | null,
  }
  const atlasUniforms = {
    uWideMap: { value: null as THREE.Texture | null },
    uMidMap: { value: null as THREE.Texture | null },
    uNearMap: { value: null as THREE.Texture | null },
    uUltraNearMap: { value: null as THREE.Texture | null },
  }

  // MeshBasic = MapLibre-like unlit ortho (Standard+sunset was crushing satellite).
  const material = new THREE.MeshBasicMaterial({
    color: previewTexture ? 0xffffff : 0xc4a574,
    map: previewTexture ?? null,
    side: THREE.FrontSide,
  })
  const eyeHeight = { value: TRIPOD_HEIGHT_M }
  const eyeXZ = { value: new THREE.Vector2(0, 0) }
  const atlasWeights = {
    wide: { value: 0 },
    mid: { value: 0 },
    near: { value: 0 },
    ultra: { value: 0 },
  }
  material.userData.eyeHeight = eyeHeight
  material.userData.eyeXZ = eyeXZ
  material.userData.atlasWeights = atlasWeights
  material.userData.isOrthoTerrain = true
  const atlasEpoch = { value: 0 }
  const previousCompile = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.call(material, shader, renderer)
    shader.uniforms.uEyeY = eyeHeight
    shader.uniforms.uEyeXZ = eyeXZ
    shader.uniforms.uWideMap = atlasUniforms.uWideMap
    shader.uniforms.uMidMap = atlasUniforms.uMidMap
    shader.uniforms.uNearMap = atlasUniforms.uNearMap
    shader.uniforms.uUltraNearMap = atlasUniforms.uUltraNearMap
    shader.uniforms.uWideW = atlasWeights.wide
    shader.uniforms.uMidW = atlasWeights.mid
    shader.uniforms.uNearW = atlasWeights.near
    shader.uniforms.uUltraW = atlasWeights.ultra
    if (!shader.vertexShader.includes('uniform float uEyeY')) {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uEyeY;
           uniform vec2 uEyeXZ;
           varying vec2 vTerrainXZ;
           varying vec3 vAstroPos;
           varying vec3 vAstroNrm;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vTerrainXZ = position.xz;
           vAstroPos = position;
           vAstroNrm = normal;
           float groundDist = length(transformed.xz - uEyeXZ);
           float ceiling = uEyeY - 0.35;
           float rise = smoothstep(4.0, 18.0, groundDist);
           if (transformed.y > ceiling) transformed.y = mix(ceiling, transformed.y, rise);`,
        )
    }
    // Re-inject whenever the program is (re)built — epoch bumps on each atlas.
    if (
      shader.fragmentShader.includes('#include <map_fragment>') &&
      !shader.fragmentShader.includes('ASTRO_NESTED_ATLAS')
    ) {
      const wide = mixAtlasGlsl('uWideMap', WIDE_DETAIL_RADIUS_M)
      const midA = mixAtlasGlsl('uMidMap', MID_DETAIL_RADIUS_M)
      const nearA = mixAtlasGlsl('uNearMap', NEAR_RADIUS_M)
      const ultraA = mixAtlasGlsl('uUltraNearMap', ULTRA_NEAR_RADIUS_M)
      const nearDiam = (radiusM * 2).toFixed(1)
      const feetDetail = `
           {
             // NEVER dFdx/dFdy hillshade under stereographic warp ? screen
             // derivatives explode into black squares / crushed tiles.
             // Vertex normal stays stable across zoom and dezoom.
             vec3 nrm = normalize(vAstroNrm);
             float shade = clamp(0.55 + 0.55 * nrm.y + 0.18 * nrm.x, 0.45, 1.25);
             diffuseColor.rgb *= shade;
             float groundR = length(vTerrainXZ);
             float closeW = 1.0 - smoothstep(6.0, 160.0, groundR);
             if (closeW > 0.001) {
               vec3 base = diffuseColor.rgb;
               float luma = dot(base, vec3(0.2126, 0.7152, 0.0722));
               vec3 contrasted = clamp(base + (base - vec3(luma)) * 1.15, 0.0, 1.0);
               diffuseColor.rgb = mix(base, contrasted, closeW * 0.7);
             }
           }`
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           #define ASTRO_NESTED_ATLAS 1
           varying vec2 vTerrainXZ;
           varying vec3 vAstroPos;
           varying vec3 vAstroNrm;${wide.decl}${midA.decl}${nearA.decl}${ultraA.decl}
           uniform float uWideW;
           uniform float uMidW;
           uniform float uNearW;
           uniform float uUltraW;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           // World-XZ base sample ? survives stereographic vertex warp.
           #ifdef USE_MAP
           {
             vec2 wuv = vTerrainXZ / ${nearDiam} + vec2(0.5);
             float bedge = min(min(wuv.x, wuv.y), min(1.0 - wuv.x, 1.0 - wuv.y));
             float bw = smoothstep(0.0, 0.04, bedge);
             if (bw > 0.001) {
               vec4 worldTex = texture2D(map, clamp(wuv, 0.0, 1.0));
               diffuseColor.rgb = mix(diffuseColor.rgb, worldTex.rgb * diffuse, bw);
               diffuseColor.a = mix(diffuseColor.a, worldTex.a, bw);
             }
           }
           #endif
           if (uWideW > 0.5) {${wide.mix}}
           if (uMidW > 0.5) {${midA.mix}}
           if (uNearW > 0.5) {${nearA.mix}}
           if (uUltraW > 0.5) {${ultraA.mix}}
           ${feetDetail}`,
        )
    }
  }
  const previousKey = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () =>
    `eye-clear-v20|vNrmShade|atlasEdge|stel|e${atlasEpoch.value}|w${atlasWeights.wide.value}|m${atlasWeights.mid.value}|n${atlasWeights.near.value}|u${atlasWeights.ultra.value}|${previousKey()}`
  // Exact handoff — overlap z-fights under log-depth (polygonOffset is a no-op).
  attachRadiusBandDiscard(material, 0, MID_DETAIL_INNER_M * 1.08)
  // Stel on terrain (terrainSafe) so stereo matches the sky. Ortho is sampled
  // from world XZ above — not mesh UVs — so the warp can't smear the satellite.
  attachStelProjector(material, { terrainSafe: true })

  // 1×1 placeholders so sampler uniforms are never null before atlases load.
  const placeholder = (() => {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    const t = new THREE.CanvasTexture(c)
    t.needsUpdate = true
    return t
  })()
  atlasUniforms.uWideMap.value = placeholder
  atlasUniforms.uMidMap.value = placeholder
  atlasUniforms.uNearMap.value = placeholder
  atlasUniforms.uUltraNearMap.value = placeholder

  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.name = 'local-terrain'
  mesh.renderOrder = 0

  let adaptFn: (ex: number, ey: number, ez: number) => void = () => {}
  let farDispose: (() => void) | null = null
  let farMaterials: Array<THREE.MeshBasicMaterial | THREE.MeshStandardMaterial> =
    []
  let disposed = false
  let fullTexture: THREE.CanvasTexture | null = null

  const handle: LocalTerrainHandle = {
    mesh,
    farMesh: null,
    materials: [material],
    adaptToEye: (ex, ey, ez) => adaptFn(ex, ey, ez),
    groundYAt: sampleTerrainY,
    groundElevationMslAt: sampleTerrainElevMsl,
    ready: false,
    stats: {
      minH,
      maxH,
      tiles: [...cache.values()].filter(Boolean).length,
      demMaxZ: DEM_MAX_ZOOM,
      farRadiusM: 0,
      phase: 'preview',
      progress: 0.3,
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      geometry.dispose()
      material.dispose()
      previewTexture?.dispose()
      fullTexture?.dispose()
      atlasSlots.wide?.dispose()
      atlasSlots.mid?.dispose()
      atlasSlots.near?.dispose()
      atlasSlots.ultra?.dispose()
      placeholder.dispose()
      farDispose?.()
    },
  }
  progressHandle = handle
  notifyProgress('preview', 0.32)
  input.onPreview?.(handle)

  // ?? Upgrade path (full ortho + nested discs + refine + far LOD) ??
  const enableAtlas = (
    slot: 'wide' | 'mid' | 'near' | 'ultra',
    tex: THREE.CanvasTexture | null,
  ) => {
    if (!tex || disposed) {
      tex?.dispose()
      return
    }
    atlasSlots[slot] = tex
    const uniformKey =
      slot === 'wide'
        ? 'uWideMap'
        : slot === 'mid'
          ? 'uMidMap'
          : slot === 'near'
            ? 'uNearMap'
            : 'uUltraNearMap'
    atlasUniforms[uniformKey].value = tex
    atlasWeights[slot].value = 1
    atlasEpoch.value += 1
    // Force program rebuild so sampler uniforms re-bind to the new atlases.
    material.needsUpdate = true
  }

  // Near ortho first (sharp 8 km core) ? never block on far LOD tile storms.
  notifyProgress('ortho', 0.4)
  const [fullMap, nearMap, ultraMap] = await Promise.all([
    buildImageryTexture(input.lat, input.lon, radiusM),
    buildNearImageryTexture(input.lat, input.lon),
    buildUltraNearImageryTexture(input.lat, input.lon),
  ])

  if (disposed) {
    fullMap?.dispose()
    nearMap?.dispose()
    ultraMap?.dispose()
    return handle
  }

  if (fullMap) {
    const prev = material.map
    material.map = fullMap
    fullTexture = fullMap
    material.color.set(0xffffff)
    material.needsUpdate = true
    if (prev && prev !== fullMap && prev !== previewTexture) prev.dispose()
  }
  enableAtlas('near', nearMap)
  enableAtlas('ultra', ultraMap)
  handle.stats.tiles = [...cache.values()].filter(Boolean).length
  notifyProgress('ortho', 0.58)
  input.onUpgrade?.(handle)

  const refined = refineTerrainEdges(positions, uvs, indices, sampleTerrainY)
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(refined.positions, 3),
  )
  geometry.setAttribute('uv', new THREE.BufferAttribute(refined.uvs, 2))
  geometry.setIndex(refined.indices)
  geometry.computeVertexNormals()
  adaptFn = createAdaptiveRefine(geometry, radiusM, sampleTerrainY)

  const detailDisposers: Array<() => void> = []
  const detailMaterials: THREE.MeshBasicMaterial[] = []

  // Detail discs next (second plan), then far rings ? sequential so a slow
  // ring never starves the sharp core.
  notifyProgress('detail', 0.62)
  try {
    const detailMid = await buildDetailTerrainDisc({
      lat: input.lat,
      lon: input.lon,
      baseElev,
      cache,
      radiusM: MID_DETAIL_RADIUS_M,
      innerRadiusM: MID_DETAIL_INNER_M,
      resolution: 960,
      imageryZooms: [13, 14, 15, 16],
      atlasSize: 4096,
      name: 'mid',
      renderOrder: 2,
      buildTexture: buildMidDetailImageryTexture,
    })
    if (!disposed) {
      mesh.add(detailMid.mesh)
      detailMaterials.push(detailMid.material)
      detailDisposers.push(detailMid.dispose)
      handle.materials = [material, ...detailMaterials]
      notifyProgress('detail', 0.72)
      input.onUpgrade?.(handle)
    } else {
      detailMid.dispose()
    }
  } catch (err) {
    console.error('[terrain:detail-mid]', err)
  }

  try {
    const detailWide = await buildDetailTerrainDisc({
      lat: input.lat,
      lon: input.lon,
      baseElev,
      cache,
      radiusM: WIDE_DETAIL_RADIUS_M,
      innerRadiusM: WIDE_DETAIL_INNER_M,
      resolution: 900,
      imageryZooms: [12, 13, 14],
      atlasSize: 4096,
      name: 'wide',
      renderOrder: 1,
      buildTexture: buildWideDetailImageryTexture,
    })
    if (!disposed) {
      mesh.add(detailWide.mesh)
      detailMaterials.push(detailWide.material)
      detailDisposers.push(detailWide.dispose)
      handle.materials = [material, ...detailMaterials]
      notifyProgress('detail', 0.8)
      input.onUpgrade?.(handle)
    } else {
      detailWide.dispose()
    }
  } catch (err) {
    console.error('[terrain:detail-wide]', err)
  }

  if (disposed) {
    for (const d of detailDisposers) d()
    return handle
  }

  handle.materials = [material, ...detailMaterials]
  handle.stats.tiles = [...cache.values()].filter(Boolean).length
  notifyProgress('far', 0.84)
  input.onUpgrade?.(handle)

  try {
    const far = await buildFarTerrainMesh({
      lat: input.lat,
      lon: input.lon,
      baseElev,
      cache,
    })
    if (!disposed) {
      farDispose = () => {
        for (const d of detailDisposers) d()
        far.dispose()
      }
      farMaterials = [...detailMaterials, ...far.materials]
      handle.farMesh = far.mesh
      handle.materials = [material, ...farMaterials]
      handle.stats.farRadiusM = FAR_TERRAIN_RADIUS_M
      handle.stats.tiles = [...cache.values()].filter(Boolean).length
      notifyProgress('ready', 1)
      input.onUpgrade?.(handle)
    } else {
      far.dispose()
      for (const d of detailDisposers) d()
    }
  } catch (err) {
    console.error('[terrain:far]', err)
    farDispose = () => {
      for (const d of detailDisposers) d()
    }
    notifyProgress('ready', 1)
  }

  handle.ready = true
  handle.stats.phase = 'ready'
  handle.stats.progress = 1
  return handle
}
