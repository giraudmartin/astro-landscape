import { describe, expect, it } from 'vitest'
import { lightNightGate } from '../lightPollution/lightPollutionProtocol'
import {
  LIGHT_POLLUTION_GLOBE_FADE_ZOOM,
  LIGHT_POLLUTION_LAYER_MAX_ZOOM,
  LIGHT_POLLUTION_OPACITY_MAX,
  lightPollutionOpacity,
  lightPollutionOpacityExpression,
} from '../lightPollution/tiles'

describe('lightNightGate', () => {
  it('is off on the day face', () => {
    expect(lightNightGate(20)).toBe(0)
    expect(lightNightGate(6)).toBe(0)
  })

  it('is full in deep night', () => {
    expect(lightNightGate(-15)).toBe(1)
  })
})

describe('lightPollutionOpacity', () => {
  it('stays on for globe even if local day', () => {
    expect(lightPollutionOpacity(0, 0)).toBeGreaterThan(0.5)
  })

  it('hides fully in ground/map framing (day or night)', () => {
    expect(lightPollutionOpacity(0, 1)).toBe(0)
    expect(lightPollutionOpacity(1, 1)).toBe(0)
  })

  it('fades out as zoom leaves the globe', () => {
    const globe = lightPollutionOpacity(1, 0)
    const mid = lightPollutionOpacity(1, 0.5)
    const ground = lightPollutionOpacity(1, 1)
    expect(mid).toBeGreaterThan(ground)
    expect(mid).toBeLessThan(globe)
    expect(mid).toBeCloseTo(globe * 0.5, 2)
  })
})

describe('lightPollutionOpacityExpression', () => {
  it('fades from globe peak to zero before spot fly mid-zooms', () => {
    expect(LIGHT_POLLUTION_LAYER_MAX_ZOOM).toBeLessThanOrEqual(6)
    expect(lightPollutionOpacityExpression()).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      LIGHT_POLLUTION_GLOBE_FADE_ZOOM,
      LIGHT_POLLUTION_OPACITY_MAX,
      LIGHT_POLLUTION_LAYER_MAX_ZOOM,
      0,
    ])
  })
})

describe('ground framing kills LP', () => {
  it('scalar opacity is 0 once groundView is full', () => {
    // Matches applyMapSky layout visibility gate (groundViewAmount >= 0.35).
    expect(lightPollutionOpacity(1, 0.35)).toBeCloseTo(
      LIGHT_POLLUTION_OPACITY_MAX * 0.65,
      2,
    )
    expect(lightPollutionOpacity(1, 1)).toBe(0)
  })
})
