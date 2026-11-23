import { t } from '../i18n'

/** Shared celestial search / target types. */

export type CelestialObjectType =
  | 'star'
  | 'constellation'
  | 'nebula'
  | 'galaxy'
  | 'cluster'
  | 'dso'
  | 'planet'
  | 'sun'
  | 'moon'
  | 'galactic_center'

export type CatalogIds = {
  hip?: number
  messier?: number
  ngc?: string
  ic?: string
  iau?: string
  body?: string
}

export type CelestialObject = {
  id: string
  name: string
  aliases: string[]
  catalogIds: CatalogIds
  type: CelestialObjectType
  /** J2000 right ascension in sidereal hours (null for solar-system bodies). */
  raHours: number | null
  /** J2000 declination in degrees (null for solar-system bodies). */
  decDeg: number | null
  mag: number | null
  constellation: string | null
}

export type HorizontalPosition = {
  altitudeDeg: number
  azimuthDeg: number
}

export type VisibilityStatus =
  | 'rises_and_sets'
  | 'circumpolar'
  | 'never_rises'
  | 'unknown'

export type HorizonCrossing = {
  datetimeUtc: string
  datetimeLocal: string
}

export type ObjectDayVisibility = {
  status: VisibilityStatus
  /** Astronomical horizon (altitude 0°), not photographic clearance. */
  horizonNote: string
  rise: HorizonCrossing | null
  set: HorizonCrossing | null
  culmination: HorizonCrossing | null
  /** True when multiple rise/set pairs exist in the civil day (rare). */
  multiplePassages: boolean
}

export type ObjectLiveInfo = {
  object: CelestialObject
  position: HorizontalPosition | null
  visibility: ObjectDayVisibility
  constellationLabel: string | null
}

const TYPE_KEY: Record<CelestialObjectType, string> = {
  star: 'star',
  constellation: 'constellation',
  nebula: 'nebula',
  galaxy: 'galaxy',
  cluster: 'cluster',
  dso: 'dso',
  planet: 'planet',
  sun: 'sun',
  moon: 'moon',
  galactic_center: 'galacticCenter',
}

/** Localized label for an object type (call at render time). */
export function typeLabel(type: CelestialObjectType): string {
  return t(`celestial.type.${TYPE_KEY[type]}`)
}

/** Localized astronomical-horizon note (call at render time). */
export function horizonNote(): string {
  return t('celestial.horizonNote')
}

const BODY_KEY: Record<string, string> = {
  'body:sun': 'sun',
  'body:moon': 'moon',
  'body:mercury': 'mercury',
  'body:venus': 'venus',
  'body:mars': 'mars',
  'body:jupiter': 'jupiter',
  'body:saturn': 'saturn',
  'body:uranus': 'uranus',
  'body:neptune': 'neptune',
  'gc:sgr-a': 'galacticCenter',
}

/**
 * Localized display name (call at render time). Solar-system bodies and the
 * galactic center resolve via i18n; everything else uses the catalog name.
 */
export function celestialObjectDisplayName(object: CelestialObject): string {
  const key = BODY_KEY[object.id]
  return key ? t(`celestial.body.${key}`) : object.name
}
