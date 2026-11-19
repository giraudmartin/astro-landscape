import { expect, it, vi } from 'vitest'
import { LineSegments, PerspectiveCamera } from 'three'
import { createSkyBodies } from '../skyBodies'

vi.mock('../celestialRender', async importOriginal => ({
  ...await importOriginal<typeof import('../celestialRender')>(),
  cloneMoonTopoModel: () => new Promise(() => {}),
}))

it('shows the exact paths immediately when revisiting dates and switching sites', () => {
  const camera = new PerspectiveCamera()
  const start = Date.UTC(2026, 10, 19, 12)
  const live = createSkyBodies()
  try {
    for (const [day, lat] of [[0, 28], [1, 28], [0, 28], [0, 37], [0, 28]] as const) {
      const frame = { utcMs: start + day * 86400000, lat, lon: -17, elevationM: 1200, camera }
      const fresh = createSkyBodies()
      try {
        live.update(frame)
        fresh.update(frame)
        for (const name of ['solarTrajectory', 'lunarTrajectory']) {
          const actual = live.root.getObjectByName(name) as LineSegments
          const expected = fresh.root.getObjectByName(name) as LineSegments
          expect(actual.visible).toBe(expected.visible)
          expect(actual.geometry.getAttribute('position').array)
            .toEqual(expected.geometry.getAttribute('position').array)
        }
      } finally {
        fresh.dispose()
      }
    }
  } finally {
    live.dispose()
  }
})
