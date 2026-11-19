import { describe, expect, it } from 'vitest'
import {
  PHI_INV,
  goldenTriangleFeet,
  nextCompositionGuideMode,
  normalizeCompositionGuideMode,
} from '../compositionGuides'

describe('compositionGuides', () => {
  it('cycles guide modes back to off', () => {
    let mode = nextCompositionGuideMode('off')
    expect(mode).toBe('thirds')
    mode = nextCompositionGuideMode(mode)
    expect(mode).toBe('phi')
    mode = nextCompositionGuideMode(mode)
    expect(mode).toBe('center')
    mode = nextCompositionGuideMode(mode)
    expect(mode).toBe('golden')
    mode = nextCompositionGuideMode(mode)
    expect(mode).toBe('off')
  })

  it('places Phi lines at golden-ratio cuts', () => {
    expect(PHI_INV).toBeCloseTo(0.618034, 5)
    expect(1 - PHI_INV).toBeCloseTo(0.381966, 5)
  })

  it('builds visually perpendicular golden-triangle feet', () => {
    const { fromTopLeft, fromBottomRight } = goldenTriangleFeet(3, 2)
    // Feet lie on the BL→TR diagonal: x/W + y/H = 1
    expect(fromTopLeft.x / 3 + fromTopLeft.y / 2).toBeCloseTo(1, 6)
    expect(fromBottomRight.x / 3 + fromBottomRight.y / 2).toBeCloseTo(1, 6)
    // TL→foot is along (H, W) = (2, 3)
    expect(fromTopLeft.y / fromTopLeft.x).toBeCloseTo(3 / 2, 6)
  })

  it('normalizes unknown values to off', () => {
    expect(normalizeCompositionGuideMode('thirds')).toBe('thirds')
    expect(normalizeCompositionGuideMode('nope')).toBe('off')
    expect(normalizeCompositionGuideMode(undefined)).toBe('off')
  })
})
