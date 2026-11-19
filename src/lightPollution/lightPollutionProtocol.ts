/**
 * GIBS Black Marble → transparent night lights.
 * Dark pixels become alpha 0; remaining glow is gated by the solar terminator
 * so city lights read on the globe’s night side only.
 */
import * as maplibregl from 'maplibre-gl'
import { fillSolarGrid, subsolarPoint } from '../nightShadeProtocol'
/** Annual composite year used in the GIBS time dimension. */
export const LIGHT_POLLUTION_YEAR = '2016-01-01'

export const LIGHT_POLLUTION_PROTOCOL = 'astro-lightpollution'
export const LIGHT_POLLUTION_PROTOCOL_URL = `${LIGHT_POLLUTION_PROTOCOL}://{z}/{x}/{y}?t={t}`

const TILE = 256
const GIBS_BASE =
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/${LIGHT_POLLUTION_YEAR}/GoogleMapsCompatible_Level8`

let registered = false

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

/** 0 = day face, 1 = deep night — lights only where this is high. */
export function lightNightGate(sunAltDeg: number): number {
  if (sunAltDeg >= 4) return 0
  if (sunAltDeg <= -12) return 1
  if (sunAltDeg >= 0) return 0.35 * (1 - sunAltDeg / 4)
  return 0.35 + 0.65 * clamp01(-sunAltDeg / 12)
}

function parseTileUrl(url: string): {
  z: number
  x: number
  y: number
  t: number
} | null {
  const match =
    /^astro-lightpollution:\/\/(\d+)\/(\d+)\/(\d+)(?:\?t=(\d+))?/.exec(url)
  if (!match) return null
  return {
    z: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3]),
    t: Number(match[4] ?? Date.now()),
  }
}

const EMPTY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
])

// 32 decoded RGBA tiles at 256 x 256 = 8 MiB. Keep the source alpha immutable.
const sourcePixels = new Map<string, Uint8ClampedArray>()

async function renderLightTile(
  z: number,
  x: number,
  y: number,
  utcMs: number,
): Promise<ArrayBuffer> {
  // GIBS WMTS is {z}/{TileRow}/{TileCol} = {z}/{y}/{x}
  const gibsUrl = `${GIBS_BASE}/${z}/${y}/${x}.png`
  const canvas = document.createElement('canvas')
  canvas.width = TILE
  canvas.height = TILE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('light pollution: no 2d context')
  let pixels = sourcePixels.get(gibsUrl)
  let img: ImageData
  if (pixels) {
    sourcePixels.delete(gibsUrl)
    sourcePixels.set(gibsUrl, pixels)
    img = ctx.createImageData(TILE, TILE)
    img.data.set(pixels)
  } else {
    const res = await fetch(gibsUrl)
    if (!res.ok) return EMPTY_PNG.buffer.slice(0)
    const bitmap = await createImageBitmap(await res.blob())
    try {
      ctx.drawImage(bitmap, 0, 0, TILE, TILE)
    } finally {
      bitmap.close()
    }
    img = ctx.getImageData(0, 0, TILE, TILE)
    pixels = img.data.slice()
    sourcePixels.set(gibsUrl, pixels)
    if (sourcePixels.size > 32) sourcePixels.delete(sourcePixels.keys().next().value!)
  }
  const data = img.data
  const subsolar = subsolarPoint(utcMs)

  // Sample terminator on a coarse grid then nearest-neighbor per pixel (cheap).
  const STEP = 4
  const coarse = TILE / STEP
  const gates = new Float32Array(coarse * coarse)
  fillSolarGrid(z, x, y, subsolar, (index, altitude) => {
    gates[index] = lightNightGate(altitude)
  })

  for (let py = 0; py < TILE; py += 1) {
    const cy = Math.min(coarse - 1, (py / STEP) | 0)
    for (let px = 0; px < TILE; px += 1) {
      const i = (py * TILE + px) * 4
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      const r01 = r / 255
      const g01 = g / 255
      const b01 = b / 255
      const luma = 0.2126 * r01 + 0.7152 * g01 + 0.0722 * b01
      const avg = (r01 + g01 + b01) / 3
      // GIBS Black Marble unlit land is navy (not black) — punch it out.
      const blueDom = b01 >= r01 - 0.02 && b01 >= g01 - 0.02
      if (luma < 0.035 || (blueDom && avg < 0.28) || luma < 0.155) {
        data[i + 3] = 0
        continue
      }
      const cx = Math.min(coarse - 1, (px / STEP) | 0)
      const night = gates[cy * coarse + cx]!
      if (night < 0.02) {
        data[i + 3] = 0
        continue
      }
      const excess = (luma - 0.155) / (1 - 0.155)
      const glow = Math.pow(Math.min(1, Math.max(0, excess)), 0.75)
      data[i + 3] = Math.round(255 * glow * night)
    }
  }

  ctx.putImageData(img, 0, 0)
  const out = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('toBlob failed'))),
      'image/png',
    )
  })
  return out.arrayBuffer()
}

export function ensureLightPollutionProtocol(): void {
  if (registered) return
  registered = true
  maplibregl.addProtocol(LIGHT_POLLUTION_PROTOCOL, async (params) => {
    const parsed = parseTileUrl(params.url)
    if (!parsed) throw new Error(`Bad light-pollution URL: ${params.url}`)
    if (parsed.z > 8) {
      return { data: EMPTY_PNG.buffer.slice(0) }
    }
    const data = await renderLightTile(
      parsed.z,
      parsed.x,
      parsed.y,
      parsed.t,
    )
    return { data }
  })
}

export function lightPollutionTileUrl(utcMs: number): string {
  const bucket = Math.floor(utcMs / 120_000) * 120_000
  return `${LIGHT_POLLUTION_PROTOCOL}://{z}/{x}/{y}?t=${bucket}`
}
