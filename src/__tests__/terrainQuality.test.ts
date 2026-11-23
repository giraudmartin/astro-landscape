import { describe, expect, it } from 'vitest'
import {
  getApproxTerrainDownloadMb,
  TERRAIN_DOWNLOAD_DEFAULT_MB,
} from '../terrainDownloadEstimate'
import {
  getTerrainQualityPreset,
  isSlowNetworkConnection,
  normalizeTerrainQuality,
  shouldPromptTerrainQuality,
} from '../terrainQuality'

describe('normalizeTerrainQuality', () => {
  it('keeps known ids and falls back to high', () => {
    expect(normalizeTerrainQuality('standard')).toBe('standard')
    expect(normalizeTerrainQuality('medium')).toBe('medium')
    expect(normalizeTerrainQuality('nope')).toBe('high')
  })
})

describe('getTerrainQualityPreset', () => {
  it('drops detail layers from high to low', () => {
    expect(getTerrainQualityPreset('standard').loadUltraNear).toBe(false)
    expect(getTerrainQualityPreset('standard').loadDetailWide).toBe(true)
    expect(getTerrainQualityPreset('standard').loadDetailMid).toBe(true)
    expect(getTerrainQualityPreset('standard').useHighDetailBake).toBe(false)
    expect(getTerrainQualityPreset('standard').farRings).toBe('full')
    expect(getTerrainQualityPreset('standard').demZoomOffset).toBe(0)
    expect(getTerrainQualityPreset('standard').imageryZoomOffset).toBe(1)
    expect(getTerrainQualityPreset('standard').imageryMaxZoom).toBe(15)
    expect(getTerrainQualityPreset('low').loadUltraNear).toBe(false)
    expect(getTerrainQualityPreset('low').loadDetailMid).toBe(false)
    expect(getTerrainQualityPreset('medium').loadDetailWide).toBe(false)
    expect(getTerrainQualityPreset('high').farRings).toBe('full')
    expect(getTerrainQualityPreset('high').useHighDetailBake).toBe(true)
  })
})

describe('getApproxTerrainDownloadMb', () => {
  it('keeps multi-site cold-load averages ordered high > medium > low', () => {
    expect(TERRAIN_DOWNLOAD_DEFAULT_MB).toEqual({
      high: 220,
      standard: 110,
      medium: 40,
      low: 15,
    })
    expect(getApproxTerrainDownloadMb('high')).toBe(220)
    expect(getApproxTerrainDownloadMb('standard')).toBe(110)
    expect(getApproxTerrainDownloadMb('medium')).toBe(40)
    expect(getApproxTerrainDownloadMb('low')).toBe(15)
    expect(getApproxTerrainDownloadMb('high')).toBeGreaterThan(
      getApproxTerrainDownloadMb('standard'),
    )
    expect(getApproxTerrainDownloadMb('standard')).toBeGreaterThan(
      getApproxTerrainDownloadMb('medium'),
    )
    expect(getApproxTerrainDownloadMb('medium')).toBeGreaterThan(
      getApproxTerrainDownloadMb('low'),
    )
  })
})

describe('isSlowNetworkConnection', () => {
  it('flags save-data and slow effective types', () => {
    expect(isSlowNetworkConnection({ saveData: true })).toBe(true)
    expect(isSlowNetworkConnection({ effectiveType: '3g' })).toBe(true)
    expect(isSlowNetworkConnection({ effectiveType: '4g', downlink: 10 })).toBe(
      false,
    )
    expect(isSlowNetworkConnection({ downlink: 0.8 })).toBe(true)
    expect(isSlowNetworkConnection(null)).toBe(false)
  })
})

describe('shouldPromptTerrainQuality', () => {
  it('prompts only when unchosen and slow', () => {
    expect(
      shouldPromptTerrainQuality({
        chosen: false,
        connection: { effectiveType: '3g' },
      }),
    ).toBe(true)
    expect(
      shouldPromptTerrainQuality({
        chosen: true,
        connection: { effectiveType: '3g' },
      }),
    ).toBe(false)
    expect(
      shouldPromptTerrainQuality({
        chosen: false,
        flatTerrain: true,
        connection: { effectiveType: '3g' },
      }),
    ).toBe(false)
    expect(
      shouldPromptTerrainQuality({
        chosen: false,
        connection: { effectiveType: '4g', downlink: 20 },
      }),
    ).toBe(false)
  })
})
