/** Ported from Photo Sightline WeatherCard — French copy, same chrome. */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchWeatherForecast,
  isUsableWeatherHour,
  selectWeatherHour,
  weatherHourToUtcMs,
  type WeatherForecast,
} from './weatherForecast'

export { selectWeatherHour } from './weatherForecast'

type WeatherCardProps = {
  date: string
  playheadUtcMs: number | null
  location: { lat: number; lon: number } | null
  onHourSelect: (utcMs: number, localDate: string) => void
  embedded?: boolean
}

const LABELS = {
  title: 'Météo',
  aria: 'Prévisions météo',
  expand: 'Développer la météo',
  collapse: 'Réduire la météo',
  needSpot: 'Sélectionne un spot photographe pour charger la météo.',
  loading: 'Chargement des prévisions…',
  unavailable:
    'Pas de météo pour cette date (Open-Meteo ne couvre que les jours récents et les prévisions proches).',
  empty: 'Aucune prévision disponible pour cette date.',
  cloudCover: 'couverture nuageuse',
  wind: 'Vent',
  cloudForecast: 'Prévision nuageuse',
  next6h: '6 h suivantes',
  cloudLayers: 'Couches nuageuses',
  coverage: 'Couverture',
  high: 'Haut',
  mid: 'Moyen',
  low: 'Bas',
  precipitation: 'PRÉCIPITATIONS',
  visibility: 'VISIBILITÉ',
  footer: 'Open-Meteo · Données de prévision',
  clearSky: 'Ciel dégagé',
  partlyCloudy: 'Partiellement nuageux',
  overcast: 'Couvert',
  foggy: 'Brouillard',
  drizzle: 'Bruine',
  rain: 'Pluie',
  snow: 'Neige',
  thunderstorm: 'Orage',
  codeUnavailable: 'Indisponible',
} as const

function nextDate(date: string): string {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + 1)
  return value.toISOString().slice(0, 10)
}

function weatherLabel(code: number): string {
  if (code === 0) return LABELS.clearSky
  if ([1, 2].includes(code)) return LABELS.partlyCloudy
  if (code === 3) return LABELS.overcast
  if ([45, 48].includes(code)) return LABELS.foggy
  if ([51, 53, 55, 56, 57].includes(code)) return LABELS.drizzle
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return LABELS.rain
  if ([71, 73, 75, 77, 85, 86].includes(code)) return LABELS.snow
  if ([95, 96, 99].includes(code)) return LABELS.thunderstorm
  return LABELS.codeUnavailable
}

function CloudSunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path className="weather-card__sun-stroke" d="M12 2v2" />
      <path className="weather-card__sun-stroke" d="m4.93 4.93 1.41 1.41" />
      <path className="weather-card__sun-stroke" d="M20 12h2" />
      <path className="weather-card__sun-stroke" d="m19.07 4.93-1.41 1.41" />
      <path
        className="weather-card__sun-stroke"
        d="M15.947 12.65a4 4 0 0 0-5.925-4.128"
      />
      <path
        className="weather-card__cloud-stroke"
        d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"
      />
    </svg>
  )
}

function CloudMoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        className="weather-card__cloud-stroke"
        d="M13 16a3 3 0 0 1 0 6H7a5 5 0 1 1 4.9-6z"
      />
      <path
        className="weather-card__moon-stroke"
        d="M18.376 14.512a6 6 0 0 0 3.461-4.127c.148-.625-.659-.97-1.248-.714a4 4 0 0 1-5.259-5.26c.255-.589-.09-1.395-.716-1.248a6 6 0 0 0-4.594 5.36"
      />
    </svg>
  )
}

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  )
}

function CloudRainIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.5 16H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      <path d="M8 20v1" />
      <path d="M12 19v2" />
      <path d="M16 20v1" />
    </svg>
  )
}

function LightningCloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973" />
      <path d="m13 12-3 5h4l-3 5" />
    </svg>
  )
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        className="weather-card__moon-stroke"
        d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
      />
    </svg>
  )
}

