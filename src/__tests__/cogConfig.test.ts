import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isAllowedLightPollutionCogUrl,
  lightPollutionCogUrl,
} from '../lightPollution/cogConfig'

describe('isAllowedLightPollutionCogUrl', () => {
  it('accepts same-origin absolute paths', () => {
    expect(
      isAllowedLightPollutionCogUrl('/light-pollution/viirs-vnl-2024-500m.cog.tif'),
    ).toBe(true)
  })

  it('rejects protocol-relative and non-https URLs', () => {
    expect(isAllowedLightPollutionCogUrl('//evil.example/x.tif')).toBe(false)
    expect(isAllowedLightPollutionCogUrl('http://sphere.sadr3d.com/x.tif')).toBe(
      false,
    )
    expect(isAllowedLightPollutionCogUrl('javascript:alert(1)')).toBe(false)
  })

  it('accepts https on product / local hosts only', () => {
    expect(
      isAllowedLightPollutionCogUrl(
        'https://sphere.sadr3d.com/light-pollution/viirs.cog.tif',
      ),
    ).toBe(true)
    expect(
      isAllowedLightPollutionCogUrl('https://preview.sadr3d.com/cog.tif'),
    ).toBe(true)
    expect(isAllowedLightPollutionCogUrl('https://localhost/cog.tif')).toBe(true)
    expect(isAllowedLightPollutionCogUrl('https://evil.example/cog.tif')).toBe(
      false,
    )
  })
})

describe('lightPollutionCogUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses allowlisted env override', () => {
    vi.stubEnv(
      'VITE_LIGHT_POLLUTION_COG_URL',
      '/light-pollution/custom.cog.tif',
    )
    expect(lightPollutionCogUrl()).toBe('/light-pollution/custom.cog.tif')
  })

  it('ignores disallowed env override and falls back to default', () => {
    vi.stubEnv(
      'VITE_LIGHT_POLLUTION_COG_URL',
      'https://evil.example/steal.tif',
    )
    expect(lightPollutionCogUrl()).toBe(
      '/light-pollution/viirs-vnl-2024-500m.cog.tif',
    )
  })
})
