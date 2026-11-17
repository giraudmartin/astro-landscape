import { fromUrl, type GeoTIFF, type GeoTIFFImage } from 'geotiff'
import {
  bortleFromRadiance,
  bortleLabelFr,
  clampBortle,
  skyBrightnessMagFromRadiance,
} from './bortleFromRadiance'
import {
  DURISCOE_MAX_KM,
  cellAreaKm2,
  cellContribution,
  horizonDistanceWeight,
  skyBrightnessMagFromSumS,
  zlrFromSumS,
} from './duriscoeZenith'
import {
  buildTerrainGateLut,
  highObserverNearFade,
  terrainGateAt,
  type TerrainGateLut,
} from './terrainGate'
import type { LightPollutionSample } from './types'

type CogHandle = {
  url: string
  tiff: GeoTIFF
  image: GeoTIFFImage
  west: number
  south: number
  east: number
  north: number
  width: number
  height: number
  /** Degrees per pixel (lon). */
  resDeg: number
}

const cogByUrl = new Map<string, Promise<CogHandle | null>>()
const cogFailed = new Set<string>()

async function openCog(url: string): Promise<CogHandle | null> {
  if (cogFailed.has(url)) return null
  try {
    const head = await fetch(url, { method: 'HEAD' })
    if (!head.ok) {
      const probe = await fetch(url, {
        headers: { Range: 'bytes=0-0' },
      })
      if (!probe.ok && probe.status !== 206) {
        cogFailed.add(url)
        return null
      }
    }
    const tiff = await fromUrl(url)
    const image = await tiff.getImage()
    const bbox = image.getBoundingBox()
    const west = bbox[0]!
    const south = bbox[1]!
    const east = bbox[2]!
    const north = bbox[3]!
    const width = image.getWidth()
    const height = image.getHeight()
    const resDeg = (east - west) / width
    return {
      url,
      tiff,
      image,
      west,
      south,
      east,
      north,
      width,
      height,
      resDeg,
    }
  } catch {
    cogFailed.add(url)
    return null
  }
}

function getCog(url: string): Promise<CogHandle | null> {
  let pending = cogByUrl.get(url)
  if (!pending) {
    pending = openCog(url).then((handle) => {
      if (!handle) cogByUrl.delete(url)
      return handle
    })
    cogByUrl.set(url, pending)
  }
  return pending
}

function lonLatToPixel(
  cog: CogHandle,
  lat: number,
  lon: number,
): { px: number; py: number } {
  const fx = ((lon - cog.west) / (cog.east - cog.west)) * cog.width
  const fy = ((cog.north - lat) / (cog.north - cog.south)) * cog.height
  return {
    px: Math.min(cog.width - 1, Math.max(0, Math.floor(fx))),
    py: Math.min(cog.height - 1, Math.max(0, Math.floor(fy))),
  }
}

