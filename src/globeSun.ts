/**
 * Globe day/night lighting helpers.
 * Subsolar math via Astronomy Engine; light → MapLibre spherical frame from
 * makewithmaplibre.com/globe (atmosphere looks opposite the light position).
 */
import {
  Body,
  Equator,
  Illumination,
  Observer,
  SiderealTime,
} from 'astronomy-engine'
import type {
  GeoJSONSource,
  LightSpecification,
  Map,
  RasterTileSource,
} from 'maplibre-gl'
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

/** Geographic point where the Moon is at zenith (UTC instant). */
export function sublunarPoint(utcMs: number): LngLat {
  const at = new Date(utcMs)
  const eq = Equator(Body.Moon, at, GEOCENTRIC, true, true)
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

export function moonIlluminationAt(utcMs: number): {
  fraction: number
  phaseAngleDeg: number
} {
  const illum = Illumination(Body.Moon, new Date(utcMs))
  return {
    fraction: illum.phase_fraction,
    phaseAngleDeg: illum.phase_angle,
  }
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
  const intensity = stable ? 0.4 : 0.85 - night * 0.7
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

  // Real night veil (not just soft globe shade) — strongest when zoomed out.
  updateNightShadeLayer(map, utcMs, stable ? 1 : Math.max(0, 1 - night))

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
      map.setPaintProperty(
        'hillshade',
        'hillshade-exaggeration',
        0.22 * (1 - night * 0.35),
      )
      map.setPaintProperty(
        'hillshade',
        'hillshade-highlight-color',
        night <= 0.55 ? '#fff6e8' : '#c8d4f0',
      )
      map.setPaintProperty(
        'hillshade',
        'hillshade-shadow-color',
        night <= 0.55 ? '#1a1208' : '#05070e',
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

export const CELESTIAL_SOURCE_ID = 'astro-celestial-bodies'
export const SUN_LAYER_ID = 'astro-sun-marker'
export const SUN_GLOW_LAYER_ID = 'astro-sun-marker-glow'
export const MOON_LAYER_ID = 'astro-moon-marker'
export const MOON_GLOW_LAYER_ID = 'astro-moon-marker-glow'

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
    // Above satellite imagery, below hillshade / labels / markers.
    const before =
      map.getLayer('hillshade') != null
        ? 'hillshade'
        : map.getLayer(SUN_GLOW_LAYER_ID) != null
          ? SUN_GLOW_LAYER_ID
          : undefined
    map.addLayer(
      {
        id: NIGHT_SHADE_LAYER_ID,
        type: 'raster',
        source: NIGHT_SHADE_SOURCE_ID,
        maxzoom: 7.5,
        paint: {
          'raster-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            1,
            4.5,
            1,
            6.5,
            0.55,
            7.5,
            0,
          ],
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
  // Pan/zoomend must not rewrite opacity every frame — that flashes the veil.
  if (
    map.getLayer(NIGHT_SHADE_LAYER_ID) &&
    (prev?.strength !== s || prev?.url !== nextUrl || !prev)
  ) {
    map.setPaintProperty(NIGHT_SHADE_LAYER_ID, 'raster-opacity', [
      'interpolate',
      ['linear'],
      ['zoom'],
      0,
      s,
      4.5,
      s,
      6.5,
      0.55 * s,
      7.5,
      0,
    ])
  }
  lastNightShadeByMap.set(map, { url: nextUrl, strength: s })
}

/** GeoJSON source + circle layers for sun/moon on the globe (low zoom). */
export function ensureCelestialBodyLayers(map: Map, utcMs: number): void {
  if (!map.isStyleLoaded()) return
  ensureNightShadeLayer(map, utcMs)

  if (!map.getSource(CELESTIAL_SOURCE_ID)) {
    map.addSource(CELESTIAL_SOURCE_ID, {
      type: 'geojson',
      data: emptyBodies(),
    })
  }

  if (!map.getLayer(SUN_GLOW_LAYER_ID)) {
    map.addLayer({
      id: SUN_GLOW_LAYER_ID,
      type: 'circle',
      source: CELESTIAL_SOURCE_ID,
      filter: ['==', ['get', 'body'], 'sun'],
      maxzoom: 6.5,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0,
          18,
          4,
          14,
          6,
          8,
        ],
        'circle-color': '#ffcc66',
        'circle-opacity': 0.28,
        'circle-blur': 0.85,
      },
    })
  }

  if (!map.getLayer(SUN_LAYER_ID)) {
    map.addLayer({
      id: SUN_LAYER_ID,
      type: 'circle',
      source: CELESTIAL_SOURCE_ID,
      filter: ['==', ['get', 'body'], 'sun'],
      maxzoom: 6.5,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0,
          7,
          4,
          5.5,
          6,
          3.5,
        ],
        'circle-color': '#ffe08a',
        'circle-stroke-color': '#ffb347',
        'circle-stroke-width': 1.2,
        'circle-opacity': 0.95,
      },
    })
  }

  if (!map.getLayer(MOON_GLOW_LAYER_ID)) {
    map.addLayer({
      id: MOON_GLOW_LAYER_ID,
      type: 'circle',
      source: CELESTIAL_SOURCE_ID,
      filter: ['==', ['get', 'body'], 'moon'],
      maxzoom: 6.5,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0,
          14,
          4,
          11,
          6,
          6,
        ],
        'circle-color': '#c9d4f5',
        'circle-opacity': 0.22,
        'circle-blur': 0.8,
      },
    })
  }

  if (!map.getLayer(MOON_LAYER_ID)) {
    map.addLayer({
      id: MOON_LAYER_ID,
      type: 'circle',
      source: CELESTIAL_SOURCE_ID,
      filter: ['==', ['get', 'body'], 'moon'],
      maxzoom: 6.5,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0,
          5.5,
          4,
          4.5,
          6,
          3,
        ],
        'circle-color': [
          'interpolate',
          ['linear'],
          ['get', 'illumination'],
          0,
          '#2a3140',
          0.5,
          '#a8b4c8',
          1,
          '#e8eef8',
        ],
        'circle-stroke-color': '#dce4f5',
        'circle-stroke-width': 1,
        'circle-opacity': 0.92,
      },
    })
  }
}

type BodyCollection = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: Record<string, string | number>
  }>
}

function emptyBodies(): BodyCollection {
  return { type: 'FeatureCollection', features: [] }
}

export function updateCelestialBodyMarkers(map: Map, utcMs: number): void {
  ensureCelestialBodyLayers(map, utcMs)
  const source = map.getSource(CELESTIAL_SOURCE_ID) as GeoJSONSource | undefined
  if (!source || typeof source.setData !== 'function') return

  const sun = subsolarPoint(utcMs)
  const moon = sublunarPoint(utcMs)
  const illum = moonIlluminationAt(utcMs)

  source.setData({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [sun.lon, sun.lat] },
        properties: { body: 'sun' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [moon.lon, moon.lat] },
        properties: {
          body: 'moon',
          illumination: Math.round(illum.fraction * 100) / 100,
        },
      },
    ],
  })
}
