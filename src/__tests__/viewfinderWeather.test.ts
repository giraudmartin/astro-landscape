import { describe, expect, it } from 'vitest'
import {
  applyWeatherCoverPreset,
  DEFAULT_VIEWFINDER_WEATHER,
  getWeatherCloudCoverage,
  getWeatherGroundLightFactor,
  resolveViewfinderWeatherAt,
  weatherTakramCoverage,
  weatherWantsVolumePass,
  type ViewfinderWeather,
} from '../viewfinderWeather'
import type { WeatherHour } from '../weatherForecast'

function hour(partial: Partial<WeatherHour> & { time: string }): WeatherHour {
  return {
    temperatureC: 12,
    cloudCover: 40,
    cloudCoverLow: 10,
    cloudCoverMid: 20,
    cloudCoverHigh: 5,
    precipitationMm: 0,
    precipitationProbability: 0,
    visibilityMeters: 20_000,
    windSpeedKmh: 8,
    humidity: 50,
    weatherCode: 1,
    ...partial,
  }
}

describe('viewfinderWeather', () => {
  it('uses max band for coverage and softens ground light under overcast', () => {
    const settings: ViewfinderWeather = {
      ...DEFAULT_VIEWFINDER_WEATHER,
      low: { ...DEFAULT_VIEWFINDER_WEATHER.low, cover: 10 },
      mid: { ...DEFAULT_VIEWFINDER_WEATHER.mid, cover: 80 },
      high: { ...DEFAULT_VIEWFINDER_WEATHER.high, cover: 5 },
    }
    expect(getWeatherCloudCoverage(settings)).toBe(0.8)
    expect(
      getWeatherGroundLightFactor({
        ...DEFAULT_VIEWFINDER_WEATHER,
        low: { ...DEFAULT_VIEWFINDER_WEATHER.low, cover: 100 },
        mid: { ...DEFAULT_VIEWFINDER_WEATHER.mid, cover: 100 },
        high: { ...DEFAULT_VIEWFINDER_WEATHER.high, cover: 100 },
      }),
    ).toBeCloseTo(0.48, 2)
  })

  it('resolves Open-Meteo bands when followForecast is on', () => {
    const settings: ViewfinderWeather = {
      ...DEFAULT_VIEWFINDER_WEATHER,
      enabled: true,
      low: { ...DEFAULT_VIEWFINDER_WEATHER.low, cover: 15, altKm: 2.9, densityPct: 65 },
      followForecast: true,
      forecast: {
        utcOffsetSeconds: 0,
        hours: [
          hour({
            time: '2026-11-18T12:00',
            cloudCoverLow: 90,
            cloudCoverMid: 40,
            cloudCoverHigh: 5,
            cloudCover: 92,
          }),
        ],
      },
    }
    const resolved = resolveViewfinderWeatherAt(
      settings,
      Date.parse('2026-11-18T12:00:00Z'),
    )
    expect(resolved.low).toMatchObject({ cover: 90, altKm: 2.9, densityPct: 65 })
    expect(settings.low.cover).toBe(15)
    expect(resolved.mid.cover).toBe(40)
    expect(resolved.high.cover).toBe(5)
    expect(resolved.totalClouds).toBe(92)
  })

  it('applies cover presets from the Chamonix prototype', () => {
    const next = applyWeatherCoverPreset(DEFAULT_VIEWFINDER_WEATHER, 'scattered')
    expect(next.enabled).toBe(true)
    expect(next.low.cover).toBe(55)
    expect(next.mid.cover).toBe(30)
    expect(next.high.cover).toBe(35)
    expect(weatherWantsVolumePass(next)).toBe(true)
    expect(
      weatherWantsVolumePass(
        applyWeatherCoverPreset(DEFAULT_VIEWFINDER_WEATHER, 'clear'),
      ),
    ).toBe(false)
  })

  it('leaves the pass and ground lighting clear for a transparent layer', () => {
    const clear = applyWeatherCoverPreset(DEFAULT_VIEWFINDER_WEATHER, 'clear')
    const weather = { ...clear, low: { ...clear.low, cover: 100, densityPct: 0 } }
    expect(weatherWantsVolumePass(weather)).toBe(false)
    expect(getWeatherGroundLightFactor(weather)).toBe(1)
  })

  it('maps clear sky to zero Takram coverage (compat helper)', () => {
    expect(weatherTakramCoverage(0)).toBe(0)
    expect(weatherTakramCoverage(1)).toBeCloseTo(0.5, 5)
    expect(weatherTakramCoverage(0.5)).toBeCloseTo(0.25, 5)
  })
})
