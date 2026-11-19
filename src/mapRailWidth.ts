/** Shared right-rail width (Mes spots / Cadrages) — Photo Sightline style. */

export const MAP_RAIL_WIDTH_DEFAULT_PX = 320
export const MAP_RAIL_WIDTH_MIN_PX = 280
export const MAP_RAIL_WIDTH_MAX_PX = 560
export const MAP_RAIL_WIDTH_STORAGE_KEY = 'astro-landscape.map-rail-width'

export function clampMapRailWidthPx(px: number, viewportWidth = window.innerWidth): number {
  const max = Math.min(
    MAP_RAIL_WIDTH_MAX_PX,
    Math.max(MAP_RAIL_WIDTH_MIN_PX, Math.floor(viewportWidth * 0.6)),
  )
  return Math.min(max, Math.max(MAP_RAIL_WIDTH_MIN_PX, Math.round(px)))
}

export function loadMapRailWidthPx(): number {
  try {
    const raw = localStorage.getItem(MAP_RAIL_WIDTH_STORAGE_KEY)
    const n = raw == null ? NaN : Number(raw)
    if (Number.isFinite(n)) return clampMapRailWidthPx(n)
  } catch {
    /* ignore */
  }
  return MAP_RAIL_WIDTH_DEFAULT_PX
}

export function saveMapRailWidthPx(px: number): void {
  try {
    localStorage.setItem(MAP_RAIL_WIDTH_STORAGE_KEY, String(clampMapRailWidthPx(px)))
  } catch {
    /* ignore */
  }
}
