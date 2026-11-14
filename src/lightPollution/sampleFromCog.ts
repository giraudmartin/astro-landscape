import { fromUrl, type GeoTIFF, type GeoTIFFImage } from 'geotiff'
import {
  bortleFromRadiance,
  bortleLabelFr,
  clampBortle,
  skyBrightnessMagFromRadiance,
} from './bortleFromRadiance'
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
}

let cogPromise: Promise<CogHandle | null> | null = null
let cogFailedUrl: string | null = null

async function openCog(url: string): Promise<CogHandle | null> {
  if (cogFailedUrl === url) return null
  try {
    // Probe first — avoid geotiff throwing on missing public asset.
    const head = await fetch(url, { method: 'HEAD' })
    if (!head.ok) {
      // Some hosts reject HEAD; try a tiny ranged GET.
      const probe = await fetch(url, {
        headers: { Range: 'bytes=0-0' },
      })
      if (!probe.ok && probe.status !== 206) {
        cogFailedUrl = url
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
    return {
      url,
      tiff,
      image,
      west,
      south,
      east,
      north,
      width: image.getWidth(),
      height: image.getHeight(),
    }
  } catch {
    cogFailedUrl = url
    return null
  }
}

function getCog(url: string): Promise<CogHandle | null> {
  if (!cogPromise) {
    cogPromise = openCog(url).then((handle) => {
      if (!handle) cogPromise = null
      return handle
    })
  }
  return cogPromise
}

/**
 * Sample VIIRS radiance (nW/cm²/sr) from an EOG COG at lon/lat.
 * Returns null if the COG is missing or the point is outside coverage.
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

  const fx = ((lon - cog.west) / (cog.east - cog.west)) * cog.width
  // GeoTIFF rows usually start at north.
  const fy = ((cog.north - lat) / (cog.north - cog.south)) * cog.height
  const px = Math.min(cog.width - 1, Math.max(0, Math.floor(fx)))
  const py = Math.min(cog.height - 1, Math.max(0, Math.floor(fy)))

  try {
    const rasters = await cog.image.readRasters({
      window: [px, py, px + 1, py + 1],
      width: 1,
      height: 1,
    })
    // geotiff returns one TypedArray per band.
    const band0 = (rasters as ArrayLike<ArrayLike<number>>)[0]
    if (!band0 || band0.length < 1) return null
    const value = Number(band0[0])
    if (!Number.isFinite(value)) return null
    // Nodata often -9999
    if (value < -1e3) return 0
    if (value < 0) return 0
    return value
  } catch {
    return null
  }
}

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
