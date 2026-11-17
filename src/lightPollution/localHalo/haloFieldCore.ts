/**
 * Local light-pollution halo — precomputed 3D illumination field.
 *
 * Port of the Chamonix VIIRS 2025 reference prototype. Everything here is
 * in the prototype frame: kilometres, X east, Y altitude MSL, Z south,
 * origin at the zone centre. Pure (no DOM / three) so it runs in a worker.
 *
 * Layout of the field: [Z][Y][X][R,G] half floats, X fastest.
 *   R = illumination with terrain screening, G = without.
 */

export const HALO_FIELD_SPEC = {
  nx: 96,
  ny: 48,
  nz: 96,
  /** Zone half-size (km): 24 × 24 km. */
  halfExtentKm: 12,
  /** Prototype vertical bounds (km MSL) — kept unless the terrain forbids. */
  yMinKm: 0.3,
  yMaxKm: 8.3,
  /** Fixed horizontal diffusion of the VIIRS version. */
  kernelKm: 3,
  /** Global artistic factor in radiance × area / 10. */
  normalization: 10,
  /** Source altitude = ground + 20 m. */
  sourceLiftKm: 0.02,
  /** Vertical decay of each source (km). */
  verticalDecayKm: 3,
  occlusionSteps: 360,
  occlusionT0: 0.003,
  occlusionT1: 0.998,
  /** Shadow → light transition. */
  shadowOffsetKm: 0.04,
  shadowWidthKm: 0.12,
  /** Diffuse residual behind ridges. */
  residual: 0.025,
} as const

/** Below this a source's horizontal weight is < fp16 subnormal resolution. */
const NEGLIGIBLE_CONTRIBUTION = 1e-12

/** Sphere used by the reference for pixel areas (IUGG mean radius). */
const AREA_EARTH_RADIUS_KM = 6371.0088

/** Native raster window (GDAL geotransform, north-up). */
export type HaloRaster = {
  /** Native radiance nW/cm²/sr, row-major. NoData kept as `nodata`. */
  values: Float32Array
  width: number
  height: number
  /** [x0, dx, 0, y0, 0, dy] — lon/lat of the top-left corner, dy < 0. */
  geotransform: [number, number, number, number, number, number]
  nodata: number
}

/**
 * Terrain heights (km MSL) on a square grid centred on the zone, pixel-centre
 * convention: cell (i, j) centre = ((i + .5)/n − .5)·extent, rows north → south.
 */
export type HaloGroundGrid = {
  heightsKm: Float32Array
  size: number
  /** Full side (km) — the reference uses 32 km for a 24 km zone. */
  extentKm: number
}

/** Projection of lon/lat to zone km (x east, z south). */
export type HaloProjector =
  | { kind: 'mercator'; mercator: [number, number]; unit: number }
  | { kind: 'enu'; lat0: number; lon0: number }

export type HaloSource = {
  xKm: number
  zKm: number
  yKm: number
  radiance: number
  areaKm2: number
  weight: number
  row: number
  col: number
}

export type HaloBounds = {
  yMinKm: number
  yMaxKm: number
}

export type HaloFieldInput = {
  sources: HaloSource[]
  ground: HaloGroundGrid
  bounds: HaloBounds
}

/** Metres per degree of latitude used by the immersive terrain ENU frame. */
export const ENU_M_PER_DEG = 111_320

export function projectLonLat(
  p: HaloProjector,
  lon: number,
  lat: number,
): { xKm: number; zKm: number } {
  if (p.kind === 'mercator') {
    const mx = (lon + 180) / 360
    const my =
      (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) /
      2
    return {
      xKm: (mx - p.mercator[0]) / p.unit,
      zKm: (my - p.mercator[1]) / p.unit,
    }
  }
  const cos0 = Math.cos((p.lat0 * Math.PI) / 180)
  return {
    xKm: ((lon - p.lon0) * ENU_M_PER_DEG * cos0) / 1000,
    zKm: (-(lat - p.lat0) * ENU_M_PER_DEG) / 1000,
  }
}

