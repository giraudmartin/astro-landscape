import {
  viewfinderAspectRatio,
  viewfinderFrameSizeForProjection,
  viewfinderFrameSizeInStage,
  type ViewfinderOrientation,
} from './lensFov'
import { getStageProjection, stelProjectEye } from './stelProjector'
import {
  clampPanoramaCount,
  panoramaShotCount,
  panoramaStepDeg,
  type PanoramaPlan,
  type PanoramaProjectionMode,
} from './panorama'

export type FrameWorldLock = {
  locked: boolean
  /** World look when the frame was pinned (MapLibre-style yaw). */
  lockYawDeg: number
  lockPitchDeg: number
  /** Current camera look. */
  lookYawDeg: number
  lookPitchDeg: number
}

type PhotoFrameOverlayProps = {
  stageW: number
  stageH: number
  orientation: ViewfinderOrientation
  label: string
  /** Three.js stage vertical FOV (deg). When set with opticalVfovDeg, frame scales with focal. */
  stageVfovDeg?: number
  /** Lens vertical FOV (deg) for the selected focal length. */
  opticalVfovDeg?: number
  /** Lens horizontal FOV (deg). Used for locked-frame corner projection. */
  opticalHfovDeg?: number
  panorama?: PanoramaPlan | null
  worldLock?: FrameWorldLock | null
  onToggleWorldLock?: () => void
  /** Look back at the locked framing (only meaningful while locked). */
  onRecenterWorldLock?: () => void
}

type Vec3 = { x: number; y: number; z: number }
type Pt2 = { x: number; y: number }

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
    y: a.z * b.x - a.x * b.z,
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

/** Camera basis matching ImmersiveView / Three.js lookAt with world up. */
function cameraBasis(
  yawDeg: number,
  pitchDeg: number,
): { forward: Vec3; right: Vec3; up: Vec3 } {
  const forward = lookDirection(yawDeg, pitchDeg)
  const zAxis: Vec3 = { x: -forward.x, y: -forward.y, z: -forward.z }
  let right = normalize(cross({ x: 0, y: 1, z: 0 }, zAxis))
  if (!right) {
    const yaw = (yawDeg * Math.PI) / 180
    right = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) }
  }
  return { forward, right, up: cross(zAxis, right) }
}

/** Eye-space point: x=right, y=up, z=forward (depth). */
type EyePt = { x: number; y: number; z: number }

function projectWorldDirToScreen(
  dir: Vec3,
  look: { forward: Vec3; right: Vec3; up: Vec3 },
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
): Pt2 | null {
  return eyeToScreen(dirToEye(dir, look), stageW, stageH, stageVfovDeg)
}

function dirToEye(
  dir: Vec3,
  look: { forward: Vec3; right: Vec3; up: Vec3 },
): EyePt {
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

/** Drop the part of a tile that sits behind the camera before it is projected. */
function clipEyeNear(poly: EyePt[], minZ = 0.08): EyePt[] {
  if (poly.length < 3) return []
  const out: EyePt[] = []
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const aIn = a.z >= minZ
    const bIn = b.z >= minZ
    if (aIn && bIn) {
      out.push(b)
      continue
    }
    if (aIn === bIn) continue
    const denom = b.z - a.z
    const t = Math.abs(denom) < 1e-8 ? 0 : (minZ - a.z) / denom
    const clamped = Math.min(1, Math.max(0, t))
    out.push({
      x: a.x + (b.x - a.x) * clamped,
      y: a.y + (b.y - a.y) * clamped,
      z: minZ,
    })
    if (bIn) out.push(b)
  }
  return out
}

function isFinitePt(p: Pt2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y)
}

