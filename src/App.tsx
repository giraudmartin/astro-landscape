import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type CelestialObject } from './celestialObjects'
import { ImmersiveView } from './ImmersiveView'
import { MapCanvas, type CameraMode, type SpotState } from './MapCanvas'
import { ConfirmCard } from './ConfirmCard'
import { FolderSaveCard } from './FolderSaveCard'
import { MobileTopDrawer } from './MobileTopDrawer'
import { MySpotsRail } from './MySpotsCard'
import { OverviewCard } from './OverviewCard'
import { SpotSaveCard } from './SpotSaveCard'
import { TimelineDock } from './TimelineDock'
import { OPERATE_PHONE_MQ, useMatchMedia } from './useMatchMedia'
import { WeatherCard } from './WeatherCard'
import {
  civilDateFromUtc,
  civilDayStartUtcMs,
} from './celestial'
import type { BasemapMode } from './basemapMode'
import { loadAppSettings, patchAppSettings } from './appSettings'
import {
  createPersonalSpot,
  createPersonalSpotFolder,
  loadPersonalSpotsState,
  movePersonalSpotToFolder,
  removePersonalSpot,
  removePersonalSpotFolder,
  savePersonalSpotsState,
  setPersonalSpotFolderVisible,
  setPersonalSpotVisible,
  upsertPersonalSpot,
  upsertPersonalSpotFolder,
  type PersonalSpot,
  type PersonalSpotFolder,
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
  const isPhone = useMatchMedia(OPERATE_PHONE_MQ)
  const [mode, setMode] = useState<CameraMode>('orbit')
  /** Immersive without DEM — flat disc for fast sky testing. */
  const [flatTerrain, setFlatTerrain] = useState(false)
  const [threeDimensional, setThreeDimensional] = useState(
    savedMap.threeDimensional,
  )
  const [basemapMode, setBasemapMode] = useState<BasemapMode>(
    savedMap.basemapMode,
  )
  const [addressSearchOpen, setAddressSearchOpen] = useState(false)
  const [spot, setSpot] = useState<SpotState | null>(null)
  const [infoDrawerOpen, setInfoDrawerOpen] = useState(false)

  const [mySpotsOpen, setMySpotsOpen] = useState(false)
  const [initialPersonalSpots] = useState(loadPersonalSpotsState)
  const [personalSpots, setPersonalSpots] = useState<PersonalSpot[]>(
    initialPersonalSpots.spots,
  )
  const [personalSpotFolders, setPersonalSpotFolders] = useState<
    PersonalSpotFolder[]
  >(initialPersonalSpots.folders)
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
  const [folderDialog, setFolderDialog] = useState<{
    mode: 'create' | 'edit'
    folder: PersonalSpotFolder | null
  } | null>(null)
  const [folderDialogName, setFolderDialogName] = useState('')
  const [confirmDialog, setConfirmDialog] = useState<{
    kind: 'spot' | 'folder'
    id: string
    name: string
  } | null>(null)

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
  /** Wall-clock UTC (minute floor) — never a fixed 18:00, or globe/map disagree with “now”. */
  const [playheadUtcMs, setPlayheadUtcMs] = useState(() => {
    const now = Date.now()
    return Math.floor(now / 60_000) * 60_000
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
    savePersonalSpotsState({
      spots: personalSpots,
      folders: personalSpotFolders,
    })
  }, [personalSpots, personalSpotFolders])

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
        setFlatTerrain(Boolean(opts.flatTerrain))
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
    // Phone sheets overlay the map — do not inset the stage.
    root.style.setProperty(
      '--map-rail-width',
      mySpotsOpen && !isPhone ? `${MAP_RAIL_WIDTH_PX}px` : '0px',
    )
    return () => {
      root.style.setProperty('--map-rail-width', '0px')
    }
  }, [mySpotsOpen, isPhone])

  useEffect(() => {
    if (!isPhone) setInfoDrawerOpen(false)
  }, [isPhone])

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

  const findSpotAt = useCallback(
    (lat: number, lon: number) =>
      personalSpots.find(
        (row) =>
          Math.abs(row.lat - lat) < 1e-6 && Math.abs(row.lon - lon) < 1e-6,
      ) ?? null,
    [personalSpots],
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

  const requestDeleteEditingSpot = useCallback(() => {
    if (!editingSpot) return
    setConfirmDialog({
      kind: 'spot',
      id: editingSpot.id,
      name: editingSpot.name,
    })
  }, [editingSpot])

  const onToggleSpotVisible = useCallback((spotId: string) => {
    setPersonalSpots((prev) => {
      const target = prev.find((row) => row.id === spotId)
      if (!target) return prev
      return setPersonalSpotVisible(prev, spotId, !target.visible)
    })
  }, [])

  const onCreateFolder = useCallback(() => {
    setFolderDialog({ mode: 'create', folder: null })
    setFolderDialogName(`Dossier ${personalSpotFolders.length + 1}`)
  }, [personalSpotFolders.length])

  const onRenameFolder = useCallback((folder: PersonalSpotFolder) => {
    setFolderDialog({ mode: 'edit', folder })
    setFolderDialogName(folder.name)
  }, [])

  const commitFolderDialog = useCallback(() => {
    if (!folderDialog) return
    const fallback =
      folderDialog.mode === 'create'
        ? `Dossier ${personalSpotFolders.length + 1}`
        : (folderDialog.folder?.name ?? 'Dossier')
    const name = folderDialogName.trim() || fallback
    if (folderDialog.mode === 'create') {
      const folder = createPersonalSpotFolder({ name })
      setPersonalSpotFolders((prev) => upsertPersonalSpotFolder(prev, folder))
    } else if (folderDialog.folder) {
      setPersonalSpotFolders((prev) =>
        upsertPersonalSpotFolder(prev, {
          ...folderDialog.folder!,
          name,
        }),
      )
    }
    setFolderDialog(null)
    setFolderDialogName('')
  }, [folderDialog, folderDialogName, personalSpotFolders.length])

  const requestDeleteFolderFromDialog = useCallback(() => {
    if (!folderDialog?.folder) return
    setConfirmDialog({
      kind: 'folder',
      id: folderDialog.folder.id,
      name: folderDialog.folder.name,
    })
  }, [folderDialog])

  const commitConfirmDialog = useCallback(() => {
    if (!confirmDialog) return
    if (confirmDialog.kind === 'spot') {
      const id = confirmDialog.id
      setPersonalSpots((prev) => removePersonalSpot(prev, id))
      if (selectedPersonalSpotId === id) setSelectedPersonalSpotId(null)
      if (editingSpot?.id === id) {
        setEditingSpot(null)
        setEditingName('')
      }
    } else {
      const next = removePersonalSpotFolder(
        personalSpots,
        personalSpotFolders,
        confirmDialog.id,
      )
      setPersonalSpots(next.spots)
      setPersonalSpotFolders(next.folders)
      if (folderDialog?.folder?.id === confirmDialog.id) {
        setFolderDialog(null)
        setFolderDialogName('')
      }
    }
    setConfirmDialog(null)
  }, [
    confirmDialog,
    selectedPersonalSpotId,
    editingSpot,
    personalSpots,
    personalSpotFolders,
    folderDialog,
  ])

  const onToggleFolderVisible = useCallback((folderId: string) => {
    setPersonalSpotFolders((prev) => {
      const target = prev.find((row) => row.id === folderId)
      if (!target) return prev
      return setPersonalSpotFolderVisible(prev, folderId, !target.visible)
    })
  }, [])

  const onMoveSpotToFolder = useCallback(
    (spotId: string, folderId: string | null) => {
      if (folderId != null) {
        const exists = personalSpotFolders.some((row) => row.id === folderId)
        if (!exists) return
      }
      setPersonalSpots((prev) =>
        movePersonalSpotToFolder(prev, spotId, folderId),
      )
    },
    [personalSpotFolders],
  )

  const immersive = mode === 'ground' && spot != null

  useEffect(() => {
    if (immersive) setInfoDrawerOpen(false)
  }, [immersive])

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
  const weatherLocation = spot
    ? { lat: spot.lat, lon: spot.lon }
    : null

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
          onModeChange={(next, opts) => {
            // Only flip flatTerrain on enter — resetting it on exit remounts
            // the parked same-spot scene and starts a DEM load in the background.
            if (next === 'ground') {
              setFlatTerrain(Boolean(opts?.flatTerrain))
            }
            setMode(next)
          }}
          onSpotChange={(next) => {
            const moved =
              !spot ||
              Math.abs(spot.lat - next.lat) >= 1e-6 ||
              Math.abs(spot.lon - next.lon) >= 1e-6
            setSpot(next)
            // Height-only DEM updates must not clear a saved selection.
            if (!moved) return
            const saved = selectedPersonalSpotId
              ? personalSpots.find((row) => row.id === selectedPersonalSpotId)
              : null
            const same =
              saved != null &&
              Math.abs(saved.lat - next.lat) < 1e-6 &&
              Math.abs(saved.lon - next.lon) < 1e-6
            if (!same) setSelectedPersonalSpotId(null)
          }}
          onThreeDimensionalChange={setThreeDimensional}
          onBasemapModeChange={setBasemapMode}
          onAddressSearchOpenChange={setAddressSearchOpen}
          skyUtcMs={playheadUtcMs}
          mySpotsOpen={mySpotsOpen}
          onMySpotsOpenChange={(open) => {
            setMySpotsOpen(open)
            if (!open) setPersonalSpotPicking(false)
            if (open) {
              setAddressSearchOpen(false)
              setInfoDrawerOpen(false)
            }
          }}
          personalSpots={personalSpots}
          personalSpotFolders={personalSpotFolders}
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
            onDateChange={onDateChange}
            selectedCelestial={selectedCelestial}
            onSelectCelestial={setSelectedCelestial}
            onTerrainReadyChange={setImmersiveTerrainReady}
            onTimelapsePreviewPlayingChange={setTimelapsePreviewPlaying}
            flatTerrain={flatTerrain}
            onExit={() => {
              setImmersiveLook(null)
              setImmersiveTerrainReady(false)
              setTimelapsePreviewPlaying(false)
              setMode('orbit')
            }}
          />
        </div>
      ) : null}

      {!immersive && isPhone ? (
        <MobileTopDrawer
          open={infoDrawerOpen}
          onOpenChange={(open) => {
            setInfoDrawerOpen(open)
            if (open) {
              setMySpotsOpen(false)
              setPersonalSpotPicking(false)
              setAddressSearchOpen(false)
            }
          }}
        >
          <section className="mobile-top-drawer__section">
            <h3 className="mobile-top-drawer__section-title">Overview</h3>
            <OverviewCard
              lat={observer.lat}
              lon={observer.lon}
              elevationM={observer.elevationM}
              date={date}
              playheadUtcMs={playheadUtcMs}
              onDateChange={onDateChange}
              onPlayheadChange={onPlayheadChange}
              embedded
            />
          </section>
          <section className="mobile-top-drawer__section mobile-top-drawer__section--weather">
            <h3 className="mobile-top-drawer__section-title">Météo</h3>
            <WeatherCard
              date={date}
              playheadUtcMs={playheadUtcMs}
              location={weatherLocation}
              embedded
              onHourSelect={(utcMs) => onPlayheadChange(utcMs)}
            />
          </section>
        </MobileTopDrawer>
      ) : null}

      {!immersive && !isPhone ? (
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
              location={weatherLocation}
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
          folders={personalSpotFolders}
          selectedId={selectedPersonalSpotId}
          onSelect={selectPersonalSpot}
          onRename={openEditDialog}
          onToggleSpotVisible={onToggleSpotVisible}
          onCreateFolder={onCreateFolder}
          onRenameFolder={onRenameFolder}
          onToggleFolderVisible={onToggleFolderVisible}
          onMoveSpotToFolder={onMoveSpotToFolder}
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
          onDelete={requestDeleteEditingSpot}
        />
      ) : null}

      {!immersive && folderDialog ? (
        <FolderSaveCard
          mode={folderDialog.mode}
          name={folderDialogName}
          onNameChange={setFolderDialogName}
          onClose={() => {
            setFolderDialog(null)
            setFolderDialogName('')
          }}
          onSubmit={commitFolderDialog}
          onDelete={
            folderDialog.mode === 'edit'
              ? requestDeleteFolderFromDialog
              : undefined
          }
        />
      ) : null}

      {!immersive && confirmDialog ? (
        <ConfirmCard
          title={
            confirmDialog.kind === 'spot'
              ? 'Supprimer le spot'
              : 'Supprimer le dossier'
          }
          message={
            confirmDialog.kind === 'spot'
              ? `Supprimer « ${confirmDialog.name} » ? Cette action est définitive.`
              : `Supprimer « ${confirmDialog.name} » ? Les spots seront conservés hors dossier.`
          }
          onConfirm={commitConfirmDialog}
          onClose={() => setConfirmDialog(null)}
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
