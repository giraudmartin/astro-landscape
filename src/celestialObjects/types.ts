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

export const TYPE_LABEL_FR: Record<CelestialObjectType, string> = {
  star: 'Étoile',
  constellation: 'Constellation',
  nebula: 'Nébuleuse',
  galaxy: 'Galaxie',
  cluster: 'Amas',
  dso: 'Objet du ciel profond',
  planet: 'Planète',
  sun: 'Soleil',
  moon: 'Lune',
  galactic_center: 'Centre galactique',
}

export const HORIZON_NOTE_FR =
  'Horaires au franchissement de l’horizon astronomique (altitude 0°). Le relief et les obstacles peuvent masquer l’objet plus tôt ou plus tard.'
