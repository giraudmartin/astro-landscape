/** Panorama planner — multi-shot grid with frame overlap (photographer style). */

/**
 * How each shot is projected onto the landscape:
 * - optical: real tripod model — each shot = camera FOV frustum at that aim
 * - spherical: constant-yaw / constant-pitch patch on the sky sphere
 * - opticalDense: optical frustum with tessellated edges (better near-clip)
 */
export type PanoramaProjectionMode = 'optical' | 'spherical' | 'opticalDense'

export const PANORAMA_PROJECTION_MODES: readonly PanoramaProjectionMode[] = [
  'optical',
  'spherical',
  'opticalDense',
] as const

export const PANORAMA_PROJECTION_LABELS: Record<PanoramaProjectionMode, string> =
  {
    optical: 'Optique (trépied)',
    spherical: 'Sphérique (az/alt)',
    opticalDense: 'Optique dense',
  }

export type PanoramaPlan = {
  enabled: boolean
  /** Horizontal shots (columns). */
  columns: number
  /** Vertical shots (rows). */
  rows: number
  /** Overlap between adjacent frames, 0–90 %. */
  overlapPercent: number
  /** Draw overlap tint on the viewfinder. */
  showOverlap: boolean
  /** Draw each photo frame outline + index. */
  showFrames: boolean
  /** Landscape projection model. */
  projectionMode: PanoramaProjectionMode
}

export const DEFAULT_PANORAMA_PLAN: PanoramaPlan = {
  enabled: false,
  columns: 3,
  rows: 1,
  overlapPercent: 30,
  showOverlap: true,
  showFrames: true,
  projectionMode: 'optical',
}

export const PANORAMA_COUNT_MIN = 1
export const PANORAMA_OVERLAP_MIN = 5
export const PANORAMA_OVERLAP_MAX = 70
/** Max covered FOV horizontally (full circle around the tripod). */
export const PANORAMA_COVERAGE_MAX_DEG = 360
/** Max covered FOV vertically (horizon → zenith → opposite, ~hemisphere pair). */
export const PANORAMA_VERTICAL_COVERAGE_MAX_DEG = 180

export function normalizePanoramaProjectionMode(
  value: unknown,
): PanoramaProjectionMode {
  return PANORAMA_PROJECTION_MODES.includes(value as PanoramaProjectionMode)
    ? (value as PanoramaProjectionMode)
    : DEFAULT_PANORAMA_PLAN.projectionMode
}

export function clampPanoramaOverlap(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_PANORAMA_PLAN.overlapPercent
  return Math.min(
    PANORAMA_OVERLAP_MAX,
    Math.max(PANORAMA_OVERLAP_MIN, Math.round(percent)),
  )
}

/**
 * Angular step (deg) between adjacent shot centres for a given FOV + overlap.
 * Matches photographer practice: rotate by fov × (1 − overlap).
 */
export function panoramaStepDeg(
  singleFovDeg: number,
  overlapPercent: number,
): number {
  return (
    Math.max(0, singleFovDeg) *
    (1 - clampPanoramaOverlap(overlapPercent) / 100)
  )
}

/**
 * Max shots along one axis so coverage stays ≤ 360°
 * (or `maxCoverageDeg`) for the given single-frame FOV + overlap.
 */
export function maxPanoramaCountForCoverage(
  singleFovDeg: number,
  overlapPercent: number,
  maxCoverageDeg = PANORAMA_COVERAGE_MAX_DEG,
): number {
  const fov = Math.max(0, singleFovDeg)
  if (!(fov > 0)) return PANORAMA_COUNT_MIN
  if (fov >= maxCoverageDeg) return PANORAMA_COUNT_MIN
  const step = panoramaStepDeg(fov, overlapPercent)
  if (!(step > 0)) return PANORAMA_COUNT_MIN
  return Math.max(
    PANORAMA_COUNT_MIN,
    Math.floor(1 + (maxCoverageDeg - fov) / step),
  )
}

export function clampPanoramaCount(n: number, maxCount: number): number {
  const max = Math.max(PANORAMA_COUNT_MIN, Math.floor(maxCount))
  if (!Number.isFinite(n)) return PANORAMA_COUNT_MIN
  return Math.min(max, Math.max(PANORAMA_COUNT_MIN, Math.round(n)))
}

