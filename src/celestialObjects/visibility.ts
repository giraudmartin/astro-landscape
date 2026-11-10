import {
  Body,
  Observer,
  SearchHourAngle,
  SearchRiseSet,
} from 'astronomy-engine'
import { civilClockFromUtc, civilDayStartUtcMs } from '../celestial'
import { objectAltitudeDegAt } from './position'
import {
  HORIZON_NOTE_FR,
  type CelestialObject,
  type HorizonCrossing,
  type ObjectDayVisibility,
  type VisibilityStatus,
} from './types'

const BODY_BY_ID: Record<string, Body> = {
  sun: Body.Sun,
  moon: Body.Moon,
  mercury: Body.Mercury,
  venus: Body.Venus,
  mars: Body.Mars,
  jupiter: Body.Jupiter,
  saturn: Body.Saturn,
  uranus: Body.Uranus,
  neptune: Body.Neptune,
}

function toCrossing(utcMs: number, lon: number): HorizonCrossing {
  return {
    datetimeUtc: new Date(utcMs).toISOString(),
    datetimeLocal: civilClockFromUtc(utcMs, lon).slice(0, 5),
  }
}

function inCivilDay(utcMs: number, dayStart: number, dayEnd: number): boolean {
  return utcMs >= dayStart && utcMs < dayEnd
}

function sampleDayAltitudes(
  object: CelestialObject,
  lat: number,
  lon: number,
  elevationM: number,
  dayStart: number,
  dayEnd: number,
  stepMs = 10 * 60_000,
): { t: number; alt: number }[] {
  const samples: { t: number; alt: number }[] = []
  for (let t = dayStart; t <= dayEnd; t += stepMs) {
    const alt = objectAltitudeDegAt(object, lat, lon, elevationM, t)
    if (alt == null) continue
    samples.push({ t, alt })
  }
  return samples
}

function refineZeroCrossing(
  object: CelestialObject,
  lat: number,
  lon: number,
  elevationM: number,
  t0: number,
  t1: number,
  rising: boolean,
): number | null {
  let lo = t0
  let hi = t1
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2
    const altMid = objectAltitudeDegAt(object, lat, lon, elevationM, mid)
    if (altMid == null) return null
    const preferHi = rising ? altMid < 0 : altMid > 0
    if (preferHi) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

function findCrossingsFromSamples(
  object: CelestialObject,
  lat: number,
  lon: number,
  elevationM: number,
  samples: { t: number; alt: number }[],
): { rises: number[]; sets: number[] } {
  const rises: number[] = []
  const sets: number[] = []
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1]!
    const b = samples[i]!
    if (a.alt < 0 && b.alt >= 0) {
      const t = refineZeroCrossing(
        object,
        lat,
        lon,
        elevationM,
        a.t,
        b.t,
        true,
      )
      if (t != null) rises.push(t)
    } else if (a.alt >= 0 && b.alt < 0) {
      const t = refineZeroCrossing(
        object,
        lat,
        lon,
        elevationM,
        a.t,
        b.t,
        false,
      )
      if (t != null) sets.push(t)
    }
  }
  return { rises, sets }
}

function culminationFromSamples(
  samples: { t: number; alt: number }[],
): number | null {
  if (!samples.length) return null
  let best = samples[0]!
  for (let i = 1; i < samples.length; i += 1) {
    const s = samples[i]!
    if (s.alt > best.alt) best = s
  }
  if (best.alt < 0) return null
  return best.t
}

function classifyFromSamples(
  samples: { t: number; alt: number }[],
): VisibilityStatus {
  if (samples.length < 3) return 'unknown'
  const minAlt = Math.min(...samples.map((s) => s.alt))
  const maxAlt = Math.max(...samples.map((s) => s.alt))
  if (minAlt >= 0) return 'circumpolar'
  if (maxAlt < 0) return 'never_rises'
  return 'rises_and_sets'
}

