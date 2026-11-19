import { expect, it } from 'vitest'
import { trajectorySegments } from '../skyBodies'
import { sampleMoonSkyPath } from '../skySamples'

it('keeps the November 19 lunar arcs separate across the hidden interval at Chamonix', () => {
  const samples = sampleMoonSkyPath({
    latitude: 45.9237,
    longitude: 6.8694,
    elevationMeters: 2466,
    startUtc: new Date('2026-11-18T23:00:00Z'),
    endUtc: new Date('2026-11-19T23:00:00Z'),
  })
  const segments = trajectorySegments(samples, 'moon')
  let breaks = 0
  for (let i = 0; i < segments.length; i += 2) {
    if (i && !segments[i]!.equals(segments[i - 1]!)) breaks++
    expect(segments[i]!.angleTo(segments[i + 1]!)).toBeLessThan(Math.PI / 180)
  }
  expect(breaks).toBe(1)
})