/** Axis-aligned rect clip (sequential half-spaces) — safe for convex polys. */
function clipPolygonToRect(
  subject: Pt2[],
  left: number,
  top: number,
  right: number,
  bottom: number,
): Pt2[] {
  const planes: Array<(p: Pt2) => number> = [
    (p) => p.x - left,
    (p) => right - p.x,
    (p) => p.y - top,
    (p) => bottom - p.y,
  ]
  let poly = subject.filter(isFinitePt)
  for (const dist of planes) {
    if (poly.length === 0) return []
    const out: Pt2[] = []
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]!
      const b = poly[(i + 1) % poly.length]!
      const da = dist(a)
      const db = dist(b)
      const aIn = da >= -1e-9
      const bIn = db >= -1e-9
      if (aIn && bIn) {
        out.push(b)
      } else if (aIn && !bIn) {
        const denom = da - db
        if (Math.abs(denom) < 1e-12) continue
        const t = Math.min(1, Math.max(0, da / denom))
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      } else if (!aIn && bIn) {
        const denom = da - db
        if (Math.abs(denom) < 1e-12) {
          out.push(b)
          continue
        }
        const t = Math.min(1, Math.max(0, da / denom))
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
        out.push(b)
      }
    }
    poly = out.filter(isFinitePt)
  }
  return poly.length >= 3 ? poly : []
}

/**
 * Project a direction polygon with near-plane clip (used by the single locked
 * optical frame). Panorama cells use spherical meridians/parallels instead.
 */
function projectEyePolyToScreen(
  dirs: Vec3[],
  look: { forward: Vec3; right: Vec3; up: Vec3 },
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
): Pt2[] {
  const poly = clipEyeNear(dirs.map((d) => dirToEye(d, look)))
  return poly
    .map((p) => eyeToScreen(p, stageW, stageH, stageVfovDeg))
    .filter((p): p is Pt2 => p != null)
}

/**
 * Project world directions with near + generous frustum clip so partially
 * visible tiles stay drawn (never all-or-nothing cull).
 */
function projectDirsToScreenClipped(
  dirs: Vec3[],
  look: { forward: Vec3; right: Vec3; up: Vec3 },
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
): Pt2[] {
  if (dirs.length < 3) return []
  const poly = clipEyeNear(dirs.map((d) => dirToEye(d, look)))
  if (poly.length < 3) return []
  const out = poly
    .map((p) => eyeToScreen(p, stageW, stageH, stageVfovDeg))
    .filter((p): p is Pt2 => p != null && isFinitePt(p))
  if (out.length < 3) return []
  // Soft stage clip (±25 %) keeps SVG/mask stable while preserving edge tiles.
  const mx = stageW * 0.25
  const my = stageH * 0.25
  return clipPolygonToRect(out, -mx, -my, stageW + mx, stageH + my)
}

/** Unnormalized ray through the shot image plane (z=1 in camera tan-space). */
function lockLocalVec(
  lock: { forward: Vec3; right: Vec3; up: Vec3 },
  xCam: number,
  yCam: number,
): Vec3 {
  return {
    x: lock.forward.x + xCam * lock.right.x + yCam * lock.up.x,
    y: lock.forward.y + xCam * lock.right.y + yCam * lock.up.y,
    z: lock.forward.z + xCam * lock.right.z + yCam * lock.up.z,
  }
}

function lockLocalDir(
  lock: { forward: Vec3; right: Vec3; up: Vec3 },
  xCam: number,
  yCam: number,
): Vec3 | null {
  return normalize(lockLocalVec(lock, xCam, yCam))
}

type LockLookBases = {
  lock: { forward: Vec3; right: Vec3; up: Vec3 }
  look: { forward: Vec3; right: Vec3; up: Vec3 }
  stageW: number
  stageH: number
  stageVfovDeg: number
}

function projectLockTanPoint(
  bases: LockLookBases,
  xCam: number,
  yCam: number,
): Pt2 | null {
  const dir = lockLocalDir(bases.lock, xCam, yCam)
  if (!dir) return null
  return projectWorldDirToScreen(
    dir,
    bases.look,
    bases.stageW,
    bases.stageH,
    bases.stageVfovDeg,
  )
}

/** Project a lock-local tan-space rectangle (TL→TR→BR→BL). */
function projectLockTanRect(
  bases: LockLookBases,
  left: number,
  right: number,
  top: number,
  bottom: number,
): Pt2[] {
  const samples = 8
  const dirs: Vec3[] = []
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    for (let i = 0; i < samples; i += 1) {
      const t = i / samples
      const dir = lockLocalDir(
        bases.lock,
        x0 + (x1 - x0) * t,
        y0 + (y1 - y0) * t,
      )
      if (dir) dirs.push(dir)
    }
  }
  edge(left, top, right, top)
  edge(right, top, right, bottom)
  edge(right, bottom, left, bottom)
  edge(left, bottom, left, top)
  return projectEyePolyToScreen(
    dirs,
    bases.look,
    bases.stageW,
    bases.stageH,
    bases.stageVfovDeg,
  )
}

