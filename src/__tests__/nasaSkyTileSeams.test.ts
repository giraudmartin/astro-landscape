import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { insetTileUVs } from '../nasaSkyTiles'

describe('nasa sky tile seam UV inset', () => {
  it('keeps UVs inside a half-texel margin', () => {
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1)
    insetTileUVs(geometry, 1024)
    const uv = geometry.getAttribute('uv')
    const inset = 0.5 / 1024
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(inset - 1e-9)
      expect(uv.getX(i)).toBeLessThanOrEqual(1 - inset + 1e-9)
      expect(uv.getY(i)).toBeGreaterThanOrEqual(inset - 1e-9)
      expect(uv.getY(i)).toBeLessThanOrEqual(1 - inset + 1e-9)
    }
    geometry.dispose()
  })
})
