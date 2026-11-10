import { describe, expect, it } from 'vitest'
import { normalizeSearchText } from '../celestialObjects/normalize'
import {
  buildSearchIndex,
  searchCelestialObjects,
} from '../celestialObjects/search'
import type { CelestialObject } from '../celestialObjects/types'

const FIXTURE: CelestialObject[] = [
  {
    id: 'hip:32349',
    name: 'Sirius',
    aliases: ['HIP 32349', 'HIP32349'],
    catalogIds: { hip: 32349 },
    type: 'star',
    raHours: 6.752481,
    decDeg: -16.716116,
    mag: -1.44,
    constellation: null,
  },
  {
    id: 'hip:27989',
    name: 'Betelgeuse',
    aliases: ['Bételgeuse', 'Betelgeuse', 'HIP 27989'],
    catalogIds: { hip: 27989 },
    type: 'star',
    raHours: 5.919529,
    decDeg: 7.407063,
    mag: 0.45,
    constellation: 'Ori',
  },
  {
    id: 'hip:11767',
    name: 'Polaris',
    aliases: ['Étoile polaire', 'Polaris', 'HIP 11767'],
    catalogIds: { hip: 11767 },
    type: 'star',
    raHours: 2.52975,
    decDeg: 89.264109,
    mag: 1.97,
    constellation: 'UMi',
  },
  {
    id: 'const:Orion',
    name: 'Orion',
    aliases: ['Orion'],
    catalogIds: { iau: 'Orion' },
    type: 'constellation',
    raHours: 5.5,
    decDeg: 0,
    mag: null,
    constellation: 'Orion',
  },
  {
    id: 'const:Andromeda',
    name: 'Andromède',
    aliases: ['Andromeda', 'Andromède'],
    catalogIds: { iau: 'Andromeda' },
    type: 'constellation',
    raHours: 1,
    decDeg: 38,
    mag: null,
    constellation: 'Andromeda',
  },
  {
    id: 'dso:M42',
    name: 'M42',
    aliases: ['Nébuleuse d’Orion', 'Orion Nebula', 'NGC1976', 'M 42'],
    catalogIds: { messier: 42, ngc: 'NGC1976' },
    type: 'nebula',
    raHours: 5.588,
    decDeg: -5.391,
    mag: 4.0,
    constellation: 'Ori',
  },
  {
    id: 'dso:M31',
    name: 'M31',
    aliases: ['Galaxie d’Andromède', 'Andromeda Galaxy', 'Andromède', 'NGC224'],
    catalogIds: { messier: 31, ngc: 'NGC224' },
    type: 'galaxy',
    raHours: 0.712,
    decDeg: 41.269,
    mag: 3.4,
    constellation: 'And',
  },
  {
    id: 'dso:M45',
    name: 'M45',
    aliases: ['Pléiades', 'Pleiades'],
    catalogIds: { messier: 45 },
    type: 'cluster',
    raHours: 3.791,
    decDeg: 24.105,
    mag: 1.6,
    constellation: 'Tau',
  },
  {
    id: 'dso:NGC7000',
    name: 'NGC7000',
    aliases: ['North America Nebula', 'North America', 'Nébuleuse North America'],
    catalogIds: { ngc: 'NGC7000' },
    type: 'nebula',
    raHours: 20.973,
    decDeg: 44.333,
    mag: null,
    constellation: 'Cyg',
  },
]

describe('normalizeSearchText', () => {
  it('folds accents and case', () => {
    expect(normalizeSearchText('Bételgeuse')).toBe('betelgeuse')
    expect(normalizeSearchText('Andromède')).toBe('andromede')
    expect(normalizeSearchText('Pléiades')).toBe('pleiades')
  })
})

describe('searchCelestialObjects', () => {
  const index = buildSearchIndex(FIXTURE)

  it('finds constellation Orion', () => {
    const hits = searchCelestialObjects(index, 'Orion')
    expect(hits[0]?.object.type).toBe('constellation')
    expect(hits[0]?.object.id).toBe('const:Orion')
  })

  it('finds Betelgeuse by English and accented French', () => {
    expect(searchCelestialObjects(index, 'Betelgeuse')[0]?.object.id).toBe(
      'hip:27989',
    )
    expect(searchCelestialObjects(index, 'Bételgeuse')[0]?.object.id).toBe(
      'hip:27989',
    )
  })

  it('finds M42 by Messier id', () => {
    const hits = searchCelestialObjects(index, 'M42')
    expect(hits[0]?.object.id).toBe('dso:M42')
  })

  it('finds Andromède as galaxy and constellation', () => {
    const hits = searchCelestialObjects(index, 'Andromède', 8)
    const ids = hits.map((h) => h.object.id)
    expect(ids).toContain('dso:M31')
    expect(ids).toContain('const:Andromeda')
  })

  it('finds Pleiades / Pléiades as M45', () => {
    expect(searchCelestialObjects(index, 'Pléiades')[0]?.object.id).toBe(
      'dso:M45',
    )
    expect(searchCelestialObjects(index, 'Pleiades')[0]?.object.id).toBe(
      'dso:M45',
    )
  })

  it('finds North America as NGC 7000', () => {
    expect(searchCelestialObjects(index, 'North America')[0]?.object.id).toBe(
      'dso:NGC7000',
    )
  })

  it('finds HIP identifiers', () => {
    expect(searchCelestialObjects(index, 'HIP 32349')[0]?.object.id).toBe(
      'hip:32349',
    )
    expect(searchCelestialObjects(index, 'hip32349')[0]?.object.id).toBe(
      'hip:32349',
    )
  })
})