/**
 * Project the locked optical rectangle (fixed angular FOV on the landscape)
 * into the current view — including perspective deformation. Edges that cross
 * behind the camera are near-plane clipped so the frame can pass behind
 * without being deleted.
 */
function projectLockedOpticalQuad(input: {
  stageW: number
  stageH: number
  stageVfovDeg: number
  opticalVfovDeg: number
  opticalHfovDeg: number
  lockYawDeg: number
  lockPitchDeg: number
  lookYawDeg: number
  lookPitchDeg: number
}): {
  polygon: Pt2[]
  center: Pt2 | null
  midTop: Pt2 | null
  midBottom: Pt2 | null
  midLeft: Pt2 | null
  midRight: Pt2 | null
} {
  const bases: LockLookBases = {
    lock: cameraBasis(input.lockYawDeg, input.lockPitchDeg),
    look: cameraBasis(input.lookYawDeg, input.lookPitchDeg),
    stageW: input.stageW,
    stageH: input.stageH,
    stageVfovDeg: input.stageVfovDeg,
  }
  const tanHalfV = Math.tan(
    ((Math.max(input.opticalVfovDeg, 0.5) / 2) * Math.PI) / 180,
  )
  const tanHalfH = Math.tan(
    ((Math.max(input.opticalHfovDeg, 0.5) / 2) * Math.PI) / 180,
  )

  return {
    polygon: projectLockTanRect(
      bases,
      -tanHalfH,
      tanHalfH,
      tanHalfV,
      -tanHalfV,
    ),
    center: projectLockTanPoint(bases, 0, 0),
    midTop: projectLockTanPoint(bases, 0, tanHalfV),
    midBottom: projectLockTanPoint(bases, 0, -tanHalfV),
    midLeft: projectLockTanPoint(bases, -tanHalfH, 0),
    midRight: projectLockTanPoint(bases, tanHalfH, 0),
  }
}

type LockedPanoTile = {
  index: number
  col: number
  row: number
  polygon: Pt2[]
  center: Pt2 | null
  badge: Pt2 | null
}

type LockedPanoOverlap = {
  key: string
  polygon: Pt2[]
}

/** Convex polygon ∩ convex clip via AABB when possible, else sequential SH. */
function intersectConvexPolygons(subject: Pt2[], clip: Pt2[]): Pt2[] {
  if (subject.length < 3 || clip.length < 3) return []
  // Fast path: axis-aligned clip rect (our overlap + stage clips).
  if (clip.length === 4) {
    const xs = clip.map((p) => p.x)
    const ys = clip.map((p) => p.y)
    const left = Math.min(...xs)
    const right = Math.max(...xs)
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    const isAxisAligned = clip.every(
      (p) =>
        (Math.abs(p.x - left) < 1e-6 || Math.abs(p.x - right) < 1e-6) &&
        (Math.abs(p.y - top) < 1e-6 || Math.abs(p.y - bottom) < 1e-6),
    )
    if (isAxisAligned) {
      return clipPolygonToRect(subject, left, top, right, bottom)
    }
  }
  return clipPolygonToRect(
    subject,
    Math.min(...clip.map((p) => p.x)),
    Math.min(...clip.map((p) => p.y)),
    Math.max(...clip.map((p) => p.x)),
    Math.max(...clip.map((p) => p.y)),
  )
}

/** Pitch clamp for panorama aim points (stay clear of gimbal poles). */
const PANO_PITCH_MAX_DEG = 89
/** Samples per edge — curved spherical / dense optical boundaries. */
const PANO_EDGE_SAMPLES = 16

function shotAimYawPitch(
  lockYawDeg: number,
  lockPitchDeg: number,
  col: number,
  row: number,
  midC: number,
  midR: number,
  stepYaw: number,
  stepPitch: number,
): { yaw: number; pitch: number } {
  // Grid is ALWAYS centred on the lock/aim: adding columns/rows expands
  // symmetrically left/right and above/below — never stacks only upward.
  const yaw = lockYawDeg + (col - midC) * stepYaw
  const pitch = Math.max(
    -PANO_PITCH_MAX_DEG,
    Math.min(PANO_PITCH_MAX_DEG, lockPitchDeg - (row - midR) * stepPitch),
  )
  return { yaw, pitch }
}

