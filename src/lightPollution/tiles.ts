/**
 * NASA GIBS VIIRS Black Marble — commercial-OK (NASA open data; attribute NASA,
 * do not imply endorsement). Served via `astro-lightpollution` protocol which
 * punches transparent oceans and gates glow by the solar terminator.
 */

import {
  LIGHT_POLLUTION_YEAR,
  lightPollutionTileUrl as protocolTileUrl,
} from './lightPollutionProtocol'

export { LIGHT_POLLUTION_YEAR }

export const LIGHT_POLLUTION_MAX_ZOOM = 8

export const LIGHT_POLLUTION_LAYER_ID = 'lightPollution'
export const LIGHT_POLLUTION_SOURCE_ID = 'lightPollution'

/** Initial style URL — playhead updates swap `t=` like night shade. */
export const LIGHT_POLLUTION_TILE_URL = protocolTileUrl(Date.now())

export const LIGHT_POLLUTION_ATTRIBUTION =
  'NASA Black Marble / VIIRS nighttime lights via GIBS — NASA Earth Observing System Data and Information System. Not an endorsement of this product.'

/** Peak raster opacity for the processed lights layer. */
export const LIGHT_POLLUTION_OPACITY_MAX = 0.9

/**
 * Globe: always on (terminator lives in the tile protocol).
 * Ground: only when the spot/playhead is night.
 */
export function lightPollutionOpacity(
  nightAmount: number,
  groundView: number,
): number {
  const ground = Math.min(1, Math.max(0, groundView))
  const globe = 1 - ground
  const n = Math.min(1, Math.max(0, nightAmount))
  const groundGate = Math.min(1, Math.max(0, (n - 0.2) / 0.55))
  return (
    LIGHT_POLLUTION_OPACITY_MAX *
    (globe * 1 + ground * groundGate)
  )
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
