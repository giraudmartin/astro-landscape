import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type CelestialObject } from './celestialObjects'
import { ImmersiveView } from './ImmersiveView'
import { MapCanvas, type CameraMode, type SpotState } from './MapCanvas'
import { MySpotsRail } from './MySpotsCard'
import { OverviewCard } from './OverviewCard'
import { SpotSaveCard } from './SpotSaveCard'
import { TimelineDock } from './TimelineDock'
import { WeatherCard } from './WeatherCard'
import {
  civilDateFromUtc,
  civilDayStartUtcMs,
} from './celestial'
import type { BasemapMode } from './basemapMode'
import { loadAppSettings, patchAppSettings } from './appSettings'
import {
  createPersonalSpot,
  loadPersonalSpots,
  removePersonalSpot,
  savePersonalSpots,
  upsertPersonalSpot,
  type PersonalSpot,
} from './personalSpots'
import { DEFAULT_MAP_VIEW } from './presets'
import {
  installThreeGameTestHooks,
  qaUtcForSite,
  type QaAppApi,
} from './qaTestHooks'
import './App.css'
import './timelineCalendar.css'

const MAP_RAIL_WIDTH_PX = 320

type PendingSave = {
  lat: number
  lon: number
  heightM: number
  bearingDeg: number
  pitchDeg: number
}

