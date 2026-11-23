import { describe, expect, it } from 'vitest'
import {
  panoramaCaptureDurationS,
  panoramaHeadRangeDeg,
  panoramaStepDeg,
} from '../panorama'

describe('panoramaHeadRangeDeg', () => {
  it('collapses to the framing centre for a 1×1 plan', () => {
    const range = panoramaHeadRangeDeg({
      centerYawDeg: 120,
      centerPitchDeg: 15,
      opticalHFovDeg: 40,
      opticalVFovDeg: 27,
      columns: 1,
      rows: 1,
      overlapPercent: 30,
    })
    expect(range.yawStartDeg).toBe(120)
    expect(range.yawEndDeg).toBe(120)
    expect(range.pitchStartDeg).toBe(15)
    expect(range.pitchEndDeg).toBe(15)
  })

  it('expands symmetrically for a multi-shot grid (Polaris start/end)', () => {
    const fovH = 40
    const fovV = 27
    const overlap = 40
    const columns = 6
    const rows = 2
    const centerYaw = 180
    const centerPitch = 10
    const stepYaw = panoramaStepDeg(fovH, overlap)
    const stepPitch = panoramaStepDeg(fovV, overlap)
    const midC = (columns - 1) / 2
    const midR = (rows - 1) / 2

    const range = panoramaHeadRangeDeg({
      centerYawDeg: centerYaw,
      centerPitchDeg: centerPitch,
      opticalHFovDeg: fovH,
      opticalVFovDeg: fovV,
      columns,
      rows,
      overlapPercent: overlap,
    })

    expect(range.yawStartDeg).toBeCloseTo(centerYaw - midC * stepYaw, 5)
    expect(range.yawEndDeg).toBeCloseTo(centerYaw + midC * stepYaw, 5)
    expect(range.pitchStartDeg).toBeCloseTo(centerPitch + midR * stepPitch, 5)
    expect(range.pitchEndDeg).toBeCloseTo(centerPitch - midR * stepPitch, 5)
  })

  it('wraps azimuth into [0, 360)', () => {
    const range = panoramaHeadRangeDeg({
      centerYawDeg: 10,
      centerPitchDeg: 0,
      opticalHFovDeg: 60,
      opticalVFovDeg: 40,
      columns: 5,
      rows: 1,
      overlapPercent: 30,
    })
    expect(range.yawStartDeg).toBeGreaterThanOrEqual(0)
    expect(range.yawStartDeg).toBeLessThan(360)
    expect(range.yawEndDeg).toBeGreaterThanOrEqual(0)
    expect(range.yawEndDeg).toBeLessThan(360)
    // Left of north → wraps below 0 into the high 300s.
    expect(range.yawStartDeg).toBeGreaterThan(270)
  })
})

describe('panoramaCaptureDurationS', () => {
  it('is just the pose for a single shot', () => {
    expect(panoramaCaptureDurationS(1, 20, 25)).toBe(20)
  })

  it('uses interval between starts then finishes the last pose', () => {
    // 12 shots, interval 25 s, pose 20 s → 11×25 + 20 = 295 s
    expect(panoramaCaptureDurationS(12, 20, 25)).toBe(295)
  })

  it('never uses an interval shorter than the pose', () => {
    expect(panoramaCaptureDurationS(3, 30, 10)).toBe(90)
  })
})
