import {
  Body,
  DefineStar,
  Equator,
  Horizon,
  Illumination,
  Observer,
  SearchRiseSet,
} from 'astronomy-engine'

export type LightingBand = 'night' | 'day' | 'near_sunset' | 'near_sunrise'

export type HorizonEvent = {
  datetimeUtc: string
  datetimeLocal: string
  lighting?: LightingBand
}

export type DayInfo = {
  date: string
  lat: number
  lon: number
  offsetHours: number
  illuminationPercent: number
  phaseLabel: string
  waxing: boolean
  sunrise: HorizonEvent | null
  sunset: HorizonEvent | null
  moonrise: HorizonEvent | null
  moonset: HorizonEvent | null
  /** Night length sunset → next sunrise (minutes). */
  nightMinutes: number
  /** Minutes the Moon is above the horizon during that night. */
  moonInNightMinutes: number
  /** Galactic center (Sgr A*) rise / set for the civil day. */
  galacticCenterRise: HorizonEvent | null
  galacticCenterSet: HorizonEvent | null
}

/** J2000 equatorial of the Galactic Center (Sgr A*). RA in sidereal hours. */
const GALACTIC_CENTER_RA_HOURS = 17 + 45 / 60 + 40.04 / 3600
const GALACTIC_CENTER_DEC_DEG = -29.0078

let galacticCenterDefined = false
function ensureGalacticCenterStar(): void {
  if (galacticCenterDefined) return
  DefineStar(
    Body.Star1,
    GALACTIC_CENTER_RA_HOURS,
    GALACTIC_CENTER_DEC_DEG,
    26_000,
  )
  galacticCenterDefined = true
}

export type CalendarDay = {
  date: string
  /** Lit fraction of the Moon at civil noon (0–100). */
  illuminationPercent: number
  /** Night length sunset → next sunrise (minutes). */
  nightMinutes: number
  /** Minutes the Moon is above the horizon during that night. */
  moonInNightMinutes: number
}

export type HorizonKind = 'sunrise' | 'sunset' | 'moonrise' | 'moonset'

/** Approximate civil offset from longitude (15° ≈ 1 h). */
export function offsetHoursFromLon(lon: number): number {
  return Math.max(-12, Math.min(14, Math.round(lon / 15)))
}

export function civilOffsetMs(lon: number): number {
  return offsetHoursFromLon(lon) * 3600_000
}

export function civilDateFromUtc(utcMs: number, lon: number): string {
  return new Date(utcMs + civilOffsetMs(lon)).toISOString().slice(0, 10)
}

export function civilClockFromUtc(utcMs: number, lon: number): string {
  return new Date(utcMs + civilOffsetMs(lon)).toISOString().slice(11, 19)
}

export function civilFractionFromUtc(utcMs: number, lon: number): number {
  const iso = new Date(utcMs + civilOffsetMs(lon)).toISOString()
  const h = Number(iso.slice(11, 13))
  const m = Number(iso.slice(14, 16))
  const s = Number(iso.slice(17, 19))
  return (h * 3600 + m * 60 + s) / 86400
}

/** Start of civil YYYY-MM-DD at observer lon, as UTC ms. */
export function civilDayStartUtcMs(date: string, lon: number): number {
  const [y, mo, d] = date.split('-').map(Number)
  const asIfUtc = Date.UTC(y!, mo! - 1, d!, 0, 0, 0)
  return asIfUtc - civilOffsetMs(lon)
}

export function shiftIsoDate(isoDate: string, deltaDays: number): string | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const next = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + deltaDays),
  )
  return next.toISOString().slice(0, 10)
}

export function sunAltitudeDegAt(
  lat: number,
  lon: number,
  elevationM: number,
  utcMs: number,
): number {
  return sunPositionAt(lat, lon, elevationM, utcMs).altitudeDeg
}

export function sunPositionAt(
  lat: number,
  lon: number,
  elevationM: number,
  utcMs: number,
): { altitudeDeg: number; azimuthDeg: number } {
  const observer = new Observer(lat, lon, elevationM / 1000)
  const at = new Date(utcMs)
  const eq = Equator(Body.Sun, at, observer, true, true)
  const horiz = Horizon(at, observer, eq.ra, eq.dec)
  return { altitudeDeg: horiz.altitude, azimuthDeg: horiz.azimuth }
}

function isMorningCivil(utcMs: number, lon: number): boolean {
  return civilFractionFromUtc(utcMs, lon) < 0.5
}

export function phaseLabelFromFraction(frac: number, waxing: boolean): string {
  if (frac < 0.03) return 'Nouvelle lune'
  if (frac < 0.22) return waxing ? 'Croissant' : 'Dernier croissant'
  if (frac < 0.28) return waxing ? 'Premier quartier' : 'Dernier quartier'
  if (frac < 0.47) return waxing ? 'Gibbeuse croissante' : 'Gibbeuse décroissante'
  if (frac < 0.53) return 'Pleine lune'
  if (frac < 0.72) return waxing ? 'Gibbeuse croissante' : 'Gibbeuse décroissante'
  if (frac < 0.78) return waxing ? 'Premier quartier' : 'Dernier quartier'
  if (frac < 0.97) return waxing ? 'Croissant' : 'Dernier croissant'
  return 'Nouvelle lune'
}

