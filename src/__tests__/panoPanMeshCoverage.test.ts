/**
 * Locked pano under stereographic pan: densified mesh must keep left-side
 * coverage that a single outline polygon used to drop.
 */
import { describe, expect, it } from 'vitest'
import {
  getStageProjection,
  setStageProjection,
  stelProjectEye,
} from '../stelProjector'
import { panoramaStepDeg } from '../panorama'

type Vec3 = { x: number; y: number; z: number }
type Pt2 = { x: number; y: number }
type EyePt = { x: number; y: number; z: number }

function lookDirection(yawDeg: number, pitchDeg: number): Vec3 {
  const yaw = (yawDeg * Math.PI) / 180
  const pitch = (pitchDeg * Math.PI) / 180
  const cp = Math.cos(pitch)
  return {
    x: Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp,
  }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.y,
    z: a.x * b.y - a.y * b.x,
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function normalize(v: Vec3): Vec3 | null {
  const len = Math.hypot(v.x, v.y, v.z)
  if (len < 1e-8) return null
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

function cameraBasis(yawDeg: number, pitchDeg: number) {
  const forward = lookDirection(yawDeg, pitchDeg)
  const zAxis: Vec3 = { x: -forward.x, y: -forward.y, z: -forward.z }
  let right = normalize(cross({ x: 0, y: 1, z: 0 }, zAxis))
  if (!right) {
    const yaw = (yawDeg * Math.PI) / 180
    right = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) }
  }
  return { forward, right, up: cross(zAxis, right) }
}

function dirToEye(dir: Vec3, look: ReturnType<typeof cameraBasis>): EyePt {
  return {
    x: dot(dir, look.right),
    y: dot(dir, look.up),
    z: dot(dir, look.forward),
  }
}

function eyeToScreen(
  p: EyePt,
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
): Pt2 | null {
  const aspect = stageW / Math.max(stageH, 1e-6)
  const ndc = stelProjectEye(p, stageVfovDeg, aspect)
  if (!ndc || !Number.isFinite(ndc.ndcX) || !Number.isFinite(ndc.ndcY)) return null
  return {
    x: ((ndc.ndcX + 1) / 2) * stageW,
    y: ((1 - ndc.ndcY) / 2) * stageH,
  }
}

function projectOneDir(
  dir: Vec3,
  look: ReturnType<typeof cameraBasis>,
  stageW: number,
  stageH: number,
  vfov: number,
): Pt2 | null {
  const eye = dirToEye(dir, look)
  if (eye.z < -1 + 4e-4) return null
  return eyeToScreen(eye, stageW, stageH, vfov)
}

function isFarOffstage(p: Pt2, stageW: number, stageH: number, margin = 0.6) {
  return (
    p.x < -stageW * margin ||
    p.x > stageW * (1 + margin) ||
    p.y < -stageH * margin ||
    p.y > stageH * (1 + margin)
  )
}

function hasAntipodeWrapChord(points: Pt2[], stageW: number, stageH: number) {
  const span = Math.max(stageW, stageH, 48)
  const midX = stageW * 0.5
  const midY = stageH * 0.5
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    if (!isFarOffstage(a, stageW, stageH) || !isFarOffstage(b, stageW, stageH)) {
      continue
    }
    const len = Math.hypot(a.x - b.x, a.y - b.y)
    if (len < span * 0.8) continue
    const crossX =
      (a.x - midX) * (b.x - midX) < 0 && Math.abs(a.x - b.x) > span * 0.8
    const crossY =
      (a.y - midY) * (b.y - midY) < 0 && Math.abs(a.y - b.y) > span * 0.8
    if (crossX || crossY) return true
  }
  return false
}

function softClip(poly: Pt2[], stageW: number, stageH: number): Pt2[] {
  const mx = stageW * 0.25
  const my = stageH * 0.25
  const planes: Array<(p: Pt2) => number> = [
    (p) => p.x + mx,
    (p) => stageW + mx - p.x,
    (p) => p.y + my,
    (p) => stageH + my - p.y,
  ]
  let cur = poly.slice()
  for (const dist of planes) {
    if (cur.length === 0) return []
    const out: Pt2[] = []
    for (let i = 0; i < cur.length; i += 1) {
      const a = cur[i]!
      const b = cur[(i + 1) % cur.length]!
      const da = dist(a)
      const db = dist(b)
      const aIn = da >= -1e-9
      const bIn = db >= -1e-9
      if (aIn && bIn) out.push(b)
      else if (aIn && !bIn) {
        const t = Math.min(1, Math.max(0, da / (da - db)))
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      } else if (!aIn && bIn) {
        const t = Math.min(1, Math.max(0, da / (da - db)))
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
        out.push(b)
      }
    }
    cur = out
  }
  return cur.length >= 3 ? cur : []
}