function WeatherGlyph({
  code,
  time,
  large = false,
}: {
  code: number
  time?: string
  large?: boolean
}) {
  const className = large
    ? 'weather-card__icon weather-card__icon--large'
    : 'weather-card__glyph'
  const hour = Number(time?.slice(11, 13))
  const night = Number.isFinite(hour) && (hour < 6 || hour >= 19)
  if (code === 0) {
    return night ? (
      <MoonIcon className={className} />
    ) : (
      <svg
        className={`${className} weather-card__glyph--sunny`}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>
    )
  }
  if ([1, 2].includes(code)) {
    return night ? (
      <CloudMoonIcon className={className} />
    ) : (
      <CloudSunIcon className={className} />
    )
  }
  if ([95, 96, 99].includes(code))
    return <LightningCloudIcon className={className} />
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code))
    return <CloudRainIcon className={className} />
  return <CloudIcon className={className} />
}

function initialWeatherCollapsed(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(max-width: 720px)').matches
}

function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat('fr-FR', options).format(value)
}

export function WeatherCard({
  date,
  playheadUtcMs,
  location,
  onHourSelect,
  embedded = false,
}: WeatherCardProps) {
  const [collapsed, setCollapsed] = useState(() =>
    embedded ? false : initialWeatherCollapsed(),
  )
  const isCollapsed = embedded ? false : collapsed
  const [forecast, setForecast] = useState<WeatherForecast | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'ready'>(
    'idle',
  )

  useEffect(() => {
    let active = true
    if (!location || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setForecast(null)
      setState('idle')
      return () => {
        active = false
      }
    }
    setState('loading')
    fetchWeatherForecast({
      latitude: location.lat,
      longitude: location.lon,
      startDate: date,
      endDate: nextDate(date),
    })
      .then((data) => {
        if (active) {
          setForecast(data)
          setState('ready')
        }
      })
      .catch(() => {
        if (active) {
          setForecast(null)
          setState('error')
        }
      })
    return () => {
      active = false
    }
  }, [date, location?.lat, location?.lon])

  const liveCurrent = useMemo(() => {
    if (!forecast) return null
    const hour = selectWeatherHour(forecast, playheadUtcMs)
    return hour && isUsableWeatherHour(hour) ? hour : null
  }, [forecast, playheadUtcMs])
  const liveHours = useMemo(() => {
    if (!forecast || !liveCurrent) return []
    return forecast.hours.slice(
      forecast.hours.indexOf(liveCurrent),
      forecast.hours.indexOf(liveCurrent) + 6,
    )
  }, [forecast, liveCurrent])
  const frozenUiRef = useRef({ current: liveCurrent, hours: liveHours })
  if (!isCollapsed) {
    frozenUiRef.current = { current: liveCurrent, hours: liveHours }
  }
  const current = isCollapsed ? frozenUiRef.current.current : liveCurrent
  const hours = isCollapsed ? frozenUiRef.current.hours : liveHours
  const showUnavailable =
    state === 'error' || (state === 'ready' && forecast != null && !current)

  const dateTime = current
    ? `${current.time.slice(8, 10)} ${new Intl.DateTimeFormat('fr-FR', {
        month: 'short',
      })
        .format(new Date(`${current.time.slice(0, 10)}T12:00:00Z`))
        .toUpperCase()} · ${current.time.slice(11, 16)}`
    : date

  return (
    <section
      className={[
        'weather-card',
        isCollapsed ? 'weather-card--collapsed' : null,
        embedded ? 'weather-card--embedded' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={LABELS.aria}
    >
      {embedded ? null : (
        <button
          type="button"
          className="weather-card__header"
          aria-label={isCollapsed ? LABELS.expand : LABELS.collapse}
          aria-expanded={!isCollapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span className="weather-card__title">{LABELS.title}</span>
          <span className="weather-card__collapse" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="m6 15 6-6 6 6" />
            </svg>
          </span>
        </button>
      )}
      <div
        className={
          isCollapsed
            ? 'weather-card__content is-collapsed'
            : 'weather-card__content'
        }
        aria-hidden={isCollapsed}
      >
        <div className="weather-card__content-inner">
          <div className="weather-card__stack">
            {!location ? (
              <div className="weather-card__panel weather-card__message">
                {LABELS.needSpot}
              </div>
            ) : state === 'loading' ? (
              <div className="weather-card__panel weather-card__message">
                {LABELS.loading}
              </div>
            ) : showUnavailable ? (
              <div className="weather-card__panel weather-card__message">
                {LABELS.unavailable}
              </div>
            ) : current ? (
              <>
                <div className="weather-card__panel">
                  <div className="weather-card__summary-heading">
                    <span>{dateTime}</span>
                    <span className="weather-card__status">
                      {weatherLabel(current.weatherCode)}
                    </span>
                  </div>
                  <div className="weather-card__main-summary">
                    <div>
                      <div className="weather-card__coverline">
                        <strong>
                          {formatNumber(Math.round(current.cloudCover))}%
                        </strong>
                        <span>{LABELS.cloudCover}</span>
                      </div>
                      <div className="weather-card__description">
                        {formatNumber(Math.round(current.temperatureC))}°C ·{' '}
                        {LABELS.wind}{' '}
                        {formatNumber(Math.round(current.windSpeedKmh))} km/h
                      </div>
                    </div>
                    <WeatherGlyph
                      code={current.weatherCode}
                      time={current.time}
                      large
                    />
                  </div>
                </div>
                <div className="weather-card__panel">
                  <div className="weather-card__panel-heading">
                    <strong>{LABELS.cloudForecast}</strong>
                    <span>{LABELS.next6h}</span>
                  </div>
                  <div className="weather-card__forecast">
                    {hours.map((hour) => {
                      const active = hour === current
                      return (
                        <button
                          className={`weather-card__hour${active ? ' weather-card__hour--active' : ''}`}
                          type="button"
                          key={hour.time}
                          onClick={() =>
                            onHourSelect(
                              weatherHourToUtcMs(
                                hour,
                                forecast?.utcOffsetSeconds ?? 0,
                              ),
                              hour.time.slice(0, 10),
                            )
                          }
                        >
                          <span>{hour.time.slice(11, 13)}</span>
                          <WeatherGlyph
                            code={hour.weatherCode}
                            time={hour.time}
                          />
                          <span>
                            {formatNumber(Math.round(hour.cloudCover))}%
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="weather-card__panel">
                  <div className="weather-card__panel-heading">
                    <strong>{LABELS.cloudLayers}</strong>
                    <span>{LABELS.coverage}</span>
                  </div>
                  <div className="weather-card__layers">
                    {(
                      [
                        {
                          name: LABELS.high,
                          value: current.cloudCoverHigh,
                          color: 'var(--weather-layer-high)',
                        },
                        {
                          name: LABELS.mid,
                          value: current.cloudCoverMid,
                          color: 'var(--weather-layer-mid)',
                        },
                        {
                          name: LABELS.low,
                          value: current.cloudCoverLow,
                          color: 'var(--weather-layer-low)',
                        },
                      ] as const
                    ).map((layer) => (
                      <div className="weather-card__layer" key={layer.name}>
                        <span>{layer.name}</span>
                        <i>
                          <b
                            style={{
                              width: `${Math.max(0, Math.min(100, layer.value))}%`,
                              background: layer.color,
                            }}
                          />
                        </i>
                        <span>
                          {formatNumber(Math.round(layer.value))}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="weather-card__metrics">
                  <div>
                    <span>{LABELS.precipitation}</span>
                    <strong>
                      {current.precipitationMm > 0 ? (
                        <CloudRainIcon />
                      ) : (
                        <CloudIcon />
                      )}
                      {formatNumber(current.precipitationMm, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}{' '}
                      mm
                    </strong>
                  </div>
                  <div>
                    <span>{LABELS.visibility}</span>
                    <strong>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      {formatNumber(
                        Math.round(current.visibilityMeters / 1000),
                      )}{' '}
                      km
                    </strong>
                  </div>
                </div>
                <div className="weather-card__footer">
                  <span>{LABELS.footer}</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 11v5m0-8h.01" />
                  </svg>
                </div>
              </>
            ) : (
              <div className="weather-card__panel weather-card__message">
                {LABELS.empty}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
