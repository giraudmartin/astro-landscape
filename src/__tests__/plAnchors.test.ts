/**
 * Frozen scout anchors — catch PL regressions without scraping LPM.
 * Values are our model targets (±tolerance), not licences commercial data.
 */
import { describe, expect, it } from 'vitest'
import {
  FIRST_RIG_NATURAL_MAG,
  firstRigKernel,
  horizonDistanceWeight,
  skyBrightnessMagFromSumS,
  skyBrightnessMagFromZlr,
} from '../lightPollution/duriscoeZenith'
import {
  HORIZON_MAX_MAG_DROP,
  peakIntensity01,
} from '../lightPollution/horizonGlowProfile'
import { bortleFromSkyBrightnessMag } from '../lightPollution/bortleFromRadiance'

/** Documented site expectations (zenith First Rig + VIIRS, DEM optional). */
export const PL_SITE_ANCHORS = [
  {
    name: 'Mer de Glace',
    sqmMin: 21.15,
    sqmMax: 21.75,
    bortleMin: 3,
    bortleMax: 4,
    peakAzMin: 250,
    peakAzMax: 320,
    note: 'Alpine; DEM may darken toward LPM ~21.7',
  },
  {
    name: 'Paris centre',
    sqmMin: 17.6,
    sqmMax: 18.3,
    bortleMin: 8,
    bortleMax: 9,
    peakAzMin: 0,
    peakAzMax: 50,
    note: 'Mega-city',
  },
  {
    name: 'Spitzkoppe',
    sqmMin: 21.7,
    sqmMax: 21.85,
    bortleMin: 2,
    bortleMax: 3,
    note: 'Pristine — no fake dome',
  },
  {
    name: 'Mauna Kea',
    sqmMin: 21.7,
    sqmMax: 21.9,
    bortleMin: 2,
    bortleMax: 3,
    peakAzMin: 100,
    peakAzMax: 180,
    note: 'Pristine zenith; mid-range Hilo lobe on horizon',
  },
] as const

describe('PL formula anchors (non-regression)', () => {
  it('keeps First Rig natural floor and Table-3 ZLR=1', () => {
    expect(FIRST_RIG_NATURAL_MAG).toBeCloseTo(21.83, 5)
    expect(skyBrightnessMagFromZlr(1)).toBeCloseTo(21.16, 2)
  })

  it('keeps zenith kernel steeper than horizon at 100 km', () => {
    expect(horizonDistanceWeight(100)).toBeGreaterThan(firstRigKernel(100))
  })

  it('maps Mer-scale / Paris-scale dome intensity into sane drops', () => {
    const merDrop = HORIZON_MAX_MAG_DROP * peakIntensity01(9)
    const parisDrop = HORIZON_MAX_MAG_DROP * peakIntensity01(115)
    expect(merDrop).toBeGreaterThan(0.25)
    expect(merDrop).toBeLessThan(0.6)
    expect(parisDrop).toBeGreaterThan(1.0)
    expect(parisDrop).toBeLessThan(1.4)
  })

  it('maps synthetic S to Bortle bands used by the UI table', () => {
    expect(bortleFromSkyBrightnessMag(skyBrightnessMagFromSumS(0))).toBeGreaterThanOrEqual(2)
    expect(bortleFromSkyBrightnessMag(21.25)).toBe(4)
    expect(bortleFromSkyBrightnessMag(17.95)).toBe(8)
  })

  it('documents site windows for offline COG checks', () => {
    for (const a of PL_SITE_ANCHORS) {
      expect(a.sqmMax).toBeGreaterThan(a.sqmMin)
      expect(a.bortleMax).toBeGreaterThanOrEqual(a.bortleMin)
    }
  })
})
