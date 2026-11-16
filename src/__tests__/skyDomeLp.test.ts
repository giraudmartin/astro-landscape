import { describe, expect, it } from 'vitest'
import {
  createAstroSkyDome,
  estimateImmersiveLpGlow01,
  invertStereographicSt,
  LP_IMMERSIVE_GLOW_GAIN,
  LP_PROFILE_TEX_WIDTH,
  setLightPollutionProfile,
} from '../skyDome'

function disposeSky(sky: ReturnType<typeof createAstroSkyDome>): void {
  if (sky.lightPollutionMesh.geometry !== sky.geometry) {
    sky.lightPollutionMesh.geometry.dispose()
  }
  sky.lightPollutionMaterial.dispose()
  sky.zodiacalMaterial.dispose()
  sky.material.dispose()
  sky.geometry.dispose()
  sky.lightPollutionProfile.dispose()
}

describe('invertStereographicSt', () => {
  it('maps screen center (st=0) to look-axis −Z', () => {
    const [x, y, z] = invertStereographicSt(0, 0)
    expect(x).toBeCloseTo(0, 5)
    expect(y).toBeCloseTo(0, 5)
    expect(z).toBeCloseTo(-1, 5)
  })

  it('round-trips a forward Stellarium map', () => {
    const nx = 0.4
    const ny = -0.2
    const nz = -0.894427
    const h = 0.5 * (1 - nz)
    const [rx, ry, rz] = invertStereographicSt(nx / h, ny / h)
    expect(rx).toBeCloseTo(nx, 4)
    expect(ry).toBeCloseTo(ny, 4)
    expect(rz).toBeCloseTo(nz, 4)
  })
})

describe('LP shader wiring — post-frame fullscreen overlay', () => {
  it('uses clip-space quad + screen-ray, not sphere vDir', () => {
    const sky = createAstroSkyDome()
    const frag = sky.lightPollutionMaterial.fragmentShader
    const vert = sky.lightPollutionMaterial.vertexShader
    expect(vert).toContain('gl_Position = vec4(position.xy, 0.0, 1.0)')
    expect(vert).not.toContain('stelProject')
    expect(frag).toContain('lpDirFromScreen')
    expect(frag).toContain('uLpResolution')
    expect(frag).toContain('uLpNdcScale')
    expect(frag).toContain('uLpInvMv')
    expect(frag).not.toContain('vDir')
    expect(sky.lightPollutionMesh.geometry.type).toBe('PlaneGeometry')
    expect(sky.lightPollutionMaterial.depthTest).toBe(false)
    expect(sky._lpOverlay.scene.children).toContain(sky.lightPollutionMesh)
    disposeSky(sky)
  })
})

describe('setLightPollutionProfile', () => {
  it('keeps a directional mound (peak visible, not a wash)', () => {
    expect(LP_PROFILE_TEX_WIDTH).toBe(128)
    const sky = createAstroSkyDome()
    const spike = new Float32Array(64)
    spike[0] = 1
    spike[1] = 0.55
    spike[63] = 0.55
    setLightPollutionProfile(sky, spike, 0.08)
    const data = sky.lightPollutionProfile.image.data as Uint8Array
    expect(data.length).toBe(128 * 4)
    expect(data[0]!).toBeGreaterThan(200)
    expect(data[64 * 4]!).toBeLessThan(60)
    expect(data[0]! - data[64 * 4]!).toBeGreaterThan(100)
    disposeSky(sky)
  })
})

describe('estimateImmersiveLpGlow01 (must stay visible)', () => {
  it('produces clear sodium signal toward a Mer-scale city on the horizon', () => {
    expect(LP_IMMERSIVE_GLOW_GAIN).toBeGreaterThan(1.5)
    const towardCity = estimateImmersiveLpGlow01({
      amount: 1,
      bortle01: 0.375,
      peak01: 0.35,
      mean01: 0.12,
      city01: 1,
      elevN: 0.05,
      sunAltDeg: -20,
    })
    const zenith = estimateImmersiveLpGlow01({
      amount: 1,
      bortle01: 0.375,
      peak01: 0.35,
      mean01: 0.12,
      city01: 1,
      elevN: 0.95,
      sunAltDeg: -20,
    })
    expect(towardCity).toBeGreaterThan(0.15)
    expect(towardCity).toBeLessThan(1.2)
    expect(towardCity).toBeGreaterThan(zenith * 3)
  })

  it('stays off in daylight', () => {
    expect(
      estimateImmersiveLpGlow01({
        amount: 1,
        bortle01: 1,
        peak01: 1,
        mean01: 0.5,
        city01: 1,
        elevN: 0.05,
        sunAltDeg: 10,
      }),
    ).toBe(0)
  })
})