export function unprojectKm(
  p: HaloProjector,
  xKm: number,
  zKm: number,
): { lon: number; lat: number } {
  if (p.kind === 'mercator') {
    const mx = p.mercator[0] + xKm * p.unit
    const my = p.mercator[1] + zKm * p.unit
    return {
      lon: mx * 360 - 180,
      lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI,
    }
  }
  const cos0 = Math.cos((p.lat0 * Math.PI) / 180)
  return {
    lon: p.lon0 + (xKm * 1000) / (ENU_M_PER_DEG * cos0),
    lat: p.lat0 - (zKm * 1000) / ENU_M_PER_DEG,
  }
}

/** Geographic area (km²) of one lat/lon pixel centred at `latDeg`. */
export function pixelAreaKm2(
  latDeg: number,
  dLonDeg: number,
  dLatDeg: number,
): number {
  const r = AREA_EARTH_RADIUS_KM
  const toRad = Math.PI / 180
  const half = Math.abs(dLatDeg) / 2
  return (
    r *
    r *
    Math.abs(dLonDeg) *
    toRad *
    Math.abs(
      Math.sin((latDeg + half) * toRad) - Math.sin((latDeg - half) * toRad),
    )
  )
}

/** Bilinear terrain height (km), identical to the reference `ground()`. */
export function groundKmAt(g: HaloGroundGrid, x: number, z: number): number {
  const n = g.size
  const h = g.heightsKm
  const gx = Math.max(0, Math.min(n - 1.001, (x / g.extentKm + 0.5) * n - 0.5))
  const gz = Math.max(0, Math.min(n - 1.001, (z / g.extentKm + 0.5) * n - 0.5))
  const i = Math.floor(gx)
  const j = Math.floor(gz)
  const fx = gx - i
  const fz = gz - j
  const r0 = j * n + i
  const r1 = r0 + n
  return (
    (h[r0]! * (1 - fx) + h[r0 + 1]! * fx) * (1 - fz) +
    (h[r1]! * (1 - fx) + h[r1 + 1]! * fx) * fz
  )
}

export function isNativeEmitter(value: number, nodata: number): boolean {
  return Number.isFinite(value) && value !== nodata && value > 0
}

/**
 * Every positive native pixel whose centre lies inside the 24 × 24 km zone.
 * No threshold, no per-city normalisation, zero and NoData skipped.
 */
export function collectHaloSources(
  raster: HaloRaster,
  projector: HaloProjector,
  ground: HaloGroundGrid,
): HaloSource[] {
  const spec = HALO_FIELD_SPEC
  const [x0, dx, , y0, , dy] = raster.geotransform
  const out: HaloSource[] = []
  for (let row = 0; row < raster.height; row++) {
    const lat = y0 + (row + 0.5) * dy
    const area = pixelAreaKm2(lat, dx, dy)
    for (let col = 0; col < raster.width; col++) {
      const value = raster.values[row * raster.width + col]!
      if (!isNativeEmitter(value, raster.nodata)) continue
      const lon = x0 + (col + 0.5) * dx
      const { xKm, zKm } = projectLonLat(projector, lon, lat)
      if (Math.abs(xKm) > spec.halfExtentKm || Math.abs(zKm) > spec.halfExtentKm)
        continue
      out.push({
        xKm,
        zKm,
        yKm: groundKmAt(ground, xKm, zKm) + spec.sourceLiftKm,
        radiance: value,
        areaKm2: area,
        weight: (value * area) / spec.normalization,
        row,
        col,
      })
    }
  }
  return out
}

/**
 * Density reference altitude (km): ground under the strongest emitting pixel,
 * floored to 10 m. Chamonix reference data → 1.03 km (the prototype constant).
 */
export function haloReferenceAltitudeKm(sources: readonly HaloSource[]): number {
  let best: HaloSource | null = null
  for (const s of sources) {
    if (!best || s.weight > best.weight) best = s
  }
  if (!best) return HALO_FIELD_SPEC.yMinKm
  const groundM = (best.yKm - HALO_FIELD_SPEC.sourceLiftKm) * 1000
  return Math.floor(groundM / 10 + 1e-9) / 100
}