/** Tessellate optical frustum edges on the planar image rectangle (z=1). */
function opticalFrustumEdgeDirs(
  shotYawDeg: number,
  shotPitchDeg: number,
  tanHalfH: number,
  tanHalfV: number,
  samples: number,
): Vec3[] {
  const shot = cameraBasis(shotYawDeg, shotPitchDeg)
  const corners: [number, number][] = [
    [-tanHalfH, tanHalfV],
    [tanHalfH, tanHalfV],
    [tanHalfH, -tanHalfV],
    [-tanHalfH, -tanHalfV],
  ]
  const dirs: Vec3[] = []
  for (let e = 0; e < 4; e += 1) {
    const a = corners[e]!
    const b = corners[(e + 1) % 4]!
    const n = e === 3 ? samples : samples + 1
    for (let i = 0; i < n; i += 1) {
      const t = i / samples
      dirs.push(
        lockLocalVec(
          shot,
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
        ),
      )
    }
  }
  return dirs
}

/**
 * Spherical rectangle: constant-yaw meridians × constant-pitch parallels.
 * Top/bottom edges curve on screen.
 */
function sphericalRectDirs(
  yaw0: number,
  yaw1: number,
  pitchBottom: number,
  pitchTop: number,
): Vec3[] {
  const pb = Math.max(
    -PANO_PITCH_MAX_DEG,
    Math.min(PANO_PITCH_MAX_DEG, pitchBottom),
  )
  const pt = Math.max(
    -PANO_PITCH_MAX_DEG,
    Math.min(PANO_PITCH_MAX_DEG, pitchTop),
  )
  if (pt <= pb + 1e-4) return []
  const dirs: Vec3[] = []
  const n = PANO_EDGE_SAMPLES
  for (let i = 0; i <= n; i += 1) {
    const t = i / n
    dirs.push(lookDirection(yaw0 + (yaw1 - yaw0) * t, pt))
  }
  for (let i = 1; i <= n; i += 1) {
    const t = i / n
    dirs.push(lookDirection(yaw1, pt + (pb - pt) * t))
  }
  for (let i = 1; i <= n; i += 1) {
    const t = i / n
    dirs.push(lookDirection(yaw1 + (yaw0 - yaw1) * t, pb))
  }
  for (let i = 1; i < n; i += 1) {
    const t = i / n
    dirs.push(lookDirection(yaw0, pb + (pt - pb) * t))
  }
  return dirs
}

/**
 * Drop a cell whose outline jumps across the view.
 * That jump is the cut where the shot passes behind the camera:
 * one chord, much longer than the sensor-edge steps.
 */
function tileFootprintSane(points: Pt2[], frameW: number, frameH: number): boolean {
  if (points.length < 3) return false
  const maxW = Math.max(frameW, 48) * 2.5
  const maxH = Math.max(frameH, 48) * 2.5
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const edges: number[] = []
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    if (!isFinitePt(a) || !isFinitePt(b)) return false
    minX = Math.min(minX, a.x)
    maxX = Math.max(maxX, a.x)
    minY = Math.min(minY, a.y)
    maxY = Math.max(maxY, a.y)
    edges.push(Math.hypot(a.x - b.x, a.y - b.y))
  }
  if (maxX - minX > maxW || maxY - minY > maxH) return false
  const longest = Math.max(...edges)
  const ordered = [...edges].sort((a, b) => a - b)
  const median = ordered[Math.floor(ordered.length / 2)] ?? 0
  const frame = Math.max(frameW, frameH, 48)
  if (longest > frame * 1.25 && longest > median * 4) return false
  return true
}

function projectTileDirs(
  dirs: Vec3[],
  look: { forward: Vec3; right: Vec3; up: Vec3 },
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
): Pt2[] {
  return projectDirsToScreenClipped(dirs, look, stageW, stageH, stageVfovDeg)
}

/**
 * Panorama grid from the tripod point of view.
 * Centres step by fov×(1−overlap) in yaw/pitch (ball-head motion).
 * Each cell is projected with the selected model — never FOV-culled.
 */
