import { describe, expect, it } from 'vitest'
import {
  civilClockFromUtc,
  civilDateFromUtc,
  civilDayStartUtcMs,
} from '../celestial'

describe('timeline clock reference (UTC sans spot / locale au spot)', () => {
  it('lon 0 is true UTC clock and day', () => {
    const utcMs = Date.UTC(2026, 10, 12, 18, 30, 0)
    expect(civilClockFromUtc(utcMs, 0)).toBe('18:30:00')
    expect(civilDateFromUtc(utcMs, 0)).toBe('2026-11-12')
    expect(civilDayStartUtcMs('2026-11-12', 0)).toBe(Date.UTC(2026, 10, 12, 0, 0, 0))
  })

  it('keeping the UTC instant only changes the civil label at a new lon', () => {
    const utcMs = Date.UTC(2026, 10, 12, 18, 0, 0)
    // ~UTC+9 (135°)
    const spotLon = 135
    expect(civilClockFromUtc(utcMs, spotLon)).toBe('03:00:00')
    expect(civilDateFromUtc(utcMs, spotLon)).toBe('2026-11-13')
    const dayStart = civilDayStartUtcMs(civilDateFromUtc(utcMs, spotLon), spotLon)
    expect(utcMs).toBeGreaterThanOrEqual(dayStart)
    expect(utcMs).toBeLessThan(dayStart + 24 * 3600_000)
  })

  it('scrubbing past civil midnight advances the civil date (PS unbounded timeline)', () => {
    const lon = 0
    const justBefore = civilDayStartUtcMs('2026-11-13', lon) - 60_000
    const justAfter = civilDayStartUtcMs('2026-11-13', lon) + 60_000
    expect(civilDateFromUtc(justBefore, lon)).toBe('2026-11-12')
    expect(civilDateFromUtc(justAfter, lon)).toBe('2026-11-13')
    expect(civilClockFromUtc(justAfter, lon)).toBe('00:01:00')
  })
})