/**
 * Vertical bounds: the reference 0.3–8.3 km unless the zone's terrain needs
 * more room (coastal cities below 0.4 km, high plateaus near 6 km).
 */
export function haloVolumeBounds(ground: HaloGroundGrid): HaloBounds {
  const spec = HALO_FIELD_SPEC
  let minG = Infinity
  let maxG = -Infinity
  const n = ground.size
  for (let j = 0; j < n; j++) {
    const z = ((j + 0.5) / n - 0.5) * ground.extentKm
    if (Math.abs(z) > spec.halfExtentKm) continue
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n - 0.5) * ground.extentKm
      if (Math.abs(x) > spec.halfExtentKm) continue
      const h = ground.heightsKm[j * n + i]!
      if (h < minG) minG = h
      if (h > maxG) maxG = h
    }
  }
  if (!Number.isFinite(minG)) return { yMinKm: spec.yMinKm, yMaxKm: spec.yMaxKm }
  const yMinKm = Math.min(spec.yMinKm, minG - 0.1)
  const span = spec.yMaxKm - spec.yMinKm
  const yMaxKm = Math.max(yMinKm + span, maxG + 2)
  return { yMinKm, yMaxKm }
}

/** Voxel-centre coordinate along one axis. */
function voxelCenter(i: number, n: number, lo: number, hi: number): number {
  return lo + ((i + 0.5) * (hi - lo)) / n
}

/**
 * Accumulate the RG field in float64. `onProgress` receives 0…1 per source.
 */
export function computeHaloFieldFloat(
  input: HaloFieldInput,
  onProgress?: (done01: number) => void,
): Float64Array {
  const spec = HALO_FIELD_SPEC
  const { nx, ny, nz } = spec
  const { ground, sources, bounds } = input
  const half = spec.halfExtentKm
  const field = new Float64Array(nx * ny * nz * 2)

  const xs = new Float64Array(nx)
  const zs = new Float64Array(nz)
  const ys = new Float64Array(ny)
  for (let i = 0; i < nx; i++) xs[i] = voxelCenter(i, nx, -half, half)
  for (let k = 0; k < nz; k++) zs[k] = voxelCenter(k, nz, -half, half)
  for (let j = 0; j < ny; j++) {
    ys[j] = voxelCenter(j, ny, bounds.yMinKm, bounds.yMaxKm)
  }

  const steps = spec.occlusionSteps
  const ts = new Float64Array(steps)
  const invTs = new Float64Array(steps)
  for (let s = 0; s < steps; s++) {
    ts[s] =
      spec.occlusionT0 +
      (s * (spec.occlusionT1 - spec.occlusionT0)) / (steps - 1)
    invTs[s] = 1 / ts[s]!
  }

  const n = ground.size
  const heights = ground.heightsKm
  const gScale = n / ground.extentKm
  const gOffset = 0.5 * n - 0.5
  const gMax = n - 1.001
  const vert = new Float64Array(ny)
  const kernel = spec.kernelKm
  const yStride = nx * 2
  const zStride = ny * nx * 2

  let done = 0
  for (const src of sources) {
    const sx = src.xKm
    const sz = src.zKm
    const sy = src.yKm
    const w = src.weight
    for (let j = 0; j < ny; j++) {
      vert[j] = Math.exp(-Math.max(ys[j]! - sy, 0) / spec.verticalDecayKm)
    }
    for (let k = 0; k < nz; k++) {
      const vz = zs[k]!
      const dz = vz - sz
      for (let i = 0; i < nx; i++) {
        const vx = xs[i]!
        const dx = vx - sx
        const dist = Math.sqrt(dx * dx + dz * dz)
        const q = dist / kernel
        const horiz = Math.exp(-1.5 * q * q) * w
        if (horiz < NEGLIGIBLE_CONTRIBUTION) continue

        // Lowest altitude above this column from which the source clears
        // every terrain sample on the straight path source → column.
        let threshold = sy
        for (let s = 0; s < steps; s++) {
          const t = ts[s]!
          const px = sx + t * dx
          const pz = sz + t * dz
          let gx = px * gScale + gOffset
          let gz = pz * gScale + gOffset
          gx = gx < 0 ? 0 : gx > gMax ? gMax : gx
          gz = gz < 0 ? 0 : gz > gMax ? gMax : gz
          const ii = gx | 0
          const jj = gz | 0
          const fx = gx - ii
          const fz = gz - jj
          const r0 = jj * n + ii
          const r1 = r0 + n
          const g =
            (heights[r0]! * (1 - fx) + heights[r0 + 1]! * fx) * (1 - fz) +
            (heights[r1]! * (1 - fx) + heights[r1 + 1]! * fx) * fz
          const req = sy + (g - sy) * invTs[s]!
          if (req > threshold) threshold = req
        }

        let o = k * zStride + i * 2
        for (let j = 0; j < ny; j++, o += yStride) {
          const v = horiz * vert[j]!
          let u = (ys[j]! - threshold + spec.shadowOffsetKm) / spec.shadowWidthKm
          u = u < 0 ? 0 : u > 1 ? 1 : u
          const vis = u * u * (3 - 2 * u)
          field[o] += v * (spec.residual + (1 - spec.residual) * vis)
          field[o + 1] += v
        }
      }
    }
    done++
    onProgress?.(done / sources.length)
  }
  return field
}

