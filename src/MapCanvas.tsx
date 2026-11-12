import { useEffect, useRef } from 'react'
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
import { applyMapSky } from './applyMapSky'
import { sunPositionAt } from './celestial'
import { ensureCelestialBodyLayers, ensureNightShadeLayer } from './globeSun'
import { ensureGlobeMilkyWayLayer } from './globeMilkyWay'
import { ensureNightShadeProtocol } from './nightShadeProtocol'
import { MapControlsStack } from './MapControlsStack'
import {
  fitPersonalSpots,
  renderPersonalSpotMarkers,
  type PersonalSpot,
} from './personalSpots'
import { DEFAULT_MAP_VIEW } from './presets'
import { skyPaletteFromSunAltitude } from './skyLighting'
import type { BasemapMode } from './basemapMode'
import { applyBasemapMode } from './satelliteHybrid'
import {
  createSpotActionMarkerElement,
  type SpotActionMarkerController,
} from './spotActionMarker'
import { streetViewUrlAt } from './streetView'

setWorkerUrl(maplibreWorkerUrl)

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
  addressSearchOpen: boolean
  spot: SpotState | null
  onModeChange: (mode: CameraMode) => void
  onSpotChange: (spot: SpotState) => void
  onThreeDimensionalChange: (next: boolean) => void
  onBasemapModeChange: (next: BasemapMode) => void
  onAddressSearchOpenChange: (open: boolean) => void
  /** UTC ms driving sky / lighting (timeline playhead). */
  skyUtcMs: number
  mySpotsOpen: boolean
  onMySpotsOpenChange: (open: boolean) => void
  personalSpots: PersonalSpot[]
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
    ],
    terrain: {
      source: 'terrain',
      exaggeration: TERRAIN_EXAGGERATION,
    },
    light: {
      anchor: 'map',
      color: '#ffffff',
      intensity: 0.55,
      position: [1.5, 210, 30],
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
  addressSearchOpen,
  spot,
  onModeChange,
  onSpotChange,
  onThreeDimensionalChange,
  onBasemapModeChange,
  onAddressSearchOpenChange,
  skyUtcMs,
  mySpotsOpen,
  onMySpotsOpenChange,
  personalSpots,
  selectedPersonalSpotId,
  personalSpotPicking,
  onPlacePersonalSpot,
  onSelectPersonalSpot,
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
  const personalSpotPickingRef = useRef(personalSpotPicking)
  const personalSpotsRef = useRef(personalSpots)
  const selectedPersonalSpotIdRef = useRef(selectedPersonalSpotId)
  const onModeChangeRef = useRef(onModeChange)
  const onSpotChangeRef = useRef(onSpotChange)
  const onThreeDimensionalChangeRef = useRef(onThreeDimensionalChange)
  const onPlacePersonalSpotRef = useRef(onPlacePersonalSpot)
  const onSelectPersonalSpotRef = useRef(onSelectPersonalSpot)
  const onRequestSaveSpotRef = useRef(onRequestSaveSpot)
  const onRequestEditSpotRef = useRef(onRequestEditSpot)
  const onMarkerMenuOpenChangeRef = useRef(onMarkerMenuOpenChange)

  modeRef.current = mode
  spotRef.current = spot
  threeDimensionalRef.current = threeDimensional
  basemapModeRef.current = basemapMode
  personalSpotPickingRef.current = personalSpotPicking
  personalSpotsRef.current = personalSpots
  selectedPersonalSpotIdRef.current = selectedPersonalSpotId
  onModeChangeRef.current = onModeChange
  onSpotChangeRef.current = onSpotChange
  onThreeDimensionalChangeRef.current = onThreeDimensionalChange
  onPlacePersonalSpotRef.current = onPlacePersonalSpot
  onSelectPersonalSpotRef.current = onSelectPersonalSpot
  onRequestSaveSpotRef.current = onRequestSaveSpot
  onRequestEditSpotRef.current = onRequestEditSpot
  onMarkerMenuOpenChangeRef.current = onMarkerMenuOpenChange

  const apiRef = useRef<{
    setMode: (next: CameraMode) => void
    setThreeDimensional: (next: boolean) => void
    setBasemapMode: (next: BasemapMode) => void
    flyToAddress: (result: AddressSearchResult) => void
    flyToMyLocation: () => void
    flyToPersonalSpot: (spot: PersonalSpot) => void
    showAllPersonalSpots: (spots: PersonalSpot[]) => void
  } | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    ensureEsriSafeImageryProtocol()
    ensureMapterhornSafeDemProtocol()
    ensureNightShadeProtocol()

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
      attributionControl: false,
      fadeDuration: 0,
    })

    mapRef.current = map

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

    const upsertMarker = (lng: number, lat: number) => {
      if (!markerRef.current || !markerUiRef.current) {
        markerUiRef.current?.destroy()
        const savedMatch = matchingSavedSpot(lat, lng)
        const markerUi = createSpotActionMarkerElement(Boolean(savedMatch), {
          onOpenChange: (open) => onMarkerMenuOpenChangeRef.current(open),
          onSelectSaved: () => {
            const current = spotRef.current
            if (!current) return false
            const match = matchingSavedSpot(current.lat, current.lon)
            if (!match) return false
            if (selectedPersonalSpotIdRef.current !== match.id) {
              onSelectPersonalSpotRef.current(match)
              return true
            }
            return false
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
            onModeChangeRef.current('ground')
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

    const goOrbit = (s: SpotState, zoom = 12.2) => {
      const pitch = threeDimensionalRef.current
        ? Math.min(Math.max(s.pitchDeg, 45), 65)
        : FLAT_PITCH
      map.easeTo({
        center: [s.lon, s.lat],
        zoom,
        pitch,
        bearing: s.bearingDeg,
        duration: 900,
      })
    }

    const goGround = (s: SpotState, zoom = 14.5) => {
      map.easeTo({
        center: [s.lon, s.lat],
        zoom,
        pitch: threeDimensionalRef.current ? 78 : FLAT_PITCH,
        bearing: s.bearingDeg,
        duration: 900,
      })
    }

    const setMode = (next: CameraMode) => {
      const current = spotRef.current
      if (!current) return
      if (next === 'ground') {
        goGround(current)
      } else {
        goOrbit(
          { ...current, pitchDeg: THREE_D_PITCH },
          Math.max(map.getZoom(), 12.2),
        )
      }
    }

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
      const apply = () => {
        void applyBasemapMode(map, next).catch((error) => {
          console.error('[basemap]', error)
        })
      }
      if (map.isStyleLoaded()) apply()
      else map.once('load', apply)
    }

    const flyToAddress = (result: AddressSearchResult) => {
      onModeChangeRef.current('orbit')
      if (!threeDimensionalRef.current) {
        onThreeDimensionalChangeRef.current(true)
        threeDimensionalRef.current = true
      }
      const pitch = THREE_D_PITCH
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
          zoom: 14,
          pitch,
          essential: true,
          duration: 1400,
        })
      }
      const apply = () => {
        publishSpot(result.lat, result.lon, map.getBearing(), pitch)
      }
      map.once('moveend', apply)
      window.setTimeout(apply, 1400)
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
          map.flyTo({
            center: [lon, lat],
            zoom: Math.max(map.getZoom(), 15),
            pitch,
            essential: true,
            duration: 850,
          })
          const apply = () => {
            publishSpot(lat, lon, map.getBearing(), pitch)
          }
          map.once('moveend', apply)
          window.setTimeout(apply, 900)
        },
        () => {
          // Permission denied / timeout — silent for now
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
      )
    }

    const flyToPersonalSpot = (saved: PersonalSpot) => {
      onModeChangeRef.current('orbit')
      if (!threeDimensionalRef.current) {
        onThreeDimensionalChangeRef.current(true)
        threeDimensionalRef.current = true
      }
      const pitch = threeDimensionalRef.current
        ? Math.min(Math.max(saved.pitchDeg, 45), 65)
        : FLAT_PITCH
      map.flyTo({
        center: [saved.lon, saved.lat],
        zoom: Math.max(map.getZoom(), 13.5),
        pitch,
        bearing: saved.bearingDeg,
        essential: true,
        duration: 900,
      })
      const apply = () => {
        publishSpot(saved.lat, saved.lon, saved.bearingDeg, pitch)
      }
      map.once('moveend', apply)
      window.setTimeout(apply, 950)
    }

    const showAllPersonalSpots = (spots: PersonalSpot[]) => {
      fitPersonalSpots(map, spots)
    }

    apiRef.current = {
      setMode,
      setThreeDimensional,
      setBasemapMode,
      flyToAddress,
      flyToMyLocation,
      flyToPersonalSpot,
      showAllPersonalSpots,
    }

    map.on('load', () => {
      map.setTerrain({
        source: 'terrain',
        exaggeration: TERRAIN_EXAGGERATION,
      })
      ensureGlobeMilkyWayLayer(map)
      ensureNightShadeLayer(map)
      ensureCelestialBodyLayers(map)
      setBasemapMode(basemapModeRef.current)
    })

    map.on('click', (event: MapMouseEvent) => {
      const { lng, lat } = event.lngLat
      const bearing = map.getBearing()
      const pitch = threeDimensionalRef.current
        ? Math.max(map.getPitch(), THREE_D_PITCH)
        : FLAT_PITCH
      const heightM = readElevation(lng, lat) ?? 0

      if (personalSpotPickingRef.current) {
        publishSpot(lat, lng, bearing, pitch)
        onPlacePersonalSpotRef.current({
          lat,
          lon: lng,
          heightM,
          bearingDeg: bearing,
          pitchDeg: pitch,
        })
        map.getCanvas().style.cursor = ''
        return
      }

      // Place / move the working pin — immersive opens via marker click (or Sol).
      if (!threeDimensionalRef.current) {
        onThreeDimensionalChangeRef.current(true)
        threeDimensionalRef.current = true
      }
      publishSpot(lat, lng, bearing, pitch)
      onModeChangeRef.current('orbit')
      goOrbit(
        {
          lat,
          lon: lng,
          heightM,
          bearingDeg: bearing,
          pitchDeg: pitch,
        },
        Math.max(map.getZoom(), 12.5),
      )
    })

    const elevTimer = window.setInterval(() => {
      // Never rewrite height while immersive — that remounts the Three.js scene.
      if (modeRef.current === 'ground') return
      const current = spotRef.current
      if (!current) return
      const heightM = readElevation(current.lon, current.lat)
      if (heightM === null || Math.abs(heightM - current.heightM) < 1) return
      onSpotChangeRef.current({ ...current, heightM })
    }, 800)

    return () => {
      window.clearInterval(elevTimer)
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

  useEffect(() => {
    apiRef.current?.setBasemapMode(basemapMode)
  }, [basemapMode])

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
      personalMarkersRef.current = renderPersonalSpotMarkers(
        map,
        personalSpots,
        selectedPersonalSpotId,
        (saved) => onSelectPersonalSpotRef.current(saved),
      )
    }

    if (map.isStyleLoaded()) sync()
    else map.once('load', sync)

    return () => {
      for (const marker of personalMarkersRef.current) marker.remove()
      personalMarkersRef.current = []
    }
  }, [personalSpots, selectedPersonalSpotId])

  useEffect(() => {
    const ui = markerUiRef.current
    if (!ui) return
    const current = spot
    if (!current) {
      ui.setSaved(false)
      ui.setLabel(null)
      return
    }
    const match =
      (selectedPersonalSpotId
        ? personalSpots.find((row) => row.id === selectedPersonalSpotId)
        : null) ??
      personalSpots.find(
        (row) =>
          Math.abs(row.lat - current.lat) < 1e-6 &&
          Math.abs(row.lon - current.lon) < 1e-6,
      ) ??
      null
    ui.setSaved(Boolean(match))
    ui.setLabel(match?.name ?? null)
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
    apiRef.current?.showAllPersonalSpots(personalSpotsRef.current)
  }, [showAllPersonalSpotsToken])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const lat = spot?.lat ?? DEFAULT_MAP_VIEW.lat
    const lon = spot?.lon ?? DEFAULT_MAP_VIEW.lon
    const elev = spot?.heightM ?? 0
    const apply = () => {
      if (!map.isStyleLoaded()) return
      const sun = sunPositionAt(lat, lon, elev, skyUtcMs)
      applyMapSky(map, skyPaletteFromSunAltitude(sun.altitudeDeg), {
        utcMs: skyUtcMs,
        sunAzimuthDeg: sun.azimuthDeg,
        zoom: map.getZoom(),
      })
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
    // Re-blend globe↔ground lighting when the user zooms.
    map.on('zoomend', apply)
    return () => {
      map.off('zoomend', apply)
    }
  }, [skyUtcMs, spot?.lat, spot?.lon, spot?.heightM])

  return (
    <div className="globe-shell">
      <div ref={containerRef} className="globe-canvas" />
      <MapControlsStack
        mapRef={mapRef}
        threeDimensional={threeDimensional}
        onThreeDimensionalChange={onThreeDimensionalChange}
        basemapMode={basemapMode}
        onBasemapModeChange={onBasemapModeChange}
        addressSearchOpen={addressSearchOpen}
        onAddressSearchOpenChange={onAddressSearchOpenChange}
        onAddressSelect={(result) => apiRef.current?.flyToAddress(result)}
        onMyLocation={() => apiRef.current?.flyToMyLocation()}
        mySpotsOpen={mySpotsOpen}
        onMySpotsOpenChange={onMySpotsOpenChange}
      />
      {spot ? (
        <p className="spot-readout">
          {formatCoord(spot.lat, spot.lon)} · {Math.round(spot.heightM)} m
        </p>
      ) : null}
    </div>
  )
}