function pixelCenterLatLon(
  cog: CogHandle,
  px: number,
  py: number,
): { lat: number; lon: number } {
  const lon = cog.west + ((px + 0.5) / cog.width) * (cog.east - cog.west)
  const lat = cog.north - ((py + 0.5) / cog.height) * (cog.north - cog.south)
  return { lat, lon }
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const r = 6371
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dphi = ((lat2 - lat1) * Math.PI) / 180
  const dl = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Decode one VIIRS DN to radiance (nW cm⁻² sr⁻¹).
 *
 * The Zenodo Hengl 2024 COG ships int16 with a GeoTIFF Scale tag of 10.
 * Applying that scale makes Paris ~740 nW (nonsense). Raw DN matches EOG
 * nW units (Paris ~74, Chamonix ~23) and First Rig / LPM city anchors —
 * so we **ignore** Scale and treat DN as nW. See docs/LIGHT_POLLUTION.md.
 */
export function viirsDnToRadianceNw(dn: number): number | null {
  if (!Number.isFinite(dn)) return null
  if (dn < -1e3) return 0 // nodata family
  if (dn < 0) return 0
  return dn
}

/**
 * Sample VIIRS radiance (nW/cm²/sr) from the COG at lon/lat.
 */
export async function sampleRadianceFromCog(
  lat: number,
  lon: number,
  url: string,
): Promise<number | null> {
  const cog = await getCog(url)
  if (!cog) return null
  if (lon < cog.west || lon > cog.east || lat < cog.south || lat > cog.north) {
    return null
  }
  const { px, py } = lonLatToPixel(cog, lat, lon)
  try {
    const rasters = await cog.image.readRasters({
      window: [px, py, px + 1, py + 1],
      width: 1,
      height: 1,
    })
    const band0 = (rasters as ArrayLike<ArrayLike<number>>)[0]
    if (!band0 || band0.length < 1) return null
    return viirsDnToRadianceNw(Number(band0[0]))
  } catch {
    return null
  }
}

export type RadianceWindow = {
  /** Radiance nW cm⁻² sr⁻¹, row-major, length = width * height. */
  radiance: Float32Array
  width: number
  height: number
  west: number
  east: number
  south: number
  north: number
}

/**
 * Read a geographic window of VIIRS radiance around (lat, lon) covering ±radiusM.
 * Used by the immersive ground-lights atlas (ENU resample).
 */
export async function readRadianceWindowFromCog(
  lat: number,
  lon: number,
  radiusM: number,
  url: string,
): Promise<RadianceWindow | null> {
  const cog = await getCog(url)
  if (!cog) return null
  if (lon < cog.west || lon > cog.east || lat < cog.south || lat > cog.north) {
    return null
  }

  const radiusKm = Math.max(1, radiusM / 1000)
  const dlat = radiusKm / 111.32
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180))
  const dlon = radiusKm / (111.32 * cosLat)
  const west = Math.max(cog.west, lon - dlon)
  const east = Math.min(cog.east, lon + dlon)
  const south = Math.max(cog.south, lat - dlat)
  const north = Math.min(cog.north, lat + dlat)

  const x0 = Math.floor(((west - cog.west) / (cog.east - cog.west)) * cog.width)
  const x1 = Math.ceil(((east - cog.west) / (cog.east - cog.west)) * cog.width)
  const y0 = Math.floor(
    ((cog.north - north) / (cog.north - cog.south)) * cog.height,
  )
  const y1 = Math.ceil(
    ((cog.north - south) / (cog.north - cog.south)) * cog.height,
  )
  const winX0 = Math.max(0, x0)
  const winY0 = Math.max(0, y0)
  const winX1 = Math.min(cog.width, x1)
  const winY1 = Math.min(cog.height, y1)
  const winW = winX1 - winX0
  const winH = winY1 - winY0
  if (winW < 1 || winH < 1) return null

  let band: ArrayLike<number>
  try {
    const rasters = await cog.image.readRasters({
      window: [winX0, winY0, winX1, winY1],
      width: winW,
      height: winH,
    })
    band = (rasters as ArrayLike<ArrayLike<number>>)[0]!
  } catch {
    return null
  }
  if (!band || band.length < winW * winH) return null

  const radiance = new Float32Array(winW * winH)
  for (let i = 0; i < radiance.length; i++) {
    radiance[i] = viirsDnToRadianceNw(Number(band[i])) ?? 0
  }

  // Exact geo bounds of the pixel window (outer edges).
  const outWest = cog.west + (winX0 / cog.width) * (cog.east - cog.west)
  const outEast = cog.west + (winX1 / cog.width) * (cog.east - cog.west)
  const outNorth = cog.north - (winY0 / cog.height) * (cog.north - cog.south)
  const outSouth = cog.north - (winY1 / cog.height) * (cog.north - cog.south)

  return {
    radiance,
    width: winW,
    height: winH,
    west: outWest,
    east: outEast,
    south: outSouth,
    north: outNorth,
  }
}

export type NativeRasterWindow = {
  /** Native DN (= nW/cm²/sr, see {@link viirsDnToRadianceNw}); NoData kept. */
  values: Float32Array
  width: number
  height: number
  /** GDAL geotransform of the window: [west, dx, 0, north, 0, dy<0]. */
  geotransform: [number, number, number, number, number, number]
  nodata: number
}

