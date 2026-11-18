import * as THREE from 'three'
import type { WeatherForecast, WeatherHour } from './weatherForecast'
import { selectWeatherHour } from './weatherForecast'

/**
 * Immersive volumetric clouds — parameters aligned on the Chamonix HTML
 * prototype (km ASL, three independent layers). Rendering lives in
 * `localHaloPass` (same post path as local PL).
 */

export type WeatherCloudLayer = {
  enabled: boolean
  /** Coverage 0…100 %. */
  cover: number
  /** Base altitude above sea level (km). */
  altKm: number
  /** Thickness (km). */
  thickKm: number
  /** Density 0…200 % (prototype slider). */
  densityPct: number
}

export type ViewfinderWeatherForecast = {
  utcOffsetSeconds: number
  hours: WeatherHour[]
}

export type ViewfinderWeather = {
  enabled: boolean
  animateClouds: boolean
  /** Wind multiplier (prototype `wind`, default 1). */
  wind: number
  low: WeatherCloudLayer
  mid: WeatherCloudLayer
  high: WeatherCloudLayer
  /**
   * Total sky cloud cover 0–100 from Open-Meteo when following the forecast.
   * Absent for manual band sliders.
   */
  totalClouds?: number
  followForecast?: boolean
  forecast?: ViewfinderWeatherForecast | null
  /** @deprecated Prefer `low.cover` — kept for migration / ground dimming. */
  lowClouds?: number
  midClouds?: number
  highClouds?: number
}

export const WEATHER_LAYER_DEFAULTS = {
  low: {
    enabled: true,
    cover: 55,
    altKm: 2.2,
    thickKm: 1.1,
    densityPct: 110,
  },
  mid: {
    enabled: true,
    cover: 30,
    altKm: 4.6,
    thickKm: 1.4,
    densityPct: 70,
  },
  high: {
    enabled: true,
    cover: 35,
    altKm: 7.4,
    thickKm: 0.7,
    densityPct: 35,
  },
} as const satisfies Record<'low' | 'mid' | 'high', WeatherCloudLayer>

export const WEATHER_COVER_PRESETS = {
  clear: [0, 0, 0] as const,
  scattered: [55, 30, 35] as const,
  overcast: [95, 75, 45] as const,
}

export const DEFAULT_VIEWFINDER_WEATHER: ViewfinderWeather = {
  enabled: false,
  animateClouds: true,
  wind: 1,
  low: { ...WEATHER_LAYER_DEFAULTS.low },
  mid: { ...WEATHER_LAYER_DEFAULTS.mid },
  high: { ...WEATHER_LAYER_DEFAULTS.high },
  followForecast: false,
  forecast: null,
}

export function clampCloudCoverPct(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function clampCloudAltKm(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value * 10) / 10))
}

export function clampCloudThickKm(value: number): number {
  if (!Number.isFinite(value)) return 0.3
  return Math.max(0.3, Math.min(2, Math.round(value * 10) / 10))
}

export function clampCloudDensityPct(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(200, Math.round(value / 5) * 5))
}

export function clampCloudWind(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(8, Math.round(value * 10) / 10))
}

export function normalizeWeatherLayer(
  value: unknown,
  fallback: WeatherCloudLayer,
): WeatherCloudLayer {
  const row =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  if (!row) return { ...fallback }
  return {
    enabled: row.enabled == null ? fallback.enabled : Boolean(row.enabled),
    cover: clampCloudCoverPct(Number(row.cover ?? fallback.cover)),
    altKm: clampCloudAltKm(Number(row.altKm ?? fallback.altKm), 0.5, 12),
    thickKm: clampCloudThickKm(Number(row.thickKm ?? fallback.thickKm)),
    densityPct: clampCloudDensityPct(
      Number(row.densityPct ?? fallback.densityPct),
    ),
  }
}

/** Effective coverage 0…1 for a layer (off → 0). */
export function weatherLayerCover01(layer: WeatherCloudLayer): number {
  if (!layer.enabled || layer.densityPct <= 0) return 0
  return clampCloudCoverPct(layer.cover) / 100
}

/** Density multiplier 0…2 (prototype % / 100). */
export function weatherLayerDensity(layer: WeatherCloudLayer): number {
  if (!layer.enabled) return 0
  return clampCloudDensityPct(layer.densityPct) / 100
}

/**
 * A weather layer is considered visually covered when any of the altitude
 * bands covers the view. Shared by ground-light adaptation.
 */
export const getWeatherCloudCoverage = (
  settings: Pick<ViewfinderWeather, 'low' | 'mid' | 'high'> &
    Partial<Pick<ViewfinderWeather, 'lowClouds' | 'midClouds' | 'highClouds'>>,
): number => {
  const low = settings.low
    ? weatherLayerCover01(settings.low)
    : clampCloudCoverPct(settings.lowClouds ?? 0) / 100
  const mid = settings.mid
    ? weatherLayerCover01(settings.mid)
    : clampCloudCoverPct(settings.midClouds ?? 0) / 100
  const high = settings.high
    ? weatherLayerCover01(settings.high)
    : clampCloudCoverPct(settings.highClouds ?? 0) / 100
  return Math.max(0, Math.min(1, Math.max(low, mid, high)))
}

