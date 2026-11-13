import { describe, expect, it } from 'vitest'
import { subsolarPoint, sunLightSpec } from '../globeSun'

describe('globe sun light', () => {
  it('anchors light to the map from the subsolar point only', () => {
    const utc = Date.UTC(2026, 10, 12, 18, 0, 0)
    const sub = subsolarPoint(utc)
    const light = sunLightSpec(sub, { intensity: 0.62, color: '#ffffff' })

    expect(light.anchor).toBe('map')
    expect(light.position?.[0]).toBe(1.5)
    expect(light['position-transition']).toEqual({ duration: 0, delay: 0 })

    // Same UTC → identical Earth-fixed light (pan/zoom must not rewrite this).
    const again = sunLightSpec(subsolarPoint(utc), {
      intensity: 0.62,
      color: '#ffffff',
    })
    expect(again.position).toEqual(light.position)
  })

  it('does not depend on a local map center', () => {
    const sub = { lon: -90, lat: -18 }
    const a = sunLightSpec(sub)
    const b = sunLightSpec(sub)
    expect(a.position).toEqual(b.position)
    expect(a.anchor).toBe('map')
  })
})
