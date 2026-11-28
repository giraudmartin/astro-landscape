import { useCallback, useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { setWorkerUrl } from 'maplibre-gl'
import type { Map, MapMouseEvent, Marker, StyleSpecification } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { AddressSearchResult } from './addressSearch'
import { track } from './analytics/umami'
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
  getPlHeatmapEnabledForMap,
  isPlMapOverlaySourceReady,
  PL_HEATMAP_ENABLE_ZOOM,
  PL_HEATMAP_MIN_ZOOM,
  PL_MAP_OVERLAY_ATTRIBUTION,
  PL_MAP_OVERLAY_FADE_MS,
  PL_MAP_OVERLAY_LAYER_ID,
  PL_MAP_OVERLAY_MAX_ZOOM,
  PL_MAP_OVERLAY_MIN_ZOOM,
  PL_MAP_OVERLAY_OPACITY_DEFAULT,
  PL_MAP_OVERLAY_REVEAL_TIMEOUT_MS,
  PL_MAP_OVERLAY_SOURCE_ID,
  PL_MAP_OVERLAY_TILE_URL,
  setPlMapOverlayOpacity,
} from './lightPollution/plMapOverlay'
import { AppBrandMark } from './AppBrandMark'
import { MapControlsStack } from './MapControlsStack'
import { MapSettingsPanel } from './MapSettingsPanel'
import { OnboardingIntroHost } from './onboarding'
import { TOUR_DEMO_SPOT } from './onboarding/tourDemoSpot'
import {
  TOUR_CLEAR_MAP_FRAME_EVENT,
  TOUR_FLY_TO_DEMO_EVENT,
} from './onboarding/tourEvents'
import {
  filterMapVisiblePersonalSpots,
  fitPersonalSpots,
  renderPersonalSpotMarkers,
  type PersonalMarkerEntry,
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
  createSpotActionMarkerElement,
  type SpotActionMarkerController,
} from './spotActionMarker'
import { streetViewUrlAt } from './streetView'
import { useT } from './i18n'

setWorkerUrl(maplibreWorkerUrl)

/** Drop a previous in-flight settle when a new fly starts (avoids stacked polls). */
let cancelActiveGroundSkySettle: (() => void) | null = null

/**
 * Phone tour: bottom padding so MapLibre centers in the free band between the
 * top of the canvas and the top of the coach card (= 50% of that band).
 * One camera call with this padding — no chase offset / second ease.
 */
function tourPhoneCardBottomPadding(map: Map): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 0
  // Keep in sync with OPERATE_PHONE_MQ / tour.css phone dock.
  if (!window.matchMedia('(max-width: 720px)').matches) return 0
  if (!document.querySelector('.onboarding-tour-root')) return 0

  const canvas = map.getCanvas()
  const mapRect = canvas.getBoundingClientRect()
  const card = document.querySelector<HTMLElement>('.onboarding-tour__card')
  const cardRect = card?.getBoundingClientRect()
  if (!cardRect || cardRect.height < 40) return 0

  return Math.max(0, Math.round(mapRect.bottom - cardRect.top))
}

function tourPhonePaddingOptions(map: Map): {
  top: number
  bottom: number
  left: number
  right: number
} {
  return {
    top: 0,
    bottom: tourPhoneCardBottomPadding(map),
    left: 0,
    right: 0,
  }
}

function clearTourPhonePadding(map: Map): void {
  map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 })
}

/**
 * After globe→spot flyTo, apply night dim once the camera is in ground framing.
 * Never land on the first frames (that killed the visible zoom-out arc).
 */
function settleGroundSkyAfterFly(
  map: Map,
  minZoom: number,
  onLand: () => void,
): void {
  cancelActiveGroundSkySettle?.()
  let landed = false
  const teardown = () => {
    window.clearInterval(poll)
    window.clearTimeout(hardDeadline)
    map.off('moveend', onMoveEnd)
    if (cancelActiveGroundSkySettle === cancel) cancelActiveGroundSkySettle = null
  }
  const cancel = () => {
    if (landed) return
    landed = true
    teardown()
  }
  cancelActiveGroundSkySettle = cancel
  const finish = (force: boolean) => {
    if (landed) return
    if (!force && map.getZoom() < minZoom) return
    if (!force && map.isMoving()) return
    landed = true
    teardown()
    onLand()
  }
  const onMoveEnd = () => {
    if (map.getZoom() < minZoom) return
    finish(true)
  }
  const poll = window.setInterval(() => finish(false), 160)
  const hardDeadline = window.setTimeout(() => finish(true), 4000)
  map.on('moveend', onMoveEnd)
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
  plLegendOpen: boolean
  onPlLegendOpenChange: (next: boolean) => void
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
  /** Onboarding: keep radial open but disable spokes + close (X). */
  markerActionsLocked?: boolean
}