function lightingAt(
  lat: number,
  lon: number,
  elevationM: number,
  eventUtcMs: number,
  sunriseMs: number | null,
  sunsetMs: number | null,
): LightingBand {
  const sunAlt = sunAltitudeDegAt(lat, lon, elevationM, eventUtcMs)
  if (sunAlt > 0) return 'day'
  const nearMs = 45 * 60_000
  if (sunsetMs != null && Math.abs(eventUtcMs - sunsetMs) < nearMs) {
    return 'near_sunset'
  }
  if (sunriseMs != null && Math.abs(eventUtcMs - sunriseMs) < nearMs) {
    return 'near_sunrise'
  }
  return 'night'
}

function searchEvent(
  body: Body,
  observer: Observer,
  direction: 1 | -1,
  startUtcMs: number,
): Date | null {
  const found = SearchRiseSet(body, observer, direction, new Date(startUtcMs), 1.2)
  return found ? found.date : null
}

function toEvent(
  date: Date | null,
  lon: number,
  lighting?: LightingBand,
): HorizonEvent | null {
  if (!date) return null
  const utcMs = date.getTime()
  return {
    datetimeUtc: date.toISOString(),
    datetimeLocal: civilClockFromUtc(utcMs, lon).slice(0, 5),
    lighting,
  }
}

export function buildDayInfo(
  date: string,
  lat: number,
  lon: number,
  elevationM = 0,
): DayInfo {
  const observer = new Observer(lat, lon, elevationM / 1000)
  const dayStart = civilDayStartUtcMs(date, lon)
  // Search from slightly before civil midnight so overnight events are caught.
  const searchFrom = dayStart - 3 * 3600_000

  const sunriseDate = searchEvent(Body.Sun, observer, +1, searchFrom)
  const sunsetDate = searchEvent(Body.Sun, observer, -1, searchFrom + 6 * 3600_000)
  const moonriseDate = searchEvent(Body.Moon, observer, +1, searchFrom)
  const moonsetDate = searchEvent(Body.Moon, observer, -1, searchFrom + 2 * 3600_000)

  const sunriseMs = sunriseDate?.getTime() ?? null
  const sunsetMs = sunsetDate?.getTime() ?? null

  const noonUtc = dayStart + 12 * 3600_000
  const illum = Illumination(Body.Moon, new Date(noonUtc))
  const frac = illum.phase_fraction
  // phase_angle decreases while waxing roughly — use elongation proxy via next day
  const illumLater = Illumination(Body.Moon, new Date(noonUtc + 86400_000))
  const waxing = illumLater.phase_fraction >= frac || frac < 0.05

  const moonriseLighting =
    moonriseDate != null
      ? lightingAt(lat, lon, elevationM, moonriseDate.getTime(), sunriseMs, sunsetMs)
      : undefined
  const moonsetLighting =
    moonsetDate != null
      ? lightingAt(lat, lon, elevationM, moonsetDate.getTime(), sunriseMs, sunsetMs)
      : undefined

  ensureGalacticCenterStar()
  const gcRiseDate = searchEvent(Body.Star1, observer, +1, searchFrom)
  const gcSetDate = searchEvent(
    Body.Star1,
    observer,
    -1,
    searchFrom + 2 * 3600_000,
  )

  const nightStartMs = sunsetDate?.getTime() ?? NaN
  const nextSunriseDate =
    sunsetDate != null
      ? searchEvent(Body.Sun, observer, +1, sunsetDate.getTime() + 60_000)
      : null
  const night = moonInNightFromBounds(
    nightStartMs,
    nextSunriseDate?.getTime() ?? NaN,
    lat,
    lon,
    elevationM,
  )

  return {
    date,
    lat,
    lon,
    offsetHours: offsetHoursFromLon(lon),
    illuminationPercent: Math.round(frac * 100),
    phaseLabel: phaseLabelFromFraction(frac, waxing),
    waxing,
    sunrise: toEvent(sunriseDate, lon),
    sunset: toEvent(sunsetDate, lon),
    moonrise: toEvent(moonriseDate, lon, moonriseLighting),
    moonset: toEvent(moonsetDate, lon, moonsetLighting),
    nightMinutes: night.nightMinutes,
    moonInNightMinutes: night.moonInNightMinutes,
    galacticCenterRise: toEvent(gcRiseDate, lon),
    galacticCenterSet: toEvent(gcSetDate, lon),
  }
}

export type ScheduleKind = 'sunrise' | 'sunset' | 'moonrise' | 'moonset'

export type ScheduleRow = {
  kind: ScheduleKind
  datetimeLocal: string
  datetimeUtc: string
  label: string
}

const SCHEDULE_LABELS: Record<ScheduleKind, string> = {
  sunrise: 'Lever du soleil',
  sunset: 'Coucher du soleil',
  moonrise: 'Lever de Lune',
  moonset: 'Coucher de Lune',
}

