import { describe, expect, it } from 'vitest'
import {
  EQUIRECT_VFOV_MAX_DEG,
  ORTHOGRAPHIC_VFOV_MAX_DEG,
  PERSPECTIVE_CAMERA_VFOV_MAX_DEG,
  RECTILINEAR_VFOV_MAX_DEG,
  STEREOGRAPHIC_VFOV_MAX_DEG,
} from './lensFov'
import {
  applyStageProjection,
  framedStageVfov,
  perspectiveFovDeg,
  setStageProjection,
  type StageProjection,
} from './stelProjector'

function fakeCamera() {
  return {
    fov: 72,
    userData: {} as Record<string, unknown>,
    updateProjectionMatrix() {},
  }
}

describe('stage FOV clamps', () => {
  const modes: Array<{
    id: StageProjection
    stageCap: number
  }> = [
    { id: 'stereographic', stageCap: STEREOGRAPHIC_VFOV_MAX_DEG },
    { id: 'rectilinear', stageCap: RECTILINEAR_VFOV_MAX_DEG },
    { id: 'equirectangular', stageCap: EQUIRECT_VFOV_MAX_DEG },
    { id: 'orthographic', stageCap: ORTHOGRAPHIC_VFOV_MAX_DEG },
  ]

  for (const { id, stageCap } of modes) {
    it(`${id}: dezoom 270° keeps PerspectiveCamera FOV sane`, () => {
      setStageProjection(id)
      const stage = framedStageVfov(270)
      const camFov = perspectiveFovDeg(270)
      const cam = fakeCamera()
      const returned = applyStageProjection(cam as never, 270)
      expect(stage).toBeLessThanOrEqual(stageCap)
      expect(returned).toBeLessThanOrEqual(stageCap)
      // Stereo frames wide stage with ~157° cam FOV; other modes stay ≤145°.
      const camCap = id === 'stereographic' ? 165 : PERSPECTIVE_CAMERA_VFOV_MAX_DEG
      expect(camFov).toBeLessThanOrEqual(camCap)
      expect(cam.fov).toBeLessThanOrEqual(camCap)
    })
  }

  it('stereographic: stage 270° is allowed, camera stays ~157°', () => {
    setStageProjection('stereographic')
    expect(framedStageVfov(270)).toBe(270)
    const camFov = perspectiveFovDeg(270)
    expect(camFov).toBeGreaterThan(150)
    expect(camFov).toBeLessThan(160)
  })

  it('telephoto zoom: stage FOV can reach 1° (fills ≤1200 mm frame)', () => {
    setStageProjection('stereographic')
    const cam = fakeCamera()
    expect(framedStageVfov(1)).toBe(1)
    expect(applyStageProjection(cam as never, 1)).toBe(1)
    expect(applyStageProjection(cam as never, 0.25)).toBe(1)
    expect(cam.fov).toBeCloseTo(perspectiveFovDeg(1), 5)
  })
})
