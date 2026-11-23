/**
 * Globe day/night lighting helpers.
 * Subsolar math via Astronomy Engine; light → MapLibre spherical frame from
 * makewithmaplibre.com/globe (atmosphere looks opposite the light position).
 */
import { Body, Equator, Observer, SiderealTime } from 'astronomy-engine'
import type { LightSpecification, Map, RasterTileSource } from 'maplibre-gl'
import {
  ensureNightShadeProtocol,
  nightShadeTileUrl,
  NIGHT_SHADE_LAYER_ID,
  NIGHT_SHADE_SOURCE_ID,
} from './nightShadeProtocol'

const RAD = Math.PI / 180
const GEOCENTRIC = new Observer(0, 0, 0)

function wrapLon(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180
}

export type LngLat = { lon: number; lat: number }

/** Geographic point where the Sun is at zenith (UTC instant). */
export function subsolarPoint(utcMs: number): LngLat {
  const at = new Date(utcMs)
  const eq = Equator(Body.Sun, at, GEOCENTRIC, true, true)
  // SiderealTime → Greenwich apparent sidereal time in hours; RA is hours.
  const lon = wrapLon(15 * (eq.ra - SiderealTime(at)))
  return { lon, lat: eq.dec }
}

/**
 * MapLibre `light` so globe atmosphere is lit from the subsolar point.
 * Atmosphere shader treats the Sun as opposite this light position.
 *
 * Position is Earth-fixed (subsolar only) — never derive it from map center,
 * bearing, or local spot azimuth, or the terminator crawls while panning.
 */
export function sunLightSpec(
  subsolar: LngLat,
  opts?: { intensity?: number; color?: string },
): LightSpecification {
  const { lon: lng, lat } = subsolar
  const x = -Math.cos(lat * RAD) * Math.sin(lng * RAD)
  const y = -Math.sin(lat * RAD)
  const z = -Math.cos(lat * RAD) * Math.cos(lng * RAD)
  const polar = (Math.acos(Math.max(-1, Math.min(1, z))) / RAD)
  const azimuthal = Math.atan2(y, x) / RAD - 90
  return {
    anchor: 'map',
    position: [1.5, azimuthal, polar],
    // Never ease the sun across the disk — pan/zoom would look like time jumps.
    'position-transition': { duration: 0, delay: 0 },
    'color-transition': { duration: 0, delay: 0 },
    'intensity-transition': { duration: 0, delay: 0 },
    color: opts?.color ?? '#ffffff',
    intensity: opts?.intensity ?? 0.55,
  }
}

/** Last Earth-fixed light we pushed — skip setLight on pan/zoom churn. */
const lastGlobeLightByMap = new WeakMap<
  Map,
  { key: string; intensity: number; color: string; stable: boolean }
>()

/** Last night-veil URL + strength — skip setTiles / opacity thrash on pan. */
const lastNightShadeByMap = new WeakMap<
  Map,
  { url: string; strength: number }
>()

/** Bust light/veil dedupe so fly land can force globe→ground night. */
export function invalidateGlobeSunCache(map: Map): void {
  lastGlobeLightByMap.delete(map)
  lastNightShadeByMap.delete(map)
}

