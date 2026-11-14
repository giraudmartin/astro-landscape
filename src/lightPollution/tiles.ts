/**
 * NASA GIBS VIIRS Black Marble — commercial-OK (NASA open data; attribute NASA,
 * do not imply endorsement). Served via `astro-lightpollution` protocol which
 * punches transparent oceans and gates glow by the solar terminator.
 *
 * Overlay is globe-only: map/city framing must never show overzoomed light blobs.
 */

import type { ExpressionSpecification } from 'maplibre-gl'
import {
  LIGHT_POLLUTION_YEAR,
  lightPollutionTileUrl as protocolTileUrl,
} from './lightPollutionProtocol'

export { LIGHT_POLLUTION_YEAR }

/** Source tile pyramid (GIBS Level8). Overzoom must not paint the layer in map mode. */
export const LIGHT_POLLUTION_MAX_ZOOM = 8

/**
 * Layer hard cutoff — hide before spot flyTo mid-zooms (was 8.5: stretched
 * Black Marble blobs looked like a “PL map” while flying globe→spot).
 * MapLibre hides the layer for zoom ≥ maxzoom.
 */
export const LIGHT_POLLUTION_LAYER_MAX_ZOOM = 6

/** Fade start — globe overview only (≤ ~z3.5). */
export const LIGHT_POLLUTION_GLOBE_FADE_ZOOM = 3.5

export const LIGHT_POLLUTION_LAYER_ID = 'lightPollution'
export const LIGHT_POLLUTION_SOURCE_ID = 'lightPollution'

/** Initial style URL — playhead updates swap `t=` like night shade. */
export const LIGHT_POLLUTION_TILE_URL = protocolTileUrl(Date.now())

export const LIGHT_POLLUTION_ATTRIBUTION =
  'NASA Black Marble / VIIRS nighttime lights via GIBS — NASA Earth Observing System Data and Information System. Not an endorsement of this product.'

/** Peak raster opacity on the globe (terminator-masked sparks on a bright disc). */
export const LIGHT_POLLUTION_OPACITY_MAX = 0.9

/**
 * MapLibre zoom expression: full on globe, 0 by map framing.
 * Prefer this over a scalar so pan/zoom never leaves city lights stuck on.
 */
export function lightPollutionOpacityExpression(): ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    LIGHT_POLLUTION_GLOBE_FADE_ZOOM,
    LIGHT_POLLUTION_OPACITY_MAX,
    LIGHT_POLLUTION_LAYER_MAX_ZOOM,
    0,
  ]
}

/**
 * Globe: on. Map/ground: off.
 * (`nightAmount` kept for call-site stability; terminator is in the tile protocol.)
 */
export function lightPollutionOpacity(
  _nightAmount: number,
  groundView: number,
): number {
  const globe = 1 - Math.min(1, Math.max(0, groundView))
  return LIGHT_POLLUTION_OPACITY_MAX * globe
}

export { protocolTileUrl as lightPollutionProtocolTileUrl }

/** Web Mercator tile indices for lon/lat at integer zoom. */
export function lonLatToTile(
  lon: number,
  lat: number,
  zoom: number,
): { x: number; y: number; z: number } {
  const z = Math.min(LIGHT_POLLUTION_MAX_ZOOM, Math.max(0, Math.floor(zoom)))
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  )
  return {
    z,
    x: ((x % n) + n) % n,
    y: Math.min(n - 1, Math.max(0, y)),
  }
}

/** Raw GIBS URL for point sampling (Bortle) — not the MapLibre protocol. */
export function lightPollutionTileUrl(z: number, x: number, y: number): string {
  // GIBS WMTS: {z}/{TileRow}/{TileCol} = {z}/{y}/{x}
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/${LIGHT_POLLUTION_YEAR}/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`
}
