import { describe, expect, it } from 'vitest'
import {
  clampTimelapseIntervalS,
  formatTimelapseVideoSeconds,
  normalizeTimelapsePlan,
  SIDEREAL_DEG_PER_S,
  timelapseFieldRollDeg,
  timelapsePreviewFrameDelayMs,
  timelapseRuleOf500PoseS,
  timelapseShotCount,
  timelapseShotUtcMs,
  timelapseStarTrailArcRad,
  timelapseVideoSeconds,
} from '../timelapse'
import { parallacticAngleRad } from '../moonGlobe'
import {
  horizontalToJ2000,
  j2000ToHorizontal,
} from '../celestialObjects/position'

describe('timelapseShotCount / video', () => {
  it('matches the prototype defaults: 120 min / 25 s → 288 images, 11.5 s @ 25 fps', () => {
    const shots = timelapseShotCount(120, 25)
    expect(shots).toBe(288)
    expect(timelapseVideoSeconds(shots, 25)).toBeCloseTo(11.52, 5)
    expect(formatTimelapseVideoSeconds(11.52)).toBe('11.5 s')
  })

  it('keeps at least one image for a short window', () => {
    expect(timelapseShotCount(1, 3600)).toBe(1)
  })
})

describe('clampTimelapseIntervalS', () => {
  it('never drops below pose length', () => {
    expect(clampTimelapseIntervalS(10, 20)).toBe(20)
    expect(clampTimelapseIntervalS(30, 20)).toBe(30)
  })
})

describe('normalizeTimelapsePlan', () => {
  it('fills defaults for missing / garbage input', () => {
    const plan = normalizeTimelapsePlan({ poseS: 'nope', support: 'wormhole' })
    expect(plan.poseS).toBe(20)
    expect(plan.support).toBe('fixed')
    expect(plan.intervalS).toBeGreaterThanOrEqual(plan.poseS)
  })
})

describe('timelapsePreviewFrameDelayMs', () => {
  it('uses playback fps for short sequences', () => {
    expect(timelapsePreviewFrameDelayMs(25, 25)).toBeCloseTo(40, 5)
  })

  it('speeds up very long sequences to finish within ~20 s', () => {
    const delay = timelapsePreviewFrameDelayMs(2000, 25)
    expect(delay).toBeLessThan(1000 / 25)
    expect(delay * 2000).toBeCloseTo(20_000, 0)
  })
})

describe('timelapseShotUtcMs', () => {
  it('steps by interval seconds', () => {
    const t0 = Date.UTC(2024, 11, 15, 22, 0, 0)
    expect(timelapseShotUtcMs(t0, 25, 0)).toBe(t0)
    expect(timelapseShotUtcMs(t0, 25, 2)).toBe(t0 + 50_000)
  })
})

describe('horizontalToJ2000 (equatorial lock)', () => {
  it('round-trips Sirius look centre within ~0.3°', () => {
    const utcMs = Date.UTC(2024, 11, 15, 22, 0, 0)
    const lat = 48.8566
    const lon = 2.3522
    const elev = 35
    const raHours = 6.752481
    const decDeg = -16.716116
    const hor = j2000ToHorizontal(raHours, decDeg, lat, lon, elev, utcMs)
    const eq = horizontalToJ2000(
      hor.altitudeDeg,
      hor.azimuthDeg,
      lat,
      lon,
      elev,
      utcMs,
    )
    expect(Math.abs(eq.raHours - raHours)).toBeLessThan(0.02)
    expect(Math.abs(eq.decDeg - decDeg)).toBeLessThan(0.3)

    // Over 2 h, locked RA/Dec should drift in az/alt (mount tracking target).
    const later = utcMs + 2 * 3600 * 1000
    const moved = j2000ToHorizontal(
      eq.raHours,
      eq.decDeg,
      lat,
      lon,
      elev,
      later,
    )
    const dAz = Math.abs(
      ((((moved.azimuthDeg - hor.azimuthDeg) % 360) + 540) % 360) - 180,
    )
    expect(dAz).toBeGreaterThan(5)
  })
})

describe('timelapseFieldRollDeg (EQ field lock)', () => {
  it('is ~0 at t0 and grows as parallactic angle changes', () => {
    const utcMs = Date.UTC(2024, 11, 15, 20, 0, 0)
    const later = utcMs + 3 * 3600 * 1000
    const lat = 48.8566
    const lon = 2.3522
    const elev = 35
    const raHours = 6.752481
    const decDeg = -16.716116
    const a = j2000ToHorizontal(raHours, decDeg, lat, lon, elev, utcMs)
    const b = j2000ToHorizontal(raHours, decDeg, lat, lon, elev, later)
    const q0 = parallacticAngleRad(a.azimuthDeg, a.altitudeDeg, lat)
    const q1 = parallacticAngleRad(b.azimuthDeg, b.altitudeDeg, lat)
    expect(timelapseFieldRollDeg(q0, q0)).toBeCloseTo(0, 8)
    expect(Math.abs(timelapseFieldRollDeg(q0, q1))).toBeGreaterThan(5)
  })

  it('defaults eqRotation to scene', () => {
    expect(normalizeTimelapsePlan({}).eqRotation).toBe('scene')
  })
})

describe('timelapseStarTrailArcRad', () => {
  it('is 0 on equatorial mount', () => {
    expect(timelapseStarTrailArcRad(120, 'equatorial')).toBe(0)
  })

  it('matches sidereal rate on a fixed tripod (60 s → ~0.25°)', () => {
    const arcDeg = (timelapseStarTrailArcRad(60, 'fixed') * 180) / Math.PI
    expect(arcDeg).toBeCloseTo(60 * SIDEREAL_DEG_PER_S, 5)
    expect(arcDeg).toBeCloseTo(0.25, 2)
  })

  it('rule of 500 scales with focal length', () => {
    expect(timelapseRuleOf500PoseS(50)).toBe(10)
    expect(timelapseRuleOf500PoseS(24)).toBe(21)
  })
})