export const getWeatherTotalCloudCoverPct = (
  settings: ViewfinderWeather,
): number => {
  if (
    typeof settings.totalClouds === 'number' &&
    Number.isFinite(settings.totalClouds)
  ) {
    return clampCloudCoverPct(settings.totalClouds)
  }
  return Math.round(getWeatherCloudCoverage(settings) * 100)
}

export const getWeatherGroundLightFactor = (
  settings: ViewfinderWeather,
): number => {
  const coverage = getWeatherCloudCoverage(settings)
  const easedCoverage = coverage * coverage * (3 - 2 * coverage)
  return 1 - easedCoverage * 0.52
}

export const getWeatherGroundSunWarmth = (
  settings: ViewfinderWeather,
): { warmth: number; overcast: number } => {
  const coverage = getWeatherCloudCoverage(settings)
  const eased = coverage * coverage * (3 - 2 * coverage)
  const warmth = Math.sin(Math.PI * Math.min(1, eased * 1.15)) * 0.85
  return { warmth, overcast: eased }
}

export const getWeatherDayFactor = (sunAltitudeDeg: number): number =>
  THREE.MathUtils.smoothstep(sunAltitudeDeg, -6, 12)

/** @deprecated Takram path removed — kept for tests that still reference it. */
export const weatherTakramCoverage = (maximumCoverage01: number): number =>
  THREE.MathUtils.lerp(0, 0.5, THREE.MathUtils.clamp(maximumCoverage01, 0, 1))

export function weatherForecastSnapshot(
  forecast: WeatherForecast,
): ViewfinderWeatherForecast {
  return {
    utcOffsetSeconds: forecast.utcOffsetSeconds,
    hours: forecast.hours,
  }
}

function viewfinderCloudBandsFromHour(hour: WeatherHour, settings: ViewfinderWeather): {
  low: WeatherCloudLayer
  mid: WeatherCloudLayer
  high: WeatherCloudLayer
  totalClouds: number
} {
  return {
    low: {
      ...settings.low,
      cover: clampCloudCoverPct(hour.cloudCoverLow),
      enabled: true,
    },
    mid: {
      ...settings.mid,
      cover: clampCloudCoverPct(hour.cloudCoverMid),
      enabled: true,
    },
    high: {
      ...settings.high,
      cover: clampCloudCoverPct(hour.cloudCoverHigh),
      enabled: true,
    },
    totalClouds: clampCloudCoverPct(hour.cloudCover),
  }
}

export function resolveViewfinderWeatherAt(
  settings: ViewfinderWeather,
  playheadUtcMs: number | null,
): ViewfinderWeather {
  if (!settings.followForecast || !settings.forecast?.hours.length) {
    return settings
  }
  const hour = selectWeatherHour(
    {
      timezone: 'UTC',
      utcOffsetSeconds: settings.forecast.utcOffsetSeconds,
      hours: settings.forecast.hours,
    },
    playheadUtcMs,
  )
  if (!hour) return settings
  const bands = viewfinderCloudBandsFromHour(hour, settings)
  return {
    ...settings,
    low: bands.low,
    mid: bands.mid,
    high: bands.high,
    totalClouds: bands.totalClouds,
    lowClouds: bands.low.cover,
    midClouds: bands.mid.cover,
    highClouds: bands.high.cover,
  }
}

export function weatherWantsVolumePass(settings: ViewfinderWeather): boolean {
  if (!settings.enabled) return false
  return (
    weatherLayerCover01(settings.low) > 0.001 ||
    weatherLayerCover01(settings.mid) > 0.001 ||
    weatherLayerCover01(settings.high) > 0.001
  )
}

/** Pack layers for the post shader: (altKm, thickKm, cover01, density). */
export function weatherLayersForShader(
  settings: ViewfinderWeather,
): [THREE.Vector4, THREE.Vector4, THREE.Vector4] {
  const pack = (layer: WeatherCloudLayer) =>
    new THREE.Vector4(
      layer.altKm,
      layer.thickKm,
      weatherLayerCover01(layer),
      weatherLayerDensity(layer),
    )
  return [pack(settings.low), pack(settings.mid), pack(settings.high)]
}

export function applyWeatherCoverPreset(
  settings: ViewfinderWeather,
  preset: keyof typeof WEATHER_COVER_PRESETS,
): ViewfinderWeather {
  const [low, mid, high] = WEATHER_COVER_PRESETS[preset]
  return {
    ...settings,
    enabled: true,
    followForecast: false,
    low: { ...settings.low, enabled: true, cover: low },
    mid: { ...settings.mid, enabled: true, cover: mid },
    high: { ...settings.high, enabled: true, cover: high },
  }
}
