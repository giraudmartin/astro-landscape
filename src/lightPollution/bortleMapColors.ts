/**
 * LPM-style Bortle colormap for the plan PL overlay (VIIRS radiance → colour).
 */

/** Below this: transparent (noise / empty). Keep low so rural halo stays blue. */
export const PL_MAP_RADIANCE_FLOOR_NW = 0.12

export const BORTLE_MAP_STOPS: ReadonlyArray<readonly [number, number, number]> =
  [
    [12, 28, 90], // 1 — readable on dark plan (not near-black)
    [24, 55, 180], // 2
    [30, 100, 245], // 3 blue
    [20, 200, 210], // 4 cyan
    [70, 220, 70], // 5 green
    [250, 230, 40], // 6 yellow
    [255, 140, 20], // 7 orange
    [255, 40, 50], // 8 red
    [255, 245, 250], // 9 white
  ]

/**
 * nW anchors — Paris (~74) must land hard in class 9 (white/red core).
 * Villages stay blue/cyan; do not use zenith-mag-from-one-cell.
 */
const RAD_NW_AT_INTEGER: ReadonlyArray<number> = [
  0, // 1
  0.2, // 2
  0.7, // 3 blue
  2, // 4 cyan
  5, // 5
  12, // 6
  22, // 7
  38, // 8
  60, // 9  (Paris 74 → above)
]

const MAG_AT_INTEGER: ReadonlyArray<number> = [
  22.05, 21.94, 21.79, 20.99, 20.0, 19.22, 18.66, 18.09, 17.2,
]

const GLOW_AT_INTEGER: ReadonlyArray<number> = [
  0, 0.008, 0.028, 0.07, 0.14, 0.26, 0.4, 0.6, 1,
]

export const PL_MAP_GLOW_MIN = 0.0035

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

function smootherstep(t: number): number {
  const x = clamp01(t)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

function continuousFromStops(
  value: number,
  stops: ReadonlyArray<number>,
): number {
  if (!Number.isFinite(value)) return 4
  if (value <= stops[0]!) return 1
  if (value >= stops[8]!) return 9
  for (let i = 0; i < 8; i += 1) {
    const lo = stops[i]!
    const hi = stops[i + 1]!
    if (value >= lo && value <= hi) {
      const t = smootherstep((value - lo) / Math.max(1e-6, hi - lo))
      return i + 1 + t
    }
  }
  return 5
}

export function bortleContinuousFromMag(magArcsec2: number): number {
  if (!Number.isFinite(magArcsec2)) return 4
  if (magArcsec2 >= MAG_AT_INTEGER[0]!) return 1
  if (magArcsec2 <= MAG_AT_INTEGER[8]!) return 9
  for (let i = 0; i < 8; i += 1) {
    const hiMag = MAG_AT_INTEGER[i]!
    const loMag = MAG_AT_INTEGER[i + 1]!
    if (magArcsec2 <= hiMag && magArcsec2 >= loMag) {
      const t = smootherstep(
        (hiMag - magArcsec2) / Math.max(1e-6, hiMag - loMag),
      )
      return i + 1 + t
    }
  }
  return 5
}

export function bortleContinuousFromMapGlow(glow01: number): number {
  return continuousFromStops(clamp01(glow01), GLOW_AT_INTEGER)
}

export function bortleContinuousFromRadianceNw(radianceNw: number): number {
  return continuousFromStops(Math.max(0, radianceNw), RAD_NW_AT_INTEGER)
}

export function bortleMapRgb(bortle: number): [number, number, number] {
  const b = Math.min(9, Math.max(1, bortle))
  const i0 = Math.min(7, Math.max(0, Math.floor(b) - 1))
  const i1 = Math.min(8, i0 + 1)
  const t = smootherstep(b - (i0 + 1))
  const a = BORTLE_MAP_STOPS[i0]!
  const c = BORTLE_MAP_STOPS[i1]!
  if (t <= 0) return [a[0], a[1], a[2]]
  return [
    lerpChannel(a[0], c[0], t),
    lerpChannel(a[1], c[1], t),
    lerpChannel(a[2], c[2], t),
  ]
}

export function bortleMapRgbFromMag(magArcsec2: number): [number, number, number] {
  return bortleMapRgb(bortleContinuousFromMag(magArcsec2))
}

export function colorizePlMapFromRadianceNw(
  radianceNw: number,
): { r: number; g: number; b: number; a: number } | null {
  if (!Number.isFinite(radianceNw) || radianceNw < PL_MAP_RADIANCE_FLOOR_NW) {
    return null
  }
  const bortle = bortleContinuousFromRadianceNw(radianceNw)
  const [r, g, b] = bortleMapRgb(bortle)
  // Rural blue must read on the dark plan; cities stay denser.
  const t = clamp01(Math.log1p(radianceNw) / Math.log1p(70))
  const a = Math.round(255 * clamp01(0.58 + 0.42 * t))
  return { r, g, b, a }
}

export function colorizePlMapPixel(
  glow01: number,
): { r: number; g: number; b: number; a: number } | null {
  const glow = Math.min(1, Math.max(0, glow01))
  if (glow < PL_MAP_GLOW_MIN) return null
  const bortle = bortleContinuousFromMapGlow(glow)
  const [r, g, b] = bortleMapRgb(bortle)
  const a = Math.round(255 * clamp01(0.35 + 0.65 * Math.pow(glow, 0.5)))
  return { r, g, b, a }
}
