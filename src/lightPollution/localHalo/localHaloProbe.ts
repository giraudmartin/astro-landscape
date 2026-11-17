/**
 * Hover readout of the VIIRS ground diagnostic.
 *
 * Same view ray as the composite shader, marched against the terrain height
 * field (`groundYAt`, O(1) per sample — never a Mesh raycast), then the hit is
 * mapped to the native raster pixel the diagnostic layer paints.
 */
import * as THREE from 'three'
import { EARTH_RADIUS_M } from '../../globeConstants'
import { HALO_FIELD_SPEC, unprojectKm } from './haloFieldCore'
import type { LocalHaloField, LocalHaloTerrainFrame } from './localHaloPass'

export type LocalHaloProbeResult = {
  lat: number
  lon: number
  altitudeM: number
  /** Native raster value; null = NoData. */
  radiance: number | null
}

const MAX_RANGE_M = 60_000

/** Screen uv (0…1, v up) → view-space direction, as `viewDirFromScreen`. */
export function viewDirFromScreen(
  u: number,
  v: number,
  camera: THREE.PerspectiveCamera,
  stelMode: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const pe = camera.projectionMatrix.elements
  const sx = (u * 2 - 1) / pe[0]!
  const sy = (v * 2 - 1) / pe[5]!
  if (stelMode < 0.5) {
    const s2 = sx * sx + sy * sy
    const denom = s2 + 4
    return out.set((sx * 4) / denom, (sy * 4) / denom, (s2 - 4) / denom).normalize()
  }
  if (stelMode < 1.5) {
    const ca = Math.cos(sy)
    return out
      .set(Math.sin(sx) * ca, Math.sin(sy), -Math.cos(sx) * ca)
      .normalize()
  }
  return out.set(sx, sy, -1).normalize()
}

export function probeLocalHalo(input: {
  u: number
  v: number
  camera: THREE.PerspectiveCamera
  stelMode: number
  groundYAt: (east: number, north: number) => number
  terrain: LocalHaloTerrainFrame
  field: LocalHaloField
}): LocalHaloProbeResult | null {
  const { camera, groundYAt, terrain, field } = input
  camera.updateMatrixWorld(true)
  const dir = viewDirFromScreen(input.u, input.v, camera, input.stelMode)
  dir.transformDirection(camera.matrixWorld)
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)

  const above = (d: number) => {
    const x = eye.x + dir.x * d
    const z = eye.z + dir.z * d
    const g = groundYAt(x, -z)
    return !Number.isFinite(g) || eye.y + dir.y * d > g
  }
  let prev = 0
  let hit = -1
  for (let d = 2; d < MAX_RANGE_M; d += Math.max(8, d * 0.004)) {
    if (!above(d)) {
      hit = d
      break
    }
    prev = d
  }
  if (hit < 0) return null
  let lo = prev
  let hi = hit
  for (let i = 0; i < 24; i++) {
    const mid = 0.5 * (lo + hi)
    if (above(mid)) lo = mid
    else hi = mid
  }
  const x = eye.x + dir.x * hi
  const y = eye.y + dir.y * hi
  const z = eye.z + dir.z * hi

  const xKm = (x - field.centerScene.x) / 1000
  const zKm = (z - field.centerScene.z) / 1000
  const half = HALO_FIELD_SPEC.halfExtentKm
  if (Math.abs(xKm) >= half || Math.abs(zKm) >= half) return null
  const r2 = x * x + z * z
  const altitudeM =
    (y + r2 / (2 * EARTH_RADIUS_M)) / terrain.verticalExaggeration +
    terrain.baseElevationM
  const { lon, lat } = unprojectKm(field.projector, xKm, zKm)

  const r = field.raster
  const gt = r.geotransform
  const px = Math.min(r.width - 1, Math.max(0, Math.floor((lon - gt[0]) / gt[1])))
  const py = Math.min(r.height - 1, Math.max(0, Math.floor((lat - gt[3]) / gt[5])))
  const value = r.values[py * r.width + px]!
  const noData = !Number.isFinite(value) || value === r.nodata || value < 0
  return { lat, lon, altitudeM, radiance: noData ? null : value }
}

export function formatLocalHaloProbe(p: LocalHaloProbeResult): string {
  const lat = `${Math.abs(p.lat).toFixed(4)}° ${p.lat >= 0 ? 'N' : 'S'}`
  const lon = `${Math.abs(p.lon).toFixed(4)}° ${p.lon >= 0 ? 'E' : 'O'}`
  const coords = `${lat} · ${lon} · ${Math.round(p.altitudeM)} m`
  const value =
    p.radiance == null
      ? 'sans données'
      : `${p.radiance.toFixed(3)} nW/cm²/sr`
  return `${coords}\n${value}`
}
