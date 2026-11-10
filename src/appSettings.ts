import type { BasemapMode } from './basemapMode'
import { TRIPOD_HEIGHT_M, clampEyeHeightM } from './presets'
import { TIMELINE_VISIBLE_RADIUS_STEPS_MS } from './DayTimeline'
import {
  clampFocalLengthMm,
  DEFAULT_FOCAL_LENGTH_MM,
  DEFAULT_ORIENTATION,
  DEFAULT_SENSOR_FORMAT,
  SENSOR_FORMATS,
  STAGE_VFOV_DEFAULT_DEG,
  STAGE_VFOV_MAX_DEG,
  STAGE_VFOV_MIN_DEG,
  type SensorFormat,
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
  normalizeStageProjection,
  type StageProjection,
} from './stelProjector'

export const APP_SETTINGS_STORAGE_KEY = 'astro-landscape.settings.v1'

export type ImmersiveSettings = {
  focalMm: number
  orientation: ViewfinderOrientation
  sensorFormat: SensorFormat
  panorama: PanoramaPlan
  projection: StageProjection
  stageVfovDeg: number
  /** Camera height above the spot ground, metres. */
  eyeHeightM: number
  showMilkyWay: boolean
  showHalpha: boolean
  showAtmosphere: boolean
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
  sensorFormat: DEFAULT_SENSOR_FORMAT,
  panorama: { ...DEFAULT_PANORAMA_PLAN },
  projection: 'stereographic',
  stageVfovDeg: STAGE_VFOV_DEFAULT_DEG,
  eyeHeightM: TRIPOD_HEIGHT_M,
  showMilkyWay: true,
  showHalpha: false,
  showAtmosphere: true,
  showConstellations: true,
  showCelestialGrid: false,
  showAzimuthGrid: false,
}

export const DEFAULT_TIMELINE_SETTINGS: TimelineSettings = {
  zoomIndex: 2,
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  map: { ...DEFAULT_MAP_SETTINGS },
  immersive: {
    ...DEFAULT_IMMERSIVE_SETTINGS,
    panorama: { ...DEFAULT_PANORAMA_PLAN },
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
    }
  }
  return {
    focalMm: clampFocalLengthMm(Number(row.focalMm)),
    orientation: normalizeOrientation(row.orientation),
    sensorFormat: normalizeSensorFormat(row.sensorFormat),
    panorama: normalizePanorama(row.panorama),
    projection: normalizeStageProjection(row.projection),
    stageVfovDeg: normalizeStageVfov(row.stageVfovDeg),
    eyeHeightM: clampEyeHeightM(
      Number(row.eyeHeightM ?? DEFAULT_IMMERSIVE_SETTINGS.eyeHeightM),
    ),
    showMilkyWay: readBoolean(
      row.showMilkyWay,
      DEFAULT_IMMERSIVE_SETTINGS.showMilkyWay,
    ),
    showHalpha: readBoolean(
      row.showHalpha,
      DEFAULT_IMMERSIVE_SETTINGS.showHalpha,
    ),
    showAtmosphere: readBoolean(
      row.showAtmosphere,
      DEFAULT_IMMERSIVE_SETTINGS.showAtmosphere,
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
  return { zoomIndex: normalizeZoomIndex(row.zoomIndex) }
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
    },
    timeline: { ...current.timeline, ...patch.timeline },
  }
  saveAppSettings(next)
  return next
}
