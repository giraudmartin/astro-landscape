import { describe, expect, it } from 'vitest'
import {
  spreadMarginForZoom,
  spreadRadianceForMapOverlay,
} from '../lightPollution/plMapOverlayGlow'

describe('spreadRadianceForMapOverlay', () => {
  it('fills zeros near a dim source without diluting a bright core', () => {
    const w = 32
    const h = 32
    const field = new Float32Array(w * h)
    field[16 * w + 16] = 80 // Paris-like core
    field[8 * w + 8] = 2 // village

    const out = spreadRadianceForMapOverlay(field, w, h, 7)
    expect(out[16 * w + 16]!).toBe(80)
    // Neighbour of village should pick up blue-range spill
    expect(out[8 * w + 10]!).toBeGreaterThan(0.12)
    expect(out[8 * w + 10]!).toBeLessThan(8)
  })

  it('extends warm orange/red around cities, not only blue/green', () => {
    const w = 48
    const h = 48
    const field = new Float32Array(w * h)
    field[24 * w + 24] = 80 // city core

    const out = spreadRadianceForMapOverlay(field, w, h, 6)
    expect(out[24 * w + 24]!).toBe(80)
    // Near-ring should land in orange/red radiance, not just ≤8 green
    const ring = out[24 * w + 27]!
    expect(ring).toBeGreaterThan(12)
    expect(ring).toBeLessThanOrEqual(48)
  })

  it('adjacent tiles with geographic halo match at the shared edge', () => {
    const zoom = 8
    const work = 32
    const margin = spreadMarginForZoom(zoom)
    const big = work + margin * 2
    // Shared source: bright city straddling the vertical tile boundary.
    const worldW = work * 2
    const worldH = work
    const world = new Float32Array(worldW * worldH)
    world[16 * worldW + (work - 1)] = 40
    world[16 * worldW + work] = 40

    const left = new Float32Array(big * big)
    const right = new Float32Array(big * big)
    for (let py = 0; py < big; py += 1) {
      const wy = Math.min(worldH - 1, Math.max(0, py - margin))
      for (let px = 0; px < big; px += 1) {
        const lx = px - margin
        const rx = work + (px - margin)
        left[py * big + px] =
          world[wy * worldW + Math.min(worldW - 1, Math.max(0, lx))]!
        right[py * big + px] =
          world[wy * worldW + Math.min(worldW - 1, Math.max(0, rx))]!
      }
    }

    const leftOut = spreadRadianceForMapOverlay(left, big, big, zoom)
    const rightOut = spreadRadianceForMapOverlay(right, big, big, zoom)

    for (let py = 0; py < work; py += 1) {
      const ly = py + margin
      const leftEdge = leftOut[ly * big + (margin + work - 1)]!
      const rightEdge = rightOut[ly * big + margin]!
      expect(Math.abs(leftEdge - rightEdge)).toBeLessThan(1e-3)
    }
  })
})
