/**
 * Pano overlay under Stéréo / Équi / Recti: clipped edge samples must still
 * project (no silent nulls → unfinished white strokes), and equirect must
 * detect ±180° seam wraps without treating dense edges as wraps.
 */
import { describe, expect, it } from 'vitest'
import {
  getStageProjection,
  setStageProjection,
  stelProjectEye,
  type StageProjection,
} from '../stelProjector'

type EyePt = { x: number; y: number; z: number }
type Pt2 = { x: number; y: number }

function nearClipMinZ(mode: StageProjection): number {
  if (mode === 'rectilinear') return 1e-3
  if (mode === 'equirectangular') return Number.NEGATIVE_INFINITY
  return -1 + 4e-4
}

function eyeToScreen(
  p: EyePt,
  stageW: number,
  stageH: number,
  vfov: number,
): Pt2 | null {
  const aspect = stageW / Math.max(stageH, 1e-6)
  const ndc = stelProjectEye(p, vfov, aspect)
  if (!ndc || !Number.isFinite(ndc.ndcX) || !Number.isFinite(ndc.ndcY)) {
    return null
  }
  return {
    x: ((ndc.ndcX + 1) / 2) * stageW,
    y: ((1 - ndc.ndcY) / 2) * stageH,
  }
}

function isFarOffstage(p: Pt2, stageW: number, stageH: number, margin = 0.6) {
  return (
    p.x < -stageW * margin ||
    p.x > stageW * (1 + margin) ||
    p.y < -stageH * margin ||
    p.y > stageH * (1 + margin)
  )
}

function segmentIsProjectionWrap(
  a: Pt2,
  b: Pt2,
  stageW: number,
  stageH: number,
  mode: StageProjection,
): boolean {
  const span = Math.max(stageW, stageH, 48)
  const len = Math.hypot(a.x - b.x, a.y - b.y)
  if (
    mode === 'equirectangular' &&
    Math.abs(a.x - b.x) > stageW * 0.45 &&
    len > span * 0.4
  ) {
    return true
  }
  if (!isFarOffstage(a, stageW, stageH) || !isFarOffstage(b, stageW, stageH)) {
    return false
  }
  if (len < span * 0.8) return false
  const midX = stageW * 0.5
  const midY = stageH * 0.5
  const crossX =
    (a.x - midX) * (b.x - midX) < 0 && Math.abs(a.x - b.x) > span * 0.8
  const crossY =
    (a.y - midY) * (b.y - midY) < 0 && Math.abs(a.y - b.y) > span * 0.8
  return crossX || crossY
}

describe('pano projection modes — near-clip / seam', () => {
  const modes: StageProjection[] = [
    'stereographic',
    'equirectangular',
    'rectilinear',
  ]

  for (const mode of modes) {
    it(`${mode}: near-clip floor samples still project`, () => {
      const prev = getStageProjection()
      setStageProjection(mode)
      try {
        const minZ = nearClipMinZ(mode)
        if (!Number.isFinite(minZ)) {
          // Equirect: a forward sample always projects.
          const pt = eyeToScreen({ x: 0, y: 0, z: 1 }, 1200, 800, 120)
          expect(pt).not.toBeNull()
          return
        }
        // Sample on the clip plane and slightly inside — both must map.
        for (const z of [minZ, minZ + 1e-3, 0.5]) {
          const pt = eyeToScreen({ x: 0.15, y: 0.05, z }, 1200, 800, 110)
          expect(pt, `z=${z}`).not.toBeNull()
          expect(Number.isFinite(pt!.x)).toBe(true)
          expect(Number.isFinite(pt!.y)).toBe(true)
        }
      } finally {
        setStageProjection(prev)
      }
    })
  }

  it('equirect: dense edge is not a wrap; ±half-stage jump is', () => {
    const prev = getStageProjection()
    setStageProjection('equirectangular')
    try {
      const stageW = 1000
      const stageH = 600
      const a = { x: 100, y: 200 }
      const b = { x: 140, y: 205 }
      expect(
        segmentIsProjectionWrap(a, b, stageW, stageH, 'equirectangular'),
      ).toBe(false)

      const left = { x: 20, y: 300 }
      const right = { x: 980, y: 310 }
      expect(
        segmentIsProjectionWrap(left, right, stageW, stageH, 'equirectangular'),
      ).toBe(true)
    } finally {
      setStageProjection(prev)
    }
  })

  it('never clamps stroke points onto the ±25% pad box', () => {
    // Regression: clampPtToPaddedStage smashed stereo arcs into unfinished /
    // pinched white strokes (484/792 points stuck on the pad in prod).
    const stageW = 1920
    const stageH = 1080
    const padX = stageW * 0.25
    const padY = stageH * 0.25
    const samples: Pt2[] = [
      { x: -padX * 3, y: stageH * 0.5 },
      { x: stageW + padX * 3, y: stageH * 0.2 },
      { x: stageW * 0.5, y: -padY * 4 },
    ]
    for (const p of samples) {
      // Usable far points must keep their coordinates — not snap to ±pad.
      expect(p.x === -padX || p.x === stageW + padX).toBe(false)
      expect(p.y === -padY || p.y === stageH + padY).toBe(false)
      const lim = Math.max(stageW, stageH) * 8
      const usable =
        Math.abs(p.x - stageW * 0.5) <= lim &&
        Math.abs(p.y - stageH * 0.5) <= lim
      expect(usable).toBe(true)
    }
  })

  it('stereographic zenith ring: clipped samples stay continuous (no null gaps)', () => {
    const prev = getStageProjection()
    setStageProjection('stereographic')
    try {
      const stageW = 1200
      const stageH = 800
      const vfov = 150
      const minZ = nearClipMinZ('stereographic')
      // Ring of eye directions near the antipode floor — mimics a locked
      // frame edge after near-clip when looking near zenith.
      const n = 48
      const radius = 0.35
      let nulls = 0
      let wrapSplits = 0
      const pts: Pt2[] = []
      for (let i = 0; i < n; i += 1) {
        const ang = (i / n) * Math.PI * 2
        const eye: EyePt = {
          x: Math.cos(ang) * radius,
          y: Math.sin(ang) * radius,
          z: minZ + 2e-4,
        }
        const pt = eyeToScreen(eye, stageW, stageH, vfov)
        if (!pt) {
          nulls += 1
          continue
        }
        if (pts.length > 0) {
          const prevPt = pts[pts.length - 1]!
          if (
            segmentIsProjectionWrap(
              prevPt,
              pt,
              stageW,
              stageH,
              'stereographic',
            )
          ) {
            wrapSplits += 1
          }
        }
        pts.push(pt)
      }
      expect(nulls).toBe(0)
      expect(pts.length).toBe(n)
      // A small ring near the clip floor should not shatter into wrap splits.
      expect(wrapSplits).toBe(0)
    } finally {
      setStageProjection(prev)
    }
  })
})
