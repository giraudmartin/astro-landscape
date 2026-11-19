import { expect, it } from 'vitest'
import { Group } from 'three'
import { installFrustumCullingControl, setFrustumCullingEnabled } from '../frustumCullingControl'

it('applies culling to existing, newly attached and reattached subtrees', () => {
  const scene = new Group()
  const branch = new Group()
  const tile = new Group()
  branch.add(tile)
  scene.add(branch)
  installFrustumCullingControl(scene)
  expect(tile.frustumCulled).toBe(false)
  setFrustumCullingEnabled(true)
  expect(tile.frustumCulled).toBe(true)
  scene.remove(branch)
  setFrustumCullingEnabled(false)
  scene.add(branch)
  const newTile = new Group()
  branch.add(newTile)
  expect(tile.frustumCulled).toBe(false)
  expect(newTile.frustumCulled).toBe(false)
})
