import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type CelestialObject } from './celestialObjects'
import {
  ImmersiveView,
  type ImmersiveFramingApi,
} from './ImmersiveView'
import { MapCanvas, type CameraMode, type SpotState } from './MapCanvas'
import { ConfirmCard } from './ConfirmCard'
import { FolderSaveCard } from './FolderSaveCard'
import { MobileTopDrawer } from './MobileTopDrawer'
import {
  FramingsPanel,
  type FramingsEditorDraft,
} from './FramingsPanel'
import { MySpotsRail } from './MySpotsCard'
import { OverviewCard } from './OverviewCard'
import {
  sampleLightPollution,
  type LightPollutionSample,
} from './lightPollution/sampleLightPollution'
import { SpotBortleCard } from './SpotBortleCard'
import { SkyBrightnessPanel } from './SkyBrightnessPanel'
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
import { TerrainQualityDialog } from './TerrainQualityDialog'
import {
  DEFAULT_TERRAIN_QUALITY,
  emitTerrainQualityChange,
  shouldPromptTerrainQuality,
  TERRAIN_QUALITY_CHANGE_EVENT,
  type TerrainQuality,
} from './terrainQuality'
import {
  loadMapRailWidthPx,
  saveMapRailWidthPx,
} from './mapRailWidth'
import {
  deleteFramingThumb,
  putFramingThumb,
} from './framingThumbStore'
import {
  createPersonalFraming,
  formatCivilLocalTimestamp,
  framingCoordsLabel,
  framingGeoSpotId,
  framingNightGroupDay,
  framingMonthFromDay,
  loadPersonalFramings,
  peakUtcFromCivilLocal,
  removePersonalFraming,
  savePersonalFramings,
  suggestFramingName,
  upsertPersonalFraming,
  type FramingViewSnapshot,
  type PersonalFraming,
} from './personalFramings'
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
import { useT } from './i18n'
import './App.css'
import './timelineCalendar.css'


type PendingSave = {
  lat: number
  lon: number
  heightM: number
  bearingDeg: number
  pitchDeg: number
}

