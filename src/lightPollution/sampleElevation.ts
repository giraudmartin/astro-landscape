/**
 * Point elevation from Mapterhorn Terrarium WebP tiles (same source as the map DEM).
 * Used to occlude light-pollution rings behind ridges and to draw an LPM-like
 * terrain horizon on the all-sky chart.
 */

const MAPTERHORN_TILE = 'https://tiles.mapterhorn.com'
/** Coarse enough for 10–360 km PL rings; keeps tile fan-out sane. */
export const LP_DEM_ZOOM = 9

const tileCache = new Map<string, Promise<ImageData | null>>()
const elevCache = new Map<string, number | null>()

function lonLatToTileXY(
  lon: number,
  lat: number,
  z: number,
): { x: number; y: number; n: number } {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  )
  return {
    x: ((x % n) + n) % n,
    y: Math.min(n - 1, Math.max(0, y)),
    n,
  }
}

/** Terrarium encoding: elev_m = (R*256 + G + B/256) - 32768 */
export function elevFromTerrariumRgb(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}

async function loadDemTile(z: number, x: number, y: number): Promise<ImageData | null> {
  const key = `${z}/${x}/${y}`
  const hit = tileCache.get(key)
  if (hit) return hit
  const pending = (async () => {
    try {
      const res = await fetch(`${MAPTERHORN_TILE}/${z}/${x}/${y}.webp`)
      if (!res.ok) return null
      const blob = await res.blob()
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        bitmap.close()
        return null
      }
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      return ctx.getImageData(0, 0, canvas.width, canvas.height)
    } catch {
      return null
    }
  })()
  tileCache.set(key, pending)
  return pending
}

/**
 * MSL elevation (m) at lon/lat, or null if the DEM tile is missing.
 */
export async function sampleElevationM(
  lat: number,
  lon: number,
  zoom = LP_DEM_ZOOM,
): Promise<number | null> {
  const qLat = Math.round(lat * 2000) / 2000
  const qLon = Math.round(lon * 2000) / 2000
  const cacheKey = `${zoom}:${qLat},${qLon}`
  if (elevCache.has(cacheKey)) return elevCache.get(cacheKey)!

  const { x, y, n } = lonLatToTileXY(lon, lat, zoom)
  const image = await loadDemTile(zoom, x, y)
  if (!image) {
    elevCache.set(cacheKey, null)
    return null
  }
  const worldX = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const worldY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const px = Math.min(
    image.width - 1,
    Math.max(0, Math.floor((worldX - x) * image.width)),
  )
  const py = Math.min(
    image.height - 1,
    Math.max(0, Math.floor((worldY - y) * image.height)),
  )
  const i = (py * image.width + px) * 4
  const elev = elevFromTerrariumRgb(
    image.data[i]!,
    image.data[i + 1]!,
    image.data[i + 2]!,
  )
  if (!Number.isFinite(elev) || elev < -500 || elev > 9000) {
    elevCache.set(cacheKey, null)
    return null
  }
  elevCache.set(cacheKey, elev)
  return elev
}

export function offsetLatLonKm(
  lat: number,
  lon: number,
  distanceKm: number,
  azimuthDegCwFromNorth: number,
): { lat: number; lon: number } {
  const az = (azimuthDegCwFromNorth * Math.PI) / 180
  const dLat = (distanceKm / 111.32) * Math.cos(az)
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const dLon =
    cosLat > 1e-6
      ? (distanceKm / (111.32 * cosLat)) * Math.sin(az)
      : 0
  let nextLon = lon + dLon
  if (nextLon > 180) nextLon -= 360
  if (nextLon < -180) nextLon += 360
  return {
    lat: Math.max(-85, Math.min(85, lat + dLat)),
    lon: nextLon,
  }
}

/** Elevation angle (deg) of a point at `distKm`, height `targetElevM`, from eye. */
export function elevationAngleDeg(
  eyeElevM: number,
  targetElevM: number,
  distKm: number,
): number {
  const d = Math.max(0.05, distKm) * 1000
  return (Math.atan2(targetElevM - eyeElevM, d) * 180) / Math.PI
}

/**
 * Max terrain elevation angle along a ground track (ridge finder).
 * `stepKm` denser for painted silhouettes; coarser for ring occlusion.
 */
export async function maxTerrainElevAngleDeg(
  lat: number,
  lon: number,
  eyeElevM: number,
  azDeg: number,
  maxKm: number,
  stepKm = 25,
): Promise<number> {
  const step = Math.max(4, stepKm)
  const steps = Math.max(3, Math.min(20, Math.ceil(maxKm / step)))
  let maxAng = -90
  for (let s = 1; s <= steps; s++) {
    const km = (maxKm * s) / steps
    const p = offsetLatLonKm(lat, lon, km, azDeg)
    const elev = await sampleElevationM(p.lat, p.lon)
    if (elev == null) continue
    const ang = elevationAngleDeg(eyeElevM, elev, km)
    if (ang > maxAng) maxAng = ang
  }
  return maxAng
}

/**
 * How much of a distant light still reaches the observer past terrain.
 * 1 = clear line / no DEM; ~0 = buried behind a high ridge.
 * Soft (not binary): scattered sky glow leaks over ridges.
 */
export function ridgeTransmission(
  eyeElevM: number,
  sourceElevM: number,
  sourceKm: number,
  ridgeMaxAngDeg: number,
): number {
  const sourceAng = elevationAngleDeg(eyeElevM, sourceElevM, sourceKm)
  // Clearance: positive → source above ridge line.
  const clearance = sourceAng - ridgeMaxAngDeg
  if (clearance >= 1.5) return 1
  if (clearance <= -8) return 0.08
  // Softstep from buried → clear.
  const t = (clearance + 8) / 9.5
  return 0.08 + 0.92 * t * t * (3 - 2 * t)
}
