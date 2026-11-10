export const OPEN_METEO_FORECAST_URL =
  import.meta.env.VITE_OPEN_METEO_FORECAST_URL ??
  'https://api.open-meteo.com/v1/forecast'

export const OPEN_METEO_ARCHIVE_URL =
  import.meta.env.VITE_OPEN_METEO_ARCHIVE_URL ??
  'https://archive-api.open-meteo.com/v1/archive'

export type WeatherHour = {
  time: string
  temperatureC: number
  cloudCover: number
  cloudCoverLow: number
  cloudCoverMid: number
  cloudCoverHigh: number
  precipitationMm: number
  precipitationProbability: number
  visibilityMeters: number
  windSpeedKmh: number
  humidity: number
  weatherCode: number
}

export type WeatherForecast = {
  timezone: string
  utcOffsetSeconds: number
  hours: WeatherHour[]
}

type OpenMeteoResponse = {
  timezone?: string
  utc_offset_seconds?: number
  hourly?: {
    time?: string[]
    temperature_2m?: number[]
    cloud_cover?: number[]
    cloud_cover_low?: number[]
    cloud_cover_mid?: number[]
    cloud_cover_high?: number[]
    precipitation?: number[]
    precipitation_probability?: number[]
    visibility?: number[]
    wind_speed_10m?: number[]
    relative_humidity_2m?: number[]
    weather_code?: number[]
  }
}

/** True when Open-Meteo filled the fields the card actually renders. */
export function isUsableWeatherHour(hour: WeatherHour): boolean {
  return (
    Number.isFinite(hour.temperatureC) &&
    Number.isFinite(hour.cloudCover) &&
    Number.isFinite(hour.cloudCoverLow) &&
    Number.isFinite(hour.cloudCoverMid) &&
    Number.isFinite(hour.cloudCoverHigh) &&
    Number.isFinite(hour.precipitationMm) &&
    Number.isFinite(hour.visibilityMeters) &&
    Number.isFinite(hour.windSpeedKmh) &&
    Number.isFinite(hour.weatherCode)
  )
}

const cache = new Map<string, Promise<WeatherForecast>>()
const hourlyFields = [
  'temperature_2m',
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'precipitation',
  'precipitation_probability',
  'visibility',
  'wind_speed_10m',
  'relative_humidity_2m',
  'weather_code',
].join(',')

async function loadOpenMeteoHours(
  baseUrl: string,
  {
    latitude,
    longitude,
    startDate,
    endDate,
  }: {
    latitude: number
    longitude: number
    startDate: string
    endDate: string
  },
): Promise<WeatherForecast> {
  const url = new URL(baseUrl)
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: hourlyFields,
    timezone: 'auto',
    start_date: startDate,
    end_date: endDate,
  }).toString()
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`)
  const data = (await response.json()) as OpenMeteoResponse
  const hourly = data.hourly
  if (!hourly?.time?.length) throw new Error('Open-Meteo returned no hourly forecast')

  const value = (values: number[] | undefined, index: number): number => {
    const raw = values?.[index]
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : Number.NaN
  }
  const hours = hourly.time
    .map((time, index) => ({
      time,
      temperatureC: value(hourly.temperature_2m, index),
      cloudCover: value(hourly.cloud_cover, index),
      cloudCoverLow: value(hourly.cloud_cover_low, index),
      cloudCoverMid: value(hourly.cloud_cover_mid, index),
      cloudCoverHigh: value(hourly.cloud_cover_high, index),
      precipitationMm: value(hourly.precipitation, index),
      precipitationProbability: value(hourly.precipitation_probability, index),
      visibilityMeters: value(hourly.visibility, index),
      windSpeedKmh: value(hourly.wind_speed_10m, index),
      humidity: value(hourly.relative_humidity_2m, index),
      weatherCode: value(hourly.weather_code, index),
    }))
    .filter(isUsableWeatherHour)
  // Open-Meteo often returns hourly timestamps with null metrics for dates
  // outside its usable forecast/archive window — treat that as unavailable.
  if (!hours.length) {
    throw new Error('Open-Meteo returned no usable hourly forecast')
  }
  return {
    timezone: data.timezone ?? 'UTC',
    utcOffsetSeconds: data.utc_offset_seconds ?? 0,
    hours,
  }
}

/** Fetches and retains Open-Meteo hourly data for one place/date range. */
export function fetchWeatherForecast({
  latitude,
  longitude,
  startDate,
  endDate,
}: {
  latitude: number
  longitude: number
  startDate: string
  endDate: string
}): Promise<WeatherForecast> {
  const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}:${startDate}:${endDate}`
  const existing = cache.get(key)
  if (existing) return existing

  const request = (async () => {
    try {
      return await loadOpenMeteoHours(OPEN_METEO_FORECAST_URL, {
        latitude,
        longitude,
        startDate,
        endDate,
      })
    } catch {
      // Past planner days fall outside the live forecast window. Archive keeps
      // Viewfinder cloud bands able to follow the playhead on those dates.
      return await loadOpenMeteoHours(OPEN_METEO_ARCHIVE_URL, {
        latitude,
        longitude,
        startDate,
        endDate,
      })
    }
  })()
  cache.set(key, request)
  request.catch(() => cache.delete(key))
  return request
}

export function weatherHourToUtcMs(hour: WeatherHour, utcOffsetSeconds: number): number {
  return Date.parse(`${hour.time}:00Z`) - utcOffsetSeconds * 1_000
}

/** Nearest Open-Meteo hour to the celestial playhead (same rule as WeatherCard). */
export function selectWeatherHour(
  forecast: WeatherForecast,
  playheadUtcMs: number | null,
): WeatherHour | null {
  if (!forecast.hours.length) return null
  if (playheadUtcMs == null) return forecast.hours[0] ?? null
  return forecast.hours.reduce((closest, hour) =>
    Math.abs(weatherHourToUtcMs(hour, forecast.utcOffsetSeconds) - playheadUtcMs) <
    Math.abs(weatherHourToUtcMs(closest, forecast.utcOffsetSeconds) - playheadUtcMs)
      ? hour
      : closest,
  )
}

/**
 * Maps an Open-Meteo hour onto the Viewfinder low/mid/high cloud sliders
 * plus total sky cloud cover (`cloud_cover`). Values are already 0–100
 * percentages from the API.
 */
export function viewfinderCloudBandsFromHour(hour: WeatherHour): {
  lowClouds: number
  midClouds: number
  highClouds: number
  totalClouds: number
} {
  const clampPct = (value: number): number =>
    Math.max(0, Math.min(100, Math.round(value)))
  return {
    lowClouds: clampPct(hour.cloudCoverLow),
    midClouds: clampPct(hour.cloudCoverMid),
    highClouds: clampPct(hour.cloudCoverHigh),
    totalClouds: clampPct(hour.cloudCover),
  }
}
