import type { BasemapMode } from './basemapMode'
import { TRIPOD_HEIGHT_M, clampEyeHeightM } from './presets'
import { TIMELINE_VISIBLE_RADIUS_STEPS_MS } from './DayTimeline'
import {
  clampFocalLengthMm,
  clampFrameRollDeg,
  DEFAULT_FOCAL_LENGTH_MM,
  DEFAULT_FRAME_MODE,
  DEFAULT_FRAME_ROLL_DEG,
  DEFAULT_ORIENTATION,
  DEFAULT_SENSOR_FORMAT,
  normalizeViewfinderFrameMode,
  SENSOR_FORMATS,
  STAGE_VFOV_DEFAULT_DEG,
  STAGE_VFOV_MAX_DEG,
  STAGE_VFOV_MIN_DEG,
  type SensorFormat,
  type ViewfinderFrameMode,
  type ViewfinderOrientation,
} from './lensFov'
import {
  clampPanoramaCount,
  clampPanoramaOverlap,
  DEFAULT_PANORAMA_PLAN,
  normalizePanoramaProjectionMode,
  type PanoramaPlan,
} from './panorama'
import {
  DEFAULT_TIMELAPSE_PLAN,
  normalizeTimelapsePlan,
  type TimelapsePlan,
} from './timelapse'
import {
  clampStarBrightness,
  clampStarGlow,
  clampStarMagDepth,
  clampStarZoomSpan,
  STAR_BRIGHTNESS_DEFAULT,
  STAR_GLOW_DEFAULT,
  STAR_MAG_DEPTH_DEFAULT,
  STAR_ZOOM_SPAN_DEFAULT,
} from './starRevealSettings'
import {
  AIRGLOW_AMOUNT_DEFAULT,
  AIRGLOW_HUE_DEFAULT,
  AIRGLOW_WAVES_DEFAULT,
  ATMOSPHERE_AMOUNT_DEFAULT,
  clampAirglowAmount,
  clampAirglowHue,
  clampAirglowWaves,
  clampAtmosphereAmount,
  clampGroundNightBrightness,
  clampGroundNightContrast,
  clampGroundNightTemperature,
  clampZodiacalAmount,
  GROUND_NIGHT_BRIGHTNESS_DEFAULT,
  GROUND_NIGHT_CONTRAST_DEFAULT,
  GROUND_NIGHT_TEMPERATURE_DEFAULT,
  ZODIACAL_AMOUNT_DEFAULT,
} from './skyLighting'
import {
  normalizeStageProjection,
  type StageProjection,
} from './stelProjector'

export const APP_SETTINGS_STORAGE_KEY = 'astro-landscape.settings.v1'

export type ImmersiveSettings = {
  focalMm: number
  orientation: ViewfinderOrientation
  /** Photo-frame roll in degrees (CCW), on top of paysage/portrait. */
  frameRollDeg: number
  sensorFormat: SensorFormat
  /** Which viewfinder overlay to draw: none / single shot / panorama grid. */
  frameMode: ViewfinderFrameMode
  panorama: PanoramaPlan
  timelapse: TimelapsePlan
  projection: StageProjection
  stageVfovDeg: number
  /** Camera height above the spot ground, metres. */
  eyeHeightM: number
  /**
   * Dusk/night ground brightness multiplier (1 = default curve).
   * Daytime albedo is unchanged.
   */
  groundNightBrightness: number
  /** Dusk/night ground contrast (1 = default). */
  groundNightContrast: number
  /** Dusk/night ground temperature −1…+1 (0 = neutral). */
  groundNightTemperature: number
  /**
   * Extra HYG magnitude depth (0 = default FOV curve).
   * Raises wide and tele limits together — denser sky, same zoom proportion.
   */
  starMagDepth: number
  /**
   * Wide↔tele magnitude-span multiplier (1 = default).
   * 0 = flat limit at every FOV; higher = more stars unlocked when zooming.
   */
  starZoomSpan: number
  /** Star luminance multiplier (1 = default). */
  starBrightness: number
  /** Halo on bright stars (0 = cores only, 1 = default). */
  starGlow: number
  showMilkyWay: boolean
  showHalpha: boolean
  /** Rayleigh sky amount 0…1 (replaces the old on/off Atmo toggle). */
  atmosphereAmount: number
  /** Additive OI airglow amount 0…1 (on top of atmosphere, night only). */
  airglowAmount: number
  /** Airglow hue 0…1 (green 557 nm → red 630 nm). */
  airglowHue: number
  /** Airglow structure 0…1 (van Rhijn gradient → gravity waves). */
  airglowWaves: number
  /** Additive zodiacal light 0…1 (ecliptic dust glow). */
  zodiacalAmount: number
  showConstellations: boolean
  showCelestialGrid: boolean
  showAzimuthGrid: boolean
}

