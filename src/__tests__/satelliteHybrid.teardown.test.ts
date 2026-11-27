import { describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { applyBasemapMode, waitForStyleLoaded } from '../satelliteHybrid'

/**
 * Minimal MapLibre stand-in. `style` flips to null the way `map.remove()` does
 * (`setStyle(null)` deletes `this.style`) before an awaited basemap apply resumes.
 */
function stubMap() {
  const listeners = new Map<string, Set<() => void>>()
  const map = {
    style: { loaded: () => true } as { loaded: () => boolean } | null,
    isStyleLoaded: vi.fn(function (this: { style: unknown }) {
      return this.style != null
    }),
    getStyle: vi.fn(function (this: { style: unknown }) {
      return this.style ? { layers: [], glyphs: undefined } : undefined
    }),
    getLayer: vi.fn(() => undefined),
    on(type: string, fn: () => void) {
      let set = listeners.get(type)
      if (!set) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(fn)
    },
    off(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn)
    },
    once(type: string, fn: () => void) {
      this.on(type, fn)
    },
  }
  map.isStyleLoaded.mockImplementation(() => map.style != null)
  map.getStyle.mockImplementation(() =>
    map.style ? { layers: [], glyphs: undefined } : undefined,
  )
  return map
}

describe('basemap apply after the map style is removed', () => {
  it('does not call isStyleLoaded once the style is gone', async () => {
    const map = stubMap()
    await expect(waitForStyleLoaded(map as unknown as MapLibreMap)).resolves.toBeUndefined()
    map.style = null
    map.isStyleLoaded.mockClear()
    await expect(waitForStyleLoaded(map as unknown as MapLibreMap)).resolves.toBeUndefined()
    expect(map.isStyleLoaded).not.toHaveBeenCalled()
  })

  it('returns without throwing when StrictMode removes the map mid-apply', async () => {
    const map = stubMap()
    const pending = applyBasemapMode(map as unknown as MapLibreMap, 'satellite')
    const callsAtYield = map.isStyleLoaded.mock.calls.length
    map.style = null
    await expect(pending).resolves.toBeUndefined()
    expect(map.isStyleLoaded.mock.calls.length).toBe(callsAtYield)
  })
})