const _f32 = new Float32Array(1)
const _u32 = new Uint32Array(_f32.buffer)

/** IEEE float32 → float16 bits, round-to-nearest-even (numpy astype). */
export function toHalfBits(value: number): number {
  _f32[0] = value
  const x = _u32[0]!
  const sign = (x >>> 16) & 0x8000
  const exp = (x >>> 23) & 0xff
  let mant = x & 0x7fffff
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0)
  const e = exp - 127 + 15
  if (e >= 0x1f) return sign | 0x7c00
  if (e <= 0) {
    if (e < -10) return sign
    mant |= 0x800000
    const shift = 14 - e
    let h = mant >>> shift
    const rem = mant & ((1 << shift) - 1)
    const halfway = 1 << (shift - 1)
    if (rem > halfway || (rem === halfway && (h & 1) === 1)) h++
    return sign | h
  }
  let h = (e << 10) | (mant >>> 13)
  const rem = mant & 0x1fff
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1) === 1)) h++
  return sign | h
}

export function halfBitsToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >>> 10) & 0x1f
  const f = h & 0x3ff
  if (e === 0) return s * f * 2 ** -24
  if (e === 0x1f) return f ? NaN : s * Infinity
  return s * (1 + f / 1024) * 2 ** (e - 15)
}

export function packHalfField(field: Float64Array): Uint16Array {
  const out = new Uint16Array(field.length)
  for (let i = 0; i < field.length; i++) out[i] = toHalfBits(field[i]!)
  return out
}

export function computeHaloField(
  input: HaloFieldInput,
  onProgress?: (done01: number) => void,
): Uint16Array {
  return packHalfField(computeHaloFieldFloat(input, onProgress))
}

/** FNV-1a over bytes — cache key for raster / DEM / parameters. */
export function fnv1a(bytes: Uint8Array, seed = 0x811c9dc5): number {
  let h = seed >>> 0
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export function haloFieldCacheKey(input: {
  raster: HaloRaster
  ground: HaloGroundGrid
  projector: HaloProjector
}): string {
  const r = input.raster
  const g = input.ground
  let h = fnv1a(new Uint8Array(r.values.buffer, r.values.byteOffset, r.values.byteLength))
  h = fnv1a(
    new Uint8Array(g.heightsKm.buffer, g.heightsKm.byteOffset, g.heightsKm.byteLength),
    h,
  )
  const params = JSON.stringify({
    spec: HALO_FIELD_SPEC,
    gt: r.geotransform,
    w: r.width,
    hgt: r.height,
    nd: r.nodata,
    gs: g.size,
    ge: g.extentKm,
    p: input.projector,
  })
  h = fnv1a(new TextEncoder().encode(params), h)
  return `halo-field-v1:${h.toString(16)}`
}