/** Chronological day schedule for the Overview card (sun + moon only). */
export function buildDaySchedule(info: DayInfo): ScheduleRow[] {
  const rows: ScheduleRow[] = []
  const push = (
    kind: ScheduleKind,
    event: HorizonEvent | null,
  ): void => {
    if (!event) return
    rows.push({
      kind,
      datetimeLocal: event.datetimeLocal,
      datetimeUtc: event.datetimeUtc,
      label: SCHEDULE_LABELS[kind],
    })
  }
  push('sunrise', info.sunrise)
  push('sunset', info.sunset)
  push('moonrise', info.moonrise)
  push('moonset', info.moonset)
  rows.sort(
    (a, b) => Date.parse(a.datetimeUtc) - Date.parse(b.datetimeUtc),
  )
  return rows
}

/** Nearest schedule event to the playhead (for Overview row highlight). */
export function nearestScheduleKind(
  rows: ScheduleRow[],
  playheadUtcMs: number,
): ScheduleKind | null {
  if (!rows.length) return null
  let best = rows[0]!
  let bestDelta = Math.abs(Date.parse(best.datetimeUtc) - playheadUtcMs)
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]!
    const delta = Math.abs(Date.parse(row.datetimeUtc) - playheadUtcMs)
    if (delta < bestDelta) {
      best = row
      bestDelta = delta
    }
  }
  return best.kind
}

function moonAltitudeDegAt(
  lat: number,
  lon: number,
  elevationM: number,
  utcMs: number,
): number {
  const observer = new Observer(lat, lon, elevationM / 1000)
  const at = new Date(utcMs)
  const eq = Equator(Body.Moon, at, observer, true, true)
  const horiz = Horizon(at, observer, eq.ra, eq.dec)
  return horiz.altitude
}

/**
 * How long the Moon is up during civil night (sunset → next sunrise).
 * Coarse 15 min samples — calendar chips only.
 */
export function moonInNightFromBounds(
  nightStartUtcMs: number,
  nightEndUtcMs: number,
  lat: number,
  lon: number,
  elevationM = 0,
): { nightMinutes: number; moonInNightMinutes: number } {
  if (
    !Number.isFinite(nightStartUtcMs) ||
    !Number.isFinite(nightEndUtcMs) ||
    nightEndUtcMs <= nightStartUtcMs
  ) {
    return { nightMinutes: 0, moonInNightMinutes: 0 }
  }
  const nightMinutes = Math.round((nightEndUtcMs - nightStartUtcMs) / 60_000)
  const stepMs = 15 * 60_000
  let moonUp = 0
  for (let t = nightStartUtcMs; t < nightEndUtcMs; t += stepMs) {
    if (moonAltitudeDegAt(lat, lon, elevationM, t) > 0) moonUp += stepMs
  }
  return {
    nightMinutes,
    moonInNightMinutes: Math.round(moonUp / 60_000),
  }
}

export function buildMonthCalendar(
  year: number,
  month: number,
  lat: number,
  lon: number,
  elevationM = 0,
): CalendarDay[] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const infos: DayInfo[] = []
  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    infos.push(buildDayInfo(date, lat, lon, elevationM))
  }
  const nextMonthFirst = shiftMonth(year, month, 1)
  const nextFirstDate = `${nextMonthFirst.year}-${String(nextMonthFirst.month).padStart(2, '0')}-01`
  const nextFirstInfo = buildDayInfo(nextFirstDate, lat, lon, elevationM)

  const days: CalendarDay[] = []
  for (let i = 0; i < infos.length; i += 1) {
    const info = infos[i]!
    const nextSunrise =
      i + 1 < infos.length ? infos[i + 1]!.sunrise : nextFirstInfo.sunrise
    const nightStart = info.sunset ? Date.parse(info.sunset.datetimeUtc) : NaN
    const nightEnd = nextSunrise ? Date.parse(nextSunrise.datetimeUtc) : NaN
    const night = moonInNightFromBounds(
      nightStart,
      nightEnd,
      lat,
      lon,
      elevationM,
    )
    days.push({
      date: info.date,
      illuminationPercent: info.illuminationPercent,
      nightMinutes: night.nightMinutes,
      moonInNightMinutes: night.moonInNightMinutes,
    })
  }
  return days
}

/** Always 6 weeks (42 cells) so the calendar chrome never resizes. */
export function monthCalendarCells(
  year: number,
  month: number,
): Array<string | null> {
  const first = new Date(Date.UTC(year, month - 1, 1))
  // Mon=0 … Sun=6
  const weekday = (first.getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: Array<string | null> = []
  for (let i = 0; i < weekday; i += 1) cells.push(null)
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push(
      `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    )
  }
  while (cells.length < 42) cells.push(null)
  return cells.slice(0, 42)
}

/** Format minutes as compact `4h30` / `45m`. */
export function formatDurationMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (rem === 0) return `${h}h`
  return `${h}h${String(rem).padStart(2, '0')}`
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

export function isMorningAt(utcMs: number, lon: number): boolean {
  return isMorningCivil(utcMs, lon)
}

export function lightingSlug(band: LightingBand): string {
  if (band === 'near_sunset') return 'near-sunset'
  if (band === 'near_sunrise') return 'near-sunrise'
  return band
}
