/**
 * Plan-basemap coloured PL overlay from the VIIRS VNL COG.
 * v17: zero visible seams + faster overview.
 * - Overview: 1:1 GIBS colourize (no per-tile expand)
 * - COG: geographic halo ≥ dilate+blur, full-res spread only, nearest upscale
 */
import * as maplibregl from 'maplibre-gl'
import { glowFromBlackMarbleRgb } from './bortleFromRadiance'
import {
  colorizePlMapFromRadianceNw,
  colorizePlMapPixel,
} from './bortleMapColors'
import { lightPollutionCogUrl } from './cogConfig'
import { LIGHT_POLLUTION_YEAR } from './lightPollutionProtocol'
import {
  spreadMarginForZoom,
  spreadRadianceForMapOverlay,
} from './plMapOverlayGlow'
import {
  readNativeRasterWindowFromCog,
  resolveLightPollutionCogUrl,
  viirsDnToRadianceNw,
} from './sampleFromCog'

export const PL_MAP_OVERLAY_PROTOCOL = 'astro-pl-map-v17'
export const PL_MAP_OVERLAY_PROTOCOL_URL = `${PL_MAP_OVERLAY_PROTOCOL}://{z}/{x}/{y}`

const TILE = 256
/** GIBS Level8 is seamless; stay on it longer to avoid mid-zoom COG cost/seams. */
const COG_DETAIL_MIN_ZOOM = 7
const GIBS_BASE =
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/${LIGHT_POLLUTION_YEAR}/GoogleMapsCompatible_Level8`

let registeredName = ''
let cogLive: boolean | null = null

const EMPTY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
])

const tileCache = new Map<string, ArrayBuffer>()
const TILE_CACHE_MAX = 512

/** Cap parallel decodes — overview is light; keep this modest for COG. */
const MAX_IN_FLIGHT = 3
let inFlight = 0
const waitQueue: Array<() => void> = []

async function withTileSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (inFlight >= MAX_IN_FLIGHT) {
    await new Promise<void>((resolve) => {
      waitQueue.push(resolve)
    })
  }
  inFlight += 1
  try {
    return await fn()
  } finally {
    inFlight -= 1
    const next = waitQueue.shift()
    if (next) next()
  }
}

function parseTileUrl(url: string): { z: number; x: number; y: number } | null {
  const match = /^astro-pl-map-v17:\/\/(\d+)\/(\d+)\/(\d+)/.exec(url)
  if (!match) return null
  return {
    z: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3]),
  }
}

export function mercatorTilePixelToLonLat(
  z: number,
  x: number,
  y: number,
  px: number,
  py: number,
  tileSize = TILE,
): { lon: number; lat: number } {
  const n = 2 ** z
  const lon = ((x + (px + 0.5) / tileSize) / n) * 360 - 180
  const mercY = Math.PI * (1 - (2 * (y + (py + 0.5) / tileSize)) / n)
  const lat =
    ((2 * Math.atan(Math.exp(mercY)) - Math.PI / 2) * 180) / Math.PI
  return {
    lon,
    lat: Math.max(-85.05112878, Math.min(85.05112878, lat)),
  }
}

export function mercatorTileBbox(
  z: number,
  x: number,
  y: number,
): { west: number; south: number; east: number; north: number } {
  const nw = mercatorTilePixelToLonLat(z, x, y, -0.5, -0.5)
  const se = mercatorTilePixelToLonLat(z, x, y, TILE - 0.5, TILE - 0.5)
  return { west: nw.lon, north: nw.lat, east: se.lon, south: se.lat }
}

function padBbox(
  bbox: { west: number; south: number; east: number; north: number },
  frac: number,
): { west: number; south: number; east: number; north: number } {
  const dlon = (bbox.east - bbox.west) * frac
  const dlat = (bbox.north - bbox.south) * frac
  return {
    west: bbox.west - dlon,
    east: bbox.east + dlon,
    south: bbox.south - dlat,
    north: bbox.north + dlat,
  }
}

function sampleBilinear(
  grid: Float32Array,
  width: number,
  height: number,
  fx: number,
  fy: number,
): number {
  if (width < 1 || height < 1) return 0
  const x = Math.min(width - 1, Math.max(0, fx))
  const y = Math.min(height - 1, Math.max(0, fy))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  return (
    grid[y0 * width + x0]! * (1 - tx) * (1 - ty) +
    grid[y0 * width + x1]! * tx * (1 - ty) +
    grid[y1 * width + x0]! * (1 - tx) * ty +
    grid[y1 * width + x1]! * tx * ty
  )
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const out = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('toBlob failed'))),
      'image/png',
    )
  })
  return out.arrayBuffer()
}

function paintRgba(
  data: Uint8ClampedArray,
  radiance: Float32Array,
  count: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const painted = colorizePlMapFromRadianceNw(radiance[i]!)
    const o = i * 4
    if (!painted) {
      data[o] = 0
      data[o + 1] = 0
      data[o + 2] = 0
      data[o + 3] = 0
      continue
    }
    data[o] = painted.r
    data[o + 1] = painted.g
    data[o + 2] = painted.b
    data[o + 3] = painted.a
  }
}

function cropCenter(
  src: Float32Array,
  srcW: number,
  margin: number,
  outSize: number,
): Float32Array {
  const out = new Float32Array(outSize * outSize)
  for (let py = 0; py < outSize; py += 1) {
    const sy = py + margin
    for (let px = 0; px < outSize; px += 1) {
      out[py * outSize + px] = src[sy * srcW + (px + margin)]!
    }
  }
  return out
}

async function probeCog(cogUrl: string): Promise<boolean> {
  if (cogLive === true) return true
  try {
    const win = await readNativeRasterWindowFromCog(
      { west: 2.2, south: 48.7, east: 2.5, north: 48.95 },
      cogUrl,
      { maxDim: 32 },
    )
    cogLive = win != null && win.width > 0
  } catch {
    cogLive = null
    return false
  }
  return cogLive === true
}

/** Keep work grids small — full-res spread; nearest upscale avoids soft edge seams. */
function workSizeForZoom(z: number): number {
  if (z <= 8) return 96
  if (z <= 10) return 128
  return 192
}

async function renderFromCog(
  z: number,
  x: number,
  y: number,
  cogUrl: string,
): Promise<ArrayBuffer | null> {
  const work = workSizeForZoom(z)
  const margin = spreadMarginForZoom(z)
  const bbox = mercatorTileBbox(z, x, y)
  // +1 so neighbour tiles share identical edge samples after spread.
  const padded = padBbox(bbox, (margin + 1) / work)
  const win = await readNativeRasterWindowFromCog(padded, cogUrl, {
    maxDim: z <= 8 ? 160 : z <= 10 ? 192 : 256,
  })
  if (!win || win.width < 2 || win.height < 2) return null

  const radianceNative = new Float32Array(win.width * win.height)
  for (let i = 0; i < radianceNative.length; i += 1) {
    const dn = win.values[i]!
    if (dn === win.nodata || !Number.isFinite(dn)) {
      radianceNative[i] = 0
      continue
    }
    radianceNative[i] = viirsDnToRadianceNw(dn) ?? 0
  }

  const big = work + margin * 2
  const bigRad = new Float32Array(big * big)
  const [west0, dx, , north0, , dy] = win.geotransform
  const absDy = Math.abs(dy)

  for (let py = 0; py < big; py += 1) {
    const tilePy = ((py - margin) / work) * TILE - 0.5
    for (let px = 0; px < big; px += 1) {
      const tilePx = ((px - margin) / work) * TILE - 0.5
      const { lon, lat } = mercatorTilePixelToLonLat(z, x, y, tilePx, tilePy)
      const fx = (lon - west0) / dx - 0.5
      const fy = (north0 - lat) / absDy - 0.5
      bigRad[py * big + px] = sampleBilinear(
        radianceNative,
        win.width,
        win.height,
        fx,
        fy,
      )
    }
  }

  const spread = spreadRadianceForMapOverlay(bigRad, big, big, z)
  const tileRad = cropCenter(spread, big, margin, work)

  const small = document.createElement('canvas')
  small.width = work
  small.height = work
  const sctx = small.getContext('2d', { willReadFrequently: true })
  if (!sctx) throw new Error('pl map overlay: no 2d context')
  const img = sctx.createImageData(work, work)
  paintRgba(img.data, tileRad, work * work)
  sctx.putImageData(img, 0, 0)

  if (work === TILE) return canvasToPng(small)

  const canvas = document.createElement('canvas')
  canvas.width = TILE
  canvas.height = TILE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('pl map overlay: no 2d context')
  // Nearest: linear upscale blends only within-tile and invents edge mismatches.
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small, 0, 0, TILE, TILE)
  return canvasToPng(canvas)
}

/**
 * Fast seamless overview — colourize GIBS 1:1.
 * Never dilate/expand: edge-clamped expand was the Europe tile seams.
 */
async function renderOverviewHeatmap(
  z: number,
  x: number,
  y: number,
): Promise<ArrayBuffer> {
  const gibsUrl = `${GIBS_BASE}/${z}/${y}/${x}.png`
  const res = await fetch(gibsUrl)
  if (!res.ok) return EMPTY_PNG.buffer.slice(0)

  const blob = await res.blob()
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = TILE
  canvas.height = TILE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    bitmap.close()
    throw new Error('pl map overlay: no 2d context')
  }
  // GIBS tiles are already 256; draw 1:1 so neighbour edges stay bit-aligned.
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(bitmap, 0, 0, TILE, TILE)
  bitmap.close()

  const img = ctx.getImageData(0, 0, TILE, TILE)
  const data = img.data
  const n = TILE * TILE
  for (let i = 0; i < n; i += 1) {
    const o = i * 4
    const painted = colorizePlMapPixel(
      glowFromBlackMarbleRgb(
        data[o]! / 255,
        data[o + 1]! / 255,
        data[o + 2]! / 255,
      ),
    )
    if (!painted) {
      data[o] = 0
      data[o + 1] = 0
      data[o + 2] = 0
      data[o + 3] = 0
      continue
    }
    data[o] = painted.r
    data[o + 1] = painted.g
    data[o + 2] = painted.b
    data[o + 3] = painted.a
  }
  ctx.putImageData(img, 0, 0)
  return canvasToPng(canvas)
}

async function renderPlMapTile(
  z: number,
  x: number,
  y: number,
): Promise<ArrayBuffer> {
  const cacheKey = `${z}/${x}/${y}`
  const cached = tileCache.get(cacheKey)
  if (cached) return cached

  return withTileSlot(async () => {
    const again = tileCache.get(cacheKey)
    if (again) return again

    let data: ArrayBuffer
    const rawUrl = lightPollutionCogUrl()
    const cogUrl = rawUrl ? resolveLightPollutionCogUrl(rawUrl) : null

    if (z < COG_DETAIL_MIN_ZOOM) {
      data = await renderOverviewHeatmap(z, x, y)
    } else if (cogUrl && (await probeCog(cogUrl))) {
      try {
        data = (await renderFromCog(z, x, y, cogUrl)) ?? EMPTY_PNG.buffer.slice(0)
      } catch (error) {
        console.warn('[pl-map] COG tile failed', z, x, y, error)
        return EMPTY_PNG.buffer.slice(0)
      }
    } else if (z <= 8) {
      data = await renderOverviewHeatmap(z, x, y)
    } else {
      return EMPTY_PNG.buffer.slice(0)
    }

    if (tileCache.size >= TILE_CACHE_MAX) {
      const first = tileCache.keys().next().value
      if (first != null) tileCache.delete(first)
    }
    tileCache.set(cacheKey, data)
    return data
  })
}

export function ensurePlMapOverlayProtocol(): void {
  if (registeredName === PL_MAP_OVERLAY_PROTOCOL) return
  if (registeredName) {
    try {
      maplibregl.removeProtocol(registeredName)
    } catch {
      // gone
    }
    tileCache.clear()
    cogLive = null
  }
  maplibregl.addProtocol(PL_MAP_OVERLAY_PROTOCOL, async (params) => {
    const parsed = parseTileUrl(params.url)
    if (!parsed) throw new Error(`Bad pl-map URL: ${params.url}`)
    const data = await renderPlMapTile(parsed.z, parsed.x, parsed.y)
    return { data }
  })
  registeredName = PL_MAP_OVERLAY_PROTOCOL
}
