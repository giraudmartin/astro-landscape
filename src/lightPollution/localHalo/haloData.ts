/**
 * Inputs of the local halo field: native VIIRS raster + relief grid.
 *
 * - `reference`: the data embedded in the Chamonix prototype (VIIRS 2025,
 *   its DEM, its local-Mercator frame) — rendering check in isolation.
 * - `app`: our VIIRS COG + the Mapterhorn relief used by the terrain mesh,
 *   in the terrain ENU frame centred on the spot.
 */
import { sampleDemGridMslM } from '../../localTerrainMesh'
import { lightPollutionCogUrl } from '../cogConfig'
import { readNativeRasterWindowFromCog } from '../sampleFromCog'
import {
  collectHaloSources,
  ENU_M_PER_DEG,
  HALO_FIELD_SPEC,
  haloReferenceAltitudeKm,
  haloVolumeBounds,
  type HaloBounds,
  type HaloFieldInput,
  type HaloGroundGrid,
  type HaloProjector,
  type HaloRaster,
  type HaloSource,
} from './haloFieldCore'

export type HaloDataSourceId = 'app' | 'reference'

export type HaloDataset = {
  source: HaloDataSourceId
  label: string
  /** Zone centre (also the projector origin). */
  center: { lat: number; lon: number }
  projector: HaloProjector
  raster: HaloRaster
  ground: HaloGroundGrid
}

export type PreparedHalo = {
  dataset: HaloDataset
  sources: HaloSource[]
  bounds: HaloBounds
  /** Density reference altitude (km MSL) — 1.03 at Chamonix. */
  referenceAltitudeKm: number
  input: HaloFieldInput
}

/** Relief grid: 32 km side for a 24 km zone (8 km of screening margin). */
const GROUND_GRID_SIZE = 512
const GROUND_GRID_EXTENT_KM = 32

export const HALO_REFERENCE_BASE =
  '/light-pollution/reference/chamonix-viirs-2025'

type ReferenceMeta = {
  center: { lat: number; lon: number }
  projector: HaloProjector
  dem: { file: string; size: number; extentKm: number }
  viirs: {
    file: string
    geotransform: HaloRaster['geotransform']
    width: number
    height: number
    nodata: number
    year: number
  }
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.arrayBuffer()
}

export async function loadReferenceHaloDataset(): Promise<HaloDataset> {
  const metaRes = await fetch(`${HALO_REFERENCE_BASE}/meta.json`)
  if (!metaRes.ok) throw new Error(`halo reference meta: HTTP ${metaRes.status}`)
  const meta = (await metaRes.json()) as ReferenceMeta
  const [viirs, dem] = await Promise.all([
    fetchBuffer(`${HALO_REFERENCE_BASE}/${meta.viirs.file}`),
    fetchBuffer(`${HALO_REFERENCE_BASE}/${meta.dem.file}`),
  ])
  const demU16 = new Uint16Array(dem)
  return {
    source: 'reference',
    label: `Référence Chamonix · VIIRS ${meta.viirs.year}`,
    center: meta.center,
    projector: meta.projector,
    raster: {
      values: new Float32Array(viirs),
      width: meta.viirs.width,
      height: meta.viirs.height,
      geotransform: meta.viirs.geotransform,
      nodata: meta.viirs.nodata,
    },
    ground: {
      heightsKm: Float32Array.from(demU16, (v) => v / 10000),
      size: meta.dem.size,
      extentKm: meta.dem.extentKm,
    },
  }
}

export async function loadAppHaloDataset(
  lat: number,
  lon: number,
): Promise<HaloDataset | null> {
  const url = lightPollutionCogUrl()
  if (!url) return null
  const half = HALO_FIELD_SPEC.halfExtentKm * 1000
  // One native pixel of margin so every centre inside the zone is read.
  const margin = 1_000
  const dLat = (half + margin) / ENU_M_PER_DEG
  const dLon =
    (half + margin) / (ENU_M_PER_DEG * Math.cos((lat * Math.PI) / 180))
  const [raster, demM] = await Promise.all([
    readNativeRasterWindowFromCog(
      { west: lon - dLon, east: lon + dLon, south: lat - dLat, north: lat + dLat },
      url,
    ),
    sampleDemGridMslM({
      lat0: lat,
      lon0: lon,
      extentM: GROUND_GRID_EXTENT_KM * 1000,
      size: GROUND_GRID_SIZE,
    }),
  ])
  if (!raster) return null
  const heightsKm = new Float32Array(demM.length)
  let missing = 0
  for (let i = 0; i < demM.length; i++) {
    const m = demM[i]!
    if (Number.isFinite(m)) heightsKm[i] = m / 1000
    else missing++
  }
  // Ocean / missing DEM tiles: sea level, never NaN in the screening loop.
  if (missing > 0) {
    for (let i = 0; i < heightsKm.length; i++) {
      if (!Number.isFinite(demM[i]!)) heightsKm[i] = 0
    }
  }
  return {
    source: 'app',
    label: 'VIIRS VNL 2024 · relief Mapterhorn',
    center: { lat, lon },
    projector: { kind: 'enu', lat0: lat, lon0: lon },
    raster,
    ground: {
      heightsKm,
      size: GROUND_GRID_SIZE,
      extentKm: GROUND_GRID_EXTENT_KM,
    },
  }
}

export function prepareHalo(dataset: HaloDataset): PreparedHalo {
  const sources = collectHaloSources(
    dataset.raster,
    dataset.projector,
    dataset.ground,
  )
  const bounds = haloVolumeBounds(dataset.ground)
  return {
    dataset,
    sources,
    bounds,
    referenceAltitudeKm: haloReferenceAltitudeKm(sources),
    input: { sources, ground: dataset.ground, bounds },
  }
}
