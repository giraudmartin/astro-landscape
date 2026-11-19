import { describe, expect, it } from 'vitest'
import { opacityFromTrackClientY } from '../PlHeatmapControl'

const TRACK_H = 88
const PAD = 9

describe('opacityFromTrackClientY', () => {
  it('maps groove top to 100% and groove bottom to 15%', () => {
    expect(opacityFromTrackClientY(PAD, 0, TRACK_H)).toBeCloseTo(1, 5)
    expect(opacityFromTrackClientY(TRACK_H - PAD, 0, TRACK_H)).toBeCloseTo(
      0.15,
      5,
    )
  })

  it('maps groove midpoint to mid opacity (~57.5%)', () => {
    const mid = PAD + (TRACK_H - 2 * PAD) / 2
    expect(opacityFromTrackClientY(mid, 0, TRACK_H)).toBeCloseTo(
      0.15 + 0.5 * 0.85,
      5,
    )
  })

  it('clamps past the groove ends', () => {
    expect(opacityFromTrackClientY(-20, 0, TRACK_H)).toBe(1)
    expect(opacityFromTrackClientY(TRACK_H + 40, 0, TRACK_H)).toBe(0.15)
  })
})
