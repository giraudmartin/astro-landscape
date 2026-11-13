import { describe, expect, it } from 'vitest'
import {
  STAR_MAG_TELE_DEFAULT,
  STAR_MAG_WIDE_DEFAULT,
  starMagLimitForFov,
} from '../starRevealSettings'

describe('starMagLimitForFov', () => {
  it('uses density as the primary mag limit at wide FOV', () => {
    expect(starMagLimitForFov(120, { depth: 0 })).toBeCloseTo(
      STAR_MAG_WIDE_DEFAULT,
      10,
    )
    expect(starMagLimitForFov(120, { depth: 2 })).toBeCloseTo(
      STAR_MAG_TELE_DEFAULT,
      10,
    )
    expect(starMagLimitForFov(120, { depth: 1 })).toBeCloseTo(
      (STAR_MAG_WIDE_DEFAULT + STAR_MAG_TELE_DEFAULT) * 0.5,
      10,
    )
  })

  it('always raises the limit when density increases at wide FOV', () => {
    const sparse = starMagLimitForFov(180, { depth: 0 })
    const mid = starMagLimitForFov(180, { depth: 1 })
    const dense = starMagLimitForFov(180, { depth: 2 })
    expect(mid).toBeGreaterThan(sparse)
    expect(dense).toBeGreaterThan(mid)
  })

  it('lets zoom reveal more when density is low and zoomSpan is on', () => {
    const wide = starMagLimitForFov(100, { depth: 0, zoomSpan: 1 })
    const tele = starMagLimitForFov(8, { depth: 0, zoomSpan: 1 })
    expect(tele).toBeGreaterThan(wide)
  })

  it('keeps a flat limit when zoomSpan is 0', () => {
    const wide = starMagLimitForFov(100, { depth: 0.8, zoomSpan: 0 })
    const tele = starMagLimitForFov(8, { depth: 0.8, zoomSpan: 0 })
    expect(wide).toBeCloseTo(tele, 10)
  })
})
