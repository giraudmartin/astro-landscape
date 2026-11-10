/**
 * Procedural night-side veil for the globe (makewithmaplibre-style).
 * Each pixel's alpha follows solar altitude vs the subsolar point so the
 * night hemisphere reads as night, not soft 3D shade.
 */
import * as maplibregl from 'maplibre-gl'
import {
  Body,
  Equator,
  Observer,
  SiderealTime,
} from 'astronomy-engine'

export const NIGHT_SHADE_PROTOCOL = 'astro-nightshade'
export const NIGHT_SHADE_SOURCE_ID = 'astro-night-shade'
export const NIGHT_SHADE_LAYER_ID = 'astro-night-shade'
/** Tile template — `t` busts the cache when the playhead moves. */
export const NIGHT_SHADE_URL = `${NIGHT_SHADE_PROTOCOL}://{z}/{x}/{y}?t={t}`

const TILE = 256
/** Sample every N pixels then upscale — plenty for globe overview. */
const STEP = 4
const RAD = Math.PI / 180
const GEOCENTRIC = new Observer(0, 0, 0)

type LngLat = { lon: number; lat: number }

let registered = false

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function wrapLon(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180
}

function subsolarPoint(utcMs: number): LngLat {
  const at = new Date(utcMs)
  const eq = Equator(Body.Sun, at, GEOCENTRIC, true, true)
  return {
    lon: wrapLon(15 * (eq.ra - SiderealTime(at))),
    lat: eq.dec,
  }
}

/** WebMercator tile pixel → lon/lat. */
function pixelToLonLat(
  z: number,
  x: number,
  y: number,
  px: number,
  py: number,
): LngLat {
  const n = 2 ** z
  const lon = ((x + px / TILE) / n) * 360 - 180
  const mercY = Math.PI * (1 - (2 * (y + py / TILE)) / n)
  const lat =
    (2 * Math.atan(Math.exp(mercY)) * 180) / Math.PI - 90
  return { lon, lat: Math.max(-85.0511, Math.min(85.0511, lat)) }
}

/** Sun altitude at a place given the subsolar point (°). */
export function sunAltitudeFromSubsolar(
  place: LngLat,
  subsolar: LngLat,
): number {
  const lat1 = place.lat * RAD
  const lat2 = subsolar.lat * RAD
  const dLon = (subsolar.lon - place.lon) * RAD
  const cosAng =
    Math.sin(lat1) * Math.sin(lat2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon)
  const ang = Math.acos(Math.max(-1, Math.min(1, cosAng))) / RAD
  return 90 - ang
}

/**
 * Night veil opacity 0..1.
 * Day (>6°) clear; nautical night (≤−12°) strong dark; soft terminator band.
 */
export function nightVeilOpacity(sunAltDeg: number): number {
  if (sunAltDeg >= 6) return 0
  if (sunAltDeg <= -12) return 0.78
  // 6° → 0, 0° → ~0.35, −6° → ~0.58, −12° → 0.78
  if (sunAltDeg >= 0) {
    return 0.35 * (1 - smoothstep(0, 6, sunAltDeg))
  }
  return 0.35 + 0.43 * smoothstep(0, -12, sunAltDeg)
}

function parseTileUrl(url: string): {
  z: number
  x: number
  y: number
  t: number
} | null {
  const match = /^astro-nightshade:\/\/(\d+)\/(\d+)\/(\d+)(?:\?t=(\d+))?/.exec(
    url,
  )
  if (!match) return null
  return {
    z: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3]),
    t: Number(match[4] ?? Date.now()),
  }
}

async function renderShadeTile(
  z: number,
  x: number,
  y: number,
  utcMs: number,
): Promise<ArrayBuffer> {
  const subsolar = subsolarPoint(utcMs)
  const canvas = document.createElement('canvas')
  canvas.width = TILE
  canvas.height = TILE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('night shade: no 2d context')

  const coarse = TILE / STEP
  const img = ctx.createImageData(coarse, coarse)
  const data = img.data

  for (let cy = 0; cy < coarse; cy += 1) {
    for (let cx = 0; cx < coarse; cx += 1) {
      const place = pixelToLonLat(
        z,
        x,
        y,
        (cx + 0.5) * STEP,
        (cy + 0.5) * STEP,
      )
      const alt = sunAltitudeFromSubsolar(place, subsolar)
      const a = Math.round(255 * nightVeilOpacity(alt))
      const i = (cy * coarse + cx) * 4
      // Cool night navy, not pure black — keeps terrain readable.
      data[i] = 4
      data[i + 1] = 8
      data[i + 2] = 18
      data[i + 3] = a
    }
  }

  // Draw coarse buffer scaled up with smoothing for a soft terminator.
  const tmp = document.createElement('canvas')
  tmp.width = coarse
  tmp.height = coarse
  const tmpCtx = tmp.getContext('2d')
  if (!tmpCtx) throw new Error('night shade: no tmp context')
  tmpCtx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.clearRect(0, 0, TILE, TILE)
  ctx.drawImage(tmp, 0, 0, TILE, TILE)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('toBlob failed'))),
      'image/png',
    )
  })
  return blob.arrayBuffer()
}

export function ensureNightShadeProtocol(): void {
  if (registered) return
  registered = true
  maplibregl.addProtocol(NIGHT_SHADE_PROTOCOL, async (params) => {
    const parsed = parseTileUrl(params.url)
    if (!parsed) throw new Error(`Bad night-shade URL: ${params.url}`)
    // Only useful on the globe; refuse very deep zooms to save CPU.
    if (parsed.z > 7) {
      const empty = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
        0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ])
      return { data: empty.buffer }
    }
    const data = await renderShadeTile(parsed.z, parsed.x, parsed.y, parsed.t)
    return { data }
  })
}

export function nightShadeTileUrl(utcMs: number): string {
  // Quantize to 2 min so tiny playhead ticks don't thrash the tile cache.
  const bucket = Math.floor(utcMs / 120_000) * 120_000
  return `${NIGHT_SHADE_PROTOCOL}://{z}/{x}/{y}?t=${bucket}`
}