export type MapSettings = {
  threeDimensional: boolean
  basemapMode: BasemapMode
}

export type TimelineSettings = {
  zoomIndex: number
  collapsed: boolean
}

export type AppSettings = {
  map: MapSettings
  immersive: ImmersiveSettings
  timeline: TimelineSettings
}

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  threeDimensional: true,
  basemapMode: 'satellite',
}

export const DEFAULT_IMMERSIVE_SETTINGS: ImmersiveSettings = {
  focalMm: DEFAULT_FOCAL_LENGTH_MM,
  orientation: DEFAULT_ORIENTATION,
  frameRollDeg: DEFAULT_FRAME_ROLL_DEG,
  sensorFormat: DEFAULT_SENSOR_FORMAT,
  frameMode: DEFAULT_FRAME_MODE,
  panorama: { ...DEFAULT_PANORAMA_PLAN },
  timelapse: { ...DEFAULT_TIMELAPSE_PLAN },
  projection: 'stereographic',
  stageVfovDeg: STAGE_VFOV_DEFAULT_DEG,
  eyeHeightM: TRIPOD_HEIGHT_M,
  groundNightBrightness: GROUND_NIGHT_BRIGHTNESS_DEFAULT,
  groundNightContrast: GROUND_NIGHT_CONTRAST_DEFAULT,
  groundNightTemperature: GROUND_NIGHT_TEMPERATURE_DEFAULT,
  starMagDepth: STAR_MAG_DEPTH_DEFAULT,
  starZoomSpan: STAR_ZOOM_SPAN_DEFAULT,
  starBrightness: STAR_BRIGHTNESS_DEFAULT,
  starGlow: STAR_GLOW_DEFAULT,
  showMilkyWay: true,
  showHalpha: false,
  atmosphereAmount: ATMOSPHERE_AMOUNT_DEFAULT,
  airglowAmount: AIRGLOW_AMOUNT_DEFAULT,
  airglowHue: AIRGLOW_HUE_DEFAULT,
  airglowWaves: AIRGLOW_WAVES_DEFAULT,
  zodiacalAmount: ZODIACAL_AMOUNT_DEFAULT,
  showConstellations: true,
  showCelestialGrid: false,
  showAzimuthGrid: false,
}

