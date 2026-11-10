export type {
  CelestialObject,
  CelestialObjectType,
  HorizontalPosition,
  ObjectDayVisibility,
  ObjectLiveInfo,
  VisibilityStatus,
} from './types'
export { HORIZON_NOTE_FR, TYPE_LABEL_FR } from './types'
export { normalizeSearchText, compactCatalogToken } from './normalize'
export {
  loadCelestialCatalog,
  getCachedCelestialCatalog,
  setCelestialCatalogForTests,
} from './catalog'
export { buildSearchIndex, searchCelestialObjects, type SearchHit } from './search'
export { objectHorizontalAt, j2000ToHorizontal, bodyToHorizontal } from './position'
export { computeDayVisibility } from './visibility'
export { SOLAR_SYSTEM_OBJECTS } from './solarSystem'
export { buildObjectLiveInfo } from './liveInfo'