/**
 * Native pixels covering a lon/lat box — no resampling, no NoData → 0.
 * Feeds the local halo field and its ground diagnostic.
 */
export async function readNativeRasterWindowFromCog(
  bbox: { west: number; south: number; east: number; north: number },
  url: string,
): Promise<NativeRasterWindow | null> {
  const cog = await getCog(url)
  if (!cog) return null
  const dx = (cog.east - cog.west) / cog.width
  const dy = (cog.north - cog.south) / cog.height
  const x0 = Math.max(0, Math.floor((bbox.west - cog.west) / dx))
  const x1 = Math.min(cog.width, Math.ceil((bbox.east - cog.west) / dx))
  const y0 = Math.max(0, Math.floor((cog.north - bbox.north) / dy))
  const y1 = Math.min(cog.height, Math.ceil((cog.north - bbox.south) / dy))
  const w = x1 - x0
  const h = y1 - y0
  if (w < 1 || h < 1) return null
  let band: ArrayLike<number>
  try {
    const rasters = await cog.image.readRasters({
      window: [x0, y0, x1, y1],
      width: w,
      height: h,
    })
    band = (rasters as ArrayLike<ArrayLike<number>>)[0]!
  } catch {
    return null
  }
  if (!band || band.length < w * h) return null
  const gdalNoData = cog.image.getGDALNoData()
  const nodata = gdalNoData != null && Number.isFinite(gdalNoData) ? gdalNoData : -32768
  return {
    values: Float32Array.from(band as ArrayLike<number>),
    width: w,
    height: h,
    geotransform: [cog.west + x0 * dx, dx, 0, cog.north - y0 * dy, 0, -dy],
    nodata,
  }
}

/** Bilinear sample of a {@link RadianceWindow} at lon/lat (0 outside). */
export function sampleRadianceWindow(
  win: RadianceWindow,
  lat: number,
  lon: number,
): number {
  if (
    lon < win.west ||
    lon > win.east ||
    lat < win.south ||
    lat > win.north ||
    win.width < 1 ||
    win.height < 1
  ) {
    return 0
  }
  const fx = ((lon - win.west) / (win.east - win.west)) * win.width - 0.5
  const fy = ((win.north - lat) / (win.north - win.south)) * win.height - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = x0 + 1
  const y1 = y0 + 1
  const tx = fx - x0
  const ty = fy - y0
  const at = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= win.width || y >= win.height) return 0
    return win.radiance[y * win.width + x]!
  }
  const v00 = at(x0, y0)
  const v10 = at(x1, y0)
  const v01 = at(x0, y1)
  const v11 = at(x1, y1)
  return (
    v00 * (1 - tx) * (1 - ty) +
    v10 * tx * (1 - ty) +
    v01 * (1 - tx) * ty +
    v11 * tx * ty
  )
}

export type FirstRigCogResult = {
  sumS: number
  zlr: number
  skyBrightnessMag: number
  localRadiance: number
  cellsUsed: number
  terrainApplied: boolean
}

export type SumFirstRigOptions = {
  observerElevM?: number
  /** Default true when observerElevM ≥ 900 m. */
  useTerrain?: boolean
}

/**
 * Full First Rig zenith sum over every VIIRS cell within 300 km.
 * Optional DEM near-field gates for alpine / high observers.
 */