export const DEFAULT_TIMELINE_SETTINGS: TimelineSettings = {
  zoomIndex: 2,
  collapsed: false,
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  map: { ...DEFAULT_MAP_SETTINGS },
  immersive: {
    ...DEFAULT_IMMERSIVE_SETTINGS,
    panorama: { ...DEFAULT_PANORAMA_PLAN },
    timelapse: { ...DEFAULT_TIMELAPSE_PLAN },
  },
  timeline: { ...DEFAULT_TIMELINE_SETTINGS },
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeBasemapMode(value: unknown): BasemapMode {
  return value === 'satellite' || value === 'hybrid' || value === 'plan'
    ? value
    : DEFAULT_MAP_SETTINGS.basemapMode
}

function normalizeOrientation(value: unknown): ViewfinderOrientation {
  return value === 'portrait' || value === 'landscape'
    ? value
    : DEFAULT_ORIENTATION
}

function normalizeSensorFormat(value: unknown): SensorFormat {
  return (SENSOR_FORMATS as readonly string[]).includes(value as string)
    ? (value as SensorFormat)
    : DEFAULT_SENSOR_FORMAT
}

function normalizePanorama(value: unknown): PanoramaPlan {
  const row = asRecord(value)
  if (!row) return { ...DEFAULT_PANORAMA_PLAN }
  return {
    enabled: readBoolean(row.enabled, DEFAULT_PANORAMA_PLAN.enabled),
    columns: clampPanoramaCount(
      Number(row.columns),
      36,
    ),
    rows: clampPanoramaCount(Number(row.rows), 36),
    overlapPercent: clampPanoramaOverlap(Number(row.overlapPercent)),
    showOverlap: readBoolean(row.showOverlap, DEFAULT_PANORAMA_PLAN.showOverlap),
    showFrames: readBoolean(row.showFrames, DEFAULT_PANORAMA_PLAN.showFrames),
    projectionMode: normalizePanoramaProjectionMode(row.projectionMode),
  }
}

function normalizeStageVfov(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return STAGE_VFOV_DEFAULT_DEG
  return Math.min(STAGE_VFOV_MAX_DEG, Math.max(STAGE_VFOV_MIN_DEG, n))
}

function normalizeZoomIndex(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_TIMELINE_SETTINGS.zoomIndex
  return Math.min(
    TIMELINE_VISIBLE_RADIUS_STEPS_MS.length - 1,
    Math.max(0, n),
  )
}

function normalizeMap(value: unknown): MapSettings {
  const row = asRecord(value)
  if (!row) return { ...DEFAULT_MAP_SETTINGS }
  return {
    threeDimensional: readBoolean(
      row.threeDimensional,
      DEFAULT_MAP_SETTINGS.threeDimensional,
    ),
    basemapMode: normalizeBasemapMode(row.basemapMode),
  }
}

function normalizeImmersive(value: unknown): ImmersiveSettings {
  const row = asRecord(value)
  if (!row) {
    return {
      ...DEFAULT_IMMERSIVE_SETTINGS,
      panorama: { ...DEFAULT_PANORAMA_PLAN },
      timelapse: { ...DEFAULT_TIMELAPSE_PLAN },
    }
  }
  const panorama = normalizePanorama(row.panorama)
  const timelapse = normalizeTimelapsePlan(row.timelapse)
  // Migrate older saves that only had panorama.enabled.
  const frameMode = normalizeViewfinderFrameMode(
    row.frameMode ?? (panorama.enabled ? 'pano' : DEFAULT_FRAME_MODE),
  )
  return {
    focalMm: clampFocalLengthMm(Number(row.focalMm)),
    orientation: normalizeOrientation(row.orientation),
    frameRollDeg: clampFrameRollDeg(
      Number(row.frameRollDeg ?? DEFAULT_FRAME_ROLL_DEG),
    ),
    sensorFormat: normalizeSensorFormat(row.sensorFormat),
    frameMode,
    panorama: {
      ...panorama,
      enabled: frameMode === 'pano',
    },
    timelapse,
    projection: normalizeStageProjection(row.projection),
    stageVfovDeg: normalizeStageVfov(row.stageVfovDeg),
    eyeHeightM: clampEyeHeightM(
      Number(row.eyeHeightM ?? DEFAULT_IMMERSIVE_SETTINGS.eyeHeightM),
    ),
    groundNightBrightness: clampGroundNightBrightness(
      Number(
        row.groundNightBrightness ??
          DEFAULT_IMMERSIVE_SETTINGS.groundNightBrightness,
      ),
    ),
    groundNightContrast: clampGroundNightContrast(
      Number(
        row.groundNightContrast ??
          DEFAULT_IMMERSIVE_SETTINGS.groundNightContrast,
      ),
    ),
    groundNightTemperature: clampGroundNightTemperature(
      Number(
        row.groundNightTemperature ??
          DEFAULT_IMMERSIVE_SETTINGS.groundNightTemperature,
      ),
    ),
    starMagDepth: clampStarMagDepth(
      Number(row.starMagDepth ?? DEFAULT_IMMERSIVE_SETTINGS.starMagDepth),
    ),
    starZoomSpan: clampStarZoomSpan(
      Number(row.starZoomSpan ?? DEFAULT_IMMERSIVE_SETTINGS.starZoomSpan),
    ),
    starBrightness: clampStarBrightness(
      Number(row.starBrightness ?? DEFAULT_IMMERSIVE_SETTINGS.starBrightness),
    ),
    starGlow: clampStarGlow(
      Number(row.starGlow ?? DEFAULT_IMMERSIVE_SETTINGS.starGlow),
    ),
    showMilkyWay: readBoolean(
      row.showMilkyWay,
      DEFAULT_IMMERSIVE_SETTINGS.showMilkyWay,
    ),
    showHalpha: readBoolean(
      row.showHalpha,
      DEFAULT_IMMERSIVE_SETTINGS.showHalpha,
    ),
    atmosphereAmount: clampAtmosphereAmount(
      Number(
        row.atmosphereAmount ??
          (row.showAtmosphere === false
            ? 0
            : DEFAULT_IMMERSIVE_SETTINGS.atmosphereAmount),
      ),
    ),
    airglowAmount: clampAirglowAmount(
      Number(row.airglowAmount ?? DEFAULT_IMMERSIVE_SETTINGS.airglowAmount),
    ),
    airglowHue: clampAirglowHue(
      Number(row.airglowHue ?? DEFAULT_IMMERSIVE_SETTINGS.airglowHue),
    ),
    airglowWaves: clampAirglowWaves(
      Number(row.airglowWaves ?? DEFAULT_IMMERSIVE_SETTINGS.airglowWaves),
    ),
    zodiacalAmount: clampZodiacalAmount(
      Number(row.zodiacalAmount ?? DEFAULT_IMMERSIVE_SETTINGS.zodiacalAmount),
    ),
    showConstellations: readBoolean(
      row.showConstellations,
      DEFAULT_IMMERSIVE_SETTINGS.showConstellations,
    ),
    showCelestialGrid: readBoolean(
      row.showCelestialGrid,
      DEFAULT_IMMERSIVE_SETTINGS.showCelestialGrid,
    ),
    showAzimuthGrid: readBoolean(
      row.showAzimuthGrid,
      DEFAULT_IMMERSIVE_SETTINGS.showAzimuthGrid,
    ),
  }
}

function normalizeTimeline(value: unknown): TimelineSettings {
  const row = asRecord(value)
  if (!row) return { ...DEFAULT_TIMELINE_SETTINGS }
  return {
    zoomIndex: normalizeZoomIndex(row.zoomIndex),
    collapsed: readBoolean(row.collapsed, DEFAULT_TIMELINE_SETTINGS.collapsed),
  }
}

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY)
    if (!raw) return structuredClone(DEFAULT_APP_SETTINGS)
    const parsed = asRecord(JSON.parse(raw) as unknown)
    if (!parsed) return structuredClone(DEFAULT_APP_SETTINGS)
    return {
      map: normalizeMap(parsed.map),
      immersive: normalizeImmersive(parsed.immersive),
      timeline: normalizeTimeline(parsed.timeline),
    }
  } catch {
    return structuredClone(DEFAULT_APP_SETTINGS)
  }
}

export function saveAppSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* quota / private mode */
  }
}

/** Merge a partial patch into stored settings and persist. */
export function patchAppSettings(
  patch: Partial<{
    map: Partial<MapSettings>
    immersive: Partial<ImmersiveSettings>
    timeline: Partial<TimelineSettings>
  }>,
): AppSettings {
  const current = loadAppSettings()
  const next: AppSettings = {
    map: { ...current.map, ...patch.map },
    immersive: {
      ...current.immersive,
      ...patch.immersive,
      panorama: patch.immersive?.panorama
        ? { ...patch.immersive.panorama }
        : { ...current.immersive.panorama },
      timelapse: patch.immersive?.timelapse
        ? { ...patch.immersive.timelapse }
        : { ...current.immersive.timelapse },
    },
    timeline: { ...current.timeline, ...patch.timeline },
  }
  saveAppSettings(next)
  return next
}