export default function App() {
  const t = useT()
  const savedMap = useMemo(() => loadAppSettings().map, [])
  const savedImmersive = useMemo(() => loadAppSettings().immersive, [])
  const isPhone = useMatchMedia(OPERATE_PHONE_MQ)
  const [mode, setMode] = useState<CameraMode>('orbit')
  /** Immersive without DEM — flat disc for fast sky testing. */
  const [flatTerrain, setFlatTerrain] = useState(false)
  const [terrainQuality, setTerrainQuality] = useState<TerrainQuality>(
    savedImmersive.terrainQuality ?? DEFAULT_TERRAIN_QUALITY,
  )
  const [terrainQualityPromptOpen, setTerrainQualityPromptOpen] =
    useState(false)
  const pendingImmersiveEnterRef = useRef<(() => void) | null>(null)

  const gateImmersiveEnter = useCallback(
    (enter: () => void, opts?: { flatTerrain?: boolean }) => {
      const chosen = loadAppSettings().immersive.terrainQualityChosen
      if (
        shouldPromptTerrainQuality({
          chosen,
          flatTerrain: opts?.flatTerrain,
        })
      ) {
        pendingImmersiveEnterRef.current = enter
        setTerrainQualityPromptOpen(true)
        return
      }
      enter()
    },
    [],
  )

  const onTerrainQualityChoose = useCallback((quality: TerrainQuality) => {
    patchAppSettings({
      immersive: { terrainQuality: quality, terrainQualityChosen: true },
    })
    setTerrainQuality(quality)
    emitTerrainQualityChange(quality)
    setTerrainQualityPromptOpen(false)
    const enter = pendingImmersiveEnterRef.current
    pendingImmersiveEnterRef.current = null
    enter?.()
  }, [])

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<TerrainQuality>).detail
      if (
        detail === 'high' ||
        detail === 'standard' ||
        detail === 'medium' ||
        detail === 'low'
      ) {
        setTerrainQuality(detail)
        return
      }
      setTerrainQuality(loadAppSettings().immersive.terrainQuality)
    }
    window.addEventListener(TERRAIN_QUALITY_CHANGE_EVENT, onChange)
    return () =>
      window.removeEventListener(TERRAIN_QUALITY_CHANGE_EVENT, onChange)
  }, [])

  const onTerrainQualityCancel = useCallback(() => {
    pendingImmersiveEnterRef.current = null
    setTerrainQualityPromptOpen(false)
  }, [])
  const [threeDimensional, setThreeDimensional] = useState(
    savedMap.threeDimensional,
  )
  const [basemapMode, setBasemapMode] = useState<BasemapMode>(
    savedMap.basemapMode,
  )
  const [plHeatmapEnabled, setPlHeatmapEnabled] = useState(
    savedMap.plHeatmapEnabled,
  )
  const [plHeatmapOpacity, setPlHeatmapOpacity] = useState(
    savedMap.plHeatmapOpacity,
  )
  const [addressSearchOpen, setAddressSearchOpen] = useState(false)
  const [spot, setSpot] = useState<SpotState | null>(null)
  const [bortleSample, setBortleSample] = useState<LightPollutionSample | null>(
    null,
  )
  const [skyBrightnessOpen, setSkyBrightnessOpen] = useState(false)
  /** Fold Overview when a spot is picked so Weather + Bortle stay visible. */
  const [overviewCollapsed, setOverviewCollapsed] = useState(false)
  const [infoDrawerOpen, setInfoDrawerOpen] = useState(false)

  const [mySpotsOpen, setMySpotsOpen] = useState(false)
  const [framingsOpen, setFramingsOpen] = useState(false)
  const [mapRailWidthPx, setMapRailWidthPx] = useState(loadMapRailWidthPx)
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
  const [personalFramings, setPersonalFramings] = useState<PersonalFraming[]>(
    () => loadPersonalFramings(),
  )
  const [framingsDisplay, setFramingsDisplay] = useState<'list' | 'calendar'>(
    'list',
  )
  const [framingsFilterSpotId, setFramingsFilterSpotId] = useState('all')
  const [framingsCalendarDay, setFramingsCalendarDay] = useState(() =>
    civilDateFromUtc(Date.now(), 0),
  )
  const [framingsCalendarMonth, setFramingsCalendarMonth] = useState(() =>
    civilDateFromUtc(Date.now(), 0).slice(0, 7),
  )
  const [activeFramingId, setActiveFramingId] = useState<string | null>(null)
  const [framingsEditor, setFramingsEditor] =
    useState<FramingsEditorDraft | null>(null)
  const framingApiRef = useRef<ImmersiveFramingApi | null>(null)
  const [immersiveCanSaveFraming, setImmersiveCanSaveFraming] = useState(false)
  const pendingFramingRestoreRef = useRef<FramingViewSnapshot | null>(null)
  const mapFramingsReturnRef = useRef<{
    open: boolean
    display: 'list' | 'calendar'
    day: string
    month: string
    filterSpotId: string
  } | null>(null)
  const [personalSpotPicking, setPersonalSpotPicking] = useState(false)
  const [flyToPersonalSpotId, setFlyToPersonalSpotId] = useState<string | null>(
    null,
  )
  const [markerMenuOpen, setMarkerMenuOpen] = useState(false)

  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null)
  const [pendingSaveName, setPendingSaveName] = useState('')
  const [editingSpot, setEditingSpot] = useState<PersonalSpot | null>(null)
  const [editingName, setEditingName] = useState('')
  /** Snapshot used to restore the pin / list if the edit dialog is cancelled. */
  const editingOriginRef = useRef<PersonalSpot | null>(null)
  const [folderDialog, setFolderDialog] = useState<{
    mode: 'create' | 'edit'
    folder: PersonalSpotFolder | null
  } | null>(null)
  const [folderDialogName, setFolderDialogName] = useState('')
  const [confirmDialog, setConfirmDialog] = useState<{
    kind: 'spot' | 'folder' | 'framing'
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

  // Collapse Overview on spot place/select (lat/lon), not on DEM height-only updates.
  const spotPickKey = spot
    ? `${spot.lat.toFixed(5)},${spot.lon.toFixed(5)}`
    : null
  useEffect(() => {
    if (spotPickKey) setOverviewCollapsed(true)
    else setOverviewCollapsed(false)
  }, [spotPickKey])

  const bortleCard =
    spot && bortleSample ? (
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
              ? t('bortle.source.viirsDem')
              : t('bortle.source.viirs')
            : t('bortle.source.blackMarble')
        }
        onOpenSkyBrightness={() => setSkyBrightnessOpen(true)}
      />
    ) : null

  /** No spot → UTC clock; with spot → civil clock at that lon (same UTC instant). */
  const timelineLon = spot ? spot.lon : 0
  const clockIsUtc = spot == null

  const [date, setDate] = useState(() => civilDateFromUtc(Date.now(), 0))
  /** Wall-clock UTC (minute floor) — never a fixed 18:00, or globe/map disagree with “now”. */
  const [playheadUtcMs, setPlayheadUtcMs] = useState(() => {
    const now = Date.now()
    return Math.floor(now / 60_000) * 60_000
  })
  const [scrubbingMapTime, setScrubbingMapTime] = useState(false)
  const [mapPreviewTime, setMapPreviewTime] = useState(playheadUtcMs)
  const playheadUtcMsRef = useRef(playheadUtcMs)
  playheadUtcMsRef.current = playheadUtcMs
  useEffect(() => {
    if (!scrubbingMapTime) return
    setMapPreviewTime(playheadUtcMsRef.current)
    const timer = window.setInterval(() => setMapPreviewTime(playheadUtcMsRef.current), 125)
    return () => window.clearInterval(timer)
  }, [scrubbingMapTime])
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
    savePersonalFramings(personalFramings)
  }, [personalFramings])

  useEffect(() => {
    installThreeGameTestHooks()
    const api: QaAppApi = {
      enterImmersive: (opts) => {
        gateImmersiveEnter(
          () => {
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
          { flatTerrain: Boolean(opts.flatTerrain) },
        )
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
  }, [mode, spot, gateImmersiveEnter])

  useEffect(() => {
    patchAppSettings({
      map: {
        threeDimensional,
        basemapMode,
        plHeatmapEnabled,
        plHeatmapOpacity,
      },
    })
  }, [threeDimensional, basemapMode, plHeatmapEnabled, plHeatmapOpacity])

  useEffect(() => {
    const root = document.documentElement
    // Phone sheets overlay the map — do not inset the stage.
    const railOpen = (mySpotsOpen || framingsOpen) && !isPhone
    root.style.setProperty(
      '--map-rail-width',
      railOpen ? `${mapRailWidthPx}px` : '0px',
    )
    return () => {
      root.style.setProperty('--map-rail-width', '0px')
    }
  }, [mySpotsOpen, framingsOpen, isPhone, mapRailWidthPx])

  const onMapRailWidthChange = useCallback((widthPx: number) => {
    setMapRailWidthPx(widthPx)
    saveMapRailWidthPx(widthPx)
  }, [])

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

  /** Draft edit location overlays the saved list for map markers only. */
  const personalSpotsForMap = useMemo(() => {
    if (!editingSpot) return personalSpots
    return upsertPersonalSpot(personalSpots, {
      ...editingSpot,
      name: editingName.trim() || editingSpot.name,
    })
  }, [personalSpots, editingSpot, editingName])

  const selectPersonalSpot = useCallback((saved: PersonalSpot) => {
    // Don't setSpot yet — night dim for the destination would paint the
    // current framing black mid-fly. Spot lands with the camera.
    setSelectedPersonalSpotId(saved.id)
    setMode('orbit')
    setFlyToPersonalSpotId(saved.id)
  }, [])

  /** Opening the pin panel: bind list selection if this pin matches a saved spot. */
  const activateWorkingPin = useCallback(() => {
    if (!spot) return
    const match = findSpotAt(spot.lat, spot.lon)
    if (match) {
      setSelectedPersonalSpotId(match.id)
      return
    }
    setSelectedPersonalSpotId(null)
  }, [spot, findSpotAt])

  const closeEditDialog = useCallback(() => {
    const origin = editingOriginRef.current
    editingOriginRef.current = null
    setEditingSpot(null)
    setEditingName('')
    setPersonalSpotPicking(false)
    if (!origin) return
    setSpot({
      lat: origin.lat,
      lon: origin.lon,
      heightM: origin.heightM ?? 0,
      bearingDeg: origin.bearingDeg,
      pitchDeg: origin.pitchDeg,
    })
    setSelectedPersonalSpotId(origin.id)
  }, [])

  const openSaveDialog = useCallback(
    (input: PendingSave) => {
      editingOriginRef.current = null
      setEditingSpot(null)
      setPendingSave(input)
      setPendingSaveName(`${t('common.spot')} ${personalSpots.length + 1}`)
      setPersonalSpotPicking(false)
      setMarkerMenuOpen(false)
    },
    [personalSpots.length, t],
  )

  const openEditDialog = useCallback((saved: PersonalSpot) => {
    setPendingSave(null)
    editingOriginRef.current = saved
    setEditingSpot(saved)
    setEditingName(saved.name)
    setSelectedPersonalSpotId(saved.id)
    setSpot({
      lat: saved.lat,
      lon: saved.lon,
      heightM: saved.heightM ?? 0,
      bearingDeg: saved.bearingDeg,
      pitchDeg: saved.pitchDeg,
    })
    setPersonalSpotPicking(true)
    setMarkerMenuOpen(false)
  }, [])

  const applyEditingSpotLocation = useCallback(
    (input: {
      lat: number
      lon: number
      heightM: number
      bearingDeg: number
      pitchDeg: number
    }) => {
      setEditingSpot((prev) =>
        prev
          ? {
              ...prev,
              lat: input.lat,
              lon: input.lon,
              heightM: input.heightM,
              bearingDeg: input.bearingDeg,
              pitchDeg: input.pitchDeg,
            }
          : null,
      )
      setSpot({
        lat: input.lat,
        lon: input.lon,
        heightM: input.heightM,
        bearingDeg: input.bearingDeg,
        pitchDeg: input.pitchDeg,
      })
    },
    [],
  )

  const onPlacePersonalSpot = useCallback(
    (input: {
      lat: number
      lon: number
      heightM: number
      bearingDeg: number
      pitchDeg: number
    }) => {
      if (editingSpot) {
        applyEditingSpotLocation(input)
        return
      }
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
    [editingSpot, applyEditingSpotLocation, openSaveDialog],
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
      name:
        pendingSaveName.trim() ||
        `${t('common.spot')} ${personalSpots.length + 1}`,
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
  }, [pendingSave, pendingSaveName, personalSpots.length, selectPersonalSpot, t])

  const commitEditingSpot = useCallback(() => {
    if (!editingSpot) return
    const next = {
      ...editingSpot,
      name: editingName.trim() || editingSpot.name,
    }
    setPersonalSpots((prev) => upsertPersonalSpot(prev, next))
    editingOriginRef.current = null
    setEditingSpot(null)
    setEditingName('')
    setPersonalSpotPicking(false)
    setSelectedPersonalSpotId(next.id)
    setSpot({
      lat: next.lat,
      lon: next.lon,
      heightM: next.heightM ?? 0,
      bearingDeg: next.bearingDeg,
      pitchDeg: next.pitchDeg,
    })
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
    setFolderDialogName(
      `${t('spots.folder.defaultName')} ${personalSpotFolders.length + 1}`,
    )
  }, [personalSpotFolders.length, t])

  const onRenameFolder = useCallback((folder: PersonalSpotFolder) => {
    setFolderDialog({ mode: 'edit', folder })
    setFolderDialogName(folder.name)
  }, [])

  const commitFolderDialog = useCallback(() => {
    if (!folderDialog) return
    const fallback =
      folderDialog.mode === 'create'
        ? `${t('spots.folder.defaultName')} ${personalSpotFolders.length + 1}`
        : (folderDialog.folder?.name ?? t('spots.folder.defaultName'))
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
  }, [folderDialog, folderDialogName, personalSpotFolders.length, t])

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
        editingOriginRef.current = null
        setEditingSpot(null)
        setEditingName('')
        setPersonalSpotPicking(false)
      }
    } else if (confirmDialog.kind === 'framing') {
      const id = confirmDialog.id
      const row = personalFramings.find((f) => f.id === id)
      setPersonalFramings((list) => removePersonalFraming(list, id))
      if (row?.thumbId) void deleteFramingThumb(row.thumbId)
      if (activeFramingId === id) setActiveFramingId(null)
      setFramingsEditor(null)
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
    personalFramings,
    activeFramingId,
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

  const currentSavedSpot = useMemo(() => {
    if (!spot) return null
    return (
      (selectedPersonalSpotId
        ? personalSpots.find((row) => row.id === selectedPersonalSpotId)
        : null) ?? findSpotAt(spot.lat, spot.lon)
    )
  }, [spot, selectedPersonalSpotId, personalSpots, findSpotAt])

  const framingSpotOptions = useMemo(() => {
    const spotNames = new Map(
      personalSpots.map((spotRow) => [spotRow.id, spotRow.name] as const),
    )
    const labels = new Map<string, string>()
    for (const framing of personalFramings) {
      if (labels.has(framing.spotId)) continue
      labels.set(
        framing.spotId,
        spotNames.get(framing.spotId) ?? framing.spotName,
      )
    }
    return [...labels.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  }, [personalSpots, personalFramings])

  // Drop a filter that no longer matches any framing (deleted last cadrage).
  useEffect(() => {
    if (framingsFilterSpotId === 'all') return
    if (framingSpotOptions.some((opt) => opt.id === framingsFilterSpotId)) return
    setFramingsFilterSpotId('all')
  }, [framingsFilterSpotId, framingSpotOptions])

  const currentFramingSpot = useMemo(() => {
    if (!spot) return null
    if (currentSavedSpot) {
      return {
        id: currentSavedSpot.id,
        name: currentSavedSpot.name,
      }
    }
    return {
      id: framingGeoSpotId(spot.lat, spot.lon),
      name: framingCoordsLabel(spot.lat, spot.lon),
    }
  }, [spot, currentSavedSpot])

  const canSaveFraming =
    mode === 'ground' && currentFramingSpot != null && immersiveCanSaveFraming

  const requestSaveCurrentFraming = useCallback(() => {
    const api = framingApiRef.current
    const place = currentFramingSpot
    if (!api || !place || !spot) return
    const view = api.getSnapshot()
    if (!view) return
    const peakLocal = formatCivilLocalTimestamp(playheadUtcMs, spot.lon)
    const existingNames = personalFramings
      .filter((row) => row.spotId === place.id)
      .map((row) => row.name)
    setFramingsEditor({
      name: suggestFramingName(view, existingNames),
      peakLocal,
      view,
      spotId: place.id,
      spotName: place.name,
    })
  }, [currentFramingSpot, spot, playheadUtcMs, personalFramings])

  const submitFramingEditor = useCallback(
    async (draft: FramingsEditorDraft) => {
      if (!spot && !draft.id) return
      const lat = spot?.lat ?? personalFramings.find((f) => f.id === draft.id)?.lat
      const lon = spot?.lon ?? personalFramings.find((f) => f.id === draft.id)?.lon
      if (lat == null || lon == null) return
      const peakLocal = draft.peakLocal
      const peakUtc = peakUtcFromCivilLocal(peakLocal, lon)
      const localDate = peakLocal.slice(0, 10)
      let thumbId: string | null = null
      if (!draft.id) {
        const blob = await framingApiRef.current?.captureThumb()
        if (blob) {
          thumbId = crypto.randomUUID?.() ?? `thumb-${Date.now()}`
          try {
            await putFramingThumb(thumbId, blob)
          } catch {
            thumbId = null
          }
        }
      } else {
        thumbId =
          personalFramings.find((f) => f.id === draft.id)?.thumbId ?? null
      }
      const heightM =
        spot?.heightM ??
        personalFramings.find((f) => f.id === draft.id)?.heightM ??
        null
      const created = createPersonalFraming({
        name: draft.name,
        lat,
        lon,
        peakUtc,
        peakLocal,
        localDate,
        spotId: draft.spotId,
        spotName: draft.spotName,
        heightM,
        view: draft.view,
        thumbId,
        source: 'immersive',
      })
      if (draft.id) {
        const prev = personalFramings.find((f) => f.id === draft.id)
        setPersonalFramings((list) =>
          upsertPersonalFraming(list, {
            ...created,
            id: draft.id!,
            createdAtIso: prev?.createdAtIso ?? created.createdAtIso,
            thumbId: prev?.thumbId ?? thumbId,
          }),
        )
        setActiveFramingId(draft.id)
      } else {
        setPersonalFramings((list) => upsertPersonalFraming(list, created))
        setActiveFramingId(created.id)
      }
      const nightDay = framingNightGroupDay(peakLocal)
      setFramingsCalendarDay(nightDay)
      setFramingsCalendarMonth(framingMonthFromDay(nightDay))
      setFramingsDisplay('list')
      setFramingsEditor(null)
      setFramingsOpen(true)
    },
    [spot, personalFramings],
  )

  const editFraming = useCallback((framing: PersonalFraming) => {
    setFramingsEditor({
      id: framing.id,
      name: framing.name,
      peakLocal: framing.peakLocal,
      view: framing.view,
      spotId: framing.spotId,
      spotName: framing.spotName,
    })
  }, [])

  const applyFramingInImmersive = useCallback(
    (framing: PersonalFraming) => {
      setDate(framing.localDate)
      const peakMs = Date.parse(framing.peakUtc)
      if (Number.isFinite(peakMs)) setPlayheadUtcMs(peakMs)
      setActiveFramingId(framing.id)
      setSelectedPersonalSpotId(framing.spotId)
      setImmersiveLook({
        bearingDeg: framing.view.bearingDeg,
        pitchDeg: framing.view.pitchDeg,
      })
      const apply = () => framingApiRef.current?.applySnapshot(framing.view)
      apply()
      window.setTimeout(apply, 120)
      window.setTimeout(apply, 400)
    },
    [],
  )

  const restoreFraming = useCallback(
    (framing: PersonalFraming) => {
      const linked = personalSpots.find((row) => row.id === framing.spotId)
      const sameSpot =
        spot != null &&
        Math.abs(spot.lat - framing.lat) < 1e-5 &&
        Math.abs(spot.lon - framing.lon) < 1e-5

      if (mode === 'ground' && sameSpot) {
        applyFramingInImmersive(framing)
        setFramingsEditor(null)
        return
      }

      // Leaving the map → remember panel UI for return.
      if (mode !== 'ground') {
        mapFramingsReturnRef.current = {
          open: framingsOpen,
          display: framingsDisplay,
          day: framingsCalendarDay,
          month: framingsCalendarMonth,
          filterSpotId: framingsFilterSpotId,
        }
      }

      gateImmersiveEnter(() => {
        pendingFramingRestoreRef.current = framing.view
        setActiveFramingId(framing.id)
        setFramingsEditor(null)
        setFramingsOpen(false)
        setMySpotsOpen(false)
        setDate(framing.localDate)
        const peakMs = Date.parse(framing.peakUtc)
        if (Number.isFinite(peakMs)) setPlayheadUtcMs(peakMs)
        setImmersiveLook({
          bearingDeg: framing.view.bearingDeg,
          pitchDeg: framing.view.pitchDeg,
        })
        if (linked) {
          setSelectedPersonalSpotId(linked.id)
          setSpot({
            lat: linked.lat,
            lon: linked.lon,
            heightM: linked.heightM ?? framing.heightM ?? 0,
            bearingDeg: framing.view.bearingDeg,
            pitchDeg: linked.pitchDeg,
          })
        } else {
          setSelectedPersonalSpotId(framing.spotId)
          setSpot({
            lat: framing.lat,
            lon: framing.lon,
            heightM: framing.heightM ?? 0,
            bearingDeg: framing.view.bearingDeg,
            pitchDeg: framing.view.pitchDeg,
          })
        }
        setFlatTerrain(false)
        setMode('ground')
      })
    },
    [
      personalSpots,
      spot,
      mode,
      framingsOpen,
      framingsDisplay,
      framingsCalendarDay,
      framingsCalendarMonth,
      framingsFilterSpotId,
      applyFramingInImmersive,
      gateImmersiveEnter,
    ],
  )

  // Apply pending framing once immersive API is ready.
  useEffect(() => {
    if (mode !== 'ground') return
    const view = pendingFramingRestoreRef.current
    if (!view) return
    const tryApply = () => {
      if (!framingApiRef.current) return false
      framingApiRef.current.applySnapshot(view)
      pendingFramingRestoreRef.current = null
      return true
    }
    if (tryApply()) return
    const t1 = window.setTimeout(() => tryApply(), 200)
    const t2 = window.setTimeout(() => tryApply(), 800)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [mode, spot?.lat, spot?.lon])

  const immersive = mode === 'ground' && spot != null

  // Map ↔ Three.js: always dismiss the right rail (Mes spots / Cadrages).
  // Leaving it open carried an empty FramingsPanel into immersive, and
  // restoring it on exit fought the map chrome.
  useEffect(() => {
    setMySpotsOpen(false)
    setFramingsOpen(false)
    setFramingsEditor(null)
    if (immersive) setInfoDrawerOpen(false)
    mapFramingsReturnRef.current = null
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
          plHeatmapEnabled={plHeatmapEnabled}
          plHeatmapOpacity={plHeatmapOpacity}
          addressSearchOpen={addressSearchOpen}
          spot={spot}
          onModeChange={(next, opts) => {
            // Only flip flatTerrain on enter — resetting it on exit remounts
            // the parked same-spot scene and starts a DEM load in the background.
            if (next === 'ground') {
              const nextFlat = Boolean(opts?.flatTerrain)
              gateImmersiveEnter(() => {
                setFlatTerrain(nextFlat)
                setMode('ground')
              }, { flatTerrain: nextFlat })
              return
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
            if (editingSpot) {
              setEditingSpot((prev) =>
                prev
                  ? {
                      ...prev,
                      lat: next.lat,
                      lon: next.lon,
                      heightM: next.heightM,
                      bearingDeg: next.bearingDeg,
                      pitchDeg: next.pitchDeg,
                    }
                  : null,
              )
              setSelectedPersonalSpotId(editingSpot.id)
              return
            }
            // Map place → temporary pin (weather follows pin; list selection cleared if moved).
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
          onPlHeatmapEnabledChange={setPlHeatmapEnabled}
          onPlHeatmapOpacityChange={setPlHeatmapOpacity}
          onAddressSearchOpenChange={setAddressSearchOpen}
          skyUtcMs={scrubbingMapTime ? mapPreviewTime : playheadUtcMs}
          mySpotsOpen={mySpotsOpen}
          onMySpotsOpenChange={(open) => {
            setMySpotsOpen(open)
            if (!open && !editingSpot) setPersonalSpotPicking(false)
            if (open) {
              setFramingsOpen(false)
              setAddressSearchOpen(false)
              setInfoDrawerOpen(false)
            }
          }}
          framingsOpen={framingsOpen}
          onFramingsOpenChange={(open) => {
            setFramingsOpen(open)
            if (open) {
              setMySpotsOpen(false)
              if (!editingSpot) setPersonalSpotPicking(false)
              setAddressSearchOpen(false)
              setInfoDrawerOpen(false)
              setFramingsEditor(null)
            }
          }}
          personalSpots={personalSpotsForMap}
          personalSpotFolders={personalSpotFolders}
          selectedPersonalSpotId={selectedPersonalSpotId}
          personalSpotPicking={personalSpotPicking || editingSpot != null}
          onPlacePersonalSpot={onPlacePersonalSpot}
          onSelectPersonalSpot={selectPersonalSpot}
          onActivateWorkingPin={activateWorkingPin}
          flyToPersonalSpotId={flyToPersonalSpotId}
          onFlyToPersonalSpotHandled={onFlyToPersonalSpotHandled}
          showAllPersonalSpotsToken={0}
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
            flatTerrain={flatTerrain}
            terrainQuality={terrainQuality}
            framingsOpen={framingsOpen}
            onFramingsOpenChange={(open) => {
              setFramingsOpen(open)
              if (open) {
                setMySpotsOpen(false)
                setFramingsEditor(null)
                if (currentFramingSpot) {
                  setFramingsFilterSpotId(currentFramingSpot.id)
                }
              }
            }}
            onFramingCanSaveChange={setImmersiveCanSaveFraming}
            framingApiRef={framingApiRef}
            onExit={() => {
              setImmersiveLook(null)
              setImmersiveTerrainReady(false)
              setTimelapsePreviewPlaying(false)
              setMySpotsOpen(false)
              setFramingsOpen(false)
              setFramingsEditor(null)
              mapFramingsReturnRef.current = null
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
              setFramingsOpen(false)
              if (!editingSpot) setPersonalSpotPicking(false)
              setAddressSearchOpen(false)
            }
          }}
        >
          <section className="mobile-top-drawer__section">
            <h3 className="mobile-top-drawer__section-title">
              {t('map.drawer.sectionOverview')}
            </h3>
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
            <h3 className="mobile-top-drawer__section-title">
              {t('map.drawer.sectionWeather')}
            </h3>
            <WeatherCard
              date={date}
              playheadUtcMs={playheadUtcMs}
              location={weatherLocation}
              embedded
              onHourSelect={(utcMs) => onPlayheadChange(utcMs)}
            />
          </section>
          {bortleCard ? (
            <section className="mobile-top-drawer__section">
              <h3 className="mobile-top-drawer__section-title">
                {t('map.drawer.sectionBortle')}
              </h3>
              {bortleCard}
            </section>
          ) : null}
        </MobileTopDrawer>
      ) : null}

      {!immersive && !isPhone ? (
        <div className="map-ui" aria-label={t('map.uiAria')}>
          <div className="ov-anchor">
            <OverviewCard
              lat={observer.lat}
              lon={observer.lon}
              elevationM={observer.elevationM}
              date={date}
              playheadUtcMs={playheadUtcMs}
              onDateChange={onDateChange}
              onPlayheadChange={onPlayheadChange}
              collapsed={overviewCollapsed}
              onCollapsedChange={setOverviewCollapsed}
            />
            <WeatherCard
              date={date}
              playheadUtcMs={playheadUtcMs}
              location={weatherLocation}
              onHourSelect={(utcMs) => onPlayheadChange(utcMs)}
            />
            {bortleCard}
          </div>
        </div>
      ) : null}

      {!immersive && spot && bortleSample ? (
        <SkyBrightnessPanel
          open={skyBrightnessOpen}
          onClose={() => setSkyBrightnessOpen(false)}
          lat={spot.lat}
          lon={spot.lon}
          elevM={spot.heightM}
          sample={bortleSample}
        />
      ) : null}

      {!immersive ? (
        <MySpotsRail
          open={mySpotsOpen}
          onClose={() => {
            setMySpotsOpen(false)
            if (!editingSpot) setPersonalSpotPicking(false)
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
          railWidthPx={mapRailWidthPx}
          onRailWidthChange={onMapRailWidthChange}
        />
      ) : null}

      <FramingsPanel
        open={framingsOpen}
        onClose={() => {
          setFramingsOpen(false)
          setFramingsEditor(null)
        }}
        mode={immersive ? 'immersive' : 'map'}
        framings={personalFramings}
        railWidthPx={mapRailWidthPx}
        onRailWidthChange={onMapRailWidthChange}
        spotOptions={framingSpotOptions}
        filterSpotId={framingsFilterSpotId}
        onFilterSpotIdChange={setFramingsFilterSpotId}
        currentSpotId={currentFramingSpot?.id ?? null}
        currentSpotName={currentFramingSpot?.name ?? null}
        display={framingsDisplay}
        onDisplayChange={setFramingsDisplay}
        calendarDay={framingsCalendarDay}
        onCalendarDayChange={(day) => {
          setFramingsCalendarDay(day)
          setFramingsCalendarMonth(framingMonthFromDay(day))
        }}
        calendarMonth={framingsCalendarMonth}
        onCalendarMonthChange={(month) => {
          setFramingsCalendarMonth(month)
          if (!framingsCalendarDay.startsWith(month)) {
            setFramingsCalendarDay(`${month}-01`)
          }
        }}
        activeId={activeFramingId}
        canSaveCurrent={canSaveFraming}
        onRequestSaveCurrent={requestSaveCurrentFraming}
        editor={framingsEditor}
        onEditorChange={setFramingsEditor}
        onSubmitEditor={(draft) => {
          void submitFramingEditor(draft)
        }}
        onDeleteFraming={(id) => {
          const row = personalFramings.find((f) => f.id === id)
          setConfirmDialog({
            kind: 'framing',
            id,
            name: row?.name ?? t('framings.defaultName'),
          })
        }}
        onRestore={restoreFraming}
        onEdit={editFraming}
      />

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
          mapPass
          onNameChange={setEditingName}
          onClose={closeEditDialog}
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

      {confirmDialog ? (
        <ConfirmCard
          title={
            confirmDialog.kind === 'spot'
              ? t('spots.confirm.deleteSpotTitle')
              : confirmDialog.kind === 'framing'
                ? t('spots.confirm.deleteFramingTitle')
                : t('spots.confirm.deleteFolderTitle')
          }
          message={
            confirmDialog.kind === 'spot'
              ? t('spots.confirm.deleteSpotMsg', { name: confirmDialog.name })
              : confirmDialog.kind === 'framing'
                ? t('spots.confirm.deleteFramingMsg', {
                    name: confirmDialog.name,
                  })
                : t('spots.confirm.deleteFolderMsg', {
                    name: confirmDialog.name,
                  })
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
          onScrubbingChange={setScrubbingMapTime}
          onDateChange={onDateChange}
          onPlayheadChange={onPlayheadChange}
        />
      ) : null}

      <TerrainQualityDialog
        open={terrainQualityPromptOpen}
        onChoose={onTerrainQualityChoose}
        onCancel={onTerrainQualityCancel}
      />
    </div>
  )
}
