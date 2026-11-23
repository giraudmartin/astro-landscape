import { computeDayVisibility } from './visibility'
import { objectHorizontalAt } from './position'
import { getActiveLocale } from '../i18n'
import { constellationsEn } from '../i18n/locales/constellations.en'
import { constellationsFr } from '../i18n/locales/constellations.fr'
import type { CelestialObject, ObjectLiveInfo } from './types'

const CONSTELLATION_LABELS = {
  fr: constellationsFr,
  en: constellationsEn,
} as const

export function constellationLabel(
  code: string | null | undefined,
): string | null {
  if (!code) return null
  return CONSTELLATION_LABELS[getActiveLocale()][code] ?? code
}

export function buildObjectLiveInfo(
  object: CelestialObject,
  date: string,
  playheadUtcMs: number,
  lat: number,
  lon: number,
  elevationM: number,
): ObjectLiveInfo {
  const position = objectHorizontalAt(
    object,
    lat,
    lon,
    elevationM,
    playheadUtcMs,
  )
  const visibility = computeDayVisibility(
    object,
    date,
    lat,
    lon,
    elevationM,
  )
  return {
    object,
    position,
    visibility,
    constellationLabel: constellationLabel(object.constellation),
  }
}
