import { sampleMoonSkyAt } from "./skySamples"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import * as THREE from 'three'
import { loadAppSettings, patchAppSettings } from './appSettings'
import { CelestialSearchPanel } from './CelestialSearchPanel'
import { CelestialTargetCard } from './CelestialTargetCard'
import {
  objectHorizontalAt,
  type CelestialObject,
} from './celestialObjects'
import { civilDayStartUtcMs, sunPositionAt } from './celestial'
import {
  clampFrameRollDeg,
  horizontalFovDegFromFocalMm,
  SENSOR_CROP_FACTOR,
  verticalFovDegFromFocalMm,
  type SensorFormat,
  type ViewfinderFrameMode,
  type ViewfinderOrientation,
} from './lensFov'
import {
  installFrustumCullingControl,
  setFrustumCullingEnabled,
} from './frustumCullingControl'
import {
  clearParkedLocalTerrain,
  createFlatLocalTerrainMesh,
  createLocalTerrainMesh,
  NEAR_TERRAIN_RADIUS_M,
  parkLocalTerrain,
  takeParkedLocalTerrain,
  reviveLocalTerrainTextures,
  type LocalTerrainHandle,
  type TerrainLoadPhase,
} from './localTerrainMesh'
import {
  createRenderDiagLive,
  type RenderDiagLive,
} from './renderDiagnostic'
import { RenderDiagnosticCard } from './RenderDiagnosticCard'
import { shuffleAstroLoaderTips } from './astroLoaderTips'
import {
  formatMegabytes,
  getNetworkBytesTotal,
  subscribeNetworkBytes,
} from './networkBytesMeter'

const TERRAIN_PHASE_LABEL: Record<TerrainLoadPhase, string> = {
  dem: 'Relief DEM\u2026',
  preview: 'Aper\u00e7u satellite\u2026',
  ortho: 'Ortho haute r\u00e9solution\u2026',
  detail: 'Relief moyen\u2026',
  far: 'Horizon 300 km\u2026',
  ready: 'Pr\u00eat',
}

const LOADER_TIP_ROTATE_MS = 15000
import {
  clampStarBrightness,
  clampStarGlow,
  clampStarMagDepth,
  clampStarZoomSpan,
} from './starRevealSettings'
import { createNightSky } from './nightSky'
import { createSkyBodies } from './skyBodies'
import { PhotoFrameOverlay } from './PhotoFrameOverlay'
import { clampEyeHeightM, EYE_HEIGHT_STEP_M } from './presets'
import { ViewBearingHud } from './ViewBearingHud'
import { type PanoramaPlan } from './panorama'
import {
  normalizeTimelapsePlan,
  timelapseStarTrailArcRad,
  type TimelapsePlan,
} from './timelapse'
import { TimelapsePreviewHud } from './TimelapsePreviewHud'
import { useTimelapsePreview } from './useTimelapsePreview'
import {
  OPEN_TIMELAPSE_SETTINGS_EVENT,
  ViewfinderCaptureCapsule,
} from './ViewfinderCaptureCapsule'
import { ViewfinderLandscapeControl } from './ViewfinderLandscapeControl'
import { ViewfinderProjectionControl } from './ViewfinderProjectionControl'
import {
  ViewfinderSkyControl,
  type LocalHaloControls,
} from './ViewfinderSkyControl'
import {
  ViewfinderWeatherControl,
  weatherControlsFromSettings,
} from './ViewfinderWeatherControl'
import { fetchWeatherForecast } from './weatherForecast'
import {
  DEFAULT_VIEWFINDER_WEATHER,
  getWeatherDayFactor,
  getWeatherGroundLightFactor,
  getWeatherGroundSunWarmth,
  normalizeWeatherLayer,
  resolveViewfinderWeatherAt,
  weatherForecastSnapshot,
  weatherWantsVolumePass,
  WEATHER_LAYER_DEFAULTS,
  type ViewfinderWeather,
  type ViewfinderWeatherForecast,
} from './viewfinderWeather'
import { ViewPitchHud } from './ViewPitchHud'
import {
  AzimuthGridIcon,
  ConstellationsIcon,
  MilkyWayIcon,
  RaDecGridIcon,
} from './psIcons'
import {
  createAstroSkyDome,
  eclipticNorthPoleThreeLocal,
  setLightPollutionProfile,
  renderImmersiveLightPollution,
  sunDirectionFromAltAz,
  updateAstroSkyDome,
} from './skyDome'
import {
  buildHorizonGlowProfile,
  peakIntensity01,
} from './lightPollution/horizonGlowProfile'
import {
  lightPollutionMilkyWayMul,
  lightPollutionStarBrightMul,
  lightPollutionStarMagPenalty,
} from './lightPollution/lpVisual'
import {
  loadAppHaloDataset,
  loadReferenceHaloDataset,
  prepareHalo,
  type HaloDataSourceId,
  type HaloDataset,
} from './lightPollution/localHalo/haloData'
import { requestHaloField } from './lightPollution/localHalo/haloFieldClient'
import {
  createLocalHaloPass,
  LOCAL_HALO_PASS_REV,
  type LocalHaloField,
  type LocalHaloTuning,
} from './lightPollution/localHalo/localHaloPass'
import { ENU_M_PER_DEG } from './lightPollution/localHalo/haloFieldCore'
import { localHaloNight } from './lightPollution/localHalo/localHaloSettings'
import {
  formatLocalHaloProbe,
  probeLocalHalo,
} from './lightPollution/localHalo/localHaloProbe'
import {
  applyStageProjection,
  getStageProjection,
  setStageProjection,
  stelModeUniform,
  type StageProjection,
} from './stelProjector'
import { createStereoCubemapPass } from './stereoCubemapPass'
import {
  clampAirglowAmount,
  clampAirglowHue,
  clampAirglowWaves,
  clampAtmosphereAmount,
  clampGroundNightBrightness,
  clampGroundNightContrast,
  clampGroundNightTemperature,
  clampLightPollutionAmount,
  clampZodiacalAmount,
  groundAlbedoFromSky,
  hexToRgb01,
  skyPaletteFromSunAltitude,
} from './skyLighting'
import { bortlePollutionFactor } from './lightPollution/bortleFromRadiance'
import { sampleLightPollution } from './lightPollution/sampleLightPollution'
import type { QaImmersiveApi } from './qaTestHooks'

type MoveDir = 'up' | 'down' | 'left' | 'right'

type LocalHaloDebug = {
  source: HaloDataSourceId
  status: string
  label: string
  sources: number
  referenceAltitudeKm: number
  yMinKm: number
  yMaxKm: number
  progress: number
  cacheKey: string
  readyMs: number
  centerScene: { x: number; z: number }
  active: boolean
}

const LOCAL_HALO_DEBUG_IDLE: LocalHaloDebug = {
  source: 'app',
  status: 'idle',
  label: '',
  sources: 0,
  referenceAltitudeKm: 0,
  yMinKm: 0,
  yMaxKm: 0,
  progress: 0,
  cacheKey: '',
  readyMs: 0,
  centerScene: { x: 0, z: 0 },
  active: false,
}

const MOVE_DIRS: MoveDir[] = ['up', 'down', 'left', 'right']
const MOVE_STEP_MS = 160
const MOVE_KEYS: Record<string, MoveDir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}
const MOVE_LABEL: Record<MoveDir, string> = {
  up: 'Haut',
  down: 'Bas',
  left: 'Gauche',
  right: 'Droite',
}

function emptyMoveHeld(): Record<MoveDir, boolean> {
  return { up: false, down: false, left: false, right: false }
}

type ImmersiveViewProps = {
  lat: number
  lon: number
  groundElevationM: number
  /** Initial look bearing (MapLibre-style, deg clockwise from north). */
  bearingDeg: number
  /** Optional initial pitch when entering from a celestial center request. */
  initialPitchDeg?: number
  skyUtcMs: number
  /** Drive the shared timeline playhead (timelapse preview, etc.). */
  onSkyUtcChange?: (utcMs: number) => void
  date: string
  /** Debug: jump the shared calendar/playhead to a civil date (YYYY-MM-DD). */
  onDateChange?: (date: string) => void
  selectedCelestial: CelestialObject | null
  onSelectCelestial: (object: CelestialObject | null) => void
  onExit: () => void
  /** True once full terrain LOD is ready (timeline can show). */
  onTerrainReadyChange?: (ready: boolean) => void
  /** So App can hide the timeline dock while playback mode is active. */
  onTimelapsePreviewPlayingChange?: (active: boolean) => void
  /**
   * When false, the WebGL scene stays mounted (same-spot cache) but skips
   * rendering — used while the user is back on the orbit map.
   */
  active?: boolean
  /**
   * Skip DEM/ortho — mount a flat disc instantly for sky / night testing.
   */
  flatTerrain?: boolean
}

const LOOK_PITCH_MIN = -85
const LOOK_PITCH_MAX = 85

function shortestYawDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function ImmersiveView({
  lat,
  lon,
  groundElevationM,
  bearingDeg,
  initialPitchDeg = 0,
  skyUtcMs,
  onSkyUtcChange,
  date,
  onDateChange,
  selectedCelestial,
  onSelectCelestial,
  onExit,
  onTerrainReadyChange,
  onTimelapsePreviewPlayingChange,
  active = true,
  flatTerrain = false,
}: ImmersiveViewProps) {
  const onTerrainReadyChangeRef = useRef(onTerrainReadyChange)
  onTerrainReadyChangeRef.current = onTerrainReadyChange
  const activeRef = useRef(active)
  activeRef.current = active
  /** DEM height updates from the map must NOT rebuild the WebGL scene. */
  const groundElevationRef = useRef(groundElevationM)
  groundElevationRef.current = groundElevationM
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const savedImmersive = useMemo(() => loadAppSettings().immersive, [])
  const [focalMm, setFocalMm] = useState(savedImmersive.focalMm)
  const [orientation, setOrientation] = useState<ViewfinderOrientation>(
    savedImmersive.orientation,
  )
  const [sensorFormat, setSensorFormat] = useState<SensorFormat>(
    savedImmersive.sensorFormat,
  )
  const [frameMode, setFrameMode] = useState<ViewfinderFrameMode>(
    savedImmersive.frameMode,
  )
  const [panorama, setPanorama] = useState<PanoramaPlan>(
    savedImmersive.panorama,
  )
  const [timelapse, setTimelapse] = useState<TimelapsePlan>(
    savedImmersive.timelapse,
  )
  const [frameRollDeg, setFrameRollDeg] = useState(() =>
    clampFrameRollDeg(savedImmersive.frameRollDeg),
  )
  /** Extra overlay roll from equatorial timelapse « Cadre seul ». */
  const [timelapseFrameRollDeg, setTimelapseFrameRollDeg] = useState(0)
  /**
   * Preview-only screen rotation of the render (0/90/180/270).
   * Does not touch DSLR orientation / focal settings.
   */
  const [previewRenderRollDeg, setPreviewRenderRollDeg] = useState(0)
  /**
   * Scene roll applied for the whole preview (snapped from photo frame roll).
   * Added on top of per-shot look roll so EQ tracking keeps the snap.
   */
  const previewSceneRollRef = useRef(0)
  /** Restore photo-settings frame roll when leaving preview. */
  const savedFrameRollRef = useRef(0)
  const [yawDeg, setYawDeg] = useState(bearingDeg)
  const [pitchDeg, setPitchDeg] = useState(
    Math.max(LOOK_PITCH_MIN, Math.min(LOOK_PITCH_MAX, initialPitchDeg)),
  )
  const [framesLocked, setFramesLocked] = useState(false)
  const [lockLook, setLockLook] = useState({
    yaw: bearingDeg,
    pitch: Math.max(LOOK_PITCH_MIN, Math.min(LOOK_PITCH_MAX, initialPitchDeg)),
  })
  /** Latest camera look — kept in sync with the WebGL camera (not only React). */
  const lookRef = useRef({
    yaw: bearingDeg,
    pitch: Math.max(LOOK_PITCH_MIN, Math.min(LOOK_PITCH_MAX, initialPitchDeg)),
    roll: 0,
  })
  const skyUtcLiveRef = useRef(skyUtcMs)
  skyUtcLiveRef.current = skyUtcMs
  const [celestialSearchOpen, setCelestialSearchOpen] = useState(false)
  /** Keep the view aimed at the selected target while the timeline moves. */
  const [targetLocked, setTargetLocked] = useState(false)
  const targetLockedRef = useRef(false)
  targetLockedRef.current = targetLocked
  const unlockTargetFollowRef = useRef(() => {})
  unlockTargetFollowRef.current = () => {
    if (!targetLockedRef.current) return
    targetLockedRef.current = false
    setTargetLocked(false)
  }
  const lookAnimRef = useRef<number | null>(null)
  const [terrainLabel, setTerrainLabel] = useState('Relief…')
  const [terrainPhase, setTerrainPhase] = useState<TerrainLoadPhase>('dem')
  const [terrainDemFromCache, setTerrainDemFromCache] = useState(false)
  const [terrainProgress, setTerrainProgress] = useState(0)
  const [terrainReady, setTerrainReady] = useState(false)
  /** First DEM+preview mesh mounted — user may look / walk; upgrades continue. */
  const [terrainUnlocked, setTerrainUnlocked] = useState(false)
  const terrainUnlockedRef = useRef(false)
  const [loaderVisible, setLoaderVisible] = useState(true)
  const [loaderTip, setLoaderTip] = useState('')
  const [loaderTipKey, setLoaderTipKey] = useState(0)
  const loaderTipDeckRef = useRef<string[]>([])
  const loaderTipRef = useRef('')
  const [netBytes, setNetBytes] = useState(0)
  useEffect(() => {
    const base = getNetworkBytesTotal()
    return subscribeNetworkBytes((total) => setNetBytes(total - base))
  }, [])
  const [projection, setProjection] = useState<StageProjection>(
    savedImmersive.projection,
  )
  /** Independent stage zoom (mouse wheel) — not tied to focal length. */
  const [stageVfovDeg, setStageVfovDeg] = useState(savedImmersive.stageVfovDeg)
  const stageVfovInitRef = useRef(savedImmersive.stageVfovDeg)
  const stageVfovLiveRef = useRef(savedImmersive.stageVfovDeg)
  stageVfovLiveRef.current = stageVfovDeg
  const [eyeHeightM, setEyeHeightM] = useState(() =>
    clampEyeHeightM(savedImmersive.eyeHeightM),
  )
  const eyeHeightRef = useRef(clampEyeHeightM(savedImmersive.eyeHeightM))
  eyeHeightRef.current = eyeHeightM
  /** Draft while typing in the elevation field (`null` = show committed value). */
  const [eyeHeightDraft, setEyeHeightDraft] = useState<string | null>(null)
  const [groundNightBrightness, setGroundNightBrightness] = useState(() =>
    clampGroundNightBrightness(savedImmersive.groundNightBrightness),
  )
  const groundNightBrightnessRef = useRef(
    clampGroundNightBrightness(savedImmersive.groundNightBrightness),
  )
  groundNightBrightnessRef.current = groundNightBrightness
  const [groundNightContrast, setGroundNightContrast] = useState(() =>
    clampGroundNightContrast(savedImmersive.groundNightContrast),
  )
  const groundNightContrastRef = useRef(
    clampGroundNightContrast(savedImmersive.groundNightContrast),
  )
  groundNightContrastRef.current = groundNightContrast
  const [groundNightTemperature, setGroundNightTemperature] = useState(() =>
    clampGroundNightTemperature(savedImmersive.groundNightTemperature),
  )
  const groundNightTemperatureRef = useRef(
    clampGroundNightTemperature(savedImmersive.groundNightTemperature),
  )
  groundNightTemperatureRef.current = groundNightTemperature
  const [starMagDepth, setStarMagDepth] = useState(() =>
    clampStarMagDepth(savedImmersive.starMagDepth),
  )
  const starMagDepthRef = useRef(clampStarMagDepth(savedImmersive.starMagDepth))
  starMagDepthRef.current = starMagDepth
  const [starZoomSpan, setStarZoomSpan] = useState(() =>
    clampStarZoomSpan(savedImmersive.starZoomSpan),
  )
  const starZoomSpanRef = useRef(
    clampStarZoomSpan(savedImmersive.starZoomSpan),
  )
  starZoomSpanRef.current = starZoomSpan
  const [starBrightness, setStarBrightness] = useState(() =>
    clampStarBrightness(savedImmersive.starBrightness),
  )
  const starBrightnessRef = useRef(
    clampStarBrightness(savedImmersive.starBrightness),
  )
  starBrightnessRef.current = starBrightness
  const [starGlow, setStarGlow] = useState(() =>
    clampStarGlow(savedImmersive.starGlow),
  )
  const starGlowRef = useRef(clampStarGlow(savedImmersive.starGlow))
  starGlowRef.current = starGlow
  const [keyHeld, setKeyHeld] = useState(emptyMoveHeld)
  const [pointerHeld, setPointerHeld] = useState(emptyMoveHeld)
  const moveRepeatRef = useRef<Partial<Record<MoveDir, number>>>({})
  const [showMilkyWay, setShowMilkyWay] = useState(savedImmersive.showMilkyWay)
  const [showHalpha, setShowHalpha] = useState(savedImmersive.showHalpha)
  const [atmosphereAmount, setAtmosphereAmount] = useState(() =>
    clampAtmosphereAmount(savedImmersive.atmosphereAmount),
  )
  const [moonlightEnabled, setMoonlightEnabled] = useState(savedImmersive.moonlightEnabled)
  const [airglowAmount, setAirglowAmount] = useState(() =>
    clampAirglowAmount(savedImmersive.airglowAmount),
  )
  const [airglowHue, setAirglowHue] = useState(() =>
    clampAirglowHue(savedImmersive.airglowHue),
  )
  const [airglowWaves, setAirglowWaves] = useState(() =>
    clampAirglowWaves(savedImmersive.airglowWaves),
  )
  const [zodiacalAmount, setZodiacalAmount] = useState(() =>
    clampZodiacalAmount(savedImmersive.zodiacalAmount),
  )
  const [lightPollutionAmount, setLightPollutionAmount] = useState(() =>
    clampLightPollutionAmount(savedImmersive.lightPollutionAmount),
  )
  const [localHalo, setLocalHalo] = useState<LocalHaloControls>(() => ({
    enabled: savedImmersive.localHaloEnabled,
    blocking: savedImmersive.localHaloBlocking,
    intensity: savedImmersive.localHaloIntensity,
    heightKm: savedImmersive.localHaloHeightKm,
    haze: savedImmersive.localHaloHaze,
    tempK: savedImmersive.localHaloTempK,
    viirsGround: savedImmersive.localHaloViirsGround,
    viirsOpacity: savedImmersive.localHaloViirsOpacity,
  }))
  const localHaloRef = useRef(localHalo)
  localHaloRef.current = localHalo
  const patchLocalHalo = useCallback(
    (patch: Partial<LocalHaloControls>) =>
      setLocalHalo((prev) => ({ ...prev, ...patch })),
    [],
  )
  const [localHaloSource, setLocalHaloSource] = useState<HaloDataSourceId>(
    () =>
      new URLSearchParams(window.location.search).get('localHalo') ===
      'reference'
        ? 'reference'
        : 'app',
  )
  const localHaloSourceRef = useRef(localHaloSource)
  localHaloSourceRef.current = localHaloSource
  const reloadLocalHaloRef = useRef<(() => void) | null>(null)
  const localHaloDebugRef = useRef<LocalHaloDebug>({ ...LOCAL_HALO_DEBUG_IDLE })
  const localHaloProbeRef = useRef<
    ((u: number, v: number) => string | null) | null
  >(null)
  const [localHaloProbe, setLocalHaloProbe] = useState<string | null>(null)
  useEffect(() => {
    reloadLocalHaloRef.current?.()
  }, [localHaloSource])
  const [showConstellations, setShowConstellations] = useState(
    savedImmersive.showConstellations,
  )
  const [showCelestialGrid, setShowCelestialGrid] = useState(
    savedImmersive.showCelestialGrid,
  )
  const [showAzimuthGrid, setShowAzimuthGrid] = useState(
    savedImmersive.showAzimuthGrid,
  )
  const [weatherSettings, setWeatherSettings] = useState<ViewfinderWeather>(
    () => ({
      enabled: savedImmersive.weatherEnabled,
      animateClouds: savedImmersive.weatherAnimateClouds,
      wind: savedImmersive.weatherWind ?? DEFAULT_VIEWFINDER_WEATHER.wind,
      followForecast: savedImmersive.weatherFollowForecast,
      low: normalizeWeatherLayer(savedImmersive.weatherLow, {
        ...WEATHER_LAYER_DEFAULTS.low,
        cover: savedImmersive.weatherLowClouds,
      }),
      mid: normalizeWeatherLayer(savedImmersive.weatherMid, {
        ...WEATHER_LAYER_DEFAULTS.mid,
        cover: savedImmersive.weatherMidClouds,
      }),
      high: normalizeWeatherLayer(savedImmersive.weatherHigh, {
        ...WEATHER_LAYER_DEFAULTS.high,
        cover: savedImmersive.weatherHighClouds,
      }),
      forecast: null,
    }),
  )
  const [weatherForecast, setWeatherForecast] =
    useState<ViewfinderWeatherForecast | null>(null)

  const weatherSettingsLive = useMemo<ViewfinderWeather>(
    () => ({ ...weatherSettings, forecast: weatherForecast }),
    [weatherSettings, weatherForecast],
  )
  const weatherSettingsRef = useRef(weatherSettingsLive)
  weatherSettingsRef.current = weatherSettingsLive
  const weatherForPlayhead = useMemo(
    () => resolveViewfinderWeatherAt(weatherSettingsLive, skyUtcMs),
    [weatherSettingsLive, skyUtcMs],
  )
  const weatherControls = useMemo(
    () => weatherControlsFromSettings(weatherForPlayhead),
    [weatherForPlayhead],
  )
  const setWeather = useCallback((next: ViewfinderWeather) => {
    setWeatherSettings({
      enabled: next.enabled,
      animateClouds: next.animateClouds,
      wind: next.wind,
      followForecast: next.followForecast,
      low: next.low,
      mid: next.mid,
      high: next.high,
      forecast: null,
    })
  }, [])

  const skyTogglesRef = useRef({
    showMilkyWay: savedImmersive.showMilkyWay,
    showHalpha: savedImmersive.showHalpha,
    atmosphereAmount: clampAtmosphereAmount(savedImmersive.atmosphereAmount),
    moonlightEnabled: savedImmersive.moonlightEnabled,
    airglowAmount: clampAirglowAmount(savedImmersive.airglowAmount),
    airglowHue: clampAirglowHue(savedImmersive.airglowHue),
    airglowWaves: clampAirglowWaves(savedImmersive.airglowWaves),
    zodiacalAmount: clampZodiacalAmount(savedImmersive.zodiacalAmount),
    lightPollutionAmount: clampLightPollutionAmount(
      savedImmersive.lightPollutionAmount,
    ),
    showConstellations: savedImmersive.showConstellations,
    showCelestialGrid: savedImmersive.showCelestialGrid,
    showAzimuthGrid: savedImmersive.showAzimuthGrid,
  })
  skyTogglesRef.current = {
    showMilkyWay,
    showHalpha,
    atmosphereAmount,
    moonlightEnabled,
    airglowAmount,
    airglowHue,
    airglowWaves,
    zodiacalAmount,
    lightPollutionAmount,
    showConstellations,
    showCelestialGrid,
    showAzimuthGrid,
  }
  const lightPollutionBortleFactorRef = useRef(0)
  const lightPollutionMeanRef = useRef(0)
  const lightPollutionPeakIntensityRef = useRef(0)
  /** Live fixed-tripod star-trail arc — only while the Timelapse planner is active. */
  const starTrailArcRadRef = useRef(0)
  starTrailArcRadRef.current =
    frameMode === 'timelapse'
      ? timelapseStarTrailArcRad(timelapse.poseS, timelapse.support)
      : 0

  useEffect(() => {
    patchAppSettings({
      immersive: {
        focalMm,
        orientation,
        frameRollDeg,
        sensorFormat,
        frameMode,
        panorama,
        timelapse,
        projection,
        stageVfovDeg,
        eyeHeightM,
        groundNightBrightness,
        groundNightContrast,
        groundNightTemperature,
        starMagDepth,
        starZoomSpan,
        starBrightness,
        starGlow,
        showMilkyWay,
        showHalpha,
        atmosphereAmount,
        moonlightEnabled,
        airglowAmount,
        airglowHue,
        airglowWaves,
        zodiacalAmount,
        lightPollutionAmount,
        localHaloEnabled: localHalo.enabled,
        localHaloBlocking: localHalo.blocking,
        localHaloIntensity: localHalo.intensity,
        localHaloHeightKm: localHalo.heightKm,
        localHaloHaze: localHalo.haze,
        localHaloTempK: localHalo.tempK,
        localHaloViirsGround: localHalo.viirsGround,
        localHaloViirsOpacity: localHalo.viirsOpacity,
        showConstellations,
        showCelestialGrid,
        showAzimuthGrid,
        weatherEnabled: weatherSettings.enabled,
        weatherAnimateClouds: weatherSettings.animateClouds,
        weatherWind: weatherSettings.wind,
        weatherFollowForecast: Boolean(weatherSettings.followForecast),
        weatherLowClouds: weatherSettings.low.cover,
        weatherMidClouds: weatherSettings.mid.cover,
        weatherHighClouds: weatherSettings.high.cover,
        weatherLow: weatherSettings.low,
        weatherMid: weatherSettings.mid,
        weatherHigh: weatherSettings.high,
      },
    })
  }, [
    localHalo,
    focalMm,
    orientation,
    frameRollDeg,
    sensorFormat,
    frameMode,
    panorama,
    timelapse,
    projection,
    stageVfovDeg,
    eyeHeightM,
    groundNightBrightness,
    groundNightContrast,
    groundNightTemperature,
    starMagDepth,
    starZoomSpan,
    starBrightness,
    starGlow,
    showMilkyWay,
    showHalpha,
    atmosphereAmount,
    moonlightEnabled,
    airglowAmount,
    airglowHue,
    airglowWaves,
    zodiacalAmount,
    lightPollutionAmount,
    showConstellations,
    showCelestialGrid,
    showAzimuthGrid,
    weatherSettings,
  ])

  useEffect(() => {
    if (!weatherSettings.enabled || !weatherSettings.followForecast) {
      setWeatherForecast(null)
      return
    }
    let cancelled = false
    const end = new Date(`${date}T12:00:00Z`)
    end.setUTCDate(end.getUTCDate() + 1)
    const endDate = end.toISOString().slice(0, 10)
    void fetchWeatherForecast({
      latitude: lat,
      longitude: lon,
      startDate: date,
      endDate,
    })
      .then((data) => {
        if (cancelled) return
        setWeatherForecast(weatherForecastSnapshot(data))
      })
      .catch(() => {
        if (!cancelled) setWeatherForecast(null)
      })
    return () => {
      cancelled = true
    }
  }, [
    weatherSettings.enabled,
    weatherSettings.followForecast,
    date,
    lat,
    lon,
  ])

  const nightSkyApiRef = useRef<ReturnType<typeof createNightSky> | null>(null)
  const renderDiagLiveRef = useRef<RenderDiagLive>(createRenderDiagLive())
  const diagContextRef = useRef({
    projection,
    stageVfovDeg,
    yawDeg,
    pitchDeg,
    eyeHeightM,
    cameraPos: { x: 0, y: 0, z: 0 },
    logDepthBuffer: true as const,
  })
  diagContextRef.current.projection = projection
  diagContextRef.current.stageVfovDeg = stageVfovDeg
  diagContextRef.current.yawDeg = yawDeg
  diagContextRef.current.pitchDeg = pitchDeg
  diagContextRef.current.eyeHeightM = eyeHeightM

  const apiRef = useRef<{
    setLook: (yaw: number, pitch: number, rollDeg?: number) => void
    setSkyUtc: (utcMs: number) => void
    setStageFov: (vfovDeg: number) => void
    setEyeHeight: (meters: number) => void
    step: (dir: MoveDir) => void
  } | null>(null)

  const cropFactor = SENSOR_CROP_FACTOR[sensorFormat]
  const optical = useMemo(() => {
    const v = verticalFovDegFromFocalMm(focalMm, orientation, cropFactor)
    const h = horizontalFovDegFromFocalMm(focalMm, orientation, cropFactor)
    return { v, h }
  }, [focalMm, orientation, cropFactor])

  const applyFrameMode = (mode: ViewfinderFrameMode) => {
    setFrameMode(mode)
    setPanorama((plan) =>
      plan.enabled === (mode === 'pano')
        ? plan
        : { ...plan, enabled: mode === 'pano' },
    )
    if (mode === 'off') setFramesLocked(false)
  }

  const applyPanorama = (next: PanoramaPlan) => {
    setPanorama(next)
    if (next.enabled) {
      if (frameMode !== 'pano') setFrameMode('pano')
      return
    }
    if (frameMode === 'pano') setFrameMode('dslr')
  }

  const timelapsePreview = useTimelapsePreview({
    lat,
    lon,
    elevationM: groundElevationM,
    selectedCelestial,
    getLook: () => lookRef.current,
    getSkyUtcMs: () => skyUtcLiveRef.current,
    onSkyUtcChange: (utcMs) => {
      // Keep live ref in sync before React commits playhead — EQ start/seek
      // must not read a stale UTC if something re-enters buildSession mid-run.
      skyUtcLiveRef.current = utcMs
      apiRef.current?.setSkyUtc(utcMs)
      onSkyUtcChange?.(utcMs)
    },
    onLookChange: (yaw, pitch, rollDeg = 0) => {
      apiRef.current?.setLook(
        yaw,
        pitch,
        rollDeg + previewSceneRollRef.current,
      )
    },
    onFrameRollChange: setTimelapseFrameRollDeg,
  })
  const timelapsePreviewActive = timelapsePreview.status.active
  /** Whole preview session (play / pause / ended) — look stays locked. */
  const timelapsePreviewLookLockedRef = useRef(false)
  timelapsePreviewLookLockedRef.current = timelapsePreviewActive

  useEffect(() => {
    onTimelapsePreviewPlayingChange?.(timelapsePreviewActive)
  }, [timelapsePreviewActive, onTimelapsePreviewPlayingChange])

  const endTimelapsePreview = () => {
    // Clear before exit() restores look — otherwise onLookChange would re-add it.
    previewSceneRollRef.current = 0
    timelapsePreview.exit()
  }
  const endTimelapsePreviewRef = useRef(endTimelapsePreview)
  endTimelapsePreviewRef.current = endTimelapsePreview

  useEffect(() => {
    if (timelapsePreviewActive) return
    setPreviewRenderRollDeg(0)
    previewSceneRollRef.current = 0
    if (savedFrameRollRef.current === 0) return
    const restore = savedFrameRollRef.current
    savedFrameRollRef.current = 0
    setFrameRollDeg(restore)
  }, [timelapsePreviewActive])

  // Stage size swaps on 90°/270° CSS rotate — refresh WebGL + FOV layout.
  useEffect(() => {
    if (!timelapsePreviewActive) return
    window.dispatchEvent(new Event('resize'))
  }, [timelapsePreviewActive, previewRenderRollDeg])

  const timelapsePhase = timelapsePreview.status.phase
  useEffect(() => {
    if (!timelapsePreviewActive) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (timelapsePhase === 'ended') {
        endTimelapsePreviewRef.current()
        return
      }
      if (timelapsePhase === 'playing') {
        timelapsePreview.pause()
        return
      }
      if (timelapsePhase === 'paused') {
        timelapsePreview.resume()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    timelapsePreviewActive,
    timelapsePhase,
    timelapsePreview.pause,
    timelapsePreview.resume,
  ])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Freeze elev for this scene — later map DEM corrections must not remount.
    const sceneGroundElevM = groundElevationRef.current

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      // near=0.08 / far=450km without log depth punches white holes through
      // mid-range ridges (z-fighting + depth precision collapse).
      logarithmicDepthBuffer: true,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    // Warp projections break world-space AABBs — frustum culling OFF by default.
    installFrustumCullingControl(scene)
    let stageFov = stageVfovInitRef.current
    // Past celestial shell (~330 km) + sky dome (~360 km).
    // Near plane 0.5 m — eye sits at ~7 m; tighter near improves depth even with log buffer.
    const camera = new THREE.PerspectiveCamera(stageFov, 1, 0.5, 450_000)
    camera.position.set(0, eyeHeightRef.current, 0)
    const stereoPass = createStereoCubemapPass()
    let terrainNearObj: THREE.Object3D | null = null
    let terrainFarObj: THREE.Object3D | null = null
    let fpsFrames = 0
    let fpsLastMs = performance.now()
    let lastWire = false
    let lastCull: boolean | null = null

    const sky = createAstroSkyDome()
    scene.add(sky.mesh)
    // LP is a post-frame fullscreen overlay (not in the stereo-warped scene).
    scene.add(sky.zodiacalMesh)
    const eclipticPoleLocal = new THREE.Vector3()

    const nightSky = createNightSky({ labelHost: host })
    nightSkyApiRef.current = nightSky
    scene.add(nightSky.root)
    if (skyTogglesRef.current.showHalpha) {
      void nightSky.ensureHalphaLoaded()
    }

    // Sun/Moon discs + day arcs — same models/sampling as PlanetStudio.
    const skyBodies = createSkyBodies()
    scene.add(skyBodies.root)

    const ambient = new THREE.AmbientLight(0xfff0dd, 0.85)
    scene.add(ambient)
    const hemi = new THREE.HemisphereLight(0xc8dcff, 0x8a6e45, 1.35)
    scene.add(hemi)
    const sunLight = new THREE.DirectionalLight(0xfff2dd, 1.35)
    scene.add(sunLight)
    // Extra sun-side fill so coarse LOD faces stay as readable as the near disc.
    const sunFill = new THREE.DirectionalLight(0xffe8d0, 0.55)
    scene.add(sunFill)

    let yaw = bearingDeg
    let pitch = Math.max(
      LOOK_PITCH_MIN,
      Math.min(LOOK_PITCH_MAX, lookRef.current.pitch),
    )
    let dragging = false
    let lastX = 0
    let lastY = 0
    let raf = 0
    let disposed = false

    /** False on WebGL context loss — parked GPU objects would be invalid. */
    let parkOnRelease = true
    let terrainDispose: (() => void) | null = null
    let adaptTerrain: ((x: number, y: number, z: number) => void) | null = null
    /** DEM mesh Y at ENU — keeps walking glued to the ground. */
    let groundYAt: ((east: number, north: number) => number) | null = null
    let groundElevMslAt: ((east: number, north: number) => number) | null =
      null
    /** Spot MSL under the camera (updates on walk). */
    let eyeGroundElevMsl = sceneGroundElevM
    let landscapeMats: Array<
      THREE.MeshBasicMaterial | THREE.MeshStandardMaterial
    > = []
    let landscapeMat:
      | THREE.MeshBasicMaterial
      | THREE.MeshStandardMaterial
      | null = null
    let latestSkyUtc = skyUtcMs
    let latestSunAltDeg = 0

    const localHaloPass = createLocalHaloPass()
    let localHaloField: LocalHaloField | null = null
    let localHaloGen = 0
    let weatherLastFrameAt = performance.now()
    const cloudMoonDirection = new THREE.Vector3()
    let cloudMoonStrength = 0
    const latestSunDir = new THREE.Vector3(0, 1, 0)
    const latestSkyLight = new THREE.Color(0.45, 0.62, 0.82)
    const loadLocalHalo = () => {
      const gen = ++localHaloGen
      localHaloField = null
      localHaloPass.setField(null)
      const source = localHaloSourceRef.current
      if (flatTerrain) {
        localHaloDebugRef.current = { ...LOCAL_HALO_DEBUG_IDLE, source, status: 'flat-terrain' }
        return
      }
      localHaloDebugRef.current = { ...LOCAL_HALO_DEBUG_IDLE, source, status: 'loading' }
      const started = performance.now()
      const fail = (status: string, error?: unknown) => {
        if (disposed || gen !== localHaloGen) return
        if (error) console.warn('[local-halo]', error)
        localHaloDebugRef.current = { ...localHaloDebugRef.current, status }
      }
      const datasetPromise: Promise<HaloDataset | null> =
        source === 'reference'
          ? loadReferenceHaloDataset()
          : loadAppHaloDataset(lat, lon)
      void datasetPromise
        .then(async (dataset) => {
          if (disposed || gen !== localHaloGen) return
          if (!dataset) return fail('no-viirs')
          const prepared = prepareHalo(dataset)
          localHaloDebugRef.current = {
            ...localHaloDebugRef.current,
            status: 'computing',
            label: dataset.label,
            sources: prepared.sources.length,
            referenceAltitudeKm: prepared.referenceAltitudeKm,
            yMinKm: prepared.bounds.yMinKm,
            yMaxKm: prepared.bounds.yMaxKm,
          }
          const request = requestHaloField(
            {
              raster: dataset.raster,
              ground: dataset.ground,
              projector: dataset.projector,
              input: prepared.input,
            },
            (done01) => {
              if (gen === localHaloGen) {
                localHaloDebugRef.current.progress = done01
              }
            },
          )
          const field = await request.field
          if (disposed || gen !== localHaloGen) return
          const cos0 = Math.cos((lat * Math.PI) / 180)
          localHaloField = {
            field,
            raster: dataset.raster,
            ground: dataset.ground,
            projector: dataset.projector,
            yMinKm: prepared.bounds.yMinKm,
            yMaxKm: prepared.bounds.yMaxKm,
            referenceAltitudeKm: prepared.referenceAltitudeKm,
            centerScene: {
              x: (dataset.center.lon - lon) * ENU_M_PER_DEG * cos0,
              z: -(dataset.center.lat - lat) * ENU_M_PER_DEG,
            },
          }
          localHaloPass.setField(localHaloField)
          localHaloDebugRef.current = {
            ...localHaloDebugRef.current,
            status: 'ready',
            progress: 1,
            cacheKey: request.key,
            readyMs: Math.round(performance.now() - started),
            centerScene: { ...localHaloField.centerScene },
          }
        })
        .catch((error: unknown) => fail('error', error))
    }
    // Secondary feature: its DEM / VIIRS fetches must not compete with the
    // terrain load, and once the relief is in, its DEM tiles are cache hits.
    let localHaloStarted = false
    const startLocalHaloOnce = () => {
      if (localHaloStarted) return
      localHaloStarted = true
      loadLocalHalo()
    }
    reloadLocalHaloRef.current = () => {
      if (localHaloStarted) loadLocalHalo()
    }
    const localHaloTuning = (): LocalHaloTuning => {
      const c = localHaloRef.current
      return {
        enabled: c.enabled,
        blocking: c.blocking,
        intensity: c.intensity,
        heightKm: c.heightKm,
        haze: c.haze,
        tempK: c.tempK,
        groundView: c.viirsGround,
        groundAlpha: c.viirsOpacity,
        night: localHaloNight(latestSunAltDeg),
      }
    }
    const localHaloTerrainFrame = (): {
      baseElevationM: number
      verticalExaggeration: number
    } => {
      const t = activeTerrain
      if (t && !isFlatTerrainHandle(t)) {
        return {
          baseElevationM: t.baseElevationM,
          verticalExaggeration: t.verticalExaggeration,
        }
      }
      return {
        baseElevationM: groundElevationRef.current,
        verticalExaggeration: 1,
      }
    }
    localHaloProbeRef.current = (u, v) => {
      const terrain = localHaloTerrainFrame()
      if (!localHaloField || !groundYAt || !activeTerrain) return null
      if (isFlatTerrainHandle(activeTerrain)) return null
      const hit = probeLocalHalo({
        u,
        v,
        camera,
        stelMode: stelModeUniform.value,
        groundYAt,
        terrain,
        field: localHaloField,
      })
      return hit ? formatLocalHaloProbe(hit) : null
    }

    // Heavy atlas / mesh uploads can OOM the GPU — stop fighting a dead context.
    renderer.domElement.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault()
        disposed = true
        parkOnRelease = false
        clearParkedLocalTerrain()
        terrainDispose?.()
        terrainDispose = null
        adaptTerrain = null
        groundYAt = null
        groundElevMslAt = null
        apiRef.current = null
      },
      false,
    )

    /** Keep a fixed eye-height clearance above local DEM (no cliff flying). */
    const snapEyeToGround = (eyeH = eyeHeightRef.current) => {
      const east = camera.position.x
      const north = -camera.position.z
      const groundY = groundYAt?.(east, north) ?? 0
      camera.position.y = groundY + eyeH
      eyeGroundElevMsl =
        groundElevMslAt?.(east, north) ?? sceneGroundElevM
      const eyeMsl = Math.max(0, eyeGroundElevMsl + eyeH)
      sky.material.uniforms.uEyeElevM.value = eyeMsl
      sky.lightPollutionMaterial.uniforms.uEyeElevM.value = eyeMsl
      sky.zodiacalMaterial.uniforms.uEyeElevM.value = eyeMsl
    }

    let roll = 0

    const applyCamera = () => {
      const yawRad = (yaw * Math.PI) / 180
      const pitchRad = (pitch * Math.PI) / 180
      const look = new THREE.Vector3(
        Math.sin(yawRad) * Math.cos(pitchRad),
        Math.sin(pitchRad),
        -Math.cos(yawRad) * Math.cos(pitchRad),
      )
      camera.up.set(0, 1, 0)
      camera.lookAt(
        camera.position.x + look.x,
        camera.position.y + look.y,
        camera.position.z + look.z,
      )
      // Equatorial field lock: roll around the view axis after horizon-level lookAt.
      if (roll !== 0) {
        camera.rotateZ((roll * Math.PI) / 180)
      }
    }

    const applySky = (utcMs: number) => {
      latestSkyUtc = utcMs
      const sun = sunPositionAt(lat, lon, sceneGroundElevM, utcMs)
      const alt = sun.altitudeDeg
      latestSunAltDeg = alt
      const dir = sunDirectionFromAltAz(alt, sun.azimuthDeg)
      const palette = skyPaletteFromSunAltitude(alt)
      const night = palette.nightAmount
      {
        // Daytime cloud ambient from painted sky. Night ambient is forced to
        // proto #0b1423 inside the shader (uDayFactor) — never the PL wash.
        const zen = hexToRgb01(palette.zenith)
        const hor = hexToRgb01(palette.horizon)
        latestSkyLight.setRGB(
          zen.r * 0.55 + hor.r * 0.45,
          zen.g * 0.55 + hor.g * 0.45,
          zen.b * 0.55 + hor.b * 0.45,
        )
      }
      const atmosphereAmountLive = clampAtmosphereAmount(
        skyTogglesRef.current.atmosphereAmount,
      )
      const atmosphereOn = atmosphereAmountLive > 0.04
      const airglowAmountLive = clampAirglowAmount(
        skyTogglesRef.current.airglowAmount,
      )
      const airglowHueLive = clampAirglowHue(skyTogglesRef.current.airglowHue)
      const airglowWavesLive = clampAirglowWaves(
        skyTogglesRef.current.airglowWaves,
      )
      const zodiacalAmountLive = clampZodiacalAmount(
        skyTogglesRef.current.zodiacalAmount,
      )
      const lightPollutionAmountLive = clampLightPollutionAmount(
        skyTogglesRef.current.lightPollutionAmount,
      )
      eclipticNorthPoleThreeLocal(
        new Date(utcMs),
        lat,
        lon,
        eyeGroundElevMsl + eyeHeightRef.current,
        eclipticPoleLocal,
      )

      const moon = sampleMoonSkyAt({ latitude: lat, longitude: lon, elevationMeters: sceneGroundElevM, utcMs })
      cloudMoonDirection.copy(sunDirectionFromAltAz(moon.altitudeApparentDeg, moon.azimuthDeg))
      cloudMoonStrength = Number(skyTogglesRef.current.moonlightEnabled) * Math.pow(moon.illuminationFraction, 2.5)
        * THREE.MathUtils.smoothstep(cloudMoonDirection.y, 0, 0.25)

      updateAstroSkyDome(sky, {
        moonDirection: cloudMoonDirection,
        moonStrength: cloudMoonStrength,
        sunAltitudeDeg: alt,
        sunDirection: dir,
        eyeElevationMslM: eyeGroundElevMsl + eyeHeightRef.current,
        atmosphereAmount: atmosphereAmountLive,
        airglowAmount: airglowAmountLive,
        airglowHue: airglowHueLive,
        airglowWaves: airglowWavesLive,
        zodiacalAmount: zodiacalAmountLive,
        lightPollutionAmount: lightPollutionAmountLive,
        lightPollutionBortleFactor: lightPollutionBortleFactorRef.current,
        lightPollutionPeakIntensity: lightPollutionPeakIntensityRef.current,
        lightPollutionMean: lightPollutionMeanRef.current,
        eclipticPole: eclipticPoleLocal,
      })

      latestSunDir.copy(dir)
      sunLight.position.copy(dir).multiplyScalar(10_000)
      sunFill.position.copy(dir).multiplyScalar(8_000)

      // Sun disc color: noon → golden → red twilight → cool moonlight.
      if (alt >= 8) {
        sunLight.color.setRGB(1, 0.96, 0.9)
        sunFill.color.setRGB(0.95, 0.92, 0.88)
      } else if (alt >= 0) {
        const t = (8 - alt) / 8
        sunLight.color.setRGB(1, 0.92 - t * 0.35, 0.82 - t * 0.55)
        sunFill.color.copy(sunLight.color)
      } else if (alt >= -6) {
        const t = (-alt) / 6
        sunLight.color.setRGB(1, 0.45 - t * 0.15, 0.22 - t * 0.1)
        sunFill.color.copy(sunLight.color)
      } else if (atmosphereOn) {
        sunLight.color.setRGB(0.55, 0.65, 0.95)
        sunFill.color.setRGB(0.5, 0.58, 0.85)
      } else {
        // No-atmo night: neutral moonlight, no blue airglow on the ground.
        sunLight.color.setRGB(0.85, 0.86, 0.88)
        sunFill.color.setRGB(0.8, 0.82, 0.85)
      }

      if (alt > -6) {
        sunLight.intensity = Math.max(0.04, Math.min(1.85, (alt + 10) / 32))
        sunFill.intensity = Math.max(0.2, Math.min(0.75, (alt + 12) / 28))
      } else {
        // Residual skylight / moonlight — landscape still readable, clearly night.
        sunLight.intensity = Math.max(
          0.02,
          (atmosphereOn ? 0.12 : 0.16) * (1 - night) + (atmosphereOn ? 0 : 0.05),
        )
        sunFill.intensity = sunLight.intensity * 0.85
      }

      const weatherLive = resolveViewfinderWeatherAt(
        weatherSettingsRef.current,
        utcMs,
      )
      // Dim ground only when volumetric clouds actually cover — not merely when
      // the Météo master switch is on (that made ON≠OFF with no visible clouds).
      if (localHaloSourceRef.current !== 'reference' && weatherWantsVolumePass(weatherLive)) {
        const groundLight = getWeatherGroundLightFactor(weatherLive)
        const { warmth, overcast } = getWeatherGroundSunWarmth(weatherLive)
        sunLight.intensity *= groundLight
        sunFill.intensity *= THREE.MathUtils.lerp(1, 0.9, overcast)
        hemi.intensity *= THREE.MathUtils.lerp(1, 0.92, overcast)
        if (warmth > 0.01 && alt > -6) {
          sunLight.color.offsetHSL(0.02 * warmth, 0.08 * warmth, -0.04 * warmth)
          sunFill.color.copy(sunLight.color)
        }
        if (overcast > 0.2) {
          const cool = overcast * 0.12
          sunLight.color.offsetHSL(0, -cool, -cool * 0.5)
          sunFill.color.copy(sunLight.color)
        }
      }

      const groundTint = groundAlbedoFromSky(palette, alt, {
        atmosphereOn,
        nightBrightness: groundNightBrightnessRef.current,
        nightContrast: groundNightContrastRef.current,
        nightTemperature: groundNightTemperatureRef.current,
      })

      if (atmosphereOn) {
        // Skylight follows sky palette so lit LODs match ortho ground tint.
        const zen = hexToRgb01(palette.zenith)
        const hor = hexToRgb01(palette.horizon)
        const warmSky = Math.max(0, 1 - Math.abs(alt - 2) / 10) // peaks ~sunset
        hemi.color.setRGB(
          zen.r * 0.55 + hor.r * 0.45 + warmSky * 0.12,
          zen.g * 0.55 + hor.g * 0.45 + warmSky * 0.05,
          zen.b * 0.55 + hor.b * 0.45 - warmSky * 0.08,
        )
        hemi.groundColor.setRGB(
          groundTint.r * 0.55,
          groundTint.g * 0.48,
          groundTint.b * 0.4,
        )
        hemi.intensity =
          0.35 +
          (1 - night) * 0.95 +
          Math.max(0, Math.min(0.4, (alt + 4) / 36))

        ambient.color.setRGB(
          groundTint.r * 0.55 + zen.r * 0.45,
          groundTint.g * 0.55 + zen.g * 0.45,
          groundTint.b * 0.55 + zen.b * 0.45,
        )
        ambient.intensity = 0.22 + (1 - night) * 0.55
      } else {
        // Dark sky, but terrain still readable — neutral fill, no blue cast.
        hemi.color.setRGB(0.42, 0.42, 0.44)
        hemi.groundColor.setRGB(0.18, 0.16, 0.14)
        hemi.intensity = 0.28 + (1 - night) * 0.5
        ambient.color.setRGB(0.4, 0.4, 0.42)
        ambient.intensity = 0.18 + (1 - night) * 0.32
      }

      // Ortho MeshBasic ignores lights — multiply albedo from sky tint.
      // Keep strength moderate (see groundAlbedoFromSky) so 4096 satellite
      // stays sharp, not mud / cream.
      if (landscapeMats.length > 0) {
        for (const mat of landscapeMats) {
          if (mat.userData.isFlatTerrain) {
            // Sky-test stub stays pure black — never inherit day albedo.
            mat.color.setRGB(0, 0, 0)
            continue
          }
          if (mat.userData.isSea) {
            mat.color.setRGB(
              0.29 * groundTint.r,
              0.48 * groundTint.g,
              0.59 * groundTint.b,
            )
            continue
          }
          if (mat.userData.isOrthoTerrain || mat.map) {
            mat.color.setRGB(groundTint.r, groundTint.g, groundTint.b)
          } else if (atmosphereOn) {
            // Untextured LODs: slightly stronger sky multiply + night emissive.
            const boost = 0.85 + night * 0.08
            mat.color.setRGB(
              groundTint.r * boost,
              groundTint.g * boost * (0.96 + night * 0.02),
              groundTint.b * boost * (0.94 + night * 0.06),
            )
            if ('emissive' in mat) {
              ;(mat as THREE.MeshStandardMaterial).emissive.setRGB(
                0.02 * night,
                0.03 * night,
                0.06 * night,
              )
              ;(mat as THREE.MeshStandardMaterial).emissiveIntensity =
                night * 0.35
            }
          } else {
            mat.color.setRGB(groundTint.r, groundTint.g, groundTint.b)
            if ('emissive' in mat) {
              ;(mat as THREE.MeshStandardMaterial).emissive.setRGB(
                0.04 * night,
                0.04 * night,
                0.045 * night,
              )
              ;(mat as THREE.MeshStandardMaterial).emissiveIntensity =
                night * 0.4
            }
          }
        }
      }

      if (getStageProjection() === 'stereographic') {
        // Outside the stereo disk (ultra-wide) must be Stellarium-black,
        // never the muddy day clear that read as a gray hublot.
        renderer.setClearColor(0x000000, 1)
      } else if (atmosphereOn) {
        // Match distant sea/haze under the geometric horizon (not a brown void).
        const elev = eyeGroundElevMsl + eyeHeightRef.current
        const seaAmt = Math.min(1, Math.max(0, (elev - 120) / 780))
        const clearR = (0.05 + (1 - night) * 0.35) * (1 - seaAmt * 0.55)
        const clearG = (0.06 + (1 - night) * 0.3) * (1 - seaAmt * 0.35)
        const clearB = 0.1 + (1 - night) * 0.22 + seaAmt * 0.06
        renderer.setClearColor(
          new THREE.Color(
            clearR * (0.22 + (1 - night) * 0.2),
            clearG * (0.2 + (1 - night) * 0.18),
            clearB * (0.22 + (1 - night) * 0.12),
          ),
          1,
        )
      } else {
        // Dark sky — no Rayleigh; stars / MW read cleanly.
        renderer.setClearColor(0x010208, 1)
      }
    }

    // Bortle + directional PL dome (sample rings → azimuth texture).
    void sampleLightPollution(lat, lon, {
      observerElevM: sceneGroundElevM,
    }).then((sample) => {
      if (disposed || !sample) return
      lightPollutionBortleFactorRef.current = bortlePollutionFactor(
        sample.bortle,
      )
      applySky(latestSkyUtc)
    })
    void buildHorizonGlowProfile(lat, lon, {
      observerElevM: sceneGroundElevM,
    }).then((profile) => {
      if (disposed) return
      setLightPollutionProfile(sky, profile.azimuth, profile.mean)
      lightPollutionMeanRef.current = profile.mean
      lightPollutionPeakIntensityRef.current = peakIntensity01(profile.peak)
      applySky(latestSkyUtc)
    })

    let activeTerrain: LocalTerrainHandle | null = null
    const isFlatTerrainHandle = (terrain: LocalTerrainHandle): boolean => {
      const mat = Array.isArray(terrain.mesh.material)
        ? terrain.mesh.material[0]
        : terrain.mesh.material
      return Boolean((mat as THREE.Material | undefined)?.userData?.isFlatTerrain)
    }
    const releaseTerrain = (terrain: LocalTerrainHandle) => {
      // Flat discs are disposable stubs — never park them as DEM cache.
      // Same spot quit→relaunch: keep GPU mesh. Incomplete builds still die.
      if (parkOnRelease && terrain.ready && !isFlatTerrainHandle(terrain)) {
        parkLocalTerrain(lat, lon, sceneGroundElevM, terrain)
      } else {
        terrain.dispose()
      }
    }
    const mountTerrain = (terrain: LocalTerrainHandle) => {
      if (disposed) {
        releaseTerrain(terrain)
        return
      }
      activeTerrain = terrain
      if (!terrain.mesh.parent) scene.add(terrain.mesh)
      if (terrain.farMesh && !terrain.farMesh.parent) scene.add(terrain.farMesh)
      terrainNearObj = terrain.mesh
      terrainFarObj = terrain.farMesh
      terrainDispose = () => {
        terrainNearObj = null
        terrainFarObj = null
        const t = activeTerrain
        activeTerrain = null
        if (t) releaseTerrain(t)
      }
      adaptTerrain = (x, y, z) => terrain.adaptToEye(x, y, z)
      groundYAt = (east, north) => terrain.groundYAt(east, north)
      groundElevMslAt = (east, north) =>
        terrain.groundElevationMslAt(east, north)
      landscapeMats = terrain.materials
      landscapeMat = terrain.mesh.material as
        | THREE.MeshBasicMaterial
        | THREE.MeshStandardMaterial
      snapEyeToGround()
      const uniform = landscapeMat.userData.eyeHeight as
        | { value: number }
        | undefined
      if (uniform) uniform.value = camera.position.y
      const eyeXZ = landscapeMat.userData.eyeXZ as
        | { value: THREE.Vector2 }
        | undefined
      eyeXZ?.value.set(camera.position.x, camera.position.z)
      applyCamera()
      applySky(latestSkyUtc)
      // First drawable relief (DEM + preview ortho) — hand control back.
      if (!terrainUnlockedRef.current) {
        terrainUnlockedRef.current = true
        setTerrainUnlocked(true)
      }
      const relief = Math.max(0, terrain.stats.maxH - terrain.stats.minH)
      const farKm = Math.round(terrain.stats.farRadiusM / 1000)
      setTerrainPhase(terrain.stats.phase)
      setTerrainProgress(terrain.stats.progress)
      if (terrain.ready) {
        setTerrainReady(true)
        onTerrainReadyChangeRef.current?.(true)
        startLocalHaloOnce()
        setTerrainLabel(
          isFlatTerrainHandle(terrain)
            ? 'Sol plat · sans DEM'
            : `DEM z${terrain.stats.demMaxZ} · ${terrain.stats.tiles} tuiles · Δ${Math.round(relief)} m · LOD ${farKm} km`,
        )
        window.setTimeout(() => {
          if (!disposed) setLoaderVisible(false)
        }, 650)
        return
      }
      if (!terrain.ready && farKm === 0) {
        setTerrainLabel(
          `DEM z${terrain.stats.demMaxZ} · ${terrain.stats.tiles} tuiles · ${terrain.mesh.children.length > 0 ? 'ortho…' : 'aperçu…'}`,
        )
        return
      }
      setTerrainLabel(
        farKm > 0
          ? `DEM z${terrain.stats.demMaxZ} · ${terrain.stats.tiles} tuiles · Δ${Math.round(relief)} m · LOD ${farKm} km`
          : `DEM z${terrain.stats.demMaxZ} · ${terrain.stats.tiles} tuiles · Δ${Math.round(relief)} m · ortho z18`,
      )
    }

    if (flatTerrain) {
      clearParkedLocalTerrain()
      const flat = createFlatLocalTerrainMesh({
        centerElevationM: sceneGroundElevM,
      })
      setTerrainDemFromCache(false)
      setTerrainPhase('ready')
      setTerrainProgress(1)
      setTerrainReady(true)
      onTerrainReadyChangeRef.current?.(true)
      terrainUnlockedRef.current = true
      setTerrainUnlocked(true)
      setLoaderVisible(false)
      setTerrainLabel('Sol plat · sans DEM')
      mountTerrain(flat)
    } else {
      const parked = takeParkedLocalTerrain(lat, lon, sceneGroundElevM)
      if (parked) {
        reviveLocalTerrainTextures(parked)
        setTerrainDemFromCache(true)
        setTerrainPhase('ready')
        setTerrainProgress(1)
        setTerrainReady(true)
        onTerrainReadyChangeRef.current?.(true)
        terrainUnlockedRef.current = true
        setTerrainUnlocked(true)
        setLoaderVisible(false)
        mountTerrain(parked)
      } else {
        clearParkedLocalTerrain()
        setTerrainLabel('Relief…')
        setTerrainPhase('dem')
        setTerrainDemFromCache(false)
        setTerrainProgress(0)
        setTerrainReady(false)
        onTerrainReadyChangeRef.current?.(false)
        terrainUnlockedRef.current = false
        setTerrainUnlocked(false)
        setLoaderVisible(true)
        void createLocalTerrainMesh({
          lat,
          lon,
          centerElevationM: sceneGroundElevM,
          radiusM: NEAR_TERRAIN_RADIUS_M,
          // 1600 + triple 4096 atlas bake OOMed the GPU (Context Lost). Stay ≤1400.
          resolution: 1200,
          onPreview: (terrain) => mountTerrain(terrain),
          onUpgrade: (terrain) => mountTerrain(terrain),
          onProgress: ({ phase, progress, cacheHitRatio }) => {
            if (disposed) return
            setTerrainPhase(phase)
            setTerrainProgress(progress)
            if (cacheHitRatio != null && cacheHitRatio >= 0.7) {
              setTerrainDemFromCache(true)
            }
            if (phase === 'ready') {
              setTerrainReady(true)
              onTerrainReadyChangeRef.current?.(true)
              window.setTimeout(() => {
                if (!disposed) setLoaderVisible(false)
              }, 650)
            }
          },
        })
          .then((terrain) => {
            if (disposed) {
              releaseTerrain(terrain)
              return
            }
            mountTerrain(terrain)
          })
          .catch((err: unknown) => {
            console.error('[terrain]', err)
            if (!disposed) {
              setTerrainLabel('Relief indisponible')
              terrainUnlockedRef.current = true
              setTerrainUnlocked(true)
              setTerrainReady(true)
              onTerrainReadyChangeRef.current?.(true)
              setLoaderVisible(false)
            }
          })
      }
    }

    const resize = () => {
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      applyStageProjection(camera, stageFov)
      setSize({ w, h })
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!terrainUnlockedRef.current) return
      if (timelapsePreviewLookLockedRef.current) return
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
      host.setPointerCapture(event.pointerId)
    }
    let lastHaloProbeMs = 0
    const updateLocalHaloProbe = (event: PointerEvent) => {
      if (!localHaloRef.current.viirsGround) return
      const now = performance.now()
      if (now - lastHaloProbeMs < 100) return
      lastHaloProbeMs = now
      const rect = renderer.domElement.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const u = (event.clientX - rect.left) / rect.width
      const v = 1 - (event.clientY - rect.top) / rect.height
      setLocalHaloProbe(localHaloProbeRef.current?.(u, v) ?? null)
    }
    const onPointerLeave = () => setLocalHaloProbe(null)
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) updateLocalHaloProbe(event)
      if (!dragging || !terrainUnlockedRef.current) return
      if (timelapsePreviewLookLockedRef.current) return
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY
      // Grab-the-world (same feel as MapLibre): drag right → look left.
      yaw = (yaw - dx * 0.14 + 360) % 360
      pitch = Math.max(
        LOOK_PITCH_MIN,
        Math.min(LOOK_PITCH_MAX, pitch + dy * 0.14),
      )
      roll = 0
      lookRef.current = { yaw, pitch, roll }
      setYawDeg(yaw)
      setPitchDeg(pitch)
      applyCamera()
      // Manual look breaks target follow (timeline lock).
      if (dx !== 0 || dy !== 0) unlockTargetFollowRef.current()
    }
    const onPointerUp = (event: PointerEvent) => {
      dragging = false
      try {
        host.releasePointerCapture(event.pointerId)
      } catch {
        // ignore
      }
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (!terrainUnlockedRef.current) return
      const factor = event.deltaY > 0 ? 1.12 : 0.9
      stageFov = applyStageProjection(camera, stageFov * factor)
      setStageVfovDeg(stageFov)
    }

    apiRef.current = {
      setLook: (nextYaw, nextPitch, nextRoll = 0) => {
        yaw = ((nextYaw % 360) + 360) % 360
        pitch = Math.max(LOOK_PITCH_MIN, Math.min(LOOK_PITCH_MAX, nextPitch))
        roll = Number.isFinite(nextRoll) ? nextRoll : 0
        lookRef.current = { yaw, pitch, roll }
        setYawDeg(yaw)
        setPitchDeg(pitch)
        applyCamera()
      },
      setSkyUtc: applySky,
      setStageFov: (vfovDeg) => {
        // Persist the framed stage FOV (per-projection cap), not the raw slider.
        stageFov = applyStageProjection(camera, vfovDeg)
        stageVfovLiveRef.current = stageFov
        setStageVfovDeg(stageFov)
      },
      setEyeHeight: (meters) => {
        const h = clampEyeHeightM(meters)
        snapEyeToGround(h)
        syncEyeUniform()
        applyCamera()
      },
      step: (dir) => {
        if (!terrainUnlockedRef.current) return
        const yawRad = (yaw * Math.PI) / 180
        const forwardX = Math.sin(yawRad)
        const forwardZ = -Math.cos(yawRad)
        const rightX = Math.cos(yawRad)
        const rightZ = Math.sin(yawRad)
        const along =
          dir === 'left' || dir === 'right'
            ? { x: rightX, z: rightZ }
            : { x: forwardX, z: forwardZ }
        const sign = dir === 'down' || dir === 'left' ? -1 : 1
        camera.position.x += along.x * sign
        camera.position.z += along.z * sign
        // Follow DEM so cliffs / ridges don't leave the eye floating.
        snapEyeToGround()
        syncEyeUniform()
        applyCamera()
      },
    }
    ;(
      window as unknown as {
        __astroSetLook?: (yaw: number, pitch: number) => void
        __astroSetStageFov?: (vfovDeg: number) => void
        __astroTerrainDebug?: () => unknown
      }
    ).__astroSetLook = (y, p) => apiRef.current?.setLook(y, p)
    ;(
      window as unknown as {
        __astroSetStageFov?: (vfovDeg: number) => void
      }
    ).__astroSetStageFov = (vfovDeg) => {
      apiRef.current?.setStageFov(vfovDeg)
    }
    ;(
      window as unknown as {
        __astroTerrainDebug?: () => unknown
      }
    ).__astroTerrainDebug = () =>
      landscapeMats.map((m) => {
        const map = 'map' in m ? (m.map as THREE.Texture | null) : null
        const img = map?.image as
          | { width?: number; height?: number }
          | undefined
        return {
          sea: !!m.userData.isSea,
          ortho: !!m.userData.isOrthoTerrain,
          mapW: img?.width ?? null,
          mapH: img?.height ?? null,
          flipY: map?.flipY ?? null,
          nearW: m.userData.atlasWeights?.near?.value ?? null,
          ultraW: m.userData.atlasWeights?.ultra?.value ?? null,
          stel: !!m.userData.stelProjector,
          band: m.userData.radiusBand ?? null,
          color: 'color' in m ? m.color.getHexString() : null,
        }
      })
    function syncEyeUniform() {
      const uniform = landscapeMat?.userData.eyeHeight as
        | { value: number }
        | undefined
      if (uniform) uniform.value = camera.position.y
      const eyeXZ = landscapeMat?.userData.eyeXZ as
        | { value: THREE.Vector2 }
        | undefined
      eyeXZ?.value.set(camera.position.x, camera.position.z)
    }

    applyCamera()
    applySky(skyUtcMs)
    // Clamp any saved ultra-wide FOV before first paint (avoids shard tunnel +
    // photo-frame / camera FOV desync).
    stageFov = applyStageProjection(camera, stageFov)
    setStageVfovDeg(stageFov)
    resize()

    const ro = new ResizeObserver(resize)
    ro.observe(host)
    host.addEventListener('pointerdown', onPointerDown)
    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerleave', onPointerLeave)
    host.addEventListener('pointerup', onPointerUp)
    host.addEventListener('pointercancel', onPointerUp)
    host.addEventListener('wheel', onWheel, { passive: false })

    const applyTerrainWireframe = (root: THREE.Object3D | null, on: boolean) => {
      if (!root) return
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh) return
        const mats = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]
        for (const mat of mats) {
          if (mat && 'wireframe' in mat) {
            ;(mat as THREE.MeshBasicMaterial).wireframe = on
          }
        }
      })
    }

    const tick = () => {
      if (disposed) return
      if (!activeRef.current) {
        raf = window.requestAnimationFrame(tick)
        return
      }
      const diag = renderDiagLiveRef.current.settings
      if (lastCull !== diag.frustumCulling) {
        lastCull = diag.frustumCulling
        setFrustumCullingEnabled(diag.frustumCulling)
      }
      if (
        camera.near !== diag.cameraNearM ||
        camera.far !== diag.cameraFarM
      ) {
        camera.near = diag.cameraNearM
        camera.far = diag.cameraFarM
        camera.updateProjectionMatrix()
      }
      sky.mesh.visible = diag.showSky
      sky.lightPollutionMesh.visible = diag.showSky
      sky.zodiacalMesh.visible = diag.showSky
      nightSky.root.visible = diag.showNightSky
      if (terrainNearObj) terrainNearObj.visible = diag.showTerrainNear
      if (terrainFarObj) terrainFarObj.visible = diag.showTerrainFar
      if (diag.terrainWireframe) {
        applyTerrainWireframe(terrainNearObj, true)
        applyTerrainWireframe(terrainFarObj, true)
        lastWire = true
      } else if (lastWire) {
        applyTerrainWireframe(terrainNearObj, false)
        applyTerrainWireframe(terrainFarObj, false)
        lastWire = false
      }

      sky.mesh.position.copy(camera.position)
      sky.zodiacalMesh.position.copy(camera.position)
      // Drift airglow phase each frame (living folds / mist).
      const skyPhaseSec = performance.now() * 0.001
      sky.material.uniforms.uAirglowTime.value = skyPhaseSec
      adaptTerrain?.(camera.position.x, camera.position.y, camera.position.z)
      const skyToggles = skyTogglesRef.current
      const lpAmt = skyToggles.lightPollutionAmount
      const lpBortle = lightPollutionBortleFactorRef.current
      // LP uniforms every frame (slider + site) — don't wait for applySky.
      const lpMat = sky.lightPollutionMaterial
      lpMat.uniforms.uLightPollution.value = clampLightPollutionAmount(lpAmt)
      lpMat.uniforms.uLpBortle.value = lpBortle
      lpMat.uniforms.uLpIntensity.value = lightPollutionPeakIntensityRef.current
      lpMat.uniforms.uLpMean.value = lightPollutionMeanRef.current
      lpMat.uniforms.uSunAltitude.value = latestSunAltDeg
      nightSky.update({
        utcMs: latestSkyUtc,
        lat,
        lon,
        elevationM: sceneGroundElevM,
        sunAltitudeDeg: latestSunAltDeg,
        camera,
        showMilkyWay: skyToggles.showMilkyWay,
        showHalpha: skyToggles.showHalpha,
        atmosphereAmount: skyToggles.atmosphereAmount,
        showConstellations: skyToggles.showConstellations,
        showCelestialGrid: skyToggles.showCelestialGrid,
        showAzimuthGrid: skyToggles.showAzimuthGrid,
        starMagDepth: starMagDepthRef.current,
        starZoomSpan: starZoomSpanRef.current,
        starBrightness: starBrightnessRef.current,
        starGlow: starGlowRef.current,
        starTrailArcRad: starTrailArcRadRef.current,
        lightPollutionMagPenalty: lightPollutionStarMagPenalty(lpBortle, lpAmt),
        lightPollutionStarBrightMul: lightPollutionStarBrightMul(
          lpBortle,
          lpAmt,
        ),
        lightPollutionMilkyWayMul: lightPollutionMilkyWayMul(lpBortle, lpAmt)
          / (1 + 4 * cloudMoonStrength * skyToggles.atmosphereAmount
            * (1 - THREE.MathUtils.smoothstep(latestSunAltDeg, -14, -3))),
        viewSize: {
          width: host.clientWidth,
          height: host.clientHeight,
        },
        // Height-field samples only — Mesh raycasts on the DEM (d1699d4) made
        // night frames take tens of seconds with constellations on.
        terrainOccluded: (origin, dir, maxDist) => {
          if (!groundYAt) return false
          const sample = groundYAt
          const lim = Math.min(Math.max(2, maxDist - 100), 80_000)
          for (let d = 80; d < lim; d += 280) {
            const x = origin.x + dir.x * d
            const y = origin.y + dir.y * d
            const z = origin.z + dir.z * d
            if (sample(x, -z) > y + 3) return true
          }
          return false
        },
      })
      skyBodies.update({
        utcMs: latestSkyUtc,
        lat,
        lon,
        elevationM: sceneGroundElevM,
        camera,
      })

      diagContextRef.current.cameraPos = {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      }

      const urlAtlas =
        typeof window !== 'undefined' &&
        /(?:\?|&)stereoDebug=atlas(?:&|$)/.test(window.location.search)
      const useCubemap =
        diag.useCubemapPass ||
        diag.cubemapAtlasPreview ||
        (getStageProjection() === 'stereographic' && urlAtlas)
      const atlasOn = diag.cubemapAtlasPreview || urlAtlas

      // Sum whole frame (cubemap = 6 faces + composite).
      renderer.info.autoReset = false
      renderer.info.reset()
      const weatherLive = resolveViewfinderWeatherAt(
        weatherSettingsRef.current,
        latestSkyUtc,
      )
      const nowMs = performance.now()
      const weatherDt = Math.min(0.1, (nowMs - weatherLastFrameAt) / 1000)
      weatherLastFrameAt = nowMs

      if (useCubemap) {
        stereoPass.setAtlasPreview(atlasOn)
        const stage = Number(camera.userData.stageVfovDeg) || stageFov
        stereoPass.render(renderer, scene, camera, stage)
        renderImmersiveLightPollution(sky, renderer, camera)
        renderDiagLiveRef.current.stats.passes = 8
        renderDiagLiveRef.current.stats.path = atlasOn
          ? 'cubemap-atlas'
          : 'cubemap'
      } else {
        stereoPass.setAtlasPreview(false)
        const haloTuning = localHaloTuning()
        const haloTerrain = localHaloTerrainFrame()
        const cloudsForPass = !useCubemap && weatherLive.enabled
          ? weatherLive
          : null
        const volumeActive = localHaloPass.isActive(haloTuning, cloudsForPass)
        localHaloDebugRef.current.active = volumeActive
        if (volumeActive) {
          localHaloPass.begin(renderer)
          renderer.render(scene, camera)
          renderImmersiveLightPollution(sky, renderer, camera)
          localHaloPass.end(
            renderer,
            camera,
            haloTerrain,
            haloTuning,
            cloudsForPass && weatherWantsVolumePass(cloudsForPass)
              ? {
                  weather: cloudsForPass,
                  skyLight: latestSkyLight,
                  sunDirection: latestSunDir,
                  moonDirection: cloudMoonDirection,
                  moonStrength: cloudMoonStrength,
                  deltaSec: cloudsForPass.animateClouds ? weatherDt : 0,
                  reference: localHaloSourceRef.current === 'reference',
                  skyLp: clampLightPollutionAmount(
                    skyTogglesRef.current.lightPollutionAmount,
                  ) * lightPollutionBortleFactorRef.current,
                  dayFactor: getWeatherDayFactor(latestSunAltDeg),
                }
              : null,
          )
          renderDiagLiveRef.current.stats.passes = 2
          renderDiagLiveRef.current.stats.path = weatherWantsVolumePass(
            weatherLive,
          )
            ? 'direct-weather'
            : 'direct-local-halo'
        } else {
          renderer.render(scene, camera)
          renderImmersiveLightPollution(sky, renderer, camera)
          renderDiagLiveRef.current.stats.passes = 2
          renderDiagLiveRef.current.stats.path = 'direct'
        }
      }
      const info = renderer.info.render
      renderDiagLiveRef.current.stats.drawCalls = info.calls
      renderDiagLiveRef.current.stats.triangles = info.triangles
      renderDiagLiveRef.current.stats.points = info.points
      renderDiagLiveRef.current.stats.lines = info.lines
      renderer.info.autoReset = true

      fpsFrames += 1
      const now = performance.now()
      if (now - fpsLastMs >= 500) {
        renderDiagLiveRef.current.stats.fps =
          (fpsFrames * 1000) / (now - fpsLastMs)
        fpsFrames = 0
        fpsLastMs = now
      }

      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)

    return () => {
      disposed = true
      if (lookAnimRef.current != null) {
        window.cancelAnimationFrame(lookAnimRef.current)
        lookAnimRef.current = null
      }
      window.cancelAnimationFrame(raf)
      ro.disconnect()
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerleave', onPointerLeave)
      host.removeEventListener('pointerup', onPointerUp)
      host.removeEventListener('pointercancel', onPointerUp)
      host.removeEventListener('wheel', onWheel)
      apiRef.current = null
      nightSkyApiRef.current = null
      sky.geometry.dispose()
      if (sky.lightPollutionMesh.geometry !== sky.geometry) {
        sky.lightPollutionMesh.geometry.dispose()
      }
      sky.material.dispose()
      sky.lightPollutionMaterial.dispose()
      sky.zodiacalMaterial.dispose()
      sky.lightPollutionProfile.dispose()
      nightSky.dispose()
      skyBodies.dispose()
      localHaloGen += 1
      reloadLocalHaloRef.current = null
      localHaloProbeRef.current = null
      localHaloPass.dispose()
      terrainDispose?.()
      stereoPass.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
    // lat/lon (+ flatTerrain) only — groundElevationM updates from the map DEM
    // must NOT remount (that was reloading the whole terrain on every
    // quit→relaunch). bearingDeg must NOT remount either — that dropped back
    // to muddy preview. flatTerrain toggles a DEM-free sky test stub.
  }, [lat, lon, flatTerrain, LOCAL_HALO_PASS_REV])

  useEffect(() => {
    apiRef.current?.setSkyUtc(skyUtcMs)
  }, [
    skyUtcMs,
    weatherSettingsLive,
    localHaloSource,
    atmosphereAmount,
    moonlightEnabled,
    airglowAmount,
    airglowHue,
    airglowWaves,
    zodiacalAmount,
    lightPollutionAmount,
    groundNightBrightness,
    groundNightContrast,
    groundNightTemperature,
  ])

  // Target lock: re-aim whenever the playhead / selection / site changes.
  // Skip during timelapse preview — EQ playback owns the look (sky lock).
  useEffect(() => {
    if (timelapsePreviewActive) return
    if (!targetLocked || !selectedCelestial) return
    const pos = objectHorizontalAt(
      selectedCelestial,
      lat,
      lon,
      groundElevationM,
      skyUtcMs,
    )
    if (!pos) return
    const targetYaw = ((pos.azimuthDeg % 360) + 360) % 360
    const targetPitch = Math.max(
      LOOK_PITCH_MIN,
      Math.min(LOOK_PITCH_MAX, pos.altitudeDeg),
    )
    if (lookAnimRef.current != null) {
      window.cancelAnimationFrame(lookAnimRef.current)
      lookAnimRef.current = null
    }
    apiRef.current?.setLook(targetYaw, targetPitch)
  }, [
    timelapsePreviewActive,
    targetLocked,
    selectedCelestial,
    skyUtcMs,
    lat,
    lon,
    groundElevationM,
  ])

  useEffect(() => {
    if (!selectedCelestial) setTargetLocked(false)
  }, [selectedCelestial])

  // Re-entering the parked same-spot view: restore ready flag for the timeline.
  useEffect(() => {
    if (!active) return
    if (terrainReady) onTerrainReadyChangeRef.current?.(true)
  }, [active, terrainReady])

  // Astro tips under the loader bar: random deck, no repeats until exhausted.
  useEffect(() => {
    if (!loaderVisible) return

    const drawNext = () => {
      if (loaderTipDeckRef.current.length === 0) {
        const shuffled = shuffleAstroLoaderTips()
        if (
          shuffled.length > 1 &&
          shuffled[0] === loaderTipRef.current
        ) {
          const first = shuffled.shift()!
          shuffled.push(first)
        }
        loaderTipDeckRef.current = shuffled
      }
      const tip = loaderTipDeckRef.current.shift() ?? ''
      loaderTipRef.current = tip
      setLoaderTip(tip)
      setLoaderTipKey((k) => k + 1)
    }

    loaderTipDeckRef.current = []
    drawNext()
    const id = window.setInterval(drawNext, LOADER_TIP_ROTATE_MS)
    return () => window.clearInterval(id)
  }, [loaderVisible])

  const timelapsePreviewApiRef = useRef(timelapsePreview)
  timelapsePreviewApiRef.current = timelapsePreview
  const timelapsePlanRef = useRef(timelapse)
  timelapsePlanRef.current = timelapse
  const frameRollForPreviewRef = useRef(frameRollDeg)
  frameRollForPreviewRef.current = frameRollDeg

  useEffect(() => {
    const api: QaImmersiveApi = {
      setLook: (yaw, pitch, rollDeg = 0) =>
        apiRef.current?.setLook(yaw, pitch, rollDeg),
      setStageFov: (vfovDeg) => apiRef.current?.setStageFov(vfovDeg),
      setProjection: (mode) => {
        setStageProjection(mode)
        setProjection(mode)
      },
      isTerrainReady: () => terrainReady,
      isCaptureReady: () => {
        if (terrainReady || terrainUnlocked) return true
        const canvas = hostRef.current?.querySelector('canvas')
        if (!canvas || canvas.width < 64 || canvas.height < 64) return false
        // Preview+ already shows textured landscape; enough for FOV QA.
        return (
          terrainPhase === 'preview' ||
          terrainPhase === 'ortho' ||
          terrainPhase === 'detail' ||
          terrainPhase === 'far' ||
          terrainPhase === 'ready' ||
          terrainProgress >= 0.3
        )
      },
      getStageVfovDeg: () => stageVfovLiveRef.current,
      getProjection: () => getStageProjection(),
      getLook: () => ({ ...lookRef.current }),
      startTimelapsePreview: (plan) => {
        const next = normalizeTimelapsePlan({
          ...timelapsePlanRef.current,
          ...plan,
        })
        setTimelapse(next)
        if (frameMode !== 'dslr') applyFrameMode('dslr')
        setFramesLocked(false)
        const fromSettings = clampFrameRollDeg(frameRollForPreviewRef.current)
        savedFrameRollRef.current = fromSettings
        previewSceneRollRef.current = fromSettings
        setFrameRollDeg(0)
        setTimelapseFrameRollDeg(0)
        const look = lookRef.current
        apiRef.current?.setLook(look.yaw, look.pitch, fromSettings)
        timelapsePreviewApiRef.current.start(next)
      },
      seekTimelapse: (shotIndex) => {
        timelapsePreviewApiRef.current.seek(shotIndex)
      },
      pauseTimelapse: () => {
        timelapsePreviewApiRef.current.pause()
      },
      getTimelapseStatus: () => ({ ...timelapsePreviewApiRef.current.status }),
      exitTimelapsePreview: () => endTimelapsePreviewRef.current(),
      getLocalHaloDebug: () => ({
        ...localHaloDebugRef.current,
        controls: { ...localHaloRef.current },
      }),
      setLocalHalo: (patch) =>
        patchLocalHalo(patch as Partial<LocalHaloControls>),
      setLocalHaloSource: (source) => setLocalHaloSource(source),
      setSkyLpAmount: (amount01) =>
        setLightPollutionAmount(clampLightPollutionAmount(amount01)),
      probeLocalHalo: (u, v) => localHaloProbeRef.current?.(u, v) ?? null,
    }
    window.__astroQaImmersive = api
    return () => {
      if (window.__astroQaImmersive === api) delete window.__astroQaImmersive
    }
  }, [
    terrainReady,
    terrainUnlocked,
    terrainPhase,
    terrainProgress,
    projection,
    frameMode,
    patchLocalHalo,
  ])

  // Sync only when the PARENT bearing prop changes. Including pitchDeg here
  // re-applied the stale map bearing and wiped __astroSetLook / drag yaw.
  // Skip while EQ/fixed timelapse owns the look — parent bearing is stale.
  useEffect(() => {
    if (timelapsePreviewLookLockedRef.current) return
    lookRef.current = {
      yaw: bearingDeg,
      pitch: lookRef.current.pitch,
      roll: 0,
    }
    setYawDeg(bearingDeg)
    apiRef.current?.setLook(bearingDeg, lookRef.current.pitch, 0)
  }, [bearingDeg])

  useLayoutEffect(() => {
    setStageProjection(projection)
  }, [projection])

  useLayoutEffect(() => {
    apiRef.current?.setStageFov(stageVfovDeg)
  }, [stageVfovDeg])

  useEffect(() => {
    apiRef.current?.setEyeHeight(eyeHeightM)
  }, [eyeHeightM])

  useEffect(() => {
    const lastStep: Record<MoveDir, number> = {
      up: 0,
      down: 0,
      left: 0,
      right: 0,
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const dir = MOVE_KEYS[event.key]
      if (!dir) return
      if (!terrainUnlockedRef.current) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      setKeyHeld((held) => (held[dir] ? held : { ...held, [dir]: true }))
      const now = performance.now()
      if (now - lastStep[dir] < MOVE_STEP_MS) return
      lastStep[dir] = now
      apiRef.current?.step(dir)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const dir = MOVE_KEYS[event.key]
      if (!dir) return
      setKeyHeld((held) => (held[dir] ? { ...held, [dir]: false } : held))
    }
    const clearKeys = () => setKeyHeld(emptyMoveHeld())
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearKeys)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearKeys)
    }
  }, [])

  useEffect(() => {
    const repeats = moveRepeatRef.current
    return () => {
      for (const id of Object.values(repeats)) {
        if (id !== undefined) window.clearInterval(id)
      }
    }
  }, [])

  setStageProjection(projection)

  const previewRotQuarter = ((previewRenderRollDeg / 90) % 4 + 4) % 4

  return (
    <div
      className={[
        'immersive',
        terrainUnlocked ? '' : 'immersive--terrain-locked',
        timelapsePreviewActive ? 'immersive--tlapse-playing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        className={
          previewRotQuarter === 0
            ? 'immersive__stage'
            : `immersive__stage immersive__stage--rot${previewRotQuarter}`
        }
      >
        <div ref={hostRef} className="immersive__canvas" />
        {!terrainUnlocked ? (
          <div className="immersive__input-lock" aria-hidden="true" />
        ) : null}
        <PhotoFrameOverlay
          stageW={size.w}
          stageH={size.h}
          orientation={orientation}
          frameMode={frameMode}
          stageVfovDeg={stageVfovDeg}
          opticalVfovDeg={optical.v}
          opticalHfovDeg={optical.h}
          panorama={panorama}
          frameRollDeg={frameRollDeg + timelapseFrameRollDeg}
          label={`${focalMm} mm · ${optical.h.toFixed(0)}° × ${optical.v.toFixed(0)}°`}
          hideGrid={timelapsePreviewActive}
          hideMeta={timelapsePreviewActive}
          outsideDimOpacity={timelapsePreviewActive ? 0.72 : 0.28}
          worldLock={{
            // Preview look tracks the sequence — keep the sensor FOV centered
            // (follow frame). A retained landscape lock projects off-screen as
            // equatorial shots advance.
            locked: framesLocked && !timelapsePreviewActive,
            lockYawDeg: lockLook.yaw,
            lockPitchDeg: lockLook.pitch,
            lookYawDeg: yawDeg,
            lookPitchDeg: pitchDeg,
          }}
          onToggleWorldLock={
            timelapsePreviewActive
              ? undefined
              : () => {
                  if (framesLocked) {
                    setFramesLocked(false)
                    return
                  }
                  const look = lookRef.current
                  setLockLook({ yaw: look.yaw, pitch: look.pitch })
                  setFramesLocked(true)
                }
          }
          onRecenterWorldLock={
            timelapsePreviewActive
              ? undefined
              : () => {
                  const { yaw, pitch } = lockLook
                  lookRef.current = { yaw, pitch, roll: 0 }
                  setYawDeg(yaw)
                  setPitchDeg(pitch)
                  apiRef.current?.setLook(yaw, pitch, 0)
                }
          }
        />
      </div>

      <ViewBearingHud
        bearingDeg={yawDeg}
        altitudeMslM={groundElevationM + eyeHeightM}
        altitudeAriaLabel={`Altitude objectif ${Math.round(
          groundElevationM + eyeHeightM,
        )} m`}
      />
      {loaderVisible ? (
        <div
          className={`immersive__loader${terrainReady ? ' immersive__loader--done' : ''}${terrainUnlocked ? ' immersive__loader--upgrading' : ''}`}
          role="status"
          aria-live="polite"
          aria-busy={!terrainReady}
        >
          <div className="immersive__loader-stack">
            <div className="immersive__loader-card">
              <div className="immersive__loader-header">
                <div className="immersive__loader-heading">
                  <p className="immersive__loader-eyebrow">Terrain</p>
                  <p className="immersive__loader-phase">
                    {terrainReady
                      ? 'Vue prête'
                      : terrainPhase === 'dem' && terrainDemFromCache
                        ? 'Relief (cache)\u2026'
                        : TERRAIN_PHASE_LABEL[terrainPhase]}
                  </p>
                  <p className="immersive__loader-detail">
                    {terrainReady
                      ? 'Relief et ortho disponibles'
                      : terrainUnlocked
                        ? 'Affinage en arrière-plan'
                        : 'Construction de la scène immersive'}
                    {` · ${formatMegabytes(netBytes)} reçus`}
                  </p>
                </div>
                <p className="immersive__loader-pct">
                  {Math.round(terrainProgress * 100)}
                  <span className="immersive__loader-pct-unit">%</span>
                </p>
              </div>
              <div
                className="immersive__loader-track"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(terrainProgress * 100)}
                role="progressbar"
              >
                <div
                  className={`immersive__loader-fill${terrainReady ? '' : ' immersive__loader-fill--active'}`}
                  style={{ width: `${Math.round(terrainProgress * 100)}%` }}
                />
              </div>
            </div>
            {loaderTip ? (
              <div
                key={loaderTipKey}
                className="immersive__loader-card immersive__loader-tip-card"
                aria-hidden="true"
              >
                <p className="immersive__loader-tip">
                  <span className="immersive__loader-tip-label">
                    Le saviez-vous ?
                  </span>
                  {loaderTip}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {localHalo.viirsGround && localHaloProbe ? (
        <div className="local-halo-probe" role="status">
          {localHaloProbe.split('\n').map((line, i) => (
            <div
              key={line}
              className={i === 1 ? 'local-halo-probe__value' : undefined}
            >
              {line}
            </div>
          ))}
        </div>
      ) : null}
      <div className="moon-preview-pitch-stack">
        <ViewPitchHud pitchDeg={pitchDeg} />
        <RenderDiagnosticCard
          liveRef={renderDiagLiveRef}
          getContext={() => ({ ...diagContextRef.current })}
        />
      </div>

      <div
        className="moon-preview-hud-tools"
        role="toolbar"
        aria-label="Ciel"
      >
        <div
          className="moon-preview-hud-tools__group"
          role="group"
          aria-label="Couches célestes"
        >
          <button
            type="button"
            className={
              showMilkyWay
                ? 'moon-preview-hud-tool is-active'
                : 'moon-preview-hud-tool'
            }
            aria-pressed={showMilkyWay}
            title="Voie lactée"
            aria-label="Voie lactée"
            onClick={() => setShowMilkyWay((v) => !v)}
          >
            <MilkyWayIcon />
          </button>
          <button
            type="button"
            className={
              showHalpha
                ? 'moon-preview-hud-tool is-active'
                : 'moon-preview-hud-tool'
            }
            aria-pressed={showHalpha}
            title="Hα — émission hydrogène"
            aria-label="Hα"
            onClick={() => {
              setShowHalpha((v) => {
                const next = !v
                if (next) void nightSkyApiRef.current?.ensureHalphaLoaded()
                return next
              })
            }}
          >
            <span className="moon-preview-hud-tool__halpha">Hα</span>
          </button>
          <button
            type="button"
            className={
              showConstellations
                ? 'moon-preview-hud-tool is-active'
                : 'moon-preview-hud-tool'
            }
            aria-pressed={showConstellations}
            title="Constellations"
            aria-label="Constellations"
            onClick={() => setShowConstellations((v) => !v)}
          >
            <ConstellationsIcon />
          </button>
          <button
            type="button"
            className={
              showCelestialGrid
                ? 'moon-preview-hud-tool is-active'
                : 'moon-preview-hud-tool'
            }
            aria-pressed={showCelestialGrid}
            title="Grille RA/Dec"
            aria-label="Grille RA/Dec"
            onClick={() => setShowCelestialGrid((v) => !v)}
          >
            <RaDecGridIcon />
          </button>
          <button
            type="button"
            className={
              showAzimuthGrid
                ? 'moon-preview-hud-tool is-active'
                : 'moon-preview-hud-tool'
            }
            aria-pressed={showAzimuthGrid}
            title="Grille azimutale"
            aria-label="Grille azimutale"
            onClick={() => setShowAzimuthGrid((v) => !v)}
          >
            <AzimuthGridIcon />
          </button>
        </div>
        {showHalpha ? (
          <p className="moon-preview-hud-credit" role="note">
            Hα{' '}
            <a
              href="https://noirlab.edu/public/images/AllSky-17_Optical656nm-Halpha-WHAM-SHASSA-VTSS/"
              target="_blank"
              rel="noreferrer"
            >
              WHAM/VTSS/SHASSA/Douglas Finkbeiner
            </a>
            {' · '}
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY 4.0
            </a>
            {' · '}
            reprojeté galactique → ICRF/J2000
          </p>
        ) : null}
      </div>

      <div className="immersive__chrome immersive__chrome--left">
        <ViewfinderCaptureCapsule
          focalMm={focalMm}
          orientation={orientation}
          frameRollDeg={frameRollDeg}
          sensorFormat={sensorFormat}
          frameMode={frameMode}
          panorama={panorama}
          timelapse={timelapse}
          opticalHFovDeg={optical.h}
          opticalVFovDeg={optical.v}
          onFocalMmChange={setFocalMm}
          onOrientationChange={setOrientation}
          onFrameRollChange={(deg) => setFrameRollDeg(clampFrameRollDeg(deg))}
          onSensorFormatChange={setSensorFormat}
          onFrameModeChange={applyFrameMode}
          onPanoramaChange={applyPanorama}
          onTimelapseChange={setTimelapse}
          onStartTimelapsePreview={() => {
            if (frameMode !== 'dslr') applyFrameMode('dslr')
            // Sensor overlay must follow the camera during preview playback.
            setFramesLocked(false)
            // Photo frame roll → same angle as camera roll so cadre + paysage
            // turn together (do NOT snap/level — keep the composed angle).
            const fromSettings = clampFrameRollDeg(frameRollDeg)
            savedFrameRollRef.current = fromSettings
            previewSceneRollRef.current = fromSettings
            setFrameRollDeg(0)
            setTimelapseFrameRollDeg(0)
            const look = lookRef.current
            apiRef.current?.setLook(look.yaw, look.pitch, fromSettings)
            timelapsePreview.start(timelapse)
          }}
          timelapsePreviewPlaying={timelapsePreviewActive}
          selectedCelestial={selectedCelestial}
        />
      </div>

      {timelapsePreviewActive ? (
        <TimelapsePreviewHud
          phase={timelapsePreview.status.phase}
          shotIndex={timelapsePreview.status.shotIndex}
          shotCount={timelapsePreview.status.shotCount}
          renderRollDeg={previewRenderRollDeg}
          onPause={timelapsePreview.pause}
          onResume={timelapsePreview.resume}
          onStop={timelapsePreview.stop}
          onReplay={timelapsePreview.replay}
          onExit={endTimelapsePreview}
          onSeek={timelapsePreview.seek}
          onOpenSettings={() => {
            endTimelapsePreview()
            window.dispatchEvent(new Event(OPEN_TIMELAPSE_SETTINGS_EVENT))
          }}
          onRotateRender={() => {
            setPreviewRenderRollDeg((deg) => (deg + 90) % 360)
          }}
        />
      ) : null}

      <div className="move-stack">
        <div className="move-pad" role="group" aria-label="Déplacement, un mètre">
          {MOVE_DIRS.map((dir) => {
            const down = keyHeld[dir] || pointerHeld[dir]
            return (
              <button
                key={dir}
                type="button"
                className={
                  down
                    ? `move-pad__key move-pad__key--${dir} is-down`
                    : `move-pad__key move-pad__key--${dir}`
                }
                aria-label={MOVE_LABEL[dir]}
                aria-keyshortcuts={`Arrow${dir === 'up' ? 'Up' : dir === 'down' ? 'Down' : dir === 'left' ? 'Left' : 'Right'}`}
                aria-pressed={down}
                disabled={!terrainUnlocked}
                onPointerDown={(event) => {
                  if (!terrainUnlockedRef.current) return
                  event.preventDefault()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setPointerHeld((held) => ({ ...held, [dir]: true }))
                  apiRef.current?.step(dir)
                  window.clearInterval(moveRepeatRef.current[dir])
                  moveRepeatRef.current[dir] = window.setInterval(() => {
                    apiRef.current?.step(dir)
                  }, MOVE_STEP_MS)
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                  setPointerHeld((held) => ({ ...held, [dir]: false }))
                  window.clearInterval(moveRepeatRef.current[dir])
                  delete moveRepeatRef.current[dir]
                }}
                onPointerCancel={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                  setPointerHeld((held) => ({ ...held, [dir]: false }))
                  window.clearInterval(moveRepeatRef.current[dir])
                  delete moveRepeatRef.current[dir]
                }}
              >
                <MoveArrow dir={dir} />
              </button>
            )
          })}
        </div>

        <div className="eye-height">
          <span className="eye-height__label" id="eye-height-label">
            Élévation
          </span>
          <div
            className="eye-height__stepper"
            role="group"
            aria-labelledby="eye-height-label"
          >
            <button
              type="button"
              className="eye-height__btn"
              aria-label={`Baisser de ${EYE_HEIGHT_STEP_M * 100} cm`}
              onClick={() => {
                setEyeHeightDraft(null)
                setEyeHeightM((h) =>
                  clampEyeHeightM(
                    Math.round((h - EYE_HEIGHT_STEP_M) * 100) / 100,
                  ),
                )
              }}
            >
              −
            </button>
            <input
              className="eye-height__input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={
                eyeHeightDraft ?? formatEyeHeightDisplay(eyeHeightM)
              }
              aria-label="Élévation de l'objectif au-dessus du sol, en mètres"
              onChange={(event) => {
                setEyeHeightDraft(event.target.value)
              }}
              onBlur={() => {
                if (eyeHeightDraft == null) return
                const parsed = Number(
                  eyeHeightDraft.trim().replace(',', '.'),
                )
                setEyeHeightDraft(null)
                if (!Number.isFinite(parsed)) return
                setEyeHeightM(clampEyeHeightM(parsed))
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                } else if (event.key === 'Escape') {
                  setEyeHeightDraft(null)
                  event.currentTarget.blur()
                }
              }}
            />
            <span className="eye-height__unit" aria-hidden="true">
              m
            </span>
            <button
              type="button"
              className="eye-height__btn"
              aria-label={`Monter de ${EYE_HEIGHT_STEP_M * 100} cm`}
              onClick={() => {
                setEyeHeightDraft(null)
                setEyeHeightM((h) =>
                  clampEyeHeightM(
                    Math.round((h + EYE_HEIGHT_STEP_M) * 100) / 100,
                  ),
                )
              }}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="immersive__chrome immersive__chrome--right">
        <div className="celestial-dock">
          <button
            type="button"
            className={
              celestialSearchOpen || selectedCelestial
                ? 'hud-btn celestial-dock__toggle is-active'
                : 'hud-btn celestial-dock__toggle'
            }
            data-celestial-search-toggle=""
            aria-pressed={celestialSearchOpen}
            aria-expanded={celestialSearchOpen}
            aria-label="Rechercher un objet céleste"
            title="Rechercher un objet céleste"
            onClick={() => setCelestialSearchOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="m16 16 4.5 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <CelestialSearchPanel
            open={celestialSearchOpen}
            onOpenChange={setCelestialSearchOpen}
            selectedId={selectedCelestial?.id ?? null}
            onSelect={onSelectCelestial}
          />
          {selectedCelestial ? (
            <CelestialTargetCard
              object={selectedCelestial}
              date={date}
              playheadUtcMs={skyUtcMs}
              lat={lat}
              lon={lon}
              elevationM={groundElevationM}
              canCenter
              targetLocked={targetLocked}
              onClose={() => onSelectCelestial(null)}
              onToggleTargetLock={() => {
                if (targetLocked) {
                  setTargetLocked(false)
                  return
                }
                const pos = objectHorizontalAt(
                  selectedCelestial,
                  lat,
                  lon,
                  groundElevationM,
                  skyUtcMs,
                )
                if (!pos) return
                if (Math.abs(pos.altitudeDeg) > LOOK_PITCH_MAX) return
                // Aim now; the skyUtc effect keeps following while locked.
                const targetYaw = ((pos.azimuthDeg % 360) + 360) % 360
                const targetPitch = Math.max(
                  LOOK_PITCH_MIN,
                  Math.min(LOOK_PITCH_MAX, pos.altitudeDeg),
                )
                if (lookAnimRef.current != null) {
                  window.cancelAnimationFrame(lookAnimRef.current)
                  lookAnimRef.current = null
                }
                apiRef.current?.setLook(targetYaw, targetPitch)
                setTargetLocked(true)
              }}
              onCenter={() => {
                const pos = objectHorizontalAt(
                  selectedCelestial,
                  lat,
                  lon,
                  groundElevationM,
                  skyUtcMs,
                )
                if (!pos) return
                if (Math.abs(pos.altitudeDeg) > LOOK_PITCH_MAX) return

                const targetYaw = ((pos.azimuthDeg % 360) + 360) % 360
                const targetPitch = Math.max(
                  LOOK_PITCH_MIN,
                  Math.min(LOOK_PITCH_MAX, pos.altitudeDeg),
                )
                const from = lookRef.current
                if (lookAnimRef.current != null) {
                  window.cancelAnimationFrame(lookAnimRef.current)
                  lookAnimRef.current = null
                }

                if (prefersReducedMotion()) {
                  apiRef.current?.setLook(targetYaw, targetPitch)
                  return
                }

                const start = performance.now()
                const duration = 700
                const deltaYaw = shortestYawDelta(from.yaw, targetYaw)
                const deltaPitch = targetPitch - from.pitch
                const tick = (now: number) => {
                  const t = Math.min(1, (now - start) / duration)
                  const eased = 1 - (1 - t) ** 3
                  const yaw = from.yaw + deltaYaw * eased
                  const pitch = from.pitch + deltaPitch * eased
                  apiRef.current?.setLook(yaw, pitch)
                  if (t < 1) {
                    lookAnimRef.current = window.requestAnimationFrame(tick)
                  } else {
                    lookAnimRef.current = null
                    apiRef.current?.setLook(targetYaw, targetPitch)
                  }
                }
                lookAnimRef.current = window.requestAnimationFrame(tick)
              }}
            />
          ) : null}
        </div>
        <ViewfinderLandscapeControl
          brightness={groundNightBrightness}
          contrast={groundNightContrast}
          temperature={groundNightTemperature}
          onBrightnessChange={setGroundNightBrightness}
          onContrastChange={setGroundNightContrast}
          onTemperatureChange={setGroundNightTemperature}
        />
        <ViewfinderSkyControl
          atmosphereAmount={atmosphereAmount}
          moonlightEnabled={moonlightEnabled}
          onMoonlightChange={setMoonlightEnabled}
          airglowAmount={airglowAmount}
          airglowHue={airglowHue}
          airglowWaves={airglowWaves}
          zodiacalAmount={zodiacalAmount}
          lightPollutionAmount={lightPollutionAmount}
          starMagDepth={starMagDepth}
          starZoomSpan={starZoomSpan}
          starBrightness={starBrightness}
          starGlow={starGlow}
          onAtmosphereAmountChange={setAtmosphereAmount}
          onAirglowAmountChange={setAirglowAmount}
          onAirglowHueChange={setAirglowHue}
          onAirglowWavesChange={setAirglowWaves}
          onZodiacalAmountChange={setZodiacalAmount}
          onLightPollutionAmountChange={setLightPollutionAmount}
          localHalo={localHalo}
          onLocalHaloChange={patchLocalHalo}
          onStarMagDepthChange={setStarMagDepth}
          onStarZoomSpanChange={setStarZoomSpan}
          onStarBrightnessChange={setStarBrightness}
          onStarGlowChange={setStarGlow}
        />
        <ViewfinderWeatherControl
          manual={weatherSettings}
          weather={weatherControls}
          onWeatherChange={setWeather}
        />
        <ViewfinderProjectionControl
          projection={projection}
          onProjectionChange={setProjection}
        />
        {onDateChange ? (
          <button
            type="button"
            className="hud-btn immersive__exit"
            style={{ width: 'auto', minWidth: 40, padding: '0 10px', fontSize: '0.7rem' }}
            onClick={() => {
              onDateChange('2026-06-12')
              onSkyUtcChange?.(
                civilDayStartUtcMs('2026-06-12', lon) + 21 * 3600_000,
              )
            }}
            title="Debug: calendrier → 12 juin 2026, 21h locale"
          >
            12/06/26
          </button>
        ) : null}
        <button
          type="button"
          className="hud-btn immersive__exit"
          onClick={onExit}
          title="Quitter la vue trépied"
          aria-label="Quitter la vue trépied"
        >
          ✕
        </button>
      </div>

      <div className="immersive__hint">
        <span>Molette pour zoomer</span>
        <span>Drag pour regarder</span>
        <span>Flèches : 1 m</span>
        <span>Focale = cadre photo seulement</span>
        {terrainLabel ? <span>{terrainLabel}</span> : null}
      </div>
    </div>
  )
}

function formatEyeHeightDisplay(meters: number): string {
  const tenths = Math.round(meters * 10)
  if (Math.abs(meters * 10 - tenths) < 1e-6) return (tenths / 10).toFixed(1)
  return String(meters)
}

function MoveArrow({ dir }: { dir: MoveDir }) {
  const turn = dir === 'right' ? 90 : dir === 'down' ? 180 : dir === 'left' ? 270 : 0
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M8 3.2 12.2 8.4H9.4V12.8H6.6V8.4H3.8Z"
        fill="currentColor"
        transform={`rotate(${turn} 8 8)`}
      />
    </svg>
  )
}