/** Pixel step between frame centres for a given overlap. */
export function panoramaStepPx(frameSizePx: number, overlapPercent: number): number {
  const o = clampPanoramaOverlap(overlapPercent) / 100
  return Math.max(frameSizePx * (1 - o), 1)
}

export type PanoramaTile = {
  /** 1-based shooting order (L→R, top→bottom). */
  index: number
  col: number
  row: number
  /** Top-left of the tile on the stage. */
  x: number
  y: number
  isCenter: boolean
}

export type PanoramaOverlapBand = {
  key: string
  x: number
  y: number
  w: number
  h: number
  /** Adjacent pair along X (horizontal stitch) or Y (vertical). */
  axis: 'x' | 'y'
}

function rectIntersection(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } | null {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const w = x2 - x1
  const h = y2 - y1
  if (w <= 0.5 || h <= 0.5) return null
  return { x: x1, y: y1, w, h }
}

/**
 * Grid of viewfinder frames centred on the stage, stepped by overlap.
 * Centre tile coincides with the single-shot optical frame when cols/rows odd.
 */
export function buildPanoramaTiles(input: {
  stageW: number
  stageH: number
  frameW: number
  frameH: number
  columns: number
  rows: number
  overlapPercent: number
}): PanoramaTile[] {
  const columns = clampPanoramaCount(input.columns, Number.POSITIVE_INFINITY)
  const rows = clampPanoramaCount(input.rows, Number.POSITIVE_INFINITY)
  const stepX = panoramaStepPx(input.frameW, input.overlapPercent)
  const stepY = panoramaStepPx(input.frameH, input.overlapPercent)
  const originX = (input.stageW - input.frameW) / 2
  const originY = (input.stageH - input.frameH) / 2
  const midC = (columns - 1) / 2
  const midR = (rows - 1) / 2
  const centerCol = columns % 2 === 1 ? (columns - 1) / 2 : -1
  const centerRow = rows % 2 === 1 ? (rows - 1) / 2 : -1
  const tiles: PanoramaTile[] = []
  let index = 1
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      tiles.push({
        index,
        col,
        row,
        x: originX + (col - midC) * stepX,
        y: originY + (row - midR) * stepY,
        isCenter: col === centerCol && row === centerRow,
      })
      index += 1
    }
  }
  return tiles
}

/** Overlap strips between horizontally / vertically adjacent tiles. */
export function buildPanoramaOverlapBands(
  tiles: PanoramaTile[],
  frameW: number,
  frameH: number,
): PanoramaOverlapBand[] {
  const byKey = new Map(tiles.map((t) => [`${t.col},${t.row}`, t]))
  const bands: PanoramaOverlapBand[] = []
  for (const tile of tiles) {
    const right = byKey.get(`${tile.col + 1},${tile.row}`)
    if (right) {
      const hit = rectIntersection(
        { x: tile.x, y: tile.y, w: frameW, h: frameH },
        { x: right.x, y: right.y, w: frameW, h: frameH },
      )
      if (hit) {
        bands.push({
          key: `h-${tile.col}-${tile.row}`,
          ...hit,
          axis: 'x',
        })
      }
    }
    const below = byKey.get(`${tile.col},${tile.row + 1}`)
    if (below) {
      const hit = rectIntersection(
        { x: tile.x, y: tile.y, w: frameW, h: frameH },
        { x: below.x, y: below.y, w: frameW, h: frameH },
      )
      if (hit) {
        bands.push({
          key: `v-${tile.col}-${tile.row}`,
          ...hit,
          axis: 'y',
        })
      }
    }
  }
  return bands
}

/** Covered FOV (deg) along one axis from one-shot FOV + grid + overlap. */
export function panoramaCoverageDeg(
  singleFovDeg: number,
  count: number,
  overlapPercent: number,
): number {
  if (count <= 1) return singleFovDeg
  return singleFovDeg + (count - 1) * panoramaStepDeg(singleFovDeg, overlapPercent)
}

export function panoramaShotCount(columns: number, rows: number): number {
  return (
    clampPanoramaCount(columns, Number.POSITIVE_INFINITY) *
    clampPanoramaCount(rows, Number.POSITIVE_INFINITY)
  )
}
