/**
 * Coloured PL heatmap overlay — independent of basemap mode (satellite / hybrid / plan).
 */

import type { Map as MapLibreMap } from 'maplibre-gl'
import { PL_MAP_OVERLAY_PROTOCOL_URL } from './plMapOverlayProtocol'
import { LIGHT_POLLUTION_LAYER_ID } from './tiles'

export const PL_MAP_OVERLAY_SOURCE_ID = 'plMapOverlay'
export const PL_MAP_OVERLAY_LAYER_ID = 'plMapOverlay'

/** Heatmap from globe overview when the overlay toggle is on. */
export const PL_MAP_OVERLAY_MIN_ZOOM = 1

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

const plHeatmapEnabledByMap = new WeakMap<MapLibreMap, boolean>()

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
