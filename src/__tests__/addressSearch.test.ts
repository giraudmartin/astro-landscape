import { describe, expect, it } from 'vitest'
import { sortByDistanceTo, type AddressSearchResult } from '../addressSearch'

const hit = (
  label: string,
  lat: number,
  lon: number,
): AddressSearchResult => ({
  label,
  lat,
  lon,
  bbox: null,
})

describe('sortByDistanceTo', () => {
  it('puts nearer hits first without dropping distant ones', () => {
    const near = { lat: 48.86, lon: 2.35 }
    const ranked = sortByDistanceTo(
      [
        hit('Dead Vlei, Namibia', -24.76, 15.29),
        hit('Paris', 48.86, 2.35),
        hit('Lyon', 45.75, 4.85),
      ],
      near,
    )
    expect(ranked.map((r) => r.label)).toEqual([
      'Paris',
      'Lyon',
      'Dead Vlei, Namibia',
    ])
  })
})