export default function App() {
  const savedMap = useMemo(() => loadAppSettings().map, [])
  const [mode, setMode] = useState<CameraMode>('orbit')
  const [threeDimensional, setThreeDimensional] = useState(
    savedMap.threeDimensional,
  )
  const [basemapMode, setBasemapMode] = useState<BasemapMode>(
    savedMap.basemapMode,
  )
  const [addressSearchOpen, setAddressSearchOpen] = useState(false)
  const [spot, setSpot] = useState<SpotState | null>(null)

  const [mySpotsOpen, setMySpotsOpen] = useState(false)
  const [personalSpots, setPersonalSpots] = useState<PersonalSpot[]>(() =>
    loadPersonalSpots(),
  )
  const [selectedPersonalSpotId, setSelectedPersonalSpotId] = useState<
    string | null
  >(null)
  const [personalSpotPicking, setPersonalSpotPicking] = useState(false)
  const [flyToPersonalSpotId, setFlyToPersonalSpotId] = useState<string | null>(
    null,
  )
  const [showAllPersonalSpotsToken, setShowAllPersonalSpotsToken] = useState(0)
  const [markerMenuOpen, setMarkerMenuOpen] = useState(false)

  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null)
  const [pendingSaveName, setPendingSaveName] = useState('')
  const [editingSpot, setEditingSpot] = useState<PersonalSpot | null>(null)
  const [editingName, setEditingName] = useState('')

  const observer = useMemo(() => {
    if (spot) {
      return { lat: spot.lat, lon: spot.lon, elevationM: spot.heightM }
    }
    return {
      lat: DEFAULT_MAP_VIEW.lat,
      lon: DEFAULT_MAP_VIEW.lon,
      elevationM: 0,
    }
  }, [spot])

  /** No spot → UTC clock; with spot → civil clock at that lon (same UTC instant). */
  const timelineLon = spot ? spot.lon : 0
  const clockIsUtc = spot == null

  const [date, setDate] = useState(() => civilDateFromUtc(Date.now(), 0))
  const [playheadUtcMs, setPlayheadUtcMs] = useState(() => {
    const start = civilDayStartUtcMs(civilDateFromUtc(Date.now(), 0), 0)
    return start + 18 * 3600_000
  })
  const playheadUtcMsRef = useRef(playheadUtcMs)
  playheadUtcMsRef.current = playheadUtcMs
  const prevTimelineLonRef = useRef(timelineLon)

  // Spot (or clear): keep the UTC instant, only refresh the civil date label.
  useEffect(() => {
    if (prevTimelineLonRef.current === timelineLon) return
    prevTimelineLonRef.current = timelineLon
    setDate(civilDateFromUtc(playheadUtcMsRef.current, timelineLon))
  }, [timelineLon])
  const [selectedCelestial, setSelectedCelestial] =
    useState<CelestialObject | null>(null)
  const [immersiveLook, setImmersiveLook] = useState<{
    bearingDeg: number
    pitchDeg: number
  } | null>(null)
  /** Immersive terrain fully loaded — timeline stays hidden until then. */
  const [immersiveTerrainReady, setImmersiveTerrainReady] = useState(false)
  /** Timelapse preview occupies the timeline slot — hide the dock. */
  const [timelapsePreviewPlaying, setTimelapsePreviewPlaying] = useState(false)

  useEffect(() => {
    savePersonalSpots(personalSpots)
  }, [personalSpots])

  useEffect(() => {
    installThreeGameTestHooks()
    const api: QaAppApi = {
      enterImmersive: (opts) => {
        setDate(opts.date)
        setPlayheadUtcMs(
          qaUtcForSite(opts.date, opts.lon, opts.localHour),
        )
        setSpot({
          lat: opts.lat,
          lon: opts.lon,
          heightM: opts.heightM,
          bearingDeg: opts.bearingDeg,
          pitchDeg: opts.pitchDeg,
        })
        setImmersiveLook({
          bearingDeg: opts.bearingDeg,
          pitchDeg: opts.pitchDeg,
        })
        setMode('ground')
      },
      setPlayheadUtcMs,
      setDate,
      exitImmersive: () => {
        setImmersiveLook(null)
        setMode('orbit')
      },
      isImmersive: () => mode === 'ground' && spot != null,
    }
    window.__astroQaApp = api
    return () => {
      if (window.__astroQaApp === api) delete window.__astroQaApp
    }
  }, [mode, spot])

  useEffect(() => {
    patchAppSettings({
      map: { threeDimensional, basemapMode },
    })
  }, [threeDimensional, basemapMode])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty(
      '--map-rail-width',
      mySpotsOpen ? `${MAP_RAIL_WIDTH_PX}px` : '0px',
    )
    return () => {
      root.style.setProperty('--map-rail-width', '0px')
    }
  }, [mySpotsOpen])

  const onFlyToPersonalSpotHandled = useCallback(
    () => setFlyToPersonalSpotId(null),
    [],
  )

  const onDateChange = useCallback(
    (nextDate: string) => {
      const prevStart = civilDayStartUtcMs(date, timelineLon)
      const timeOfDay = playheadUtcMs - prevStart
      setDate(nextDate)
      const nextStart = civilDayStartUtcMs(nextDate, timelineLon)
      setPlayheadUtcMs(
        nextStart + Math.min(Math.max(timeOfDay, 0), 24 * 3600_000 - 1),
      )
    },
    [date, timelineLon, playheadUtcMs],
  )

  /** Timeline scrub (PS-style): unbounded UTC — civil date follows the playhead. */
  const onPlayheadChange = useCallback(
    (utcMs: number) => {
      setPlayheadUtcMs(utcMs)
      setDate((prev) => {
        const next = civilDateFromUtc(utcMs, timelineLon)
        return next === prev ? prev : next
      })
    },
    [timelineLon],
  )

  const selectPersonalSpot = useCallback((saved: PersonalSpot) => {
    setSelectedPersonalSpotId(saved.id)
    setSpot({
      lat: saved.lat,
      lon: saved.lon,
      heightM: saved.heightM ?? 0,
      bearingDeg: saved.bearingDeg,
      pitchDeg: saved.pitchDeg,
    })
    setMode('orbit')
    setFlyToPersonalSpotId(saved.id)
  }, [])

  const findSpotAt = useCallback(
    (lat: number, lon: number) =>
      personalSpots.find(
        (row) =>
          Math.abs(row.lat - lat) < 1e-6 && Math.abs(row.lon - lon) < 1e-6,
      ) ?? null,
    [personalSpots],
  )

  const openSaveDialog = useCallback(
    (input: PendingSave) => {
      setEditingSpot(null)
      setPendingSave(input)
      setPendingSaveName(`Spot ${personalSpots.length + 1}`)
      setPersonalSpotPicking(false)
      setMarkerMenuOpen(false)
    },
    [personalSpots.length],
  )

  const openEditDialog = useCallback((saved: PersonalSpot) => {
    setPendingSave(null)
    setEditingSpot(saved)
    setEditingName(saved.name)
    setMarkerMenuOpen(false)
  }, [])

  const onPlacePersonalSpot = useCallback(
    (input: {
      lat: number
      lon: number
      heightM: number
      bearingDeg: number
      pitchDeg: number
    }) => {
      setSpot({
        lat: input.lat,
        lon: input.lon,
        heightM: input.heightM,
        bearingDeg: input.bearingDeg,
        pitchDeg: input.pitchDeg,
      })
      setSelectedPersonalSpotId(null)
      openSaveDialog(input)
    },
    [openSaveDialog],
  )

  const onRequestSaveSpot = useCallback(() => {
    if (!spot) return
    if (findSpotAt(spot.lat, spot.lon)) return
    openSaveDialog({
      lat: spot.lat,
      lon: spot.lon,
      heightM: spot.heightM,
      bearingDeg: spot.bearingDeg,
      pitchDeg: spot.pitchDeg,
    })
  }, [spot, findSpotAt, openSaveDialog])

  const onRequestEditSpot = useCallback(() => {
    if (!spot) return
    const saved =
      (selectedPersonalSpotId
        ? personalSpots.find((row) => row.id === selectedPersonalSpotId)
        : null) ?? findSpotAt(spot.lat, spot.lon)
    if (!saved) return
    openEditDialog(saved)
  }, [
    spot,
    selectedPersonalSpotId,
    personalSpots,
    findSpotAt,
    openEditDialog,
  ])

  const commitPendingSave = useCallback(() => {
    if (!pendingSave) return
    const saved = createPersonalSpot({
      name: pendingSaveName.trim() || `Spot ${personalSpots.length + 1}`,
      lat: pendingSave.lat,
      lon: pendingSave.lon,
      heightM: pendingSave.heightM,
      bearingDeg: pendingSave.bearingDeg,
      pitchDeg: pendingSave.pitchDeg,
    })
    setPersonalSpots((prev) => upsertPersonalSpot(prev, saved))
    setPendingSave(null)
    setPendingSaveName('')
    setMySpotsOpen(true)
    selectPersonalSpot(saved)
  }, [pendingSave, pendingSaveName, personalSpots.length, selectPersonalSpot])

  const commitEditingSpot = useCallback(() => {
    if (!editingSpot) return
    const next = {
      ...editingSpot,
      name: editingName.trim() || editingSpot.name,
    }
    setPersonalSpots((prev) => upsertPersonalSpot(prev, next))
    setEditingSpot(null)
    setEditingName('')
  }, [editingSpot, editingName])

  const deleteEditingSpot = useCallback(() => {
    if (!editingSpot) return
    const ok =
      typeof window === 'undefined'
        ? true
        : window.confirm(`Supprimer « ${editingSpot.name} » ?`)
    if (!ok) return
    const id = editingSpot.id
    setPersonalSpots((prev) => removePersonalSpot(prev, id))
    if (selectedPersonalSpotId === id) setSelectedPersonalSpotId(null)
    setEditingSpot(null)
    setEditingName('')
  }, [editingSpot, selectedPersonalSpotId])

  const onDeletePersonalSpot = useCallback(
    (spotId: string) => {
      const target = personalSpots.find((row) => row.id === spotId)
      if (!target) return
      const ok =
        typeof window === 'undefined'
          ? true
          : window.confirm(`Supprimer « ${target.name} » ?`)
      if (!ok) return
      setPersonalSpots((prev) => removePersonalSpot(prev, spotId))
      if (selectedPersonalSpotId === spotId) setSelectedPersonalSpotId(null)
      if (editingSpot?.id === spotId) {
        setEditingSpot(null)
        setEditingName('')
      }
    },
    [personalSpots, selectedPersonalSpotId, editingSpot],
  )

  const immersive = mode === 'ground' && spot != null
  /**
   * Keep the last immersive Three.js scene mounted (hidden) while the user is
   * back on the map at the SAME spot — quit→relaunch must not rebuild terrain.
   */
  const [parkedImmersiveSpot, setParkedImmersiveSpot] =
    useState<SpotState | null>(null)

  useEffect(() => {
    if (immersive && spot) setParkedImmersiveSpot(spot)
  }, [immersive, spot])

  useEffect(() => {
    if (!parkedImmersiveSpot || !spot) return
    const same =
      Math.abs(parkedImmersiveSpot.lat - spot.lat) < 1e-6 &&
      Math.abs(parkedImmersiveSpot.lon - spot.lon) < 1e-6
    if (!same) setParkedImmersiveSpot(null)
  }, [spot, parkedImmersiveSpot])

  const keepImmersiveMounted =
    parkedImmersiveSpot != null &&
    spot != null &&
    Math.abs(parkedImmersiveSpot.lat - spot.lat) < 1e-6 &&
    Math.abs(parkedImmersiveSpot.lon - spot.lon) < 1e-6
  const mountImmersive = immersive || keepImmersiveMounted
  const showTimeline =
    (!immersive || immersiveTerrainReady) && !timelapsePreviewPlaying

  return (
    <div className="app">
      {/* Keep the map mounted across immersive sessions — remounting it was
          rewriting spot.heightM via DEM and forcing a full Three.js rebuild. */}
      <div
        className={immersive ? 'map-host is-covered' : 'map-host'}
        aria-hidden={immersive}
      >
        <MapCanvas
          mode={mode}
          threeDimensional={threeDimensional}
          basemapMode={basemapMode}
          addressSearchOpen={addressSearchOpen}
          spot={spot}
          onModeChange={setMode}
          onSpotChange={(next) => {
            setSpot(next)
            setSelectedPersonalSpotId((currentId) => {
              if (!currentId) return null
              const saved = personalSpots.find((row) => row.id === currentId)
              if (!saved) return null
              const same =
                Math.abs(saved.lat - next.lat) < 1e-6 &&
                Math.abs(saved.lon - next.lon) < 1e-6
              return same ? currentId : null
            })
          }}
          onThreeDimensionalChange={setThreeDimensional}
          onBasemapModeChange={setBasemapMode}
          onAddressSearchOpenChange={setAddressSearchOpen}
          skyUtcMs={playheadUtcMs}
          mySpotsOpen={mySpotsOpen}
          onMySpotsOpenChange={(open) => {
            setMySpotsOpen(open)
            if (!open) setPersonalSpotPicking(false)
            if (open) setAddressSearchOpen(false)
          }}
          personalSpots={personalSpots}
          selectedPersonalSpotId={selectedPersonalSpotId}
          personalSpotPicking={personalSpotPicking}
          onPlacePersonalSpot={onPlacePersonalSpot}
          onSelectPersonalSpot={selectPersonalSpot}
          flyToPersonalSpotId={flyToPersonalSpotId}
          onFlyToPersonalSpotHandled={onFlyToPersonalSpotHandled}
          showAllPersonalSpotsToken={showAllPersonalSpotsToken}
          onRequestSaveSpot={onRequestSaveSpot}
          onRequestEditSpot={onRequestEditSpot}
          markerMenuOpen={markerMenuOpen}
          onMarkerMenuOpenChange={setMarkerMenuOpen}
        />
      </div>
      {mountImmersive && spot != null ? (
        <div
          className="immersive-host"
          hidden={!immersive}
          aria-hidden={!immersive}
          style={
            immersive
              ? undefined
              : {
                  position: 'fixed',
                  inset: 0,
                  visibility: 'hidden',
                  pointerEvents: 'none',
                }
          }
        >
          <ImmersiveView
            active={immersive}
            lat={spot.lat}
            lon={spot.lon}
            groundElevationM={spot.heightM}
            bearingDeg={immersiveLook?.bearingDeg ?? spot.bearingDeg}
            initialPitchDeg={immersiveLook?.pitchDeg ?? 0}
            skyUtcMs={playheadUtcMs}
            onSkyUtcChange={onPlayheadChange}
            date={date}
            selectedCelestial={selectedCelestial}
            onSelectCelestial={setSelectedCelestial}
            onTerrainReadyChange={setImmersiveTerrainReady}
            onTimelapsePreviewPlayingChange={setTimelapsePreviewPlaying}
            onExit={() => {
              setImmersiveLook(null)
              setImmersiveTerrainReady(false)
              setTimelapsePreviewPlaying(false)
              setMode('orbit')
            }}
          />
        </div>
      ) : null}

      {!immersive ? (
        <div className="map-ui" aria-label="Aperçu et météo">
          <div className="ov-anchor">
            <OverviewCard
              lat={observer.lat}
              lon={observer.lon}
              elevationM={observer.elevationM}
              date={date}
              playheadUtcMs={playheadUtcMs}
              onDateChange={onDateChange}
              onPlayheadChange={onPlayheadChange}
            />
            <WeatherCard
              date={date}
              playheadUtcMs={playheadUtcMs}
              location={
                spot ? { lat: spot.lat, lon: spot.lon } : null
              }
              onHourSelect={(utcMs) => onPlayheadChange(utcMs)}
            />
          </div>
        </div>
      ) : null}

      {!immersive ? (
        <MySpotsRail
          open={mySpotsOpen}
          onClose={() => {
            setMySpotsOpen(false)
            setPersonalSpotPicking(false)
          }}
          spots={personalSpots}
          selectedId={selectedPersonalSpotId}
          picking={personalSpotPicking}
          onStartAdd={() => {
            setPersonalSpotPicking(true)
            setMySpotsOpen(true)
          }}
          onCancelAdd={() => setPersonalSpotPicking(false)}
          onSelect={selectPersonalSpot}
          onRename={openEditDialog}
          onDelete={onDeletePersonalSpot}
          onShowAll={() =>
            setShowAllPersonalSpotsToken((token) => token + 1)
          }
        />
      ) : null}

      {!immersive && pendingSave ? (
        <SpotSaveCard
          mode="save"
          name={pendingSaveName}
          lat={pendingSave.lat}
          lon={pendingSave.lon}
          onNameChange={setPendingSaveName}
          onClose={() => {
            setPendingSave(null)
            setPendingSaveName('')
          }}
          onSubmit={commitPendingSave}
        />
      ) : null}

      {!immersive && editingSpot ? (
        <SpotSaveCard
          mode="edit"
          name={editingName}
          lat={editingSpot.lat}
          lon={editingSpot.lon}
          onNameChange={setEditingName}
          onClose={() => {
            setEditingSpot(null)
            setEditingName('')
          }}
          onSubmit={commitEditingSpot}
          onDelete={deleteEditingSpot}
        />
      ) : null}

      {showTimeline ? (
        <TimelineDock
          lat={observer.lat}
          lon={timelineLon}
          elevationM={observer.elevationM}
          date={date}
          playheadUtcMs={playheadUtcMs}
          clockIsUtc={clockIsUtc}
          onDateChange={onDateChange}
          onPlayheadChange={onPlayheadChange}
        />
      ) : null}

    </div>
  )
}
