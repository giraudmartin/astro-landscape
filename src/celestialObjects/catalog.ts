import { SOLAR_SYSTEM_OBJECTS } from './solarSystem'
import type { CelestialObject } from './types'

type CatalogFile = 'stars.json' | 'constellations.json' | 'deep-sky.json'

let loadPromise: Promise<readonly CelestialObject[]> | null = null
let cachedCatalog: readonly CelestialObject[] | null = null

async function fetchCatalog(file: CatalogFile): Promise<CelestialObject[]> {
  const res = await fetch(`/catalogs/${file}`)
  if (!res.ok) {
    throw new Error(`Failed to load ${file}: ${res.status}`)
  }
  const data = (await res.json()) as CelestialObject[]
  return data
}

/**
 * Lazy-load remote JSON catalogs once, then merge with always-on solar-system
 * targets. Does not pull the full HYG / OpenNGC CSV at startup.
 */
export async function loadCelestialCatalog(): Promise<
  readonly CelestialObject[]
> {
  if (cachedCatalog) return cachedCatalog
  if (!loadPromise) {
    loadPromise = (async () => {
      const [stars, constellations, deepSky] = await Promise.all([
        fetchCatalog('stars.json'),
        fetchCatalog('constellations.json'),
        fetchCatalog('deep-sky.json'),
      ])
      const merged: CelestialObject[] = [
        ...SOLAR_SYSTEM_OBJECTS,
        ...constellations,
        ...deepSky,
        ...stars,
      ]
      cachedCatalog = merged
      return merged
    })().catch((err) => {
      loadPromise = null
      throw err
    })
  }
  return loadPromise
}

export function getCachedCelestialCatalog(): readonly CelestialObject[] | null {
  return cachedCatalog
}

/** Test / Node helper — inject a ready catalog without fetch. */
export function setCelestialCatalogForTests(
  catalog: readonly CelestialObject[] | null,
): void {
  cachedCatalog = catalog
  loadPromise = catalog ? Promise.resolve(catalog) : null
}