function fixedTargetVisibility(
  object: CelestialObject,
  date: string,
  lat: number,
  lon: number,
  elevationM: number,
): ObjectDayVisibility {
  const dayStart = civilDayStartUtcMs(date, lon)
  const dayEnd = dayStart + 24 * 3600_000
  const samples = sampleDayAltitudes(
    object,
    lat,
    lon,
    elevationM,
    dayStart,
    dayEnd,
  )
  if (samples.length < 3) {
    return {
      status: 'unknown',
      horizonNote: HORIZON_NOTE_FR,
      rise: null,
      set: null,
      culmination: null,
      multiplePassages: false,
    }
  }

  const status = classifyFromSamples(samples)
  const { rises, sets } = findCrossingsFromSamples(
    object,
    lat,
    lon,
    elevationM,
    samples,
  )
  const culMs = culminationFromSamples(samples)

  return {
    status,
    horizonNote: HORIZON_NOTE_FR,
    rise:
      status === 'rises_and_sets' && rises[0] != null
        ? toCrossing(rises[0], lon)
        : null,
    set:
      status === 'rises_and_sets' && sets[0] != null
        ? toCrossing(sets[0], lon)
        : null,
    culmination: culMs != null ? toCrossing(culMs, lon) : null,
    multiplePassages: rises.length > 1 || sets.length > 1,
  }
}

/**
 * Solar-system bodies keep Astronomy Engine SearchRiseSet conventions
 * already used for Sun/Moon in celestial.ts.
 */
function bodyVisibility(
  body: Body,
  bodyKey: string,
  date: string,
  lat: number,
  lon: number,
  elevationM: number,
): ObjectDayVisibility {
  const observer = new Observer(lat, lon, elevationM / 1000)
  const dayStart = civilDayStartUtcMs(date, lon)
  const dayEnd = dayStart + 24 * 3600_000
  const searchFrom = dayStart - 3 * 3600_000

  const riseEvent = SearchRiseSet(body, observer, +1, new Date(searchFrom), 1.2)
  const setEvent = SearchRiseSet(
    body,
    observer,
    -1,
    new Date(searchFrom + 2 * 3600_000),
    1.2,
  )

  const riseMs = riseEvent?.date.getTime() ?? null
  const setMs = setEvent?.date.getTime() ?? null

  let culMs: number | null = null
  try {
    const transit = SearchHourAngle(body, observer, 0, new Date(dayStart))
    const t = transit.time.date.getTime()
    if (inCivilDay(t, dayStart, dayEnd)) culMs = t
  } catch {
    culMs = null
  }

  const riseInDay =
    riseMs != null && inCivilDay(riseMs, dayStart, dayEnd) ? riseMs : null
  const setInDay =
    setMs != null && inCivilDay(setMs, dayStart, dayEnd) ? setMs : null

  let status: VisibilityStatus = 'rises_and_sets'
  if (riseInDay == null && setInDay == null) {
    const probe: CelestialObject = {
      id: `body:${bodyKey}`,
      name: bodyKey,
      aliases: [],
      catalogIds: { body: bodyKey },
      type: bodyKey === 'sun' ? 'sun' : bodyKey === 'moon' ? 'moon' : 'planet',
      raHours: null,
      decDeg: null,
      mag: null,
      constellation: null,
    }
    const samples = sampleDayAltitudes(
      probe,
      lat,
      lon,
      elevationM,
      dayStart,
      dayEnd,
      30 * 60_000,
    )
    status = classifyFromSamples(samples)
  }

  return {
    status,
    horizonNote: HORIZON_NOTE_FR,
    rise: riseInDay != null ? toCrossing(riseInDay, lon) : null,
    set: setInDay != null ? toCrossing(setInDay, lon) : null,
    culmination: culMs != null ? toCrossing(culMs, lon) : null,
    multiplePassages: false,
  }
}

export function computeDayVisibility(
  object: CelestialObject,
  date: string,
  lat: number,
  lon: number,
  elevationM: number,
): ObjectDayVisibility {
  if (object.catalogIds.body) {
    const body = BODY_BY_ID[object.catalogIds.body]
    if (!body) {
      return {
        status: 'unknown',
        horizonNote: HORIZON_NOTE_FR,
        rise: null,
        set: null,
        culmination: null,
        multiplePassages: false,
      }
    }
    return bodyVisibility(
      body,
      object.catalogIds.body,
      date,
      lat,
      lon,
      elevationM,
    )
  }
  if (object.raHours == null || object.decDeg == null) {
    return {
      status: 'unknown',
      horizonNote: HORIZON_NOTE_FR,
      rise: null,
      set: null,
      culmination: null,
      multiplePassages: false,
    }
  }
  return fixedTargetVisibility(object, date, lat, lon, elevationM)
}
