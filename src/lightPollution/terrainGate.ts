/**
 * Coarse DEM terrain gates for zenith / near-field skyglow.
 *
 * Uses Mapterhorn height-field samples along sightlines (O(az × steps)) —
 * never mesh raycasts. Soft transmission: scattered zenith glow still leaks
 * over ridges (see {@link ridgeTransmission}).
 *
 * Applied mainly to nearby sources (≲80 km): alpine over-brightness vs LPM
 * is dominated by valley towns just below the observer.
 */

import {
  elevationAngleDeg,
  maxTerrainElevAngleDeg,
  offsetLatLonKm,
  ridgeTransmission,
  sampleElevationM,
} from './sampleElevation'

export const TERRAIN_GATE_AZ_BINS = 32
/** Beyond this, zenith scatter is treated as above local ridges. */
export const TERRAIN_GATE_NEAR_KM = 80

export type TerrainGateLut = {
  /** Transmission 0.08…1 per azimuth bin (near-field). */
  byAz: Float32Array
  eyeElevM: number
  azBins: number
}

/**
 * Build one transmission value per azimuth for sources ~15–25 km out
 * (typical valley-town distance from alpine ridges).
 */
export async function buildTerrainGateLut(
  lat: number,
  lon: number,
  eyeElevM: number,
  azBins = TERRAIN_GATE_AZ_BINS,
): Promise<TerrainGateLut> {
  const byAz = new Float32Array(azBins)
  const tasks: Promise<void>[] = []
  const probeKm = 22
  const ridgeMaxKm = 55

  for (let i = 0; i < azBins; i++) {
    const azDeg = (i / azBins) * 360
    tasks.push(
      (async () => {
        const ridge = await maxTerrainElevAngleDeg(
          lat,
          lon,
          eyeElevM,
          azDeg,
          ridgeMaxKm,
          12,
        )
        const src = offsetLatLonKm(lat, lon, probeKm, azDeg)
        const srcElev =
          (await sampleElevationM(src.lat, src.lon)) ?? eyeElevM - 400
        byAz[i] = ridgeTransmission(eyeElevM, srcElev, probeKm, ridge)
      })(),
    )
  }
  await Promise.all(tasks)
  return { byAz, eyeElevM, azBins }
}

function sampleGate(lut: TerrainGateLut, azDeg: number): number {
  const n = lut.azBins
  const x = (((azDeg % 360) + 360) % 360 / 360) * n
  const i0 = Math.floor(x) % n
  const i1 = (i0 + 1) % n
  const f = x - Math.floor(x)
  return lut.byAz[i0]! * (1 - f) + lut.byAz[i1]! * f
}

/**
 * Near-field terrain transmission for a source at (az, d).
 * Far sources → 1 (zenith path above local topography).
 */
export function terrainGateAt(
  lut: TerrainGateLut | null | undefined,
  azDeg: number,
  distanceKm: number,
): number {
  if (!lut) return 1
  if (!(distanceKm > 0)) return 1
  if (distanceKm >= TERRAIN_GATE_NEAR_KM) return 1
  const near = sampleGate(lut, azDeg)
  // Blend: full gate at ≤15 km, none by TERRAIN_GATE_NEAR_KM.
  const t = Math.min(
    1,
    Math.max(0, (distanceKm - 15) / (TERRAIN_GATE_NEAR_KM - 15)),
  )
  return near * (1 - t) + 1 * t
}

/**
 * Extra geometric fade when the observer sits well above typical sources
 * (no DEM path needed). Complements ridge gates.
 *
 * Motivated by path geometry: Δh/d large → less solid angle into the zenith
 * column. Soft, capped — not a mag hack.
 */
export function highObserverNearFade(
  eyeElevM: number | undefined,
  distanceKm: number,
  sourceElevM?: number,
): number {
  if (eyeElevM == null || !Number.isFinite(eyeElevM) || eyeElevM < 900) return 1
  if (!(distanceKm > 0) || distanceKm > 70) return 1
  const src =
    sourceElevM != null && Number.isFinite(sourceElevM)
      ? sourceElevM
      : Math.min(eyeElevM - 500, 1200)
  const ang = elevationAngleDeg(eyeElevM, src, distanceKm)
  // Looking steeply down on nearby lights → reduce zenith coupling.
  if (ang >= -0.5) return 1
  if (ang <= -20) return 0.3
  const u = (-ang - 0.5) / 19.5
  return 1 - 0.7 * u * u * (3 - 2 * u)
}
