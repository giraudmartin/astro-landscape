import { useCallback, useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { setWorkerUrl } from 'maplibre-gl'
import type { Map, MapMouseEvent, Marker, StyleSpecification } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { AddressSearchResult } from './addressSearch'
import {
  DEM_MAX_ZOOM,
  IMAGERY_MAX_ZOOM,
  MAPTERHORN_DEM_URL,
  TERRAIN_EXAGGERATION,
} from './globeConstants'
import {
  ensureEsriSafeImageryProtocol,
  ESRI_SAFE_IMAGERY_URL,
} from './esriSafeImagery'
import { ensureMapterhornSafeDemProtocol } from './mapterhornSafeDem'
import {
  applyMapSky,
  groundViewAmount,
  invalidateMapSkyCache,
} from './applyMapSky'
import { sunPositionAt } from './celestial'
import { ensureNightShadeLayer, removeCelestialBodyMarkers } from './globeSun'
import { ensureGlobeMilkyWayLayer } from './globeMilkyWay'
import { ensureNightShadeProtocol } from './nightShadeProtocol'
import { ensureLightPollutionProtocol } from './lightPollution/lightPollutionProtocol'
import { ensurePlMapOverlayProtocol } from './lightPollution/plMapOverlayProtocol'
import {
  applyPlMapOverlay,
  PL_HEATMAP_ENABLE_ZOOM,
  PL_HEATMAP_MIN_ZOOM,
  PL_MAP_OVERLAY_ATTRIBUTION,
  PL_MAP_OVERLAY_LAYER_ID,
  PL_MAP_OVERLAY_MAX_ZOOM,
  PL_MAP_OVERLAY_MIN_ZOOM,
  PL_MAP_OVERLAY_OPACITY_DEFAULT,
  PL_MAP_OVERLAY_SOURCE_ID,
  PL_MAP_OVERLAY_TILE_URL,
} from './lightPollution/plMapOverlay'
import { PlMapOverlayLegend } from './PlMapOverlayLegend'
import { MapControlsStack } from './MapControlsStack'
import { MapSettingsPanel } from './MapSettingsPanel'
import {
  filterMapVisiblePersonalSpots,
  fitPersonalSpots,
  renderPersonalSpotMarkers,
  type PersonalSpot,
  type PersonalSpotFolder,
} from './personalSpots'
import { DEFAULT_MAP_VIEW } from './presets'
import { skyPaletteFromSunAltitude } from './skyLighting'
import type { BasemapMode } from './basemapMode'
import { applyBasemapMode, waitForStyleLoaded } from './satelliteHybrid'
import {
  LIGHT_POLLUTION_ATTRIBUTION,
  LIGHT_POLLUTION_LAYER_ID,
  LIGHT_POLLUTION_LAYER_MAX_ZOOM,
  LIGHT_POLLUTION_MAX_ZOOM,
  LIGHT_POLLUTION_SOURCE_ID,
  LIGHT_POLLUTION_TILE_URL,
  lightPollutionOpacityExpression,
} from './lightPollution/tiles'
import {
  sampleLightPollution,
  type LightPollutionSample,
} from './lightPollution/sampleLightPollution'
import { SpotBortleCard } from './SpotBortleCard'
import { SkyBrightnessPanel } from './SkyBrightnessPanel'
import {
  createSpotActionMarkerElement,
  type SpotActionMarkerController,
} from './spotActionMarker'
import { streetViewUrlAt } from './streetView'

setWorkerUrl(maplibreWorkerUrl)

/**
 * After globe→spot flyTo, apply night dim only once the camera is in ground
 * framing. One-shot moveend often fires mid-fly below the gate and never
 * retries — poll + hard deadline so noon ortho cannot stick.
 */
function settleGroundSkyAfterFly(
  map: Map,
  minZoom: number,
  onLand: () => void,
): void {
  let landed = false
  const finish = (force: boolean) => {
    if (landed) return
    if (!force && map.getZoom() < minZoom) return
    landed = true
    window.clearInterval(poll)
    window.clearTimeout(hardDeadline)
    map.off('moveend', onMoveOrIdle)
    map.off('idle', onMoveOrIdle)
    map.off('zoomend', onMoveOrIdle)
    onLand()
  }
  const onMoveOrIdle = () => finish(false)
  const poll = window.setInterval(() => finish(false), 120)
  const hardDeadline = window.setTimeout(() => finish(true), 2200)
  map.on('moveend', onMoveOrIdle)
  map.on('idle', onMoveOrIdle)
  map.on('zoomend', onMoveOrIdle)
  // Kick once in case fly is already past minZoom when this is registered.
  queueMicrotask(() => finish(false))
}

export type CameraMode = 'orbit' | 'ground'

export type SpotState = {
  lat: number
  lon: number
  heightM: number
  bearingDeg: number
  pitchDeg: number
}

type MapCanvasProps = {
  mode: CameraMode
  threeDimensional: boolean
  basemapMode: BasemapMode
  plHeatmapEnabled: boolean
  plHeatmapOpacity: number
  addressSearchOpen: boolean
  spot: SpotState | null
  onModeChange: (
    mode: CameraMode,
    opts?: { flatTerrain?: boolean },
  ) => void
  onSpotChange: (spot: SpotState) => void
  onThreeDimensionalChange: (next: boolean) => void
  onBasemapModeChange: (next: BasemapMode) => void
  onPlHeatmapEnabledChange: (next: boolean) => void
  onPlHeatmapOpacityChange: (next: number) => void
  onAddressSearchOpenChange: (open: boolean) => void
  /** UTC ms driving sky / lighting (timeline playhead). */
  skyUtcMs: number
  mySpotsOpen: boolean
  onMySpotsOpenChange: (open: boolean) => void
  framingsOpen: boolean
  onFramingsOpenChange: (open: boolean) => void
  personalSpots: PersonalSpot[]
  personalSpotFolders: PersonalSpotFolder[]
  selectedPersonalSpotId: string | null
  personalSpotPicking: boolean
  onPlacePersonalSpot: (input: {
    lat: number
    lon: number
    heightM: number
    bearingDeg: number
    pitchDeg: number
  }) => void
  onSelectPersonalSpot: (spot: PersonalSpot) => void
  /** Opening the pin panel — sync saved-spot list selection if coords match. */
  onActivateWorkingPin: () => void
  flyToPersonalSpotId: string | null
  onFlyToPersonalSpotHandled: () => void
  showAllPersonalSpotsToken: number
  /** Open the save-spot dialog for the current working pin. */
  onRequestSaveSpot: () => void
  /** Open the edit dialog for the selected / matching saved spot. */
  onRequestEditSpot: () => void
  markerMenuOpen: boolean
  onMarkerMenuOpenChange: (open: boolean) => void
}

const THREE_D_PITCH = 55
const FLAT_PITCH = 0

function formatCoord(lat: number, lon: number) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}°${ns}  ${Math.abs(lon).toFixed(4)}°${ew}`
}

function demSource(): maplibregl.RasterDEMSourceSpecification {
  return {
    type: 'raster-dem',
    tiles: [MAPTERHORN_DEM_URL],
    encoding: 'terrarium',
    tileSize: 512,
    maxzoom: DEM_MAX_ZOOM,
    attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
  }
}

function buildStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    // Globe at low zoom → mercator when close (MapLibre built-in transition).
    projection: { type: 'globe' },
    sources: {
      imagery: {
        type: 'raster',
        tiles: [ESRI_SAFE_IMAGERY_URL],
        tileSize: 256,
        maxzoom: IMAGERY_MAX_ZOOM,
        attribution:
          'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      },
      [LIGHT_POLLUTION_SOURCE_ID]: {
        type: 'raster',
        tiles: [LIGHT_POLLUTION_TILE_URL],
        tileSize: 256,
        maxzoom: LIGHT_POLLUTION_MAX_ZOOM,
        attribution: LIGHT_POLLUTION_ATTRIBUTION,
      },
      [PL_MAP_OVERLAY_SOURCE_ID]: {
        type: 'raster',
        tiles: [PL_MAP_OVERLAY_TILE_URL],
        tileSize: 256,
        minzoom: PL_MAP_OVERLAY_MIN_ZOOM,
        maxzoom: PL_MAP_OVERLAY_MAX_ZOOM,
        attribution: PL_MAP_OVERLAY_ATTRIBUTION,
      },
      terrain: demSource(),
      hillshadeDem: demSource(),
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        // Deep space behind the globe disc.
        paint: { 'background-color': '#1a1c22' },
      },
      {
        id: 'imagery',
        type: 'raster',
        source: 'imagery',
        paint: {
          'raster-opacity': 1,
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
        },
      },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'hillshadeDem',
        paint: {
          'hillshade-exaggeration': 0.22,
          'hillshade-shadow-color': '#1a1208',
          'hillshade-highlight-color': '#fff6e8',
          'hillshade-accent-color': '#5a4630',
          'hillshade-illumination-direction': 315,
          'hillshade-illumination-anchor': 'map',
        },
      },
      {
        id: LIGHT_POLLUTION_LAYER_ID,
        type: 'raster',
        source: LIGHT_POLLUTION_SOURCE_ID,
        // Hard stop before map/city framing — do not overzoom Black Marble blobs.
        maxzoom: LIGHT_POLLUTION_LAYER_MAX_ZOOM,
        paint: {
          'raster-opacity': lightPollutionOpacityExpression(),
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
        },
      },
      {
        // Coloured PL heatmap — no layer maxzoom; source maxzoom overzooms past z11.
        id: PL_MAP_OVERLAY_LAYER_ID,
        type: 'raster',
        source: PL_MAP_OVERLAY_SOURCE_ID,
        minzoom: PL_MAP_OVERLAY_MIN_ZOOM,
        layout: { visibility: 'none' },
        paint: {
          'raster-opacity': PL_MAP_OVERLAY_OPACITY_DEFAULT,
          'raster-fade-duration': 0,
          // Nearest avoids hairline seams from linear filter across tile edges.
          'raster-resampling': 'nearest',
        },
      },
    ],
    terrain: {
      source: 'terrain',
      exaggeration: TERRAIN_EXAGGERATION,
    },
    light: {
      anchor: 'map',
      color: '#ffffff',
      intensity: 0.55,
      // Placeholder until playhead applies subsolar — never ease across the disk.
      position: [1.5, 210, 30],
      'position-transition': { duration: 0, delay: 0 },
      'color-transition': { duration: 0, delay: 0 },
      'intensity-transition': { duration: 0, delay: 0 },
    },
    sky: {
      'sky-color': '#87b7ff',
      'sky-horizon-blend': 0.42,
      'horizon-color': '#c8daf0',
      'horizon-fog-blend': 0.55,
      'fog-color': '#b7cce6',
      'fog-ground-blend': 0.25,
      // Strong limb glow when Earth is a sphere in space.
      'atmosphere-blend': [
        'interpolate',
        ['linear'],
        ['zoom'],
        2,
        0.95,
        5,
        0.75,
        10,
        0.3,
        13,
        0,
      ],
    },
  }
}

export function MapCanvas({
  mode,
  threeDimensional,
  basemapMode,
  plHeatmapEnabled,
  plHeatmapOpacity,
  addressSearchOpen,
  spot,
  onModeChange,
  onSpotChange,
  onThreeDimensionalChange,
  onBasemapModeChange,
  onPlHeatmapEnabledChange,
  onPlHeatmapOpacityChange,
  onAddressSearchOpenChange,
  skyUtcMs,
  mySpotsOpen,
  onMySpotsOpenChange,
  framingsOpen,
  onFramingsOpenChange,
  personalSpots,
  personalSpotFolders,
  selectedPersonalSpotId,
  personalSpotPicking,
  onPlacePersonalSpot,
  onSelectPersonalSpot,
  onActivateWorkingPin,
  flyToPersonalSpotId,
  onFlyToPersonalSpotHandled,
  showAllPersonalSpotsToken,
  onRequestSaveSpot,
  onRequestEditSpot,
  markerMenuOpen,
  onMarkerMenuOpenChange,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const markerUiRef = useRef<SpotActionMarkerController | null>(null)
  const personalMarkersRef = useRef<Marker[]>([])
  const modeRef = useRef(mode)
  const spotRef = useRef(spot)
  const threeDimensionalRef = useRef(threeDimensional)
  const basemapModeRef = useRef(basemapMode)
  const plHeatmapEnabledRef = useRef(plHeatmapEnabled)
  const plHeatmapOpacityRef = useRef(plHeatmapOpacity)
  const personalSpotPickingRef = useRef(personalSpotPicking)
  const personalSpotsRef = useRef(personalSpots)
  const personalSpotFoldersRef = useRef(personalSpotFolders)
  const selectedPersonalSpotIdRef = useRef(selectedPersonalSpotId)
  const onModeChangeRef = useRef(onModeChange)
  const onSpotChangeRef = useRef(onSpotChange)
  const onThreeDimensionalChangeRef = useRef(onThreeDimensionalChange)
  const onPlHeatmapEnabledChangeRef = useRef(onPlHeatmapEnabledChange)
  const onPlacePersonalSpotRef = useRef(onPlacePersonalSpot)
  const onSelectPersonalSpotRef = useRef(onSelectPersonalSpot)
  const onActivateWorkingPinRef = useRef(onActivateWorkingPin)
  const onRequestSaveSpotRef = useRef(onRequestSaveSpot)
  const onRequestEditSpotRef = useRef(onRequestEditSpot)
  const onMarkerMenuOpenChangeRef = useRef(onMarkerMenuOpenChange)
  /** Open radial after selecting a saved camera pin (working pin remounts). */
  const pendingOpenMarkerMenuRef = useRef(false)

  const skyUtcMsRef = useRef(skyUtcMs)
  skyUtcMsRef.current = skyUtcMs

  modeRef.current = mode
  spotRef.current = spot
  threeDimensionalRef.current = threeDimensional
  basemapModeRef.current = basemapMode
  plHeatmapEnabledRef.current = plHeatmapEnabled
  plHeatmapOpacityRef.current = plHeatmapOpacity
  personalSpotPickingRef.current = personalSpotPicking
  personalSpotsRef.current = personalSpots
  personalSpotFoldersRef.current = personalSpotFolders
  selectedPersonalSpotIdRef.current = selectedPersonalSpotId
  onModeChangeRef.current = onModeChange
  onSpotChangeRef.current = onSpotChange
  onThreeDimensionalChangeRef.current = onThreeDimensionalChange
  onPlHeatmapEnabledChangeRef.current = onPlHeatmapEnabledChange
  onPlacePersonalSpotRef.current = onPlacePersonalSpot
  onSelectPersonalSpotRef.current = onSelectPersonalSpot
  onActivateWorkingPinRef.current = onActivateWorkingPin
  onRequestSaveSpotRef.current = onRequestSaveSpot
  onRequestEditSpotRef.current = onRequestEditSpot
  onMarkerMenuOpenChangeRef.current = onMarkerMenuOpenChange

  const apiRef = useRef<{
    setMode: (next: CameraMode) => void
    setThreeDimensional: (next: boolean) => void
    setBasemapMode: (next: BasemapMode) => Promise<void>
    setPlHeatmap: (enabled: boolean, opacity: number) => void
    flyToAddress: (result: AddressSearchResult) => void
    flyToMyLocation: () => void
    flyToPersonalSpot: (spot: PersonalSpot) => void
    showAllPersonalSpots: (spots: PersonalSpot[]) => void
  } | null>(null)

  /**
   * Always-fresh playhead apply — mount-effect flyTo closures must not keep a
   * stale copy that paints globe-day ortho after landing on a night spot.
   */
  const applyPlayheadSkyRef = useRef<() => void>(() => {})
  applyPlayheadSkyRef.current = () => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    const live = spotRef.current
    const lat = live?.lat ?? DEFAULT_MAP_VIEW.lat
    const lon = live?.lon ?? DEFAULT_MAP_VIEW.lon
    const elev = live?.heightM ?? 0
    const utc = skyUtcMsRef.current
    const sun = sunPositionAt(lat, lon, elev, utc)
    invalidateMapSkyCache(map)
    applyMapSky(map, skyPaletteFromSunAltitude(sun.altitudeDeg), {
      utcMs: utc,
      sunAzimuthDeg: sun.azimuthDeg,
      sunAltitudeDeg: sun.altitudeDeg,
      zoom: map.getZoom(),
    })
    if (import.meta.env.DEV) {
      ;(window as unknown as { __astroMap?: maplibregl.Map }).__astroMap = map
    }
  }
  if (import.meta.env.DEV) {
    ;(
      window as unknown as { __astroApplySky?: () => void }
    ).__astroApplySky = () => applyPlayheadSkyRef.current()
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    ensureEsriSafeImageryProtocol()
    ensureMapterhornSafeDemProtocol()
    ensureNightShadeProtocol()
    ensureLightPollutionProtocol()
    ensurePlMapOverlayProtocol()

    const map = new maplibregl.Map({
      container,
      style: buildStyle(),
      center: [DEFAULT_MAP_VIEW.lon, DEFAULT_MAP_VIEW.lat],
      zoom: DEFAULT_MAP_VIEW.zoom,
      pitch: DEFAULT_MAP_VIEW.pitchDeg,
      bearing: DEFAULT_MAP_VIEW.bearingDeg,
      maxPitch: 85,
      minZoom: 0.8,
      // DEM tiles are 512px → MapLibre fetches ~mapZoom−1; 18 unlocks Mapterhorn z17
      maxZoom: 18,
      // Instant paint — night dim must not ease from noon ortho after flyTo.
      fadeDuration: 0,
      attributionControl: false,
      fadeDuration: 0,
    })

    mapRef.current = map
    if (import.meta.env.DEV) {
      ;(window as unknown as { __astroMap?: maplibregl.Map }).__astroMap = map
    }

    const containerResizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            map.resize()
          })
        : null
    containerResizeObserver?.observe(container)

    const readElevation = (lng: number, lat: number) => {
      if (!map.getTerrain()) return null
      const elev = map.queryTerrainElevation({ lng, lat })
      return typeof elev === 'number' && Number.isFinite(elev) ? elev : null
    }

    const matchingSavedSpot = (lat: number, lon: number) =>
      personalSpotsRef.current.find(
        (row) =>
          Math.abs(row.lat - lat) < 1e-6 && Math.abs(row.lon - lon) < 1e-6,
      ) ?? null

    /** Ignore the map click that follows a touch long-press (mobile “right-click”). */
    let suppressMapClickUntil = 0
    let suppressSpotActionMenuUntil = 0

    const upsertMarker = (lng: number, lat: number) => {
      if (!markerRef.current || !markerUiRef.current) {
        markerUiRef.current?.destroy()
        const savedMatch = matchingSavedSpot(lat, lng)
        const markerUi = createSpotActionMarkerElement(Boolean(savedMatch), {
          onOpenChange: (open) => onMarkerMenuOpenChangeRef.current(open),
          shouldBlockOpen: () =>
            performance.now() < suppressSpotActionMenuUntil ||
            // Globe overview: never open the radial — click zooms the map instead.
            groundViewAmount(map.getZoom()) < 0.35,
          onActivate: () => {
            onActivateWorkingPinRef.current()
          },
          onStreetView: () => {
            const current = spotRef.current
            if (!current) return
            const url = streetViewUrlAt({
              lat: current.lat,
              lon: current.lon,
              headingDeg: current.bearingDeg,
              pitchDeg: 0,
            })
            window.open(url, '_blank', 'noopener,noreferrer')
          },
          onImmersive: () => {
            if (!spotRef.current) return
            onModeChangeRef.current('ground', { flatTerrain: false })
          },
          onSkyFlat: () => {
            if (!spotRef.current) return
            onModeChangeRef.current('ground', { flatTerrain: true })
          },
          onAdd: () => {
            onRequestSaveSpotRef.current()
            return false
          },
          onEdit: () => {
            onRequestEditSpotRef.current()
          },
        })
        if (savedMatch) markerUi.setLabel(savedMatch.name)
        markerUiRef.current = markerUi
        markerRef.current = new maplibregl.Marker({
          element: markerUi.element,
          anchor: 'center',
        })
          .setLngLat([lng, lat])
          .addTo(map)
      } else {
        markerRef.current.setLngLat([lng, lat])
        const match = matchingSavedSpot(lat, lng)
        markerUiRef.current.setSaved(Boolean(match))
        markerUiRef.current.setLabel(match?.name ?? null)
      }
      if (pendingOpenMarkerMenuRef.current) {
        pendingOpenMarkerMenuRef.current = false
        markerUiRef.current?.open()
      }
    }

    const publishSpot = (
      lat: number,
      lon: number,
      bearingDeg: number,
      pitchDeg: number,
    ) => {
      const next: SpotState = {
        lat,
        lon,
        heightM: readElevation(lon, lat) ?? spotRef.current?.heightM ?? 0,
        bearingDeg,
        pitchDeg,
      }
      upsertMarker(lon, lat)
      onSpotChangeRef.current(next)
      return next
    }

    // Ground mode is the Three.js view painted over this map. Flying the
    // camera on the way in or out used to run against a collapsed map and
    // left the spot markers off-screen when the user came back.
    const setMode: (next: CameraMode) => void = () => {}

    const setThreeDimensional = (next: boolean) => {
      threeDimensionalRef.current = next
      if (modeRef.current === 'ground') {
        map.easeTo({
          pitch: next ? 78 : FLAT_PITCH,
          duration: 500,
          essential: true,
        })
        return
      }
      map.easeTo({
        pitch: next ? THREE_D_PITCH : FLAT_PITCH,
        duration: 500,
        essential: true,
      })
    }

    const setBasemapMode = (next: BasemapMode) => {
      // applyBasemapMode waits for style.load after glyphs — never once('load'),
      // which misses clicks while isStyleLoaded is briefly false.
      return applyBasemapMode(map, next)
        .catch((error) => {
          console.error('[basemap]', error)
        })
        .finally(() => {
          // Hillshade paint is reset by basemap — restore playhead night/day.
          applyPlMapOverlay(map, {
            enabled: plHeatmapEnabledRef.current,
            opacity: plHeatmapOpacityRef.current,
          })
          applyPlayheadSkyRef.current()
        })
    }

    const setPlHeatmap = (enabled: boolean, opacity: number) => {
      void waitForStyleLoaded(map).then(() => {
        applyPlMapOverlay(map, { enabled, opacity })
        applyPlayheadSkyRef.current()
      })
    }

    /** Mid-fly Black Marble overzoom looked like a PL map — hide before zooming in. */
    const hideLightPollutionForGroundFly = () => {
      if (!map.getLayer(LIGHT_POLLUTION_LAYER_ID)) return
      try {
        map.setLayoutProperty(LIGHT_POLLUTION_LAYER_ID, 'visibility', 'none')
      } catch {
        // style not ready
      }
    }

    const flyToAddress = (result: AddressSearchResult) => {
      onModeChangeRef.current('orbit')
      if (!threeDimensionalRef.current) {
        onThreeDimensionalChangeRef.current(true)
        threeDimensionalRef.current = true
      }
      const pitch = THREE_D_PITCH
      hideLightPollutionForGroundFly()
      const targetZoom = 14
      if (result.bbox) {
        const [west, south, east, north] = result.bbox
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          {
            padding: 72,
            pitch,
            bearing: map.getBearing(),
            duration: 1400,
            maxZoom: 16,
          },
        )
      } else {
        map.flyTo({
          center: [result.lon, result.lat],
          zoom: targetZoom,
          pitch,
          essential: true,
          duration: 1400,
        })
      }
      settleGroundSkyAfterFly(map, 10, () => {
        publishSpot(result.lat, result.lon, map.getBearing(), pitch)
        applyPlayheadSkyRef.current()
      })
    }

    const flyToMyLocation = () => {
      if (!navigator.geolocation) return
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const lat = coords.latitude
          const lon = coords.longitude
          onModeChangeRef.current('orbit')
          if (!threeDimensionalRef.current) {
            onThreeDimensionalChangeRef.current(true)
            threeDimensionalRef.current = true
          }
          const pitch = threeDimensionalRef.current ? THREE_D_PITCH : FLAT_PITCH
          hideLightPollutionForGroundFly()
          const targetZoom = Math.max(map.getZoom(), 15)
          map.flyTo({
            center: [lon, lat],
            zoom: targetZoom,
            pitch,
            essential: true,
            duration: 850,
          })
          settleGroundSkyAfterFly(map, Math.min(targetZoom - 0.5, 12), () => {
            publishSpot(lat, lon, map.getBearing(), pitch)
            applyPlayheadSkyRef.current()
          })
        },
        () => {
          // Permission denied / timeout — silent for now
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
      )
    }

    const flyToPersonalSpot = (saved: PersonalSpot) => {
      onModeChangeRef.current('orbit')
      const pitch = threeDimensionalRef.current
        ? Math.min(Math.max(saved.pitchDeg, 45), 65)
        : FLAT_PITCH

      // Already on the map: activate pin only — no zoom. Globe: fly in.
      if (groundViewAmount(map.getZoom()) >= 0.35) {
        publishSpot(saved.lat, saved.lon, saved.bearingDeg, pitch)
        return
      }

      if (!threeDimensionalRef.current) {
        onThreeDimensionalChangeRef.current(true)
        threeDimensionalRef.current = true
      }
      hideLightPollutionForGroundFly()
      const targetZoom = Math.max(map.getZoom(), 13.5)
      map.flyTo({
        center: [saved.lon, saved.lat],
        zoom: targetZoom,
        pitch,
        bearing: saved.bearingDeg,
        essential: true,
        duration: 900,
      })
      // Spot list sets React state at globe zoom first (day paint). One-shot
      // moveend often fired mid-fly below the gate and never retried — noon stuck.
      settleGroundSkyAfterFly(map, Math.min(targetZoom - 0.5, 10), () => {
        publishSpot(saved.lat, saved.lon, saved.bearingDeg, pitch)
        applyPlayheadSkyRef.current()
      })
    }

    const showAllPersonalSpots = (spots: PersonalSpot[]) => {
      fitPersonalSpots(map, spots)
    }

    apiRef.current = {
      setMode,
      setThreeDimensional,
      setBasemapMode,
      setPlHeatmap,
      flyToAddress,
      flyToMyLocation,
      flyToPersonalSpot,
      showAllPersonalSpots,
    }

    let mapReadyDone = false
    const onMapReady = () => {
      if (mapReadyDone) return
      mapReadyDone = true
      map.setTerrain({
        source: 'terrain',
        exaggeration: TERRAIN_EXAGGERATION,
      })
      ensureGlobeMilkyWayLayer(map)
      // Playhead UTC — never Date.now(), or first shade tiles disagree with the dock.
      ensureNightShadeLayer(map, skyUtcMsRef.current)
      removeCelestialBodyMarkers(map)
      // Terminator + light before first paint settle — don't wait for a user pan.
      applyPlayheadSkyRef.current()
      setBasemapMode(basemapModeRef.current)
      // Don't restore PL at globe zoom — would flash the opacity bar then auto-close.
      if (
        plHeatmapEnabledRef.current &&
        map.getZoom() < PL_HEATMAP_MIN_ZOOM
      ) {
        onPlHeatmapEnabledChangeRef.current(false)
        setPlHeatmap(false, plHeatmapOpacityRef.current)
      } else {
        setPlHeatmap(plHeatmapEnabledRef.current, plHeatmapOpacityRef.current)
      }
      // One re-apply after first tiles are in; never on every moveend (that
      // rewrote light/veil and looked like time jumping on drag-release).
      map.once('idle', () => applyPlayheadSkyRef.current())
      // Permanent: spot-list fly sets React spot at globe zoom (day paint). The
      // spot-effect zoomend can miss the landing; this always re-dims on settle.
      map.on('zoomend', () => {
        applyPlayheadSkyRef.current()
      })
    }
    map.on('load', onMapReady)
    // Inline style can finish before 'load' is attached — don't skip basemap/PL.
    if (map.isStyleLoaded()) onMapReady()

    /** Place / move the working pin — temporary until saved; never opens panel. */
    const placeWorkingPin = (lat: number, lng: number) => {
      selectedPersonalSpotIdRef.current = null
      const bearing = map.getBearing()
      const pitch = threeDimensionalRef.current
        ? Math.max(map.getPitch(), THREE_D_PITCH)
        : FLAT_PITCH
      onModeChangeRef.current('orbit')
      publishSpot(lat, lng, bearing, pitch)
    }

    /** Globe overview: left-click zooms toward the cursor — no pin, no panel. */
    const zoomTowardCursor = (lng: number, lat: number) => {
      const z = map.getZoom()
      const nextZoom = Math.min(Math.max(z + 2.4, 5.8), 11.5)
      map.easeTo({
        center: [lng, lat],
        zoom: nextZoom,
        duration: 750,
        essential: true,
      })
    }

    const onMapClick = (event: MapMouseEvent) => {
      if (performance.now() < suppressMapClickUntil) return
      // Right-button / non-primary must never select or place via `click`
      // (some stacks synthesize click after contextmenu).
      const button = event.originalEvent?.button
      if (typeof button === 'number' && button !== 0) return

      const { lng, lat } = event.lngLat
      const bearing = map.getBearing()
      const pitch = threeDimensionalRef.current
        ? Math.max(map.getPitch(), THREE_D_PITCH)
        : FLAT_PITCH
      const heightM = readElevation(lng, lat) ?? 0

      // "Mes spots" picking / edit-relocate still uses left-click.
      if (personalSpotPickingRef.current) {
        publishSpot(lat, lng, bearing, pitch)
        onPlacePersonalSpotRef.current({
          lat,
          lon: lng,
          heightM,
          bearingDeg: bearing,
          pitchDeg: pitch,
        })
        // Keep crosshair while picking stays on (edit relocate is multi-click).
        map.getCanvas().style.cursor = 'crosshair'
        return
      }

      // Globe: zoom to cursor only — do not place a pin or open the panel.
      if (groundViewAmount(map.getZoom()) < 0.35) {
        zoomTowardCursor(lng, lat)
        return
      }

      // Left-click empty map does nothing — right-click / long-press places.
      // Left-click on a pin selects + opens the panel.
    }

    const onMapContextMenu = (event: MapMouseEvent) => {
      event.preventDefault()
      if (personalSpotPickingRef.current) return

      // Always place — never select. Suppress a follow-up `click` so a
      // right-click near a saved pin cannot be turned into a selection.
      const until = performance.now() + 900
      suppressMapClickUntil = until
      suppressSpotActionMenuUntil = until
      placeWorkingPin(event.lngLat.lat, event.lngLat.lng)
    }

    // Mobile has no right-click: long-press on the map canvas places the pin.
    const LONG_PRESS_MS = 480
    const LONG_PRESS_MOVE_PX = 14
    let longPressTimer: number | null = null
    let longPressStart: { x: number; y: number } | null = null

    const clearLongPressTimer = () => {
      if (longPressTimer != null) {
        window.clearTimeout(longPressTimer)
        longPressTimer = null
      }
      longPressStart = null
    }

    const onCanvasPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return
      if (event.button !== 0) return
      if (personalSpotPickingRef.current) return
      const canvas = map.getCanvas()
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      longPressStart = { x: event.clientX, y: event.clientY }
      clearLongPressTimer()
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null
        longPressStart = null
        const lngLat = map.unproject([x, y])
        const until = performance.now() + 900
        suppressMapClickUntil = until
        suppressSpotActionMenuUntil = until
        try {
          navigator.vibrate?.(12)
        } catch {
          /* optional */
        }
        placeWorkingPin(lngLat.lat, lngLat.lng)
      }, LONG_PRESS_MS)
    }

    const onCanvasPointerMove = (event: PointerEvent) => {
      if (!longPressStart || longPressTimer == null) return
      const dx = event.clientX - longPressStart.x
      const dy = event.clientY - longPressStart.y
      if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
        clearLongPressTimer()
      }
    }

    const onCanvasPointerEnd = () => {
      clearLongPressTimer()
    }

    map.on('click', onMapClick)
    map.on('contextmenu', onMapContextMenu)
    {
      const canvas = map.getCanvas()
      canvas.addEventListener('pointerdown', onCanvasPointerDown)
      canvas.addEventListener('pointermove', onCanvasPointerMove)
      canvas.addEventListener('pointerup', onCanvasPointerEnd)
      canvas.addEventListener('pointercancel', onCanvasPointerEnd)
      canvas.addEventListener('lostpointercapture', onCanvasPointerEnd)
    }

    const elevTimer = window.setInterval(() => {
      // Never rewrite height while immersive — that remounts the Three.js scene.
      if (modeRef.current === 'ground') return
      const current = spotRef.current
      if (!current) return
      const heightM = readElevation(current.lon, current.lat)
      if (heightM === null || Math.abs(heightM - current.heightM) < 1) return
      onSpotChangeRef.current({ ...current, heightM })
    }, 800)

    /** Close PL + opacity bar when the user dezooms past the useful floor. */
    const gatePlHeatmapZoom = () => {
      if (!plHeatmapEnabledRef.current) return
      if (map.getZoom() >= PL_HEATMAP_MIN_ZOOM) return
      onPlHeatmapEnabledChangeRef.current(false)
    }
    map.on('zoomend', gatePlHeatmapZoom)
    void waitForStyleLoaded(map).then(() => {
      if (mapRef.current === map) gatePlHeatmapZoom()
    })

    return () => {
      window.clearInterval(elevTimer)
      map.off('zoomend', gatePlHeatmapZoom)
      // Keep MapLibre in sync when the spots rail resizes the map stage.
      containerResizeObserver?.disconnect()
      clearLongPressTimer()
      map.off('click', onMapClick)
      map.off('contextmenu', onMapContextMenu)
      {
        const canvas = map.getCanvas()
        canvas.removeEventListener('pointerdown', onCanvasPointerDown)
        canvas.removeEventListener('pointermove', onCanvasPointerMove)
        canvas.removeEventListener('pointerup', onCanvasPointerEnd)
        canvas.removeEventListener('pointercancel', onCanvasPointerEnd)
        canvas.removeEventListener('lostpointercapture', onCanvasPointerEnd)
      }
      apiRef.current = null
      for (const marker of personalMarkersRef.current) marker.remove()
      personalMarkersRef.current = []
      markerUiRef.current?.destroy()
      markerUiRef.current = null
      markerRef.current?.remove()
      markerRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    apiRef.current?.setMode(mode)
  }, [mode])

  useEffect(() => {
    apiRef.current?.setThreeDimensional(threeDimensional)
  }, [threeDimensional])

  const [basemapApplying, setBasemapApplying] = useState(false)
  const basemapApplySeqRef = useRef(0)

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    const seq = ++basemapApplySeqRef.current
    setBasemapApplying(true)
    void api.setBasemapMode(basemapMode).finally(() => {
      if (basemapApplySeqRef.current === seq) setBasemapApplying(false)
    })
  }, [basemapMode])

  useEffect(() => {
    apiRef.current?.setPlHeatmap(plHeatmapEnabled, plHeatmapOpacity)
  }, [plHeatmapEnabled, plHeatmapOpacity])

  /**
   * Enable PL from globe: ease into a useful zoom. Zooming back out past the
   * floor closes the control (opacity bar animates shut via CSS).
   */
  const requestPlHeatmapEnabled = useCallback(
    (next: boolean) => {
      if (next) {
        const map = mapRef.current
        if (map && map.getZoom() < PL_HEATMAP_MIN_ZOOM) {
          map.easeTo({
            zoom: PL_HEATMAP_ENABLE_ZOOM,
            duration: 900,
            essential: true,
          })
        }
      }
      onPlHeatmapEnabledChange(next)
    },
    [onPlHeatmapEnabledChange],
  )

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = personalSpotPicking ? 'crosshair' : ''
    return () => {
      map.getCanvas().style.cursor = ''
    }
  }, [personalSpotPicking])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const sync = () => {
      for (const marker of personalMarkersRef.current) marker.remove()
      const mapVisible = filterMapVisiblePersonalSpots(
        personalSpots,
        personalSpotFolders,
      )
      personalMarkersRef.current = renderPersonalSpotMarkers(
        map,
        mapVisible,
        selectedPersonalSpotId,
        (saved) => {
          // Globe click zooms in — don't also open the actions panel.
          if (groundViewAmount(map.getZoom()) >= 0.35) {
            pendingOpenMarkerMenuRef.current = true
          }
          onSelectPersonalSpotRef.current(saved)
        },
        spot,
      )
    }

    // Prefer style.load over load: another load handler throwing must not
    // leave Mes spots without markers (applyPlayheadSky bare-name burn).
    if (map.isStyleLoaded()) sync()
    map.on('load', sync)
    map.on('style.load', sync)

    return () => {
      map.off('load', sync)
      map.off('style.load', sync)
      for (const marker of personalMarkersRef.current) marker.remove()
      personalMarkersRef.current = []
    }
  }, [personalSpots, personalSpotFolders, selectedPersonalSpotId, spot])

  useEffect(() => {
    const ui = markerUiRef.current
    if (!spot) {
      ui?.destroy()
      markerUiRef.current = null
      markerRef.current?.remove()
      markerRef.current = null
      return
    }
    if (!ui) return
    const match =
      personalSpots.find(
        (row) =>
          Math.abs(row.lat - spot.lat) < 1e-6 &&
          Math.abs(row.lon - spot.lon) < 1e-6,
      ) ?? null
    ui.setSaved(Boolean(match))
    ui.setLabel(match?.name ?? null)
    if (pendingOpenMarkerMenuRef.current) {
      pendingOpenMarkerMenuRef.current = false
      ui.open()
    }
  }, [spot, personalSpots, selectedPersonalSpotId])

  useEffect(() => {
    if (markerMenuOpen) return
    markerUiRef.current?.close()
  }, [markerMenuOpen])

  useEffect(() => {
    if (!flyToPersonalSpotId) return
    const saved = personalSpots.find((row) => row.id === flyToPersonalSpotId)
    if (saved) apiRef.current?.flyToPersonalSpot(saved)
    onFlyToPersonalSpotHandled()
  }, [flyToPersonalSpotId, personalSpots, onFlyToPersonalSpotHandled])

  useEffect(() => {
    if (showAllPersonalSpotsToken <= 0) return
    apiRef.current?.showAllPersonalSpots(
      filterMapVisiblePersonalSpots(
        personalSpotsRef.current,
        personalSpotFoldersRef.current,
      ),
    )
  }, [showAllPersonalSpotsToken])

  useEffect(() => {
    const map = mapRef.current
    // The immersive renderer owns the visible sky while the map is covered.
    if (!map || (mode === 'ground' && spot != null)) return
    let lastAppliedZoom = map.getZoom()
    let lastGround = groundViewAmount(lastAppliedZoom) >= 0.35
    const apply = () => {
      if (!map.isStyleLoaded()) return
      lastAppliedZoom = map.getZoom()
      lastGround = groundViewAmount(lastAppliedZoom) >= 0.35
      // Use the live ref so night dim matches current zoom after flyTo landing.
      applyPlayheadSkyRef.current()
    }
    /** Catch globe→spot flyTo (and pans that change framing) without thrashing every frame. */
    const onMoveEnd = () => {
      const z = map.getZoom()
      const ground = groundViewAmount(z) >= 0.35
      // Always re-apply when crossing globe↔ground — spot list paints day at
      // globe zoom, then fly lands without a large lastAppliedZoom delta miss.
      if (ground !== lastGround) {
        apply()
        return
      }
      if (Math.abs(z - lastAppliedZoom) < 0.15) return
      apply()
    }
    void waitForStyleLoaded(map).then(apply)
    map.on('zoomend', apply)
    map.on('moveend', onMoveEnd)
    return () => {
      map.off('zoomend', apply)
      map.off('moveend', onMoveEnd)
    }
  }, [mode, skyUtcMs, spot?.lat, spot?.lon, spot?.heightM])

  const [bortleSample, setBortleSample] = useState<LightPollutionSample | null>(
    null,
  )
  const [skyBrightnessOpen, setSkyBrightnessOpen] = useState(false)

  useEffect(() => {
    if (!spot) {
      setBortleSample(null)
      setSkyBrightnessOpen(false)
      return
    }
    let cancelled = false
    const { lat, lon, heightM } = spot
    void sampleLightPollution(lat, lon, { observerElevM: heightM }).then(
      (sample) => {
        if (cancelled) return
        setBortleSample(sample)
      },
    )
    return () => {
      cancelled = true
    }
  }, [spot])

  return (
    <div className="globe-shell">
      <div ref={containerRef} className="globe-canvas" />
      <MapControlsStack
        mapRef={mapRef}
        threeDimensional={threeDimensional}
        onThreeDimensionalChange={onThreeDimensionalChange}
        basemapMode={basemapMode}
        basemapApplying={basemapApplying}
        onBasemapModeChange={onBasemapModeChange}
        plHeatmapEnabled={plHeatmapEnabled}
        plHeatmapOpacity={plHeatmapOpacity}
        onPlHeatmapEnabledChange={requestPlHeatmapEnabled}
        onPlHeatmapOpacityChange={onPlHeatmapOpacityChange}
        addressSearchOpen={addressSearchOpen}
        onAddressSearchOpenChange={onAddressSearchOpenChange}
        onAddressSelect={(result) => apiRef.current?.flyToAddress(result)}
        onMyLocation={() => apiRef.current?.flyToMyLocation()}
        mySpotsOpen={mySpotsOpen}
        onMySpotsOpenChange={onMySpotsOpenChange}
        framingsOpen={framingsOpen}
        onFramingsOpenChange={onFramingsOpenChange}
      />
      <MapSettingsPanel />
      {plHeatmapEnabled ? <PlMapOverlayLegend /> : null}
      {spot && bortleSample ? (
        <SpotBortleCard
          bortle={bortleSample.bortle}
          label={bortleSample.bortleLabel}
          lat={spot.lat}
          lon={spot.lon}
          elevM={spot.heightM}
          skyBrightnessMag={bortleSample.skyBrightnessMag}
          sourceHint={
            bortleSample.source === 'viirs-cog'
              ? bortleSample.terrainApplied
                ? 'VIIRS · First Rig · DEM · estimé'
                : 'VIIRS · First Rig · estimé'
              : 'Black Marble · First Rig · estimé'
          }
          onOpenSkyBrightness={() => setSkyBrightnessOpen(true)}
        />
      ) : spot ? (
        <p className="spot-readout">
          {formatCoord(spot.lat, spot.lon)} · {Math.round(spot.heightM)} m
        </p>
      ) : null}
      {spot && bortleSample ? (
        <SkyBrightnessPanel
          open={skyBrightnessOpen}
          onClose={() => setSkyBrightnessOpen(false)}
          lat={spot.lat}
          lon={spot.lon}
          elevM={spot.heightM}
          sample={bortleSample}
        />
      ) : null}
    </div>
  )
}