export async function sumFirstRigFromCog(
  lat: number,
  lon: number,
  url: string,
  options?: SumFirstRigOptions,
): Promise<FirstRigCogResult | null> {
  const cog = await getCog(url)
  if (!cog) return null
  if (lon < cog.west || lon > cog.east || lat < cog.south || lat > cog.north) {
    return null
  }

  const dlat = DURISCOE_MAX_KM / 111.32
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180))
  const dlon = DURISCOE_MAX_KM / (111.32 * cosLat)
  const west = Math.max(cog.west, lon - dlon)
  const east = Math.min(cog.east, lon + dlon)
  const south = Math.max(cog.south, lat - dlat)
  const north = Math.min(cog.north, lat + dlat)

  const x0 = Math.floor(((west - cog.west) / (cog.east - cog.west)) * cog.width)
  const x1 = Math.ceil(((east - cog.west) / (cog.east - cog.west)) * cog.width)
  const y0 = Math.floor(((cog.north - north) / (cog.north - cog.south)) * cog.height)
  const y1 = Math.ceil(((cog.north - south) / (cog.north - cog.south)) * cog.height)
  const winX0 = Math.max(0, x0)
  const winY0 = Math.max(0, y0)
  const winX1 = Math.min(cog.width, x1)
  const winY1 = Math.min(cog.height, y1)
  const winW = winX1 - winX0
  const winH = winY1 - winY0
  if (winW < 1 || winH < 1) return null

  let band: ArrayLike<number>
  try {
    const rasters = await cog.image.readRasters({
      window: [winX0, winY0, winX1, winY1],
      width: winW,
      height: winH,
    })
    band = (rasters as ArrayLike<ArrayLike<number>>)[0]!
  } catch {
    return null
  }
  if (!band || band.length < winW * winH) return null

  const eyeElevM =
    options?.observerElevM != null && Number.isFinite(options.observerElevM)
      ? options.observerElevM
      : undefined
  const wantTerrain =
    options?.useTerrain !== false && eyeElevM != null && eyeElevM >= 900
  let terrainLut: TerrainGateLut | null = null
  if (wantTerrain && eyeElevM != null) {
    try {
      terrainLut = await buildTerrainGateLut(lat, lon, eyeElevM)
    } catch {
      terrainLut = null
    }
  }

  const minD = Math.max(0.2, cog.resDeg * 111.32 * 0.5)
  let sumS = 0
  let cellsUsed = 0
  let localRadiance = 0

  const { px: localPx, py: localPy } = lonLatToPixel(cog, lat, lon)

  for (let row = 0; row < winH; row++) {
    for (let col = 0; col < winW; col++) {
      const dn = Number(band[row * winW + col])
      const r = viirsDnToRadianceNw(dn)
      if (r == null) continue
      const px = winX0 + col
      const py = winY0 + row
      const { lat: cLat, lon: cLon } = pixelCenterLatLon(cog, px, py)
      const d = haversineKm(lat, lon, cLat, cLon)
      if (d > DURISCOE_MAX_KM) continue
      const A = cellAreaKm2(cog.resDeg, cLat)
      let contrib = cellContribution(r, A, d, minD)
      if (contrib > 0 && (terrainLut || eyeElevM != null)) {
        const az = bearingDegCwFromNorth(lat, lon, cLat, cLon)
        const gate = terrainGateAt(terrainLut, az, d)
        const fade = highObserverNearFade(eyeElevM, d)
        contrib *= gate * fade
      }
      if (contrib > 0) {
        sumS += contrib
        cellsUsed++
      }
      if (px === localPx && py === localPy) localRadiance = r
    }
  }

  return {
    sumS,
    zlr: zlrFromSumS(sumS),
    skyBrightnessMag: skyBrightnessMagFromSumS(sumS),
    localRadiance,
    cellsUsed,
    terrainApplied: terrainLut != null,
  }
}

export type DirectionalCogResult = {
  /** Absolute Duriscoe all-sky wedge sums S(az). */
  bins: Float32Array
  peak: number
  peakAzDeg: number
  cellsUsed: number
}

function bearingDegCwFromNorth(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dl = ((lon2 - lon1) * Math.PI) / 180
  const x = Math.sin(dl) * Math.cos(p2)
  const y =
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
}

/**
 * Directional Duriscoe **all-sky** sum per azimuth wedge (horizon / domes).
 * Steeper First Rig zenith kernel is intentionally NOT used here — distant
 * cities dominate horizon lobes.
 */
