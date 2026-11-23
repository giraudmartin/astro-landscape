/**
 * Coloured PL heatmap overlay — independent of basemap mode (satellite / hybrid / plan).
 */

import type { Map as MapLibreMap } from 'maplibre-gl'
import { PL_MAP_OVERLAY_PROTOCOL_URL } from './plMapOverlayProtocol'
import { LIGHT_POLLUTION_LAYER_ID } from './tiles'

export const PL_MAP_OVERLAY_SOURCE_ID = 'plMapOverlay'
export const PL_MAP_OVERLAY_LAYER_ID = 'plMapOverlay'

/**
 * Below this zoom the heatmap is useless (whole-planet burst of tiles) and the
 * PL control auto-closes. Layer minzoom matches so MapLibre does not fetch.
 */
export const PL_HEATMAP_MIN_ZOOM = 6

/** Ease target when enabling PL while still below {@link PL_HEATMAP_MIN_ZOOM}. */
export const PL_HEATMAP_ENABLE_ZOOM = 7

/** Heatmap paints from regional framing — not globe overview. */
export const PL_MAP_OVERLAY_MIN_ZOOM = PL_HEATMAP_MIN_ZOOM

/**
 * Native tile pyramid max — MapLibre overzooms beyond this so the overlay
 * stays visible at every map zoom (no layer maxzoom cutoff).
 */
export const PL_MAP_OVERLAY_MAX_ZOOM = 11

export const PL_MAP_OVERLAY_TILE_URL = PL_MAP_OVERLAY_PROTOCOL_URL

export const PL_MAP_OVERLAY_ATTRIBUTION =
  'Coloured light-pollution overlay: EOG VIIRS VNL 2024 (~500 m, CC BY 4.0) false-coloured with a Bortle ramp — same COG as spot SQM/Bortle. Not World Atlas.'

/** Default opacity — basemap stays readable underneath. */
export const PL_MAP_OVERLAY_OPACITY_DEFAULT = 0.82

/**
 * Soft tile fade so PL does not pop tile-by-tile once the layer is revealed.
 * First reveal still waits for idle (opacity 0 → target) — see MapCanvas.
 */
export const PL_MAP_OVERLAY_FADE_MS = 320

/**
 * Cap how long the PL control spinner waits for the overlay source.
 * COG colourise can take well beyond a normal basemap idle — keep the small
 * spinner up; never block the immersive terrain loader on this.
 */
export const PL_MAP_OVERLAY_REVEAL_TIMEOUT_MS = 45_000

const plHeatmapEnabledByMap = new WeakMap<MapLibreMap, boolean>()

/**
 * True when the coloured PL raster has finished its current viewport tiles.
 * Do not use map.areTilesLoaded() alone — basemap idle fires long before COG.
 */
export function isPlMapOverlaySourceReady(map: MapLibreMap): boolean {
  try {
    if (!map.getSource(PL_MAP_OVERLAY_SOURCE_ID)) return false
    if (
      map.getLayoutProperty(PL_MAP_OVERLAY_LAYER_ID, 'visibility') !== 'visible'
    ) {
      return false
    }
    return map.isSourceLoaded(PL_MAP_OVERLAY_SOURCE_ID)
  } catch {
    return false
  }
}

export function getPlHeatmapEnabledForMap(
  map: MapLibreMap,
): boolean | undefined {
  return plHeatmapEnabledByMap.get(map)
}

export function clampPlHeatmapOpacity(value: number): number {
  if (!Number.isFinite(value)) return PL_MAP_OVERLAY_OPACITY_DEFAULT
  return Math.min(1, Math.max(0.15, value))
}

/** Keep heatmap under labels when vector basemaps are on. */
function movePlOverlayBelowLabels(map: MapLibreMap): void {
  const layers = map.getStyle()?.layers
  if (!layers?.length) {
    map.moveLayer(PL_MAP_OVERLAY_LAYER_ID)
    return
  }
  const firstSymbol = layers.find(
    (layer) =>
      layer.type === 'symbol' && layer.id !== PL_MAP_OVERLAY_LAYER_ID,
  )
  if (firstSymbol) {
    map.moveLayer(PL_MAP_OVERLAY_LAYER_ID, firstSymbol.id)
    return
  }
  map.moveLayer(PL_MAP_OVERLAY_LAYER_ID)
}

/**
 * Paint-only opacity update for live slider drag — no layout/moveLayer/sky.
 * Returns false if the layer is not ready (caller should fall back to full apply).
 */
export function setPlMapOverlayOpacity(
  map: MapLibreMap,
  opacity: number,
): boolean {
  if (!map.isStyleLoaded() || !map.getLayer(PL_MAP_OVERLAY_LAYER_ID)) {
    return false
  }
  try {
    map.setPaintProperty(
      PL_MAP_OVERLAY_LAYER_ID,
      'raster-opacity',
      clampPlHeatmapOpacity(opacity),
    )
    return true
  } catch {
    return false
  }
}

/**
 * Show/hide the coloured PL heatmap on top of the current basemap.
 * When on, Black Marble sparks stay off (heatmap replaces them).
 */
export function applyPlMapOverlay(
  map: MapLibreMap,
  options: { enabled: boolean; opacity: number },
): void {
  if (!map.isStyleLoaded()) return
  const enabled = options.enabled
  const opacity = clampPlHeatmapOpacity(options.opacity)
  plHeatmapEnabledByMap.set(map, enabled)

  if (map.getLayer(PL_MAP_OVERLAY_LAYER_ID)) {
    try {
      map.setLayoutProperty(
        PL_MAP_OVERLAY_LAYER_ID,
        'visibility',
        enabled ? 'visible' : 'none',
      )
      if (enabled) {
        map.setPaintProperty(PL_MAP_OVERLAY_LAYER_ID, 'raster-opacity', opacity)
        map.setPaintProperty(
          PL_MAP_OVERLAY_LAYER_ID,
          'raster-resampling',
          'nearest',
        )
        movePlOverlayBelowLabels(map)
      }
    } catch {
      // style not ready
    }
  }

  if (enabled && map.getLayer(LIGHT_POLLUTION_LAYER_ID)) {
    try {
      map.setLayoutProperty(LIGHT_POLLUTION_LAYER_ID, 'visibility', 'none')
    } catch {
      // style not ready
    }
  }
}