/** Drive globe terminator light + hillshade from the playhead sun. */
export function applyGlobeSunLighting(
  map: Map,
  utcMs: number,
  opts: {
    /** Local sun azimuth at map focus (° clockwise from north) — ground only. */
    sunAzimuthDeg: number
    nightAmount: number
    /**
     * When true (zoomed out), keep sun light white/stable so the day face
     * doesn't hue-shift when it faces the camera vs sits behind the limb.
     */
    stableGlobeLight?: boolean
  },
): LngLat {
  const subsolar = subsolarPoint(utcMs)
  const night = Math.max(0, Math.min(1, opts.nightAmount))
  const stable = opts.stableGlobeLight ?? true

  // Globe atmosphere is view-dependent enough already — don't also tint the
  // light orange/blue from local twilight or the day disk "pops" in colour.
  // Keep stable intensity modest: Esri deserts + MapLibre light blow out above ~0.5.
  // Ground framing: moonlit at night — old 0.85-0.7*n still read as daylight.
  const intensity = stable
    ? 0.4
    : Math.max(0.08, 0.75 - night * 0.72)
  const color = stable
    ? '#ffffff'
    : night > 0.7
      ? '#6a7fb8'
      : night > 0.35
        ? '#ffd2a8'
        : '#ffffff'

  // Subsolar quantized — pan/zoom must not rewrite light (MapLibre transitions
  // would slide the terminator across continents).
  const lightKey = `${subsolar.lon.toFixed(3)},${subsolar.lat.toFixed(3)}`
  const prev = lastGlobeLightByMap.get(map)
  const lightChanged =
    !prev ||
    prev.key !== lightKey ||
    prev.intensity !== intensity ||
    prev.color !== color
  if (lightChanged) {
    try {
      map.setLight(sunLightSpec(subsolar, { intensity, color }))
    } catch {
      // Style not ready / light unsupported
    }
  }

  // Terminator veil: full on the globe; on ground follow local night.
  // (Was `1 - night`, which killed the veil exactly when ortho most needs it.)
  updateNightShadeLayer(map, utcMs, stable ? 1 : night)

  if (map.getLayer('hillshade')) {
    // Globe: local spot azimuth as global hillshade reads as a second sun that
    // fights the subsolar terminator — kill it until we're in ground framing.
    // Only rewrite paint when globe↔ground mode flips (pan must not thrash this).
    const modeFlipped = !prev || prev.stable !== stable
    if (stable) {
      if (modeFlipped || lightChanged) {
        map.setPaintProperty('hillshade', 'hillshade-exaggeration', 0)
      }
    } else {
      const az = ((opts.sunAzimuthDeg % 360) + 360) % 360
      map.setPaintProperty('hillshade', 'hillshade-illumination-direction', az)
      map.setPaintProperty('hillshade', 'hillshade-illumination-anchor', 'map')
      // Deep night: near-zero hillshade — cool ridges on dim ortho read as a PL map.
      map.setPaintProperty(
        'hillshade',
        'hillshade-exaggeration',
        night > 0.55 ? 0.02 : 0.14 * (1 - night * 0.5),
      )
      map.setPaintProperty(
        'hillshade',
        'hillshade-highlight-color',
        night <= 0.55 ? '#fff6e8' : '#8a9099',
      )
      map.setPaintProperty(
        'hillshade',
        'hillshade-shadow-color',
        night <= 0.55 ? '#1a1208' : '#12151c',
      )
    }
  }

  lastGlobeLightByMap.set(map, {
    key: lightKey,
    intensity,
    color,
    stable,
  })

  return subsolar
}

/** Legacy marker ids — removed from the globe; kept for HMR/style cleanup. */
const CELESTIAL_SOURCE_ID = 'astro-celestial-bodies'
const SUN_LAYER_ID = 'astro-sun-marker'
const SUN_GLOW_LAYER_ID = 'astro-sun-marker-glow'
const MOON_LAYER_ID = 'astro-moon-marker'
const MOON_GLOW_LAYER_ID = 'astro-moon-marker-glow'

/**
 * Night-shade opacity at a map zoom (linear stops).
 * Globe-only veil: must be ~0 by mid map zoom or overzoomed tiles black out
 * land/ocean and show hard tile seams (seen on Atlantic mid-zoom).
 */
export function nightShadeOpacityAtZoom(zoom: number, strength = 1): number {
  const s = Math.max(0, Math.min(1, strength))
  const z = zoom
  if (z <= 4.5) return s
  if (z >= 7.5) return 0
  if (z <= 6.5) {
    // 4.5 → 6.5: s → 0.4*s
    const t = (z - 4.5) / 2
    return s * (1 - t * 0.6)
  }
  // 6.5 → 7.5: 0.4*s → 0
  const t = (z - 6.5) / 1
  return s * 0.4 * (1 - t)
}