function projectLockedPanorama(input: {
  stageW: number
  stageH: number
  stageVfovDeg: number
  opticalVfovDeg: number
  opticalHfovDeg: number
  lockYawDeg: number
  lockPitchDeg: number
  lookYawDeg: number
  lookPitchDeg: number
  columns: number
  rows: number
  overlapPercent: number
  projectionMode: PanoramaProjectionMode
  /** On-screen size of one photo. A cell much larger than this has wrapped. */
  frameW: number
  frameH: number
}): { tiles: LockedPanoTile[]; overlaps: LockedPanoOverlap[] } {
  const look = cameraBasis(input.lookYawDeg, input.lookPitchDeg)
  const halfHDeg = Math.max(input.opticalHfovDeg, 0.5) / 2
  const halfVDeg = Math.max(input.opticalVfovDeg, 0.5) / 2
  const tanHalfH = Math.tan((halfHDeg * Math.PI) / 180)
  const tanHalfV = Math.tan((halfVDeg * Math.PI) / 180)
  const columns = clampPanoramaCount(input.columns, Number.POSITIVE_INFINITY)
  const rows = clampPanoramaCount(input.rows, Number.POSITIVE_INFINITY)
  const stepYaw = panoramaStepDeg(input.opticalHfovDeg, input.overlapPercent)
  const stepPitch = panoramaStepDeg(input.opticalVfovDeg, input.overlapPercent)
  const midC = (columns - 1) / 2
  const midR = (rows - 1) / 2
  const mode = input.projectionMode

  const tiles: LockedPanoTile[] = []
  let index = 1
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const { yaw: cyaw, pitch: cpitch } = shotAimYawPitch(
        input.lockYawDeg,
        input.lockPitchDeg,
        col,
        row,
        midC,
        midR,
        stepYaw,
        stepPitch,
      )
      const aim = lookDirection(cyaw, cpitch)
      const center = projectWorldDirToScreen(
        aim,
        look,
        input.stageW,
        input.stageH,
        input.stageVfovDeg,
      )

      let dirs: Vec3[]
      if (mode === 'spherical') {
        dirs = sphericalRectDirs(
          cyaw - halfHDeg,
          cyaw + halfHDeg,
          cpitch - halfVDeg,
          cpitch + halfVDeg,
        )
      } else {
        // Four corners joined by straight screen lines cut across the view
        // as soon as a shot leaves the centre. Follow the sensor edge.
        dirs = opticalFrustumEdgeDirs(
          cyaw,
          cpitch,
          tanHalfH,
          tanHalfV,
          PANO_EDGE_SAMPLES,
        )
      }

      const projected = projectTileDirs(
        dirs,
        look,
        input.stageW,
        input.stageH,
        input.stageVfovDeg,
      )
      const polygon = tileFootprintSane(projected, input.frameW, input.frameH)
        ? projected
        : []

      const shot = cameraBasis(cyaw, cpitch)
      const badgeDir =
        lockLocalDir(shot, -tanHalfH * 0.72, tanHalfV * 0.72) ?? aim
      const badge =
        projectWorldDirToScreen(
          badgeDir,
          look,
          input.stageW,
          input.stageH,
          input.stageVfovDeg,
        ) ?? center

      tiles.push({
        index,
        col,
        row,
        polygon: polygon.length >= 3 ? polygon : [],
        center,
        badge,
      })
      index += 1
    }
  }

  const overlaps: LockedPanoOverlap[] = []
  const byKey = new Map(tiles.map((t) => [`${t.col},${t.row}`, t]))
  for (const tile of tiles) {
    if (tile.polygon.length < 3) continue
    const right = byKey.get(`${tile.col + 1},${tile.row}`)
    if (right && right.polygon.length >= 3) {
      const hit = intersectConvexPolygons(tile.polygon, right.polygon)
      if (hit.length >= 3) {
        overlaps.push({ key: `h-${tile.col}-${tile.row}`, polygon: hit })
      }
    }
    const below = byKey.get(`${tile.col},${tile.row + 1}`)
    if (below && below.polygon.length >= 3) {
      const hit = intersectConvexPolygons(tile.polygon, below.polygon)
      if (hit.length >= 3) {
        overlaps.push({ key: `v-${tile.col}-${tile.row}`, polygon: hit })
      }
    }
  }

  return { tiles, overlaps }
}

