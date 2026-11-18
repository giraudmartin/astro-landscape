import type { Map, RasterTileSource } from 'maplibre-gl'
import {
  applyGlobeSunLighting,
  updateCelestialBodyMarkers,
} from './globeSun'
import {
  LIGHT_POLLUTION_LAYER_ID,
  LIGHT_POLLUTION_SOURCE_ID,
  lightPollutionOpacityExpression,
  lightPollutionProtocolTileUrl,
} from './lightPollution/tiles'
import { getPlHeatmapEnabledForMap } from './lightPollution/plMapOverlay'
import { getBasemapModeForMap } from './satelliteHybrid'
import { hexToRgb, type SkyPalette } from './skyLighting'

const lastLightPollutionUrlByMap = new WeakMap<Map, string>()

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

/** Skip identical re-applies (load+idle, StrictMode) — rewrites flash the day face. */
const lastMapSkyKeyByMap = new WeakMap<Map, string>()

/** Bust cache so flyTo landing always re-applies night dim (not stale globe day paint). */
export function invalidateMapSkyCache(map: Map): void {
  lastMapSkyKeyByMap.delete(map)
}

/**
 * 0 = full globe/space treatment (terminator only).
 * 1 = ground planning treatment (local sky + imagery dim).
 * MapLibre globe→mercator handoff is roughly mid single digits.
 */
export function groundViewAmount(zoom: number): number {
  return clamp01((zoom - 4.5) / 4)
}

/**
 * How hard to crush satellite imagery in ground framing (0 = day, 1 = deep night).
 * Globe overview keeps this near 0 — day/night there is the terminator veil.
 * Zoomed spots must track dusk/night or ortho tiles stay noon-bright.
 */
export function mapImageryNightDim(
  nightAmount: number,
  sunAltitudeDeg: number,
  groundView: number,
): number {
  const ground = clamp01(groundView)
  const night = clamp01(nightAmount) * ground
  // Dusk ramps from sunset (0°) → 1 at −8°, before nightAmount alone is strong.
  const dusk = clamp01(-sunAltitudeDeg / 8) * ground
  // Night tint without void: shade is globe-only; ortho must carry spot night.
  return clamp01(night * 0.48 + dusk * 0.35)
}

/**
 * Imagery paint derived from dim (+ optional ground for globe Sahara soft-cap).
 * Pure helper so mid-zoom readability stays under unit tests.
 */
export function mapImageryNightPaint(
  dim: number,
  groundView = 1,
): {
  brightnessMin: number
  brightnessMax: number
  saturation: number
  hueRotate: number
  opacity: number
} {
  const d = clamp01(dim)
  const ground = clamp01(groundView)
  const globeDayMax = 0.78 + 0.22 * ground
  return {
    brightnessMin: d * 0.06,
    // Floor 0.42 — verified in-browser: ≤0.35 still reads as void over ocean.
    brightnessMax: Math.max(0.42, (1 - d * 0.55) * globeDayMax),
    saturation: 1 - d * 0.38,
    hueRotate: d * 16,
    opacity: 1 - d * 0.22,
  }
}

export type ApplyMapSkyOptions = {
  /** UTC playhead — drives terminator + sun/moon markers. */
  utcMs: number
  /** Local sun azimuth at map focus (° clockwise from north). */
  sunAzimuthDeg: number
  /** Current map zoom — blends globe vs ground lighting. */
  zoom: number
  /** Local sun altitude at map focus (°) — drives post-sunset imagery dim. */
  sunAltitudeDeg: number
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
  if (options) {
    const applyKey = [
      options.utcMs,
      options.zoom.toFixed(2),
      options.sunAltitudeDeg.toFixed(2),
      localNight.toFixed(3),
      palette.zenith,
      palette.horizon,
    ].join('|')
    if (lastMapSkyKeyByMap.get(map) === applyKey) return
    lastMapSkyKeyByMap.set(map, applyKey)
  }
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
        0.55,
        5,
        0.4,
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
    // Globe: soft day exposure so Sahara isn't chalk; night still from terminator.
    // Ground: tint/dim noon ortho — never crush to void (mid-zoom must stay readable).
    const alt = options?.sunAltitudeDeg ?? 90
    const dim = mapImageryNightDim(localNight, alt, ground)
    const paint = mapImageryNightPaint(dim, ground)
    const twilight = ground * palette.twilightStrength
    map.setPaintProperty('imagery', 'raster-brightness-min', paint.brightnessMin)
    map.setPaintProperty('imagery', 'raster-brightness-max', paint.brightnessMax)
    map.setPaintProperty('imagery', 'raster-saturation', paint.saturation - 1)
    map.setPaintProperty(
      'imagery',
      'raster-hue-rotate',
      paint.hueRotate + twilight * 8,
    )
    map.setPaintProperty('imagery', 'raster-opacity', paint.opacity)
  }

  // Coloured heatmap toggle replaces Black Marble sparks when on.
  // Satellite/hybrid (heatmap off): BM on globe only.
  const heatmapOn = getPlHeatmapEnabledForMap(map) === true
  const planBasemap = getBasemapModeForMap(map) === 'plan'
  if (map.getLayer(LIGHT_POLLUTION_LAYER_ID)) {
    const zoom = options?.zoom ?? map.getZoom()
    const onGlobe =
      !heatmapOn && !planBasemap && groundViewAmount(zoom) < 0.35
    try {
      map.setLayoutProperty(
        LIGHT_POLLUTION_LAYER_ID,
        'visibility',
        onGlobe ? 'visible' : 'none',
      )
    } catch {
      // style not ready
    }
    map.setPaintProperty(
      LIGHT_POLLUTION_LAYER_ID,
      'raster-opacity',
      lightPollutionOpacityExpression(),
    )
  }
  // Only refresh LP tiles while the globe layer can show — scrubbing time on a
  // spot must not reload Black Marble (looked like a PL map flash).
  if (
    options &&
    !heatmapOn &&
    !planBasemap &&
    groundViewAmount(options.zoom) < 0.35 &&
    map.getSource(LIGHT_POLLUTION_SOURCE_ID)
  ) {
    const nextUrl = lightPollutionProtocolTileUrl(options.utcMs)
    if (lastLightPollutionUrlByMap.get(map) !== nextUrl) {
      const source = map.getSource(LIGHT_POLLUTION_SOURCE_ID) as
        | RasterTileSource
        | undefined
      if (source && typeof source.setTiles === 'function') {
        source.setTiles([nextUrl])
      }
      lastLightPollutionUrlByMap.set(map, nextUrl)
    }
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