const THREE_D_PITCH = 55
const FLAT_PITCH = 0

function demSource(): maplibregl.RasterDEMSourceSpecification {
  return {
    type: 'raster-dem',
    tiles: [MAPTERHORN_DEM_URL],
    encoding: 'terrarium',
    tileSize: 512,
    maxzoom: DEM_MAX_ZOOM - 1,
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
        // The layer gates visibility at camera zoom 6. At a steep pitch its
        // uniform coverage can still need a coarser overview tile.
        minzoom: 0,
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
          // Soft in — avoid tile-by-tile pops after the first reveal.
          'raster-fade-duration': PL_MAP_OVERLAY_FADE_MS,
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
  plLegendOpen,
  onPlLegendOpenChange,
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
  markerActionsLocked = false,
}: MapCanvasProps) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const markerUiRef = useRef<SpotActionMarkerController | null>(null)
  const personalMarkersRef = useRef(new globalThis.Map<string, PersonalMarkerEntry>())
  const scheduleElevationRef = useRef<() => void>(() => {})
  const modeRef = useRef(mode)
  const spotRef = useRef(spot)
  const threeDimensionalRef = useRef(threeDimensional)
  const basemapModeRef = useRef(basemapMode)
  const plHeatmapEnabledRef = useRef(plHeatmapEnabled)
  const plHeatmapOpacityRef = useRef(plHeatmapOpacity)
  /** True after the first idle reveal for the current PL-on cycle. */
  const plHeatmapRevealedRef = useRef(false)
  const plRevealSeqRef = useRef(0)
  const beginPlHeatmapRevealRef = useRef<() => void>(() => {})
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
  const markerMenuOpenRef = useRef(markerMenuOpen)
  /** Open radial after selecting a saved camera pin (working pin remounts). */
  const pendingOpenMarkerMenuRef = useRef(false)
  /** Programmatic spot (tour, etc.): create/move the working pin outside map clicks. */
  const syncWorkingPinRef = useRef<(lat: number, lon: number) => void>(() => {})

  const skyUtcMsRef = useRef(skyUtcMs)
  skyUtcMsRef.current = skyUtcMs
  /**
   * Fly destination for local sun — selectPersonalSpot delays setSpot until
   * landing, and render sync can briefly clobber spotRef with the old spot.
   * Lighting must still track the place we're flying to.
   */
  const skyFocusRef = useRef<{ lat: number; lon: number; elevM: number } | null>(
    null,
  )
  /** Bust in-flight style/idle retries when a newer apply is requested. */
  const skyApplyGenRef = useRef(0)
  const skyRetryPendingRef = useRef(false)

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
  markerMenuOpenRef.current = markerMenuOpen

  // Drop fly focus once React spot matches the destination.
  if (
    spot &&
    skyFocusRef.current &&
    Math.abs(spot.lat - skyFocusRef.current.lat) < 1e-5 &&
    Math.abs(spot.lon - skyFocusRef.current.lon) < 1e-5
  ) {
    skyFocusRef.current = {
      lat: spot.lat,
      lon: spot.lon,
      elevM: spot.heightM,
    }
  }

  const apiRef = useRef<{
    setMode: (next: CameraMode) => void
    setThreeDimensional: (next: boolean) => void
    setBasemapMode: (next: BasemapMode) => Promise<void>
    setPlHeatmap: (enabled: boolean, opacity: number) => void
    flyToAddress: (result: AddressSearchResult) => void
    flyToMyLocation: () => void
    flyToPersonalSpot: (spot: PersonalSpot) => void
    flyToTourDemo: () => void
    showAllPersonalSpots: (spots: PersonalSpot[]) => void
  } | null>(null)

  /**
   * Always-fresh playhead apply — mount-effect flyTo closures must not keep a
   * stale copy that paints globe-day ortho after landing on a night spot.
   * Never silent-return on !isStyleLoaded: DEM/imagery load at land makes that
   * true often, and noon ortho then sticks while the timeline shows night.
   */
  const applyPlayheadSkyRef = useRef<() => void>(() => {})
  applyPlayheadSkyRef.current = () => {
    const map = mapRef.current
    if (!map) return
    // Imagery layer is enough — isStyleLoaded() stays false for long stretches
    // while DEM/PL tiles stream, and silent-skip left noon ortho stuck.
    if (!map.getLayer('imagery')) {
      if (skyRetryPendingRef.current) return
      skyRetryPendingRef.current = true
      const gen = skyApplyGenRef.current
      const retry = () => {
        if (skyApplyGenRef.current !== gen) return
        skyRetryPendingRef.current = false
        if (mapRef.current !== map) return
        applyPlayheadSkyRef.current()
      }
      void waitForStyleLoaded(map).then(retry)
      map.once('idle', retry)
      return
    }
    skyRetryPendingRef.current = false
    const focus = skyFocusRef.current
    const live = spotRef.current
    const lat = focus?.lat ?? live?.lat ?? DEFAULT_MAP_VIEW.lat
    const lon = focus?.lon ?? live?.lon ?? DEFAULT_MAP_VIEW.lon
    const elev = focus?.elevM ?? live?.heightM ?? 0
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
  /** Apply now and once more when tiles settle — land often races style load. */
  const applyPlayheadSkyNowAndOnIdleRef = useRef<(map: Map) => void>(() => {})
  applyPlayheadSkyNowAndOnIdleRef.current = (map: Map) => {
    skyApplyGenRef.current += 1
    skyRetryPendingRef.current = false
    const gen = skyApplyGenRef.current
    applyPlayheadSkyRef.current()
    map.once('idle', () => {
      if (skyApplyGenRef.current !== gen) return
      applyPlayheadSkyRef.current()
    })
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
      // Keep imagery zoomable to 18 while the map overzooms the z16 relief.
      maxZoom: 18,
      // Instant paint — night dim must not ease from noon ortho after flyTo.
      fadeDuration: 0,
      attributionControl: false,
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
      if (pendingOpenMarkerMenuRef.current || markerMenuOpenRef.current) {
        pendingOpenMarkerMenuRef.current = false
        markerUiRef.current?.open()
      }
    }

    syncWorkingPinRef.current = (lat, lon) => {
      upsertMarker(lon, lat)
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
          // Stale apply from the map StrictMode just removed — the live map
          // has its own apply. isStyleLoaded on the dead map warns and throws.
          if (mapRef.current !== map) return
          // Hillshade paint is reset by basemap — restore playhead night/day.
          applyPlMapOverlay(map, {
            enabled: plHeatmapEnabledRef.current,
            opacity: plHeatmapRevealedRef.current
              ? plHeatmapOpacityRef.current
              : 0,
          })
          applyPlayheadSkyRef.current()
          // Basemap wipe mid-reveal — wait for tiles again before fading in.
          if (
            plHeatmapEnabledRef.current &&
            !plHeatmapRevealedRef.current
          ) {
            beginPlHeatmapRevealRef.current()
          }
        })
    }

    const paintOpacityForCurrentReveal = (opacity: number) =>
      plHeatmapRevealedRef.current ? opacity : 0

    const setPlHeatmap = (enabled: boolean, opacity: number) => {
      // Opacity-only when the overlay is truly showing. Never skip full apply if
      // layout visibility was wiped (basemap reload) while WeakMap still says on.
      if (enabled && getPlHeatmapEnabledForMap(map) === true && map.isStyleLoaded()) {
        try {
          if (
            map.getLayoutProperty(PL_MAP_OVERLAY_LAYER_ID, 'visibility') ===
              'visible' &&
            setPlMapOverlayOpacity(map, paintOpacityForCurrentReveal(opacity))
          ) {
            return
          }
        } catch {
          // fall through to full apply
        }
      }
      void waitForStyleLoaded(map).then(() => {
        applyPlMapOverlay(map, {
          enabled: plHeatmapEnabledRef.current,
          opacity: paintOpacityForCurrentReveal(plHeatmapOpacityRef.current),
        })
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
      track('place_search')
      onModeChangeRef.current('orbit')
      if (!threeDimensionalRef.current) {
        onThreeDimensionalChangeRef.current(true)
        threeDimensionalRef.current = true
      }
      const pitch = THREE_D_PITCH
      hideLightPollutionForGroundFly()
      const targetZoom = 14
      skyFocusRef.current = {
        lat: result.lat,
        lon: result.lon,
        elevM: spotRef.current?.heightM ?? 0,
      }
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
        applyPlayheadSkyNowAndOnIdleRef.current(map)
      })
    }

    const flyToMyLocation = () => {
      if (!navigator.geolocation) return
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          track('locate_me')
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
          skyFocusRef.current = {
            lat,
            lon,
            elevM: spotRef.current?.heightM ?? 0,
          }
          map.flyTo({
            center: [lon, lat],
            zoom: targetZoom,
            pitch,
            essential: true,
            duration: 850,
          })
          settleGroundSkyAfterFly(map, Math.min(targetZoom - 0.5, 12), () => {
            publishSpot(lat, lon, map.getBearing(), pitch)
            applyPlayheadSkyNowAndOnIdleRef.current(map)
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

      hideLightPollutionForGroundFly()

      const targetZoom = 13.5
      // Destination sun for mid-fly ground-crossing applies — delayed setSpot
      // must not leave noon ortho from the previous spot / DEFAULT_MAP_VIEW.
      skyFocusRef.current = {
        lat: saved.lat,
        lon: saved.lon,
        elevM: saved.heightM ?? spotRef.current?.heightM ?? 0,
      }
      skyApplyGenRef.current += 1
      skyRetryPendingRef.current = false
      // One flyTo with zoom-out → zoom-in. Never easeTo at ground zoom across
      // oceans (black void, looks like no camera move then a pop-in).
      cancelActiveGroundSkySettle?.()
      map.stop()
      const tourPad = tourPhonePaddingOptions(map)
      map.flyTo({
        center: [saved.lon, saved.lat],
        zoom: targetZoom,
        pitch,
        bearing: saved.bearingDeg,
        essential: true,
        duration: 1800,
        curve: 1.42,
        padding: tourPad,
      })

      settleGroundSkyAfterFly(map, Math.min(targetZoom - 0.5, 10), () => {
        const heightM =
          saved.heightM ??
          readElevation(saved.lon, saved.lat) ??
          spotRef.current?.heightM ??
          0
        const next: SpotState = {
          lat: saved.lat,
          lon: saved.lon,
          heightM,
          bearingDeg: saved.bearingDeg,
          pitchDeg: pitch,
        }
        skyFocusRef.current = { lat: next.lat, lon: next.lon, elevM: heightM }
        spotRef.current = next
        upsertMarker(saved.lon, saved.lat)
        onSpotChangeRef.current(next)
        applyPlayheadSkyNowAndOnIdleRef.current(map)
      })
    }

    const showAllPersonalSpots = (spots: PersonalSpot[]) => {
      fitPersonalSpots(map, spots)
    }

    /**
     * Tour: one camera move to Mirador, framed with bottom padding = card stack
     * so the pin lands at 50% of (screen top → card top). No second chase ease.
     */
    const flyToTourDemo = () => {
      onModeChangeRef.current('orbit')
      if (!threeDimensionalRef.current) {
        onThreeDimensionalChangeRef.current(true)
        threeDimensionalRef.current = true
      }
      hideLightPollutionForGroundFly()
      const pitch = THREE_D_PITCH
      skyFocusRef.current = {
        lat: TOUR_DEMO_SPOT.lat,
        lon: TOUR_DEMO_SPOT.lon,
        elevM: TOUR_DEMO_SPOT.heightM,
      }

      const padding = tourPhonePaddingOptions(map)
      const here = map.getCenter()
      const alreadyThere =
        Math.abs(here.lng - TOUR_DEMO_SPOT.lon) < 0.003 &&
        Math.abs(here.lat - TOUR_DEMO_SPOT.lat) < 0.003 &&
        Math.abs(map.getZoom() - TOUR_DEMO_SPOT.zoom) < 1.25

      map.stop()
      if (alreadyThere) {
        map.easeTo({
          center: [TOUR_DEMO_SPOT.lon, TOUR_DEMO_SPOT.lat],
          zoom: TOUR_DEMO_SPOT.zoom,
          pitch,
          bearing: TOUR_DEMO_SPOT.bearingDeg,
          padding,
          duration: 320,
          essential: true,
        })
        return
      }

      map.flyTo({
        center: [TOUR_DEMO_SPOT.lon, TOUR_DEMO_SPOT.lat],
        zoom: TOUR_DEMO_SPOT.zoom,
        pitch,
        bearing: TOUR_DEMO_SPOT.bearingDeg,
        padding,
        essential: true,
        duration: 1600,
      })
      settleGroundSkyAfterFly(map, 10, () => {
        applyPlayheadSkyNowAndOnIdleRef.current(map)
      })
    }

    apiRef.current = {
      setMode,
      setThreeDimensional,
      setBasemapMode,
      setPlHeatmap,
      flyToAddress,
      flyToMyLocation,
      flyToPersonalSpot,
      flyToTourDemo,
      showAllPersonalSpots,
    }

    let mapReadyDone = false
    const onMapReady = () => {
      if (mapReadyDone) return
      mapReadyDone = true
      // A single raster level avoids a visible boundary between the overview
      // and detailed light maps when the camera looks towards the horizon.
      map.setSourceTileLodParams(1, 3, PL_MAP_OVERLAY_SOURCE_ID)
      map.setSourceTileLodParams(1, 3, 'imagery')
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
      // Prefetch PL tiles at opacity 0 in parallel with basemap glyphs — cuts the
      // long gap after map settle without touching the immersive terrain loader.
      if (
        plHeatmapEnabledRef.current &&
        map.getZoom() >= PL_HEATMAP_MIN_ZOOM
      ) {
        applyPlMapOverlay(map, { enabled: true, opacity: 0 })
      }
      setBasemapMode(basemapModeRef.current)
      // Don't restore PL at globe zoom — would flash the opacity bar then auto-close.
      if (
        plHeatmapEnabledRef.current &&
        map.getZoom() < PL_HEATMAP_MIN_ZOOM
      ) {
        onPlHeatmapEnabledChangeRef.current(false)
        setPlHeatmap(false, plHeatmapOpacityRef.current)
      } else if (plHeatmapEnabledRef.current) {
        // Hold opacity 0 + spinner until PL source tiles are in.
        beginPlHeatmapRevealRef.current()
      } else {
        setPlHeatmap(false, plHeatmapOpacityRef.current)
      }
      // One re-apply after first tiles are in; never on every moveend (that
      // rewrote light/veil and looked like time jumping on drag-release).
      map.once('idle', () => applyPlayheadSkyRef.current())

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
    // Strict: any real finger travel OR MapLibre pan/zoom/rotate cancels —
    // only a still hold places a marker.
    const LONG_PRESS_MS = 480
    const LONG_PRESS_MOVE_PX = 10
    let longPressTimer: number | null = null
    let longPressStart: { x: number; y: number; pointerId: number } | null =
      null

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
      clearLongPressTimer()
      const canvas = map.getCanvas()
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const pointerId = event.pointerId
      longPressStart = {
        x: event.clientX,
        y: event.clientY,
        pointerId,
      }
      longPressTimer = window.setTimeout(() => {
        // Still holding the same finger with no cancel → place.
        if (!longPressStart || longPressStart.pointerId !== pointerId) return
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
      if (event.pointerId !== longPressStart.pointerId) return
      const dx = event.clientX - longPressStart.x
      const dy = event.clientY - longPressStart.y
      if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
        clearLongPressTimer()
      }
    }

    const onCanvasPointerEnd = (event: PointerEvent) => {
      if (
        longPressStart &&
        event.pointerId != null &&
        event.pointerId !== longPressStart.pointerId
      ) {
        return
      }
      clearLongPressTimer()
    }

    // MapLibre often captures the pointer once a drag starts — canvas
    // pointermove may stop firing, so cancel on camera gesture start too.
    const onMapGestureStart = () => {
      clearLongPressTimer()
    }

    map.on('click', onMapClick)
    map.on('contextmenu', onMapContextMenu)
    map.on('dragstart', onMapGestureStart)
    map.on('zoomstart', onMapGestureStart)
    map.on('rotatestart', onMapGestureStart)
    map.on('pitchstart', onMapGestureStart)
    {
      const canvas = map.getCanvas()
      canvas.addEventListener('pointerdown', onCanvasPointerDown)
      // Window move: still cancel if the finger slides after MapLibre capture.
      window.addEventListener('pointermove', onCanvasPointerMove)
      window.addEventListener('pointerup', onCanvasPointerEnd)
      window.addEventListener('pointercancel', onCanvasPointerEnd)
      canvas.addEventListener('lostpointercapture', onCanvasPointerEnd)
    }

    let elevationFrame = 0
    const updateElevation = () => {
      elevationFrame = 0
      // Never rewrite height while immersive — that remounts the Three.js scene.
      if (modeRef.current === 'ground') return
      const current = spotRef.current
      if (!current) return
      const heightM = readElevation(current.lon, current.lat)
      if (heightM === null || Math.abs(heightM - current.heightM) < 1) return
      onSpotChangeRef.current({ ...current, heightM })
    }
    const scheduleElevation = () => {
      if (!elevationFrame && spotRef.current && modeRef.current !== 'ground') {
        elevationFrame = requestAnimationFrame(updateElevation)
      }
    }
    const onTerrainData = (event: maplibregl.MapSourceDataEvent) => {
      if (event.sourceId === 'terrain') scheduleElevation()
    }
    scheduleElevationRef.current = scheduleElevation
    map.on('sourcedata', onTerrainData)
    map.on('idle', scheduleElevation)

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
      scheduleElevationRef.current = () => {}
      syncWorkingPinRef.current = () => {}
      map.off('sourcedata', onTerrainData)
      map.off('idle', scheduleElevation)
      map.off('zoomend', gatePlHeatmapZoom)
      cancelAnimationFrame(elevationFrame)
      // Keep MapLibre in sync when the spots rail resizes the map stage.
      containerResizeObserver?.disconnect()
      clearLongPressTimer()
      map.off('click', onMapClick)
      map.off('contextmenu', onMapContextMenu)
      map.off('dragstart', onMapGestureStart)
      map.off('zoomstart', onMapGestureStart)
      map.off('rotatestart', onMapGestureStart)
      map.off('pitchstart', onMapGestureStart)
      {
        const canvas = map.getCanvas()
        canvas.removeEventListener('pointerdown', onCanvasPointerDown)
        window.removeEventListener('pointermove', onCanvasPointerMove)
        window.removeEventListener('pointerup', onCanvasPointerEnd)
        window.removeEventListener('pointercancel', onCanvasPointerEnd)
        canvas.removeEventListener('lostpointercapture', onCanvasPointerEnd)
      }
      apiRef.current = null
      for (const { marker } of personalMarkersRef.current.values()) marker.remove()
      personalMarkersRef.current.clear()
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

  useEffect(() => {
    scheduleElevationRef.current()
  }, [spot, mode])

  const [basemapApplying, setBasemapApplying] = useState(false)
  // Show the small PL spinner immediately when restored on at launch.
  const [plHeatmapLoading, setPlHeatmapLoading] = useState(plHeatmapEnabled)
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

  /**
   * PL enable: opacity 0 + small control spinner until the PL source itself is
   * loaded (not basemap idle — that fired ~30s early at launch). Fade in then.
   * Runs in parallel with map/basemap work; never extends immersive terrain loader.
   */
  useEffect(() => {
    if (!plHeatmapEnabled) {
      plRevealSeqRef.current += 1
      plHeatmapRevealedRef.current = false
      setPlHeatmapLoading(false)
      apiRef.current?.setPlHeatmap(false, plHeatmapOpacityRef.current)
      return
    }

    const seq = ++plRevealSeqRef.current
    plHeatmapRevealedRef.current = false
    setPlHeatmapLoading(true)

    let cancelled = false
    let timeoutId: number | null = null
    let sourceHandler: ((e: { sourceId?: string; isSourceLoaded?: boolean }) => void) | null =
      null
    let idleHandler: (() => void) | null = null

    const finishReveal = (map: Map) => {
      if (cancelled || seq !== plRevealSeqRef.current) return
      if (!plHeatmapEnabledRef.current) return
      plHeatmapRevealedRef.current = true
      applyPlMapOverlay(map, {
        enabled: true,
        opacity: plHeatmapOpacityRef.current,
      })
      setPlHeatmapLoading(false)
    }

    const clearWait = (map: Map) => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }
      if (sourceHandler) {
        map.off('sourcedata', sourceHandler)
        sourceHandler = null
      }
      if (idleHandler) {
        map.off('idle', idleHandler)
        idleHandler = null
      }
    }

    const tryFinish = (map: Map) => {
      if (cancelled || seq !== plRevealSeqRef.current) return
      if (!isPlMapOverlaySourceReady(map)) return
      clearWait(map)
      finishReveal(map)
    }

    const run = () => {
      const map = mapRef.current
      if (!map || cancelled || seq !== plRevealSeqRef.current) return
      clearWait(map)
      void waitForStyleLoaded(map).then(() => {
        if (cancelled || seq !== plRevealSeqRef.current) return
        // Start / keep fetching at opacity 0 (may already be prefetching).
        applyPlMapOverlay(map, { enabled: true, opacity: 0 })
        sourceHandler = (e) => {
          if (e.sourceId !== PL_MAP_OVERLAY_SOURCE_ID) return
          if (e.isSourceLoaded) tryFinish(map)
        }
        idleHandler = () => tryFinish(map)
        map.on('sourcedata', sourceHandler)
        map.on('idle', idleHandler)
        timeoutId = window.setTimeout(() => {
          clearWait(map)
          finishReveal(map)
        }, PL_MAP_OVERLAY_REVEAL_TIMEOUT_MS)
        tryFinish(map)
      })
    }

    beginPlHeatmapRevealRef.current = run
    run()

    return () => {
      cancelled = true
      const map = mapRef.current
      if (map) clearWait(map)
      else if (timeoutId != null) window.clearTimeout(timeoutId)
    }
  }, [plHeatmapEnabled])

  const opacityRafRef = useRef<number | null>(null)
  const pendingOpacityRef = useRef(plHeatmapOpacity)

  useEffect(() => {
    return () => {
      if (opacityRafRef.current != null) {
        cancelAnimationFrame(opacityRafRef.current)
        opacityRafRef.current = null
      }
    }
  }, [])

  /**
   * Paint map opacity immediately. Coalesce React/localStorage to one update
   * per frame; use commit to flush the final value on pointer release.
   */
  const paintPlHeatmapOpacity = useCallback((next: number) => {
    const map = mapRef.current
    if (!map || !plHeatmapEnabledRef.current) return
    // Still waiting on first tiles — keep opacity 0 until reveal.
    if (!plHeatmapRevealedRef.current) return
    try {
      const visible =
        map.getLayoutProperty(PL_MAP_OVERLAY_LAYER_ID, 'visibility') ===
        'visible'
      if (visible && setPlMapOverlayOpacity(map, next)) return
    } catch {
      // style mid-reload
    }
    // Layer missing/hidden (e.g. after basemap swap) — full apply restores it.
    if (map.isStyleLoaded()) {
      applyPlMapOverlay(map, { enabled: true, opacity: next })
    }
  }, [])

  const requestPlHeatmapOpacity = useCallback(
    (next: number) => {
      plHeatmapOpacityRef.current = next
      pendingOpacityRef.current = next
      paintPlHeatmapOpacity(next)
      if (opacityRafRef.current != null) return
      opacityRafRef.current = requestAnimationFrame(() => {
        opacityRafRef.current = null
        onPlHeatmapOpacityChange(pendingOpacityRef.current)
      })
    },
    [onPlHeatmapOpacityChange, paintPlHeatmapOpacity],
  )

  const commitPlHeatmapOpacity = useCallback(
    (next: number) => {
      plHeatmapOpacityRef.current = next
      pendingOpacityRef.current = next
      paintPlHeatmapOpacity(next)
      if (opacityRafRef.current != null) {
        cancelAnimationFrame(opacityRafRef.current)
        opacityRafRef.current = null
      }
      onPlHeatmapOpacityChange(next)
    },
    [onPlHeatmapOpacityChange, paintPlHeatmapOpacity],
  )

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
      const mapVisible = filterMapVisiblePersonalSpots(
        personalSpots,
        personalSpotFolders,
      )
      renderPersonalSpotMarkers(
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
        personalMarkersRef.current,
        {
          clusterAriaLabel: (count) => t('spots.countAria', { n: count }),
        },
      )
    }

    // Prefer style.load over load: another load handler throwing must not
    // leave Mes spots without markers (applyPlayheadSky bare-name burn).
    sync()
    map.on('load', sync)
    map.on('style.load', sync)
    // Re-cluster when screen-space distances change (zoom / pitch / bearing).
    map.on('zoomend', sync)
    map.on('pitchend', sync)
    map.on('rotateend', sync)

    return () => {
      map.off('load', sync)
      map.off('style.load', sync)
      map.off('zoomend', sync)
      map.off('pitchend', sync)
      map.off('rotateend', sync)
    }
  }, [personalSpots, personalSpotFolders, selectedPersonalSpotId, spot, t])

  useEffect(() => {
    if (!spot) {
      markerUiRef.current?.destroy()
      markerUiRef.current = null
      markerRef.current?.remove()
      markerRef.current = null
      return
    }
    // App may setSpot without a map click / fly settle (tour place) — ensure pin exists.
    syncWorkingPinRef.current(spot.lat, spot.lon)
    const ui = markerUiRef.current
    if (!ui) return
    const match =
      personalSpots.find(
        (row) =>
          Math.abs(row.lat - spot.lat) < 1e-6 &&
          Math.abs(row.lon - spot.lon) < 1e-6,
      ) ?? null
    ui.setSaved(Boolean(match))
    ui.setLabel(match?.name ?? null)
    if (pendingOpenMarkerMenuRef.current || markerMenuOpen) {
      pendingOpenMarkerMenuRef.current = false
      ui.open()
    }
  }, [spot, personalSpots, selectedPersonalSpotId, markerMenuOpen])

  useEffect(() => {
    if (markerMenuOpen) {
      markerUiRef.current?.open()
      return
    }
    markerUiRef.current?.close()
  }, [markerMenuOpen])

  useEffect(() => {
    markerUiRef.current?.setLocked(markerActionsLocked)
  }, [markerActionsLocked, markerMenuOpen, spot])

  useEffect(() => {
    const onTourFly = () => {
      apiRef.current?.flyToTourDemo()
    }
    const onTourClearFrame = () => {
      const map = mapRef.current
      if (map) clearTourPhonePadding(map)
    }
    window.addEventListener(TOUR_FLY_TO_DEMO_EVENT, onTourFly)
    window.addEventListener(TOUR_CLEAR_MAP_FRAME_EVENT, onTourClearFrame)
    return () => {
      window.removeEventListener(TOUR_FLY_TO_DEMO_EVENT, onTourFly)
      window.removeEventListener(TOUR_CLEAR_MAP_FRAME_EVENT, onTourClearFrame)
    }
  }, [])

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
      map.off('idle', apply)
      if (!map.getLayer('imagery')) {
        map.once('idle', apply)
        return
      }
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
    let active = true
    void waitForStyleLoaded(map).then(() => { if (active) apply() })
    map.on('zoomend', apply)
    map.on('moveend', onMoveEnd)
    return () => {
      active = false
      map.off('idle', apply)
      map.off('zoomend', apply)
      map.off('moveend', onMoveEnd)
    }
    // heightM must NOT be a dep: DEM idle rewrites tear down pending idle
    // retries and leave noon ortho stuck after a night-spot fly.
  }, [mode, skyUtcMs, spot?.lat, spot?.lon])

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
        plHeatmapLoading={plHeatmapLoading}
        plHeatmapOpacity={plHeatmapOpacity}
        onPlHeatmapEnabledChange={requestPlHeatmapEnabled}
        onPlHeatmapOpacityChange={requestPlHeatmapOpacity}
        onPlHeatmapOpacityCommit={commitPlHeatmapOpacity}
        plLegendOpen={plLegendOpen}
        onPlLegendOpenChange={onPlLegendOpenChange}
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
      <OnboardingIntroHost />
      <AppBrandMark />
    </div>
  )
}