function nightShadeOpacityExpression(strength: number) {
  const s = Math.max(0, Math.min(1, strength))
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    0,
    s,
    4.5,
    s,
    6.5,
    0.4 * s,
    7.5,
    0,
  ] as [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...number[]
  ]
}

/** Night-side raster veil over imagery (globe overview). */
export function ensureNightShadeLayer(map: Map, utcMs: number): void {
  if (!map.isStyleLoaded()) return
  ensureNightShadeProtocol()

  const tiles = [nightShadeTileUrl(utcMs)]
  if (!map.getSource(NIGHT_SHADE_SOURCE_ID)) {
    map.addSource(NIGHT_SHADE_SOURCE_ID, {
      type: 'raster',
      tiles,
      tileSize: 256,
      maxzoom: 7,
      attribution: '',
    })
  }

  if (!map.getLayer(NIGHT_SHADE_LAYER_ID)) {
    // Above satellite imagery, below hillshade / labels.
    // Hard maxzoom: never overzoom shade into map/spot framing (tile seams + void).
    const before = map.getLayer('hillshade') != null ? 'hillshade' : undefined
    map.addLayer(
      {
        id: NIGHT_SHADE_LAYER_ID,
        type: 'raster',
        source: NIGHT_SHADE_SOURCE_ID,
        maxzoom: 7.5,
        paint: {
          'raster-opacity': nightShadeOpacityExpression(1),
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
        },
      },
      before,
    )
  }
}

export function updateNightShadeLayer(
  map: Map,
  utcMs: number,
  strength = 1,
): void {
  ensureNightShadeLayer(map, utcMs)
  const s = Math.max(0, Math.min(1, strength))
  const nextUrl = nightShadeTileUrl(utcMs)
  const prev = lastNightShadeByMap.get(map)
  const source = map.getSource(NIGHT_SHADE_SOURCE_ID) as
    | RasterTileSource
    | undefined
  if (
    source &&
    typeof source.setTiles === 'function' &&
    prev?.url !== nextUrl
  ) {
    source.setTiles([nextUrl])
  }
  if (!map.getLayer(NIGHT_SHADE_LAYER_ID)) {
    lastNightShadeByMap.set(map, { url: nextUrl, strength: s })
    return
  }
  // Globe veil only — clamp maxzoom so HMR/old sessions cannot keep shade on spots.
  try {
    map.setLayerZoomRange(NIGHT_SHADE_LAYER_ID, 0, 7.5)
  } catch {
    // older maplibre
  }
  // Always rewrite opacity (curve + strength). Only setTiles above is URL-gated.
  map.setPaintProperty(
    NIGHT_SHADE_LAYER_ID,
    'raster-opacity',
    nightShadeOpacityExpression(s),
  )
  lastNightShadeByMap.set(map, { url: nextUrl, strength: s })
}

const celestialMarkersCleared = new WeakSet<Map>()

/** Strip leftover subsolar/sublunar circle markers (no longer drawn on the globe). */
export function removeCelestialBodyMarkers(map: Map): void {
  if (!map.isStyleLoaded()) return
  if (celestialMarkersCleared.has(map) && !map.getSource(CELESTIAL_SOURCE_ID)) {
    return
  }
  for (const id of [
    MOON_LAYER_ID,
    MOON_GLOW_LAYER_ID,
    SUN_LAYER_ID,
    SUN_GLOW_LAYER_ID,
  ]) {
    if (map.getLayer(id)) {
      try {
        map.removeLayer(id)
      } catch {
        // style churn
      }
    }
  }
  if (map.getSource(CELESTIAL_SOURCE_ID)) {
    try {
      map.removeSource(CELESTIAL_SOURCE_ID)
    } catch {
      // style churn
    }
  }
  celestialMarkersCleared.add(map)
}
