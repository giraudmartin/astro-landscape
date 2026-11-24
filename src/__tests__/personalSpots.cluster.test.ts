import { describe, expect, it } from 'vitest'
import {
  clusterPersonalSpots,
  createPersonalSpot,
} from '../personalSpots'

describe('clusterPersonalSpots', () => {
  it('groups overlapping screen positions into one cluster with a count', () => {
    const a = createPersonalSpot({ name: 'A', lat: 48.86, lon: 2.29 })
    const b = createPersonalSpot({ name: 'B', lat: 48.8601, lon: 2.2901 })
    const c = createPersonalSpot({ name: 'C', lat: 48.87, lon: 2.3 })
    const byId: Record<string, { x: number; y: number }> = {
      [a.id]: { x: 100, y: 100 },
      [b.id]: { x: 110, y: 105 },
      [c.id]: { x: 400, y: 400 },
    }
    const items = clusterPersonalSpots(
      [a, b, c],
      ([lon, lat]) => {
        const spot = [a, b, c].find((s) => s.lon === lon && s.lat === lat)!
        return byId[spot.id]!
      },
      52,
    )
    expect(items).toHaveLength(2)
    const cluster = items.find((item) => item.kind === 'cluster')
    const leaf = items.find((item) => item.kind === 'leaf')
    expect(cluster?.kind).toBe('cluster')
    if (cluster?.kind === 'cluster') {
      expect(cluster.spots).toHaveLength(2)
      expect(cluster.spots.map((s) => s.id).sort()).toEqual(
        [a.id, b.id].sort(),
      )
    }
    expect(leaf?.kind).toBe('leaf')
    if (leaf?.kind === 'leaf') {
      expect(leaf.spot.id).toBe(c.id)
    }
  })

  it('chains near-neighbours into one cluster', () => {
    const a = createPersonalSpot({ name: 'A', lat: 48.86, lon: 2.29 })
    const b = createPersonalSpot({ name: 'B', lat: 48.8601, lon: 2.2901 })
    const c = createPersonalSpot({ name: 'C', lat: 48.8602, lon: 2.2902 })
    const byId: Record<string, { x: number; y: number }> = {
      [a.id]: { x: 0, y: 0 },
      [b.id]: { x: 40, y: 0 },
      [c.id]: { x: 80, y: 0 },
    }
    const items = clusterPersonalSpots(
      [a, b, c],
      ([lon, lat]) => {
        const spot = [a, b, c].find((s) => s.lon === lon && s.lat === lat)!
        return byId[spot.id]!
      },
      52,
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('cluster')
    if (items[0]?.kind === 'cluster') {
      expect(items[0].spots).toHaveLength(3)
    }
  })

  it('keeps isolated markers as leaves', () => {
    const a = createPersonalSpot({ name: 'A', lat: 48.86, lon: 2.29 })
    const b = createPersonalSpot({ name: 'B', lat: 48.87, lon: 2.3 })
    const items = clusterPersonalSpots(
      [a, b],
      ([lon]) => (lon === a.lon ? { x: 0, y: 0 } : { x: 200, y: 200 }),
      52,
    )
    expect(items.every((item) => item.kind === 'leaf')).toBe(true)
    expect(items).toHaveLength(2)
  })

  it('does not invent clusters for a single spot', () => {
    const a = createPersonalSpot({ name: 'Solo', lat: 48.86, lon: 2.29 })
    const items = clusterPersonalSpots([a], () => ({ x: 10, y: 10 }))
    expect(items).toEqual([{ kind: 'leaf', spot: a }])
  })
})
