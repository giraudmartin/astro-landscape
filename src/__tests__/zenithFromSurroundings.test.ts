import { describe, expect, it } from 'vitest'
import { bortleFromSkyBrightnessMag } from '../lightPollution/bortleFromRadiance'
import {
  FIRST_RIG_ALPHA_POWER,
  FIRST_RIG_ALPHA_SCALE,
  FIRST_RIG_NATURAL_MAG,
  FIRST_RIG_ZLR_DIVISOR,
  firstRigKernel,
  skyBrightnessMagFromSumS,
  skyBrightnessMagFromZlr,
  sumSFromRingSamples,
  zlrFromSumS,
} from '../lightPollution/duriscoeZenith'
import { viirsDnToRadianceNw } from '../lightPollution/sampleFromCog'

describe('firstRigKernel', () => {
  it('matches First Rig Table 1 weights at key distances', () => {
    // Table 1: weight at 1 km = 1; at 10 km ≈ 0.039; at 100 km ≈ 0.000089
    expect(firstRigKernel(1)).toBeCloseTo(1, 2)
    expect(firstRigKernel(10)).toBeCloseTo(0.039, 2)
    expect(firstRigKernel(100)).toBeCloseTo(0.000089, 5)
    expect(firstRigKernel(301)).toBe(0)
  })

  it('is steeper than Duriscoe all-sky at 100 km (zenith vs horizon)', async () => {
    const { allSkyKernel } = await import('../lightPollution/duriscoeZenith')
    expect(allSkyKernel(100)).toBeGreaterThan(firstRigKernel(100))
  })

  it('uses First Rig α constants (not Duriscoe all-sky 2.3/0.28)', () => {
    expect(FIRST_RIG_ALPHA_SCALE).toBeCloseTo(2.47, 5)
    expect(FIRST_RIG_ALPHA_POWER).toBeCloseTo(0.158, 5)
    expect(FIRST_RIG_ZLR_DIVISOR).toBeCloseTo(66.89, 5)
    expect(FIRST_RIG_NATURAL_MAG).toBeCloseTo(21.83, 5)
  })
})

describe('skyBrightnessMagFromZlr (First Rig Table 3)', () => {
  it('maps published ZLR anchors', () => {
    expect(skyBrightnessMagFromZlr(0)).toBeCloseTo(21.83, 2)
    expect(skyBrightnessMagFromZlr(0.1)).toBeCloseTo(21.74, 2)
    expect(skyBrightnessMagFromZlr(0.5)).toBeCloseTo(21.44, 2)
    expect(skyBrightnessMagFromZlr(1)).toBeCloseTo(21.16, 2)
    expect(skyBrightnessMagFromZlr(3)).toBeCloseTo(20.45, 2)
    expect(skyBrightnessMagFromZlr(10)).toBeCloseTo(19.38, 2)
    expect(skyBrightnessMagFromZlr(30)).toBeCloseTo(18.27, 2)
    expect(skyBrightnessMagFromZlr(100)).toBeCloseTo(16.99, 2)
  })

  it('never claims Bortle 1 at zero artificial light (natural 21.83)', () => {
    // Product Bortle table is LPM-compatible; 21.83 → class 3 there.
    // First Rig’s own table would say 2 — either way not 1.
    expect(bortleFromSkyBrightnessMag(skyBrightnessMagFromZlr(0))).toBeGreaterThanOrEqual(2)
  })
})

describe('sumSFromRingSamples', () => {
  it('raises S when a bright near ring is present', () => {
    const dark = sumSFromRingSamples([
      { distanceKm: 0, widthKm: 2, radiances: [0] },
      { distanceKm: 10, widthKm: 6, radiances: Array(16).fill(0) },
    ])
    const nearTown = sumSFromRingSamples([
      { distanceKm: 0, widthKm: 2, radiances: [0] },
      {
        distanceKm: 10,
        widthKm: 6,
        radiances: [8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    ])
    expect(nearTown).toBeGreaterThan(dark)
    expect(
      bortleFromSkyBrightnessMag(skyBrightnessMagFromSumS(nearTown)),
    ).toBeGreaterThan(1)
  })

  it('converts S → ZLR with the published divisor', () => {
    expect(zlrFromSumS(66.89)).toBeCloseTo(1, 5)
  })
})

describe('viirsDnToRadianceNw', () => {
  it('treats DN as nW and ignores a ×10 GeoTIFF Scale trap', () => {
    expect(viirsDnToRadianceNw(74)).toBe(74) // Paris-like core
    expect(viirsDnToRadianceNw(0)).toBe(0)
    expect(viirsDnToRadianceNw(-32768)).toBe(0)
  })
})
