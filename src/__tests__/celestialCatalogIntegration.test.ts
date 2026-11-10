import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SOLAR_SYSTEM_OBJECTS } from '../celestialObjects/solarSystem'
import {
  buildSearchIndex,
  searchCelestialObjects,
} from '../celestialObjects/search'
import type { CelestialObject } from '../celestialObjects/types'
import { buildObjectLiveInfo } from '../celestialObjects/liveInfo'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function loadJson(name: string): CelestialObject[] {
  const file = path.join(root, 'public', 'catalogs', name)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as CelestialObject[]
}

describe('built catalogs integration', () => {
  const catalog = [
    ...SOLAR_SYSTEM_OBJECTS,
    ...loadJson('constellations.json'),
    ...loadJson('deep-sky.json'),
    ...loadJson('stars.json'),
  ]
  const index = buildSearchIndex(catalog)

  it('searches key examples against the shipped catalogs', () => {
    expect(searchCelestialObjects(index, 'Orion')[0]?.object.type).toBe(
      'constellation',
    )
    expect(searchCelestialObjects(index, 'Betelgeuse')[0]?.object.name).toBe(
      'Betelgeuse',
    )
    expect(searchCelestialObjects(index, 'Bételgeuse')[0]?.object.name).toBe(
      'Betelgeuse',
    )
    expect(searchCelestialObjects(index, 'M42')[0]?.object.catalogIds.messier).toBe(
      42,
    )
    expect(searchCelestialObjects(index, 'M42')[0]?.object.type).toBe('nebula')
    const andromede = searchCelestialObjects(index, 'Andromède', 10).map(
      (h) => h.object.type,
    )
    expect(andromede).toContain('galaxy')
    expect(andromede).toContain('constellation')
    expect(searchCelestialObjects(index, 'Pléiades')[0]?.object.catalogIds.messier).toBe(
      45,
    )
    expect(
      searchCelestialObjects(index, 'North America')[0]?.object.catalogIds.ngc,
    ).toMatch(/NGC7000/i)
    expect(searchCelestialObjects(index, 'HIP 32349')[0]?.object.name).toBe(
      'Sirius',
    )
  })

  it('refreshes live info when the playhead moves without implying a camera move', () => {
    const sirius = catalog.find((o) => o.name === 'Sirius')!
    const a = buildObjectLiveInfo(
      sirius,
      '2024-12-15',
      Date.UTC(2024, 11, 15, 18, 0, 0),
      48.8566,
      2.3522,
      35,
    )
    const b = buildObjectLiveInfo(
      sirius,
      '2024-12-15',
      Date.UTC(2024, 11, 15, 22, 0, 0),
      48.8566,
      2.3522,
      35,
    )
    expect(a.position?.azimuthDeg).not.toBe(b.position?.azimuthDeg)
    // Same object identity — selection persists; caller decides whether to recenter.
    expect(a.object.id).toBe(b.object.id)
  })
})