export async function sumDirectionalFromCog(
  lat: number,
  lon: number,
  url: string,
  azBins = 64,
): Promise<DirectionalCogResult | null> {
  const cog = await getCog(url)
  if (!cog) return null
  if (lon < cog.west || lon > cog.east || lat < cog.south || lat > cog.north) {
    return null
  }

  const dlat = DURISCOE_MAX_KM / 111.32
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180))
  const dlon = DURISCOE_MAX_KM / (111.32 * cosLat)
  const west = Math.max(cog.west, lon - dlon)
  const east = Math.min(cog.east, lon + dlon)
  const south = Math.max(cog.south, lat - dlat)
  const north = Math.min(cog.north, lat + dlat)

  const x0 = Math.floor(((west - cog.west) / (cog.east - cog.west)) * cog.width)
  const x1 = Math.ceil(((east - cog.west) / (cog.east - cog.west)) * cog.width)
  const y0 = Math.floor(
    ((cog.north - north) / (cog.north - cog.south)) * cog.height,
  )
  const y1 = Math.ceil(
    ((cog.north - south) / (cog.north - cog.south)) * cog.height,
  )
  const winX0 = Math.max(0, x0)
  const winY0 = Math.max(0, y0)
  const winX1 = Math.min(cog.width, x1)
  const winY1 = Math.min(cog.height, y1)
  const winW = winX1 - winX0
  const winH = winY1 - winY0
  if (winW < 1 || winH < 1) return null

  let band: ArrayLike<number>
  try {
    const rasters = await cog.image.readRasters({
      window: [winX0, winY0, winX1, winY1],
      width: winW,
      height: winH,
    })
    band = (rasters as ArrayLike<ArrayLike<number>>)[0]!
  } catch {
    return null
  }
  if (!band || band.length < winW * winH) return null

  const minD = Math.max(0.2, cog.resDeg * 111.32 * 0.5)
  const bins = new Float32Array(azBins)
  let cellsUsed = 0

  for (let row = 0; row < winH; row++) {
    for (let col = 0; col < winW; col++) {
      const r = viirsDnToRadianceNw(Number(band[row * winW + col]))
      if (r == null || r < 0.5) continue
      const px = winX0 + col
      const py = winY0 + row
      const { lat: cLat, lon: cLon } = pixelCenterLatLon(cog, px, py)
      const d = haversineKm(lat, lon, cLat, cLon)
      // Skip the observer neighbourhood — direction comes from towns, not the pin.
      if (!(d >= 2) || d > DURISCOE_MAX_KM) continue
      const k = horizonDistanceWeight(d, minD)
      if (k <= 0) continue
      const A = cellAreaKm2(cog.resDeg, cLat)
      const contrib = r * A * k
      if (!(contrib > 0)) continue
      const az = bearingDegCwFromNorth(lat, lon, cLat, cLon)
      const bi = Math.min(azBins - 1, Math.floor((az / 360) * azBins))
      bins[bi]! += contrib
      cellsUsed++
    }
  }

  // Light circular smooth (keep lobe peaks sharp enough for Chamonix/Hilo).
  const smoothed = new Float32Array(azBins)
  for (let i = 0; i < azBins; i++) {
    const i0 = (i - 1 + azBins) % azBins
    const i1 = (i + 1) % azBins
    smoothed[i] = 0.2 * bins[i0]! + 0.6 * bins[i]! + 0.2 * bins[i1]!
  }

  let peak = 0
  let peakIdx = 0
  for (let i = 0; i < azBins; i++) {
    if (smoothed[i]! > peak) {
      peak = smoothed[i]!
      peakIdx = i
    }
  }

  return {
    bins: smoothed,
    peak,
    peakAzDeg: (peakIdx / azBins) * 360,
    cellsUsed,
  }
}

/**
 * @deprecated Single-pixel COG → Bortle. Prefer {@link sampleLightPollution}.
 */
export async function sampleBortleFromCog(
  lat: number,
  lon: number,
  url: string,
): Promise<LightPollutionSample | null> {
  const radiance = await sampleRadianceFromCog(lat, lon, url)
  if (radiance == null) return null
  const skyBrightnessMag = skyBrightnessMagFromRadiance(radiance)
  const bortle = clampBortle(bortleFromRadiance(radiance))
  return {
    lat,
    lon,
    luminance01: Math.min(1, radiance / 80),
    radianceNwCm2Sr: radiance,
    skyBrightnessMag,
    bortle,
    bortleLabel: bortleLabelFr(bortle),
    source: 'viirs-cog',
  }
}
