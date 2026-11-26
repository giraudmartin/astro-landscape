import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatPhotonLabel,
  parsePhotonFeatures,
  searchAddresses,
  sortByDistanceTo,
  type AddressSearchResult,
} from '../addressSearch'

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

describe('formatPhotonLabel', () => {
  it('joins address parts and drops consecutive duplicates', () => {
    expect(
      formatPhotonLabel({
        name: 'Berlin',
        city: 'Berlin',
        state: 'Berlin',
        country: 'Germany',
      }),
    ).toBe('Berlin, Germany')

    expect(
      formatPhotonLabel({
        name: 'Brandenburg Gate',
        housenumber: '1',
        street: 'Pariser Platz',
        postcode: '10117',
        city: 'Berlin',
        country: 'Germany',
      }),
    ).toBe('Brandenburg Gate, 1 Pariser Platz, 10117, Berlin, Germany')
  })
})

describe('parsePhotonFeatures', () => {
  it('maps GeoJSON features to AddressSearchResult with extent bbox', () => {
    const results = parsePhotonFeatures({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [13.39, 52.52] },
          properties: {
            name: 'Berlin',
            country: 'Germany',
            extent: [13.08, 52.67, 13.76, 52.33],
          },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [NaN, 1] },
          properties: { name: 'Bad' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {},
        },
      ],
    })

    expect(results).toEqual([
      {
        label: 'Berlin, Germany',
        lat: 52.52,
        lon: 13.39,
        bbox: [13.08, 52.33, 13.76, 52.67],
      },
    ])
  })
})

describe('searchAddresses', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('calls Photon with soft lat/lon bias and never hard bbox', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [15.29, -24.76] },
            properties: { name: 'Deadvlei', country: 'Namibia' },
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [2.35, 48.86] },
            properties: { name: 'Paris', country: 'France' },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const results = await searchAddresses('dea', {
      limit: 5,
      near: { lat: 48.86, lon: 2.35 },
      viewbox: [2.2, 48.7, 2.5, 49.0],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).toContain('https://photon.komoot.io/api/')
    expect(calledUrl).toContain('q=dea')
    expect(calledUrl).toContain('lat=48.86')
    expect(calledUrl).toContain('lon=2.35')
    expect(calledUrl).not.toContain('bbox=')
    expect(calledUrl).not.toContain('nominatim')

    // Client re-rank puts Paris first while keeping Deadvlei.
    expect(results.map((r) => r.label)).toEqual([
      'Paris, France',
      'Deadvlei, Namibia',
    ])
  })

  it('returns [] for short queries and throws on HTTP errors', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchAddresses('ab')).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValue({ ok: false, status: 429 })
    await expect(searchAddresses('paris')).rejects.toThrow(
      'Address search failed (429)',
    )
  })
})