function projectMesh(
  yaw0: number,
  yaw1: number,
  pitch0: number,
  pitch1: number,
  look: ReturnType<typeof cameraBasis>,
  stageW: number,
  stageH: number,
  vfov: number,
  div = 8,
): Pt2[][] {
  const cells: Pt2[][] = []
  for (let i = 0; i < div; i += 1) {
    for (let j = 0; j < div; j += 1) {
      const u0 = i / div
      const u1 = (i + 1) / div
      const v0 = j / div
      const v1 = (j + 1) / div
      const dirs = [
        lookDirection(yaw0 + (yaw1 - yaw0) * u0, pitch0 + (pitch1 - pitch0) * v1),
        lookDirection(yaw0 + (yaw1 - yaw0) * u1, pitch0 + (pitch1 - pitch0) * v1),
        lookDirection(yaw0 + (yaw1 - yaw0) * u1, pitch0 + (pitch1 - pitch0) * v0),
        lookDirection(yaw0 + (yaw1 - yaw0) * u0, pitch0 + (pitch1 - pitch0) * v0),
      ]
      const corners: Pt2[] = []
      let ok = true
      for (const d of dirs) {
        const p = projectOneDir(d, look, stageW, stageH, vfov)
        if (!p) {
          ok = false
          break
        }
        corners.push(p)
      }
      if (!ok) continue
      if (hasAntipodeWrapChord(corners, stageW, stageH)) continue
      const clipped = softClip(corners, stageW, stageH)
      if (clipped.length >= 3) cells.push(clipped)
    }
  }
  return cells
}

function pointInAnyCell(pt: Pt2, cells: Pt2[][]) {
  for (const poly of cells) {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!
      const b = poly[j]!
      const hit =
        a.y > pt.y !== b.y > pt.y &&
        pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y + 1e-12) + a.x
      if (hit) inside = !inside
    }
    if (inside) return true
  }
  return false
}

describe('pano pan mesh coverage', () => {
  it('keeps left-column on-stage samples after a strong right pan', () => {
    const prev = getStageProjection()
    setStageProjection('stereographic')
    try {
      const stageW = 1200
      const stageH = 800
      const vfov = 110
      const lockYaw = 180
      const lockPitch = 15
      const lookYaw = 220 // +40° — left column still on-stage, outline used to shred
      const lookPitch = 15
      const hfov = 84
      const vfovOpt = 62
      const overlap = 50
      const cols = 5
      const rows = 2
      const stepYaw = panoramaStepDeg(hfov, overlap)
      const stepPitch = panoramaStepDeg(vfovOpt, overlap)
      const midC = (cols - 1) / 2
      const midR = (rows - 1) / 2
      const look = cameraBasis(lookYaw, lookPitch)

      // Leftmost column, top row — still on-stage after +40° pan.
      const col = 0
      const row = 0
      const cyaw = lockYaw + (col - midC) * stepYaw
      const cpitch = lockPitch - (row - midR) * stepPitch
      const yaw0 = cyaw - hfov / 2
      const yaw1 = cyaw + hfov / 2
      const pitch0 = cpitch - vfovOpt / 2
      const pitch1 = cpitch + vfovOpt / 2

      const cells = projectMesh(
        yaw0,
        yaw1,
        pitch0,
        pitch1,
        look,
        stageW,
        stageH,
        vfov,
      )

      let onstage = 0
      let covered = 0
      for (let i = 0; i <= 16; i += 1) {
        for (let j = 0; j <= 16; j += 1) {
          const yaw = yaw0 + ((yaw1 - yaw0) * i) / 16
          const pitch = pitch0 + ((pitch1 - pitch0) * j) / 16
          const p = projectOneDir(
            lookDirection(yaw, pitch),
            look,
            stageW,
            stageH,
            vfov,
          )
          if (!p || p.x < 0 || p.x > stageW || p.y < 0 || p.y > stageH) continue
          onstage += 1
          if (pointInAnyCell(p, cells)) covered += 1
        }
      }

      expect(cells.length).toBeGreaterThan(0)
      expect(onstage).toBeGreaterThan(0)
      expect(covered / onstage).toBeGreaterThan(0.7)
    } finally {
      setStageProjection(prev)
    }
  })
})
