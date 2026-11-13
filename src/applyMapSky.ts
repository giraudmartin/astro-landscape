import type { Map } from 'maplibre-gl'
import {
  applyGlobeSunLighting,
  updateCelestialBodyMarkers,
} from './globeSun'
import { hexToRgb, type SkyPalette } from './skyLighting'

function rgbTuple(hex: string): [number, number, number] {
  const { r, g, b } = hexToRgb(hex)
  return [r, g, b]
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const u = Math.min(1, Math.max(0, t))
  return [
    Math.round(a[0]! + (b[0]! - a[0]!) * u),
    Math.round(a[1]! + (b[1]! - a[1]!) * u),
    Math.round(a[2]! + (b[2]! - a[2]!) * u),
  ]
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

/**
 * 0 = full globe/space treatment (terminator only).
 * 1 = ground planning treatment (local sky + imagery dim).
 * MapLibre globe→mercator handoff is roughly mid single digits.
 */
export function groundViewAmount(zoom: number): number {
  return clamp01((zoom - 4.5) / 4)
}

export type ApplyMapSkyOptions = {
  /** UTC playhead — drives terminator + sun/moon markers. */
  utcMs: number
  /** Local sun azimuth at map focus (° clockwise from north). */
  sunAzimuthDeg: number
  /** Current map zoom — blends globe vs ground lighting. */
  zoom: number
}

/**
 * Drive MapLibre sky + globe terminator light + imagery from the atmosphere palette.
 *
 * At low zoom the globe must stay colour-stable: day/night comes only from
 * `setLight` (terminator). Local sky/imagery night tint is for close framing.
 */
export function applyMapSky(
  map: Map,
  palette: SkyPalette,
  options?: ApplyMapSkyOptions,
): void {
  if (!map.isStyleLoaded()) return

  const ground = options ? groundViewAmount(options.zoom) : 1
  const globe = 1 - ground
  const localNight = palette.nightAmount
  // On the globe, ignore local day/night for global colour — otherwise the
  // lit hemisphere looks totally different facing the camera vs behind it.
  const night = localNight * ground

  const zenith = rgbTuple(palette.zenith)
  const horizon = rgbTuple(palette.horizon)
  const spaceZenith: [number, number, number] = [22, 24, 30]
  const spaceHorizon: [number, number, number] = [28, 32, 40]
  const skyZenith = mixRgb(spaceZenith, zenith, ground)
  const skyHorizon = mixRgb(spaceHorizon, horizon, ground)
  const fogRgb = mixRgb(skyHorizon, skyZenith, 0.35)

  try {
    map.setSky({
      'sky-color': `rgb(${skyZenith[0]}, ${skyZenith[1]}, ${skyZenith[2]})`,
      // Keep fog soft on the globe — fog matrix is weak/unsupported there
      // and strong fog washes the day face differently by view angle.
      'sky-horizon-blend': 0.28 + 0.14 * ground,
      'horizon-color': `rgb(${skyHorizon[0]}, ${skyHorizon[1]}, ${skyHorizon[2]})`,
      'horizon-fog-blend': 0.2 + 0.35 * ground,
      'fog-color': `rgb(${fogRgb[0]}, ${fogRgb[1]}, ${fogRgb[2]})`,
      'fog-ground-blend': 0.06 + (0.22 + night * 0.28) * ground,
      'atmosphere-blend': [
        'interpolate',
        ['linear'],
        ['zoom'],
        2,
        0.85,
        5,
        0.55,
        10,
        Math.max(0.08, 0.35 - night * 0.25) * ground,
        13,
        0,
      ],
    })
  } catch {
    // Older styles without sky support
  }

  if (map.getLayer('imagery')) {
    // Globe: leave satellite at natural exposure — terminator darkens night.
    // Ground view: also cool/dim with local sky so the map floor tracks dusk.
    const brightness = 1 - night * 0.58
    const saturation = 1 - night * 0.4
    const twilight = ground * palette.twilightStrength
    map.setPaintProperty('imagery', 'raster-brightness-min', night * 0.1)
    map.setPaintProperty('imagery', 'raster-brightness-max', brightness)
    map.setPaintProperty('imagery', 'raster-saturation', saturation - 1)
    // Soft cool shift into night / blue hour (degrees); day stays 0.
    map.setPaintProperty(
      'imagery',
      'raster-hue-rotate',
      night * 18 * ground + twilight * 8,
    )
    map.setPaintProperty(
      'imagery',
      'raster-opacity',
      1 - night * 0.14,
    )
  }

  if (map.getLayer('background')) {
    // Transparent so the milky-way custom layer shows through behind Earth.
    map.setPaintProperty('background', 'background-color', '#1a1c22')
    map.setPaintProperty('background', 'background-opacity', 0)
  }

  if (options) {
    applyGlobeSunLighting(map, options.utcMs, {
      sunAzimuthDeg: options.sunAzimuthDeg,
      // Stable white sun light on the globe; only soften slightly when close
      // and the local scene is night.
      nightAmount: night,
      stableGlobeLight: globe > 0.35,
    })
    updateCelestialBodyMarkers(map, options.utcMs)
  } else if (map.getLayer('hillshade')) {
    map.setPaintProperty(
      'hillshade',
      'hillshade-exaggeration',
      0.22 * (1 - night * 0.35),
    )
  }
}
