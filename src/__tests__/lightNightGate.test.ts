import { describe, expect, it } from 'vitest'
import { lightNightGate } from '../lightPollution/lightPollutionProtocol'
import { lightPollutionOpacity } from '../lightPollution/tiles'

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

  it('hides on ground during day', () => {
    expect(lightPollutionOpacity(0, 1)).toBe(0)
  })

  it('shows on ground at night', () => {
    expect(lightPollutionOpacity(1, 1)).toBeGreaterThan(0.5)
  })
})
