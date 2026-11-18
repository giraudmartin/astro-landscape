/**
 * Soft helpers for PL map overlay.
 * Heavy per-tile dilate/blur caused visible seams across France — keep this light.
 */

/** Max-filter dilate — grows bright cores before blur. */
export function dilateGlowField(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const r = Math.max(0, Math.floor(radius))
  if (r === 0) return src.slice()
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let m = 0
      for (let dy = -r; dy <= r; dy += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + dy))
        const row = yy * width
        for (let dx = -r; dx <= r; dx += 1) {
          const xx = Math.min(width - 1, Math.max(0, x + dx))
          const v = src[row + xx]!
          if (v > m) m = v
        }
      }
      out[y * width + x] = m
    }
  }
  return out
}

/** Separable box blur on a glow field. */
export function blurGlowField(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const r = Math.max(0, Math.floor(radius))
  if (r === 0) return src.slice()
  const tmp = new Float32Array(width * height)
  const out = new Float32Array(width * height)
  const span = r * 2 + 1

  for (let y = 0; y < height; y += 1) {
    const row = y * width
    let sum = 0
    for (let x = -r; x <= r; x += 1) {
      const xx = Math.min(width - 1, Math.max(0, x))
      sum += src[row + xx]!
    }
    for (let x = 0; x < width; x += 1) {
      tmp[row + x] = sum / span
      const leave = Math.min(width - 1, Math.max(0, x - r))
      const enter = Math.min(width - 1, Math.max(0, x + r + 1))
      sum += src[row + enter]! - src[row + leave]!
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let y = -r; y <= r; y += 1) {
      const yy = Math.min(height - 1, Math.max(0, y))
      sum += tmp[yy * width + x]!
    }
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / span
      const leave = Math.min(height - 1, Math.max(0, y - r))
      const enter = Math.min(height - 1, Math.max(0, y + r + 1))
      sum += tmp[enter * width + x]! - tmp[leave * width + x]!
    }
  }
  return out
}

/**
 * Tiny seam-safe soften for Black Marble fallback only.
 * COG path skips this — large per-tile expand was the France vertical cut.
 */
export function expandRadiiForZoom(_zoom: number): {
  near: number
  mid: number
  far: number
} {
  return { near: 2, mid: 3, far: 4 }
}

export function expandMarginForZoom(zoom: number): number {
  return expandRadiiForZoom(zoom).far + 2
}

/**
 * Light multi-scale soften (fallback / tiny halo only).
 */
export function expandGlowField(
  glow: Float32Array,
  width: number,
  height: number,
  zoom: number,
): Float32Array {
  const { near: nearR, mid: midR, far: farR } = expandRadiiForZoom(zoom)

  const near = blurGlowField(glow, width, height, nearR)
  const mid = blurGlowField(glow, width, height, midR)
  const far = blurGlowField(glow, width, height, farR)

  const out = new Float32Array(glow.length)
  for (let i = 0; i < glow.length; i += 1) {
    const core = glow[i]!
    const spill = Math.max(near[i]! * 0.85, mid[i]! * 0.4, far[i]! * 0.18)
    out[i] = Math.min(1, Math.max(core, spill))
  }
  return out
}

function ruralCityDilate(zoom: number): { rural: number; city: number } {
  const z = Math.max(0, Math.min(12, zoom))
  // Keep radii small — overview uses fast GIBS path; this is COG detail only.
  if (z <= 7) return { rural: 3, city: 3 }
  if (z <= 9) return { rural: 3, city: 2 }
  return { rural: 2, city: 2 }
}

function spreadRadianceCore(
  radianceNw: Float32Array,
  width: number,
  height: number,
  zoom: number,
): Float32Array {
  const rural = new Float32Array(radianceNw.length)
  const city = new Float32Array(radianceNw.length)
  for (let i = 0; i < radianceNw.length; i += 1) {
    const v = radianceNw[i]!
    if (!(v > 0)) continue
    rural[i] = Math.min(8, v)
    if (v >= 8) city[i] = Math.min(48, v)
  }

  const { rural: ruralDilate, city: cityDilate } = ruralCityDilate(zoom)

  const ruralSoft = blurGlowField(
    dilateGlowField(rural, width, height, ruralDilate),
    width,
    height,
    ruralDilate + 1,
  )
  const citySoft = blurGlowField(
    dilateGlowField(city, width, height, cityDilate),
    width,
    height,
    cityDilate + 1,
  )

  const out = new Float32Array(radianceNw.length)
  for (let i = 0; i < radianceNw.length; i += 1) {
    out[i] = Math.max(radianceNw[i]!, ruralSoft[i]!, citySoft[i]!)
  }
  return out
}

/**
 * Spread real VIIRS radiance for an LPM-like map.
 * Always full-res: half-res upsample reintroduced tile seams even with a halo.
 */
export function spreadRadianceForMapOverlay(
  radianceNw: Float32Array,
  width: number,
  height: number,
  zoom: number,
): Float32Array {
  return spreadRadianceCore(radianceNw, width, height, zoom)
}

/** Extra pixels of tile padding so spread doesn't seam at tile edges. */
export function spreadMarginForZoom(zoom: number): number {
  const { rural, city } = ruralCityDilate(zoom)
  const dilateR = Math.max(rural, city)
  return dilateR + dilateR + 2
}