function pointsToSvg(points: Pt2[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}

function LockKeyholeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="16" r="1" />
        <rect width="18" height="12" x="3" y="10" rx="2" />
        <path d="M7 10V7a5 5 0 0 1 9.33-2.5" />
      </svg>
    )
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="16" r="1" />
      <rect x="3" y="10" width="18" height="12" rx="2" />
      <path d="M7 10V7a5 5 0 0 1 10 0v3" />
    </svg>
  )
}

/** Lucide "scan" — recenter view on the locked framing. */
function RecenterIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    </svg>
  )
}

/** SVG viewfinder rectangle — optical frame projected onto the stage. */
export function PhotoFrameOverlay({
  stageW,
  stageH,
  orientation,
  label,
  stageVfovDeg,
  opticalVfovDeg,
  opticalHfovDeg,
  panorama = null,
  worldLock = null,
  onToggleWorldLock,
  onRecenterWorldLock,
}: PhotoFrameOverlayProps) {
  if (stageW < 2 || stageH < 2) return null

  const aspect = viewfinderAspectRatio(orientation)
  const derivedHfov =
    opticalHfovDeg ??
    (opticalVfovDeg != null
      ? (2 *
          Math.atan(
            Math.tan(((opticalVfovDeg / 2) * Math.PI) / 180) * aspect,
          ) *
          180) /
        Math.PI
      : undefined)

  const { frameW, frameH } =
    stageVfovDeg != null && opticalVfovDeg != null
      ? viewfinderFrameSizeForProjection(
          stageW,
          stageH,
          stageVfovDeg,
          opticalVfovDeg,
          orientation,
          getStageProjection(),
        )
      : viewfinderFrameSizeInStage(stageW, stageH, orientation)

  const locked = worldLock?.locked === true
  const canProjectAngles =
    worldLock != null &&
    stageVfovDeg != null &&
    opticalVfovDeg != null &&
    derivedHfov != null

  const panoOn =
    panorama != null &&
    panorama.enabled &&
    (panorama.columns > 1 || panorama.rows > 1)

  // Unlocked: grid follows look. Locked: pinned on landscape.
  const framingYawDeg = locked
    ? worldLock!.lockYawDeg
    : (worldLock?.lookYawDeg ?? 0)
  const framingPitchDeg = locked
    ? worldLock!.lockPitchDeg
    : (worldLock?.lookPitchDeg ?? 0)

  const lockedProj =
    canProjectAngles && locked && !panoOn
      ? projectLockedOpticalQuad({
          stageW,
          stageH,
          stageVfovDeg,
          opticalVfovDeg,
          opticalHfovDeg: derivedHfov,
          lockYawDeg: worldLock.lockYawDeg,
          lockPitchDeg: worldLock.lockPitchDeg,
          lookYawDeg: worldLock.lookYawDeg,
          lookPitchDeg: worldLock.lookPitchDeg,
        })
      : null

  const projectedPano =
    canProjectAngles && panoOn
      ? projectLockedPanorama({
          stageW,
          stageH,
          stageVfovDeg,
          opticalVfovDeg,
          opticalHfovDeg: derivedHfov,
          lockYawDeg: framingYawDeg,
          lockPitchDeg: framingPitchDeg,
          lookYawDeg: worldLock.lookYawDeg,
          lookPitchDeg: worldLock.lookPitchDeg,
          columns: panorama.columns,
          rows: panorama.rows,
          overlapPercent: panorama.overlapPercent,
          projectionMode: panorama.projectionMode,
          frameW,
          frameH,
        })
      : null

  const lockedPoly =
    lockedProj && lockedProj.polygon.length >= 3
      ? lockedProj.polygon
      : null
  // Keep every tile that still has a clipped footprint — never drop half-in FOV.
  const panoTiles = (projectedPano?.tiles ?? []).filter(
    (t) => t.polygon.length >= 3,
  )
  const panoOverlaps = projectedPano?.overlaps ?? []
  // Mask holes: keep raw quads (CSS overflow clips the SVG). Avoid screen-space
  // polygon clip — it corrupts large side footprints into garbage verts.
  const panoMaskPolys = panoTiles

  const showLockedFrame = !panoOn && lockedPoly != null
  const showProjectedPano = panoOn && canProjectAngles
  const showFollowFrame = !panoOn && !locked
  // Wide stereographic stage ≫ optical frame: NEVER dump a 50% black veil
  // over the landscape — that looked like “qualité cassée / devient noir”
  // on dezoom. Keep the green outline only.
  const wideLandscapeStage =
    stageVfovDeg != null &&
    opticalVfovDeg != null &&
    stageVfovDeg > opticalVfovDeg * 1.2
  const showDim =
    (showProjectedPano || locked || showFollowFrame) && !wideLandscapeStage

  const left = (stageW - frameW) / 2
  const top = (stageH - frameH) / 2

  const showFrames = panoOn && panorama.showFrames
  const showOverlap = panoOn && panorama.showOverlap

  let envelopeBottom = top + frameH
  let envelopeCenterX = left + frameW / 2
  if (showProjectedPano && panoTiles.length > 0 && worldLock && stageVfovDeg != null) {
    let maxY = -Infinity
    for (const tile of panoTiles) {
      for (const p of tile.polygon) maxY = Math.max(maxY, p.y)
    }
    // Optical axis of the whole grid, not the first cell. An even
    // column or row count has no middle tile, so the corner cell
    // was sliding the caption sideways. A cell clipped to the stage
    // edge must not drag the caption to the bottom of the screen.
    const look = cameraBasis(worldLock.lookYawDeg, worldLock.lookPitchDeg)
    const mid = projectWorldDirToScreen(
      lookDirection(framingYawDeg, framingPitchDeg),
      look,
      stageW,
      stageH,
      stageVfovDeg,
    )
    envelopeCenterX = mid?.x ?? stageW / 2
    const aimBottom = mid ? mid.y + frameH * 0.5 : maxY
    envelopeBottom = maxY > aimBottom + frameH * 2 ? aimBottom : maxY
  } else if (lockedPoly) {
    let minX = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of lockedPoly) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    envelopeBottom = maxY
    envelopeCenterX = lockedProj?.center?.x ?? (minX + maxX) / 2
  } else if (locked || showProjectedPano) {
    envelopeCenterX = stageW / 2
    envelopeBottom = stageH - 96
  }

  const badgeR = Math.max(5, Math.min(frameW, frameH) * 0.018)
  const shots = panoOn
    ? panoramaShotCount(panorama.columns, panorama.rows)
    : 0

  const quadPoints = lockedPoly ? pointsToSvg(lockedPoly) : ''
  const showCrosshair =
    showLockedFrame &&
    lockedProj?.midTop &&
    lockedProj.midBottom &&
    lockedProj.midLeft &&
    lockedProj.midRight

  return (
    <div className="photo-frame">
      <svg
        className="photo-frame__svg"
        width={stageW}
        height={stageH}
        viewBox={`0 0 ${stageW} ${stageH}`}
        aria-hidden="true"
      >
        <defs>
          {showDim ? (
            <mask id="photo-frame-mask">
              <rect width={stageW} height={stageH} fill="white" />
              {showProjectedPano
                ? panoMaskPolys.map((tile) => (
                    <polygon
                      key={`mask-${tile.index}`}
                      points={pointsToSvg(tile.polygon)}
                      fill="black"
                    />
                  ))
                : showLockedFrame ? (
                    <polygon points={quadPoints} fill="black" />
                  ) : showFollowFrame ? (
                    <rect
                      x={left}
                      y={top}
                      width={frameW}
                      height={frameH}
                      fill="black"
                      rx={2}
                    />
                  ) : null}
            </mask>
          ) : null}
        </defs>

        {showDim ? (
          <rect
            width={stageW}
            height={stageH}
            fill="rgba(4, 8, 14, 0.48)"
            mask="url(#photo-frame-mask)"
          />
        ) : null}

        {showOverlap && showProjectedPano
          ? panoOverlaps.map((band) => (
              <polygon
                key={`ov-${band.key}`}
                points={pointsToSvg(band.polygon)}
                fill="rgba(125, 222, 168, 0.18)"
                stroke="rgba(125, 222, 168, 0.35)"
                strokeWidth={0.8}
              />
            ))
          : null}

        {showFrames && showProjectedPano
          ? panoTiles.map((tile) => {
              const badge = tile.badge ?? tile.center
              const badgeOnStage =
                badge != null &&
                badge.x >= -badgeR * 2 &&
                badge.x <= stageW + badgeR * 2 &&
                badge.y >= -badgeR * 2 &&
                badge.y <= stageH + badgeR * 2
              return (
                <g key={`shot-${tile.index}`}>
                  <polygon
                    points={pointsToSvg(tile.polygon)}
                    fill="none"
                    stroke="rgba(232, 244, 255, 0.88)"
                    strokeWidth={1.6}
                    strokeLinejoin="round"
                  />
                  {badgeOnStage ? (
                    <>
                      <circle
                        cx={badge!.x}
                        cy={badge!.y}
                        r={badgeR}
                        fill="rgba(8, 12, 20, 0.82)"
                        stroke="rgba(125, 222, 168, 0.8)"
                        strokeWidth={0.9}
                      />
                      <text
                        x={badge!.x}
                        y={badge!.y + 0.4}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#e8fff2"
                        fontSize={Math.max(7, badgeR * 1.05)}
                        fontWeight={650}
                        fontFamily="system-ui, sans-serif"
                      >
                        {tile.index}
                      </text>
                    </>
                  ) : null}
                </g>
              )
            })
          : null}

        {showLockedFrame ? (
          <>
            <polygon
              points={quadPoints}
              fill="none"
              stroke="rgba(125, 222, 168, 0.98)"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
            {showCrosshair ? (
              <>
                <line
                  x1={lockedProj.midTop!.x}
                  y1={lockedProj.midTop!.y}
                  x2={lockedProj.midBottom!.x}
                  y2={lockedProj.midBottom!.y}
                  stroke="rgba(125, 222, 168, 0.22)"
                  strokeWidth={1}
                />
                <line
                  x1={lockedProj.midLeft!.x}
                  y1={lockedProj.midLeft!.y}
                  x2={lockedProj.midRight!.x}
                  y2={lockedProj.midRight!.y}
                  stroke="rgba(125, 222, 168, 0.22)"
                  strokeWidth={1}
                />
              </>
            ) : null}
          </>
        ) : null}

        {showFollowFrame ? (
          <>
            <rect
              x={left}
              y={top}
              width={frameW}
              height={frameH}
              fill="none"
              stroke="rgba(125, 222, 168, 0.98)"
              strokeWidth={2.5}
              rx={2}
            />
            <line
              x1={left + frameW / 2}
              y1={top}
              x2={left + frameW / 2}
              y2={top + frameH}
              stroke="rgba(125, 222, 168, 0.22)"
              strokeWidth={1}
            />
            <line
              x1={left}
              y1={top + frameH / 2}
              x2={left + frameW}
              y2={top + frameH / 2}
              stroke="rgba(125, 222, 168, 0.22)"
              strokeWidth={1}
            />
          </>
        ) : null}
      </svg>

      <div
        className="photo-frame__meta"
        style={{
          /* Keep controls reachable if the framed patch pans off-screen. */
          left: Math.min(stageW - 28, Math.max(28, envelopeCenterX)),
          top: Math.min(stageH - 72, Math.max(12, envelopeBottom + 8)),
        }}
      >
        <p className="photo-frame__label">
          {panoOn
            ? `${label} · ${shots} vues · overlap ${panorama.overlapPercent}%`
            : `${label} · ${aspect.toFixed(2)}∶1`}
          {locked ? ' · fixé' : ''}
        </p>
        {onToggleWorldLock || (locked && onRecenterWorldLock) ? (
          <div className="photo-frame__actions">
            {onToggleWorldLock ? (
              <button
                type="button"
                className={
                  locked
                    ? 'photo-frame__lock is-locked'
                    : 'photo-frame__lock'
                }
                aria-pressed={locked}
                title={
                  locked
                    ? 'Déverrouiller le cadrage (suit le viseur)'
                    : 'Verrouiller le cadrage sur le paysage'
                }
                aria-label={
                  locked
                    ? 'Déverrouiller le cadrage'
                    : 'Verrouiller le cadrage sur le paysage'
                }
                onPointerDown={(event) => {
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleWorldLock()
                }}
              >
                <LockKeyholeIcon open={!locked} />
              </button>
            ) : null}
            {locked && onRecenterWorldLock ? (
              <button
                type="button"
                className="photo-frame__recenter"
                title="Recentrer la vue sur le cadrage verrouillé"
                aria-label="Recentrer la vue sur le cadrage verrouillé"
                onPointerDown={(event) => {
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  onRecenterWorldLock()
                }}
              >
                <RecenterIcon />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
