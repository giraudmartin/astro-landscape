import { CompositionGuideOverlay } from './CompositionGuideOverlay'
import {
  PHI_INV,
  goldenTriangleFeet,
  type CompositionGuideMode,
} from './compositionGuides'
import {
  viewfinderAspectRatio,
  viewfinderFrameSizeForProjection,
  viewfinderFrameSizeInStage,
  type ViewfinderFrameMode,
  type ViewfinderOrientation,
} from './lensFov'
import { getStageProjection, stelProjectEye } from './stelProjector'
import {
  clampPanoramaCount,
  panoramaStepDeg,
  type PanoramaPlan,
  type PanoramaProjectionMode,
} from './panorama'

/** PS primary mint via CSS tokens — keep SVG strokes on the same green as UI chrome. */
const accentRgba = (alpha: number) => `rgba(var(--ui-accent-rgb), ${alpha})`

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
  /** Which overlay to draw. `off` hides the whole viewfinder chrome. */
  frameMode?: ViewfinderFrameMode
  /** Three.js stage vertical FOV (deg). When set with opticalVfovDeg, frame scales with focal. */
  stageVfovDeg?: number
  /** Lens vertical FOV (deg) for the selected focal length. */
  opticalVfovDeg?: number
  /** Lens horizontal FOV (deg). Used for locked-frame corner projection. */
  opticalHfovDeg?: number
  panorama?: PanoramaPlan | null
  worldLock?: FrameWorldLock | null
  /**
   * Screen-space roll (deg) for the unlocked follow frame — used by
   * equatorial timelapse « Cadre seul » mode. Positive = CCW.
   */
  frameRollDeg?: number
  /** Timelapse preview: hide FOV composition guides while the playback bar is up. */
  hideGrid?: boolean
  /** Photo Sightline composition guide cycle (thirds / phi / center / golden). */
  compositionGuide?: CompositionGuideMode
  /** Outside-matte opacity 0…1 (default soft letterbox). */
  outsideDimOpacity?: number
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

/**
 * Near-plane floor matching what `stelProjectEye` / `warpEye` can still map.
 *
 * Must stay strictly inside the warp singularity so clipped samples still
 * project (skipped nulls used to join distant neighbours → wrap splits /
 * unfinished white strokes). Equirect has no singularity — skip near clip.
 */
function nearClipMinZForStage(): number {
  const mode = getStageProjection()
  // Rectilinear r=x/z. Keep low so frame edges near the view rim still draw.
  if (mode === 'rectilinear') return 1e-3
  if (mode === 'equirectangular') return Number.NEGATIVE_INFINITY
  // Stereographic: h = 0.5*(1+z) must stay ≥ 1e-4 (warpEye). z ≥ -1+4e-4.
  return -1 + 4e-4
}

/** Drop the part of a tile that sits past the projection singularity. */
function clipEyeNear(poly: EyePt[], minZ = nearClipMinZForStage()): EyePt[] {
  if (poly.length < 3) return []
  if (!Number.isFinite(minZ)) return poly.slice()
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

/** Soft stage pad (±25 %) keeps SVG/mask stable for edge tiles. */
function softClipToStage(poly: Pt2[], stageW: number, stageH: number): Pt2[] {
  const mx = stageW * 0.25
  const my = stageH * 0.25
  return clipPolygonToRect(poly, -mx, -my, stageW + mx, stageH + my)
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
  /** Shot aim (deg) — used to build angular overlap bands. */
  yaw: number
  pitch: number
  /**
   * Densified on-stage cells (mask + coverage). A single outline polygon
   * self-intersects / false-wraps under stereographic pan and drops the
   * left side — mesh cells keep every projectable patch.
   */
  cells: Pt2[][]
  /** Outer boundary stroke pieces (broken at singularity jumps). */
  strokes: Pt2[][]
  /** Any cell flattened for envelope / legacy consumers. */
  polygon: Pt2[]
  center: Pt2 | null
  badge: Pt2 | null
}

type LockedPanoOverlap = {
  key: string
  cells: Pt2[][]
}

function polygonSignedArea(poly: Pt2[]): number {
  let area = 0
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    area += a.x * b.y - b.x * a.y
  }
  return area * 0.5
}

/** Pitch clamp for panorama aim points (stay clear of gimbal poles). */
const PANO_PITCH_MAX_DEG = 89
/** Samples per edge — curved spherical / dense optical boundaries. */
const PANO_EDGE_SAMPLES = 32

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

/** Far outside the stage (stereographic balloon / antipode ring). */
function isFarOffstage(
  p: Pt2,
  stageW: number,
  stageH: number,
  margin = 0.6,
): boolean {
  return (
    p.x < -stageW * margin ||
    p.x > stageW * (1 + margin) ||
    p.y < -stageH * margin ||
    p.y > stageH * (1 + margin)
  )
}

/**
 * True when a screen segment is a fake chord across a projection singularity:
 * stereographic antipode (both ends far off-stage, opposite sides) or
 * equirect ±180° azimuth seam (huge horizontal jump between dense samples).
 */
function segmentIsProjectionWrap(
  a: Pt2,
  b: Pt2,
  stageW: number,
  stageH: number,
): boolean {
  const span = Math.max(stageW, stageH, 48)
  const len = Math.hypot(a.x - b.x, a.y - b.y)
  // Equirect seam: atan2 jumps ±π → chord across most of the stage width.
  // Dense edge samples never span this much unless the azimuth unwraps.
  if (
    getStageProjection() === 'equirectangular' &&
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

/** Polygon has a fake wrap chord (stereo antipode or equirect seam). */
function hasAntipodeWrapChord(
  points: Pt2[],
  stageW: number,
  stageH: number,
): boolean {
  if (points.length < 3) return false
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    if (!isFinitePt(a) || !isFinitePt(b)) return true
    if (segmentIsProjectionWrap(a, b, stageW, stageH)) return true
  }
  return false
}

/**
 * Soft-clip a projected fill. Wrap chords (stereo antipode / equirect seam)
 * are dropped — keeping them paints a full-stage fan; splitting without a
 * seam-edge close reintroduces the same chord on polygon close.
 * Recti near-plane runaways are dropped too (soft-clip alone left huge green
 * pad-filling blotches).
 */
function finalizeProjectedFill(
  screen: Pt2[],
  stageW: number,
  stageH: number,
): Pt2[][] {
  if (screen.length < 3) return []
  if (hasAntipodeWrapChord(screen, stageW, stageH)) return []
  // Reject only extreme runaways (recti singularity). Soft-clip handles the rest.
  const lim = Math.max(stageW, stageH) * 4
  for (const p of screen) {
    if (
      !isFinitePt(p) ||
      Math.abs(p.x - stageW * 0.5) > lim ||
      Math.abs(p.y - stageH * 0.5) > lim
    ) {
      return []
    }
  }
  const clipped = softClipToStage(screen, stageW, stageH)
  if (clipped.length < 3) return []
  let anyOnstage = false
  for (const p of clipped) {
    if (p.x >= -1 && p.x <= stageW + 1 && p.y >= -1 && p.y <= stageH + 1) {
      anyOnstage = true
      break
    }
  }
  if (!anyOnstage) return []
  // Bowtie / runaway fill (stereo zenith or recti near-plane chord).
  const area = Math.abs(polygonSignedArea(clipped))
  const mode = getStageProjection()
  // Recti zenith "boule" was ~9–10% of stage; keep thin optical bands under that.
  const areaCap =
    mode === 'equirectangular' ? 0.35 : mode === 'rectilinear' ? 0.07 : 0.22
  if (area > stageW * stageH * areaCap) return []
  // Recti: near-plane salvage projects as a tall central oval under N.
  if (mode === 'rectilinear') {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const p of clipped) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
    const bw = maxX - minX
    const bh = maxY - minY
    if (bh > stageH * 0.42 && bh >= bw * 0.9) return []
  }
  return [clipped]
}

/** Subdivisions per tile axis — enough to survive stereographic pan warp. */
const PANO_MESH_DIV = 10
/**
 * Extra samples along each mesh-cell edge so fills track the same curves as
 * frame strokes (PANO_EDGE_SAMPLES). Quads alone cut corners under stereo.
 */
const PANO_MESH_EDGE_SAMPLES = 4

function projectOneDir(
  dir: Vec3,
  look: { forward: Vec3; right: Vec3; up: Vec3 },
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
): Pt2 | null {
  const eye = dirToEye(dir, look)
  if (eye.z < nearClipMinZForStage()) return null
  return eyeToScreen(eye, stageW, stageH, stageVfovDeg)
}

/** Project a closed dir loop with the same eye near-clip as strokes. */
function projectDirsToScreenPoly(
  dirs: Vec3[],
  look: { forward: Vec3; right: Vec3; up: Vec3 },
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
): Pt2[] {
  if (dirs.length < 3) return []
  const eyes: EyePt[] = []
  for (const d of dirs) {
    const n = normalize(d)
    if (!n) return []
    eyes.push(dirToEye(n, look))
  }
  const clippedEyes = clipEyeNear(eyes, nearClipMinZForStage())
  if (clippedEyes.length < 3) return []
  const screen: Pt2[] = []
  for (const e of clippedEyes) {
    const pt = eyeToScreen(e, stageW, stageH, stageVfovDeg)
    if (!pt || !isFinitePt(pt)) return []
    screen.push(pt)
  }
  return screen
}

function finalizeMeshCell(
  corners: Pt2[],
  stageW: number,
  stageH: number,
): Pt2[] {
  const parts = finalizeProjectedFill(corners, stageW, stageH)
  return parts[0] ?? []
}

/**
 * Spherical-rect cell outline with edge tessellation (matches stroke density).
 * Order: top L→R, right T→B, bottom R→L, left B→T.
 */
function sphericalCellDirs(
  yA: number,
  yB: number,
  pA: number,
  pB: number,
  edgeSamples: number,
): Vec3[] {
  const n = Math.max(1, edgeSamples)
  const dirs: Vec3[] = []
  for (let i = 0; i <= n; i += 1) {
    const t = i / n
    dirs.push(lookDirection(yA + (yB - yA) * t, pB))
  }
  for (let i = 1; i <= n; i += 1) {
    const t = i / n
    dirs.push(lookDirection(yB, pB + (pA - pB) * t))
  }
  for (let i = 1; i <= n; i += 1) {
    const t = i / n
    dirs.push(lookDirection(yB + (yA - yB) * t, pA))
  }
  for (let i = 1; i < n; i += 1) {
    const t = i / n
    dirs.push(lookDirection(yA, pA + (pB - pA) * t))
  }
  return dirs
}

type SphericalMeshDiv = { divYaw: number; divPitch: number; edgeSamples?: number }

/**
 * Densify a spherical (yaw×pitch) patch into projectable screen cells.
 * Prefer mesh over outline hacks — outline polygons lose left coverage on pan.
 * Anisotropic div keeps thin overlap bands smooth along the long curved axis.
 */
function projectSphericalPatchMesh(
  yaw0: number,
  yaw1: number,
  pitchBottom: number,
  pitchTop: number,
  look: { forward: Vec3; right: Vec3; up: Vec3 },
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
  div: number | SphericalMeshDiv = PANO_MESH_DIV,
): Pt2[][] {
  if (!(yaw1 > yaw0 + 1e-4) || !(pitchTop > pitchBottom + 1e-4)) return []
  const divYaw =
    typeof div === 'number' ? div : Math.max(1, Math.floor(div.divYaw))
  const divPitch =
    typeof div === 'number' ? div : Math.max(1, Math.floor(div.divPitch))
  const edgeSamples =
    typeof div === 'number'
      ? PANO_MESH_EDGE_SAMPLES
      : Math.max(1, Math.floor(div.edgeSamples ?? PANO_MESH_EDGE_SAMPLES))
  const cells: Pt2[][] = []
  for (let i = 0; i < divYaw; i += 1) {
    const u0 = i / divYaw
    const u1 = (i + 1) / divYaw
    for (let j = 0; j < divPitch; j += 1) {
      const v0 = j / divPitch
      const v1 = (j + 1) / divPitch
      const yA = yaw0 + (yaw1 - yaw0) * u0
      const yB = yaw0 + (yaw1 - yaw0) * u1
      const pA = pitchBottom + (pitchTop - pitchBottom) * v0
      const pB = pitchBottom + (pitchTop - pitchBottom) * v1
      const dirs = sphericalCellDirs(yA, yB, pA, pB, edgeSamples)
      const corners = projectDirsToScreenPoly(
        dirs,
        look,
        stageW,
        stageH,
        stageVfovDeg,
      )
      if (corners.length < 3) continue
      const cell = finalizeMeshCell(corners, stageW, stageH)
      if (cell.length >= 3) cells.push(cell)
    }
  }
  return cells
}

/** Sample optical image-plane rectangle edges (tan-space) like sphericalCellDirs. */
function opticalCellDirs(
  shot: { forward: Vec3; right: Vec3; up: Vec3 },
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  edgeSamples: number,
): Vec3[] {
  const n = Math.max(1, edgeSamples)
  const dirs: Vec3[] = []
  const push = (x: number, y: number) => {
    dirs.push(lockLocalVec(shot, x, y))
  }
  for (let i = 0; i <= n; i += 1) {
    const t = i / n
    push(x0 + (x1 - x0) * t, y1)
  }
  for (let i = 1; i <= n; i += 1) {
    const t = i / n
    push(x1, y1 + (y0 - y1) * t)
  }
  for (let i = 1; i <= n; i += 1) {
    const t = i / n
    push(x1 + (x0 - x1) * t, y0)
  }
  for (let i = 1; i < n; i += 1) {
    const t = i / n
    push(x0, y0 + (y1 - y0) * t)
  }
  return dirs
}

type TanPt = { x: number; y: number }

function scaleAdd(a: Vec3, sa: number, b: Vec3, sb: number): Vec3 {
  return {
    x: a.x * sa + b.x * sb,
    y: a.y * sa + b.y * sb,
    z: a.z * sa + b.z * sb,
  }
}

/** Clip polygon by half-plane a + bx·x + by·y ≤ 0 (tan-space). */
function clipTanPolyByHalfPlane(
  poly: TanPt[],
  a: number,
  bx: number,
  by: number,
): TanPt[] {
  if (poly.length === 0) return []
  const dist = (p: TanPt) => a + bx * p.x + by * p.y
  const out: TanPt[] = []
  for (let i = 0; i < poly.length; i += 1) {
    const s = poly[i]!
    const e = poly[(i + 1) % poly.length]!
    const ds = dist(s)
    const de = dist(e)
    const sIn = ds <= 1e-9
    const eIn = de <= 1e-9
    if (sIn && eIn) {
      out.push(e)
    } else if (sIn && !eIn) {
      const denom = ds - de
      if (Math.abs(denom) < 1e-12) continue
      const t = Math.min(1, Math.max(0, ds / denom))
      out.push({ x: s.x + (e.x - s.x) * t, y: s.y + (e.y - s.y) * t })
    } else if (!sIn && eIn) {
      const denom = ds - de
      if (Math.abs(denom) < 1e-12) {
        out.push(e)
        continue
      }
      const t = Math.min(1, Math.max(0, ds / denom))
      out.push({ x: s.x + (e.x - s.x) * t, y: s.y + (e.y - s.y) * t })
      out.push(e)
    }
  }
  return out
}

/**
 * Exact optical overlap in shot A's image plane: sensor rectangle ∩ shot B's
 * frustum. B's frustum sides are planes through the origin → straight half-planes
 * in A's tan-space (no stair-step grid).
 */
function opticalOverlapTanPoly(
  shotA: { forward: Vec3; right: Vec3; up: Vec3 },
  shotB: { forward: Vec3; right: Vec3; up: Vec3 },
  tanHalfH: number,
  tanHalfV: number,
): TanPt[] {
  // CCW sensor rectangle in A.
  let poly: TanPt[] = [
    { x: -tanHalfH, y: tanHalfV },
    { x: tanHalfH, y: tanHalfV },
    { x: tanHalfH, y: -tanHalfV },
    { x: -tanHalfH, y: -tanHalfV },
  ]
  // Inside B: |x_B|≤tH, |y_B|≤tV, z_B≥0 — homogeneous → linear in A's (x,y).
  const normals: Vec3[] = [
    scaleAdd(shotB.right, 1, shotB.forward, -tanHalfH),
    scaleAdd(shotB.right, -1, shotB.forward, -tanHalfH),
    scaleAdd(shotB.up, 1, shotB.forward, -tanHalfV),
    scaleAdd(shotB.up, -1, shotB.forward, -tanHalfV),
    { x: -shotB.forward.x, y: -shotB.forward.y, z: -shotB.forward.z },
  ]
  for (const n of normals) {
    const a0 = dot(shotA.forward, n)
    const bx = dot(shotA.right, n)
    const by = dot(shotA.up, n)
    poly = clipTanPolyByHalfPlane(poly, a0, bx, by)
    if (poly.length < 3) return []
  }
  return poly
}

/**
 * Densify a tan-space polygon, near-clip in eye space, project as ONE fill
 * polygon — never a triangle fan (fans = visible ribs / chelou spikes).
 */
function projectTanPolyFill(
  shot: { forward: Vec3; right: Vec3; up: Vec3 },
  tanPoly: TanPt[],
  look: { forward: Vec3; right: Vec3; up: Vec3 },
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
  edgeSamples = 24,
): Pt2[][] {
  if (tanPoly.length < 3) return []
  const n = Math.max(4, edgeSamples)
  const eyes: EyePt[] = []
  for (let i = 0; i < tanPoly.length; i += 1) {
    const a = tanPoly[i]!
    const b = tanPoly[(i + 1) % tanPoly.length]!
    const count = i === tanPoly.length - 1 ? n : n + 1
    for (let s = 0; s < count; s += 1) {
      const t = s / n
      const p: TanPt = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      }
      const dir = normalize(lockLocalVec(shot, p.x, p.y))
      if (!dir) continue
      eyes.push(dirToEye(dir, look))
    }
  }
  if (eyes.length < 3) return []
  // Recti: if any sample is behind the near plane, drop the fill instead of
  // clipEyeNear-salvaging — that cut projects as the zenith "boule" oval.
  const minZ = nearClipMinZForStage()
  if (getStageProjection() === 'rectilinear') {
    for (const e of eyes) {
      if (e.z < minZ) return []
    }
  }
  const clippedEyes = clipEyeNear(eyes, minZ)
  if (clippedEyes.length < 3) return []
  const screen: Pt2[] = []
  for (const e of clippedEyes) {
    const pt = eyeToScreen(e, stageW, stageH, stageVfovDeg)
    if (pt && isFinitePt(pt)) screen.push(pt)
  }
  if (screen.length < 3) return []
  return finalizeProjectedFill(screen, stageW, stageH)
}

/**
 * Optical overlap = exact sensor-A ∩ frustum-B, one smooth fill polygon.
 */
function projectOpticalOverlapMesh(
  yawA: number,
  pitchA: number,
  yawB: number,
  pitchB: number,
  halfHDeg: number,
  halfVDeg: number,
  tanHalfH: number,
  tanHalfV: number,
  look: { forward: Vec3; right: Vec3; up: Vec3 },
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
  _div?: SphericalMeshDiv,
): Pt2[][] {
  const shotA = cameraBasis(yawA, pitchA)
  const shotB = cameraBasis(yawB, pitchB)
  const tanPoly = opticalOverlapTanPoly(shotA, shotB, tanHalfH, tanHalfV)
  if (tanPoly.length < 3) return []
  const single = projectTanPolyFill(
    shotA,
    tanPoly,
    look,
    stageW,
    stageH,
    stageVfovDeg,
    28,
  )
  if (single.length > 0) return single
  // Recti: no spherical fallback — those cells stretch into junk fans.
  if (getStageProjection() === 'rectilinear') return []
  // Zenith stereo: single poly bowtied — spherical az/alt band instead.
  const yaw0 = Math.max(yawA - halfHDeg, yawB - halfHDeg)
  const yaw1 = Math.min(yawA + halfHDeg, yawB + halfHDeg)
  const pitch0 = Math.max(pitchA - halfVDeg, pitchB - halfVDeg)
  const pitch1 = Math.min(pitchA + halfVDeg, pitchB + halfVDeg)
  return projectSphericalPatchMesh(
    yaw0,
    yaw1,
    pitch0,
    pitch1,
    look,
    stageW,
    stageH,
    stageVfovDeg,
    { divYaw: 6, divPitch: 6, edgeSamples: 6 },
  )
}

/**
 * Optical sensor fill as a densified tan-space mesh.
 *
 * A single projected sensor poly looks smooth on the horizon but near zenith
 * under stereographic it bowties into a screen-filling green fan — always mesh.
 * Keep cells small + edge-sampled so the fill tracks the white stroke curves.
 */
function projectOpticalFrustumMesh(
  shotYawDeg: number,
  shotPitchDeg: number,
  tanHalfH: number,
  tanHalfV: number,
  look: { forward: Vec3; right: Vec3; up: Vec3 },
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
  div = PANO_MESH_DIV,
): Pt2[][] {
  const shot = cameraBasis(shotYawDeg, shotPitchDeg)
  // Denser under stereo: coarse quads = visible green triangle fans at zenith.
  const meshDiv =
    getStageProjection() === 'stereographic'
      ? Math.max(div, 14)
      : Math.max(div, 10)
  const edgeSamples =
    getStageProjection() === 'stereographic'
      ? Math.max(PANO_MESH_EDGE_SAMPLES, 8)
      : PANO_MESH_EDGE_SAMPLES
  const cells: Pt2[][] = []
  for (let i = 0; i < meshDiv; i += 1) {
    const u0 = i / meshDiv
    const u1 = (i + 1) / meshDiv
    for (let j = 0; j < meshDiv; j += 1) {
      const v0 = j / meshDiv
      const v1 = (j + 1) / meshDiv
      const x0 = -tanHalfH + 2 * tanHalfH * u0
      const x1 = -tanHalfH + 2 * tanHalfH * u1
      const y0 = -tanHalfV + 2 * tanHalfV * v0
      const y1 = -tanHalfV + 2 * tanHalfV * v1
      const tryDirs = [
        opticalCellDirs(shot, x0, x1, y0, y1, edgeSamples),
        opticalCellDirs(shot, x0, x1, y0, y1, 1),
      ]
      let cell: Pt2[] = []
      for (const dirs of tryDirs) {
        const corners = projectDirsToScreenPoly(
          dirs,
          look,
          stageW,
          stageH,
          stageVfovDeg,
        )
        if (corners.length < 3) continue
        cell = finalizeMeshCell(corners, stageW, stageH)
        if (cell.length >= 3) break
      }
      if (cell.length >= 3) cells.push(cell)
    }
  }
  return cells
}

/**
 * Stereographic samples near the antipode land at huge screen radii. Keep them
 * for smooth arcs that leave the viewBox (SVG clips), but drop the singularity
 * neighbourhood — never clamp onto a pad box (that smashed curves into the
 * unfinished / pinched white strokes).
 */
function isUsableStrokePt(p: Pt2, stageW: number, stageH: number): boolean {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false
  // Recti: drop only extreme singularity runaways. Stereo/équi: keep all.
  if (getStageProjection() !== 'rectilinear') return true
  const lim = Math.max(stageW, stageH) * 5
  return (
    Math.abs(p.x - stageW * 0.5) <= lim &&
    Math.abs(p.y - stageH * 0.5) <= lim
  )
}

function projectEyeSample(
  eye: EyePt,
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
): Pt2 | null {
  const pt = eyeToScreen(eye, stageW, stageH, stageVfovDeg)
  if (!pt || !isFinitePt(pt) || !isUsableStrokePt(pt, stageW, stageH)) {
    return null
  }
  return pt
}

function eyeNearIntersect(a: EyePt, b: EyePt, minZ: number): EyePt {
  const denom = b.z - a.z
  const t = Math.abs(denom) < 1e-8 ? 0 : (minZ - a.z) / denom
  const clamped = Math.min(1, Math.max(0, t))
  return {
    x: a.x + (b.x - a.x) * clamped,
    y: a.y + (b.y - a.y) * clamped,
    z: minZ,
  }
}

/**
 * Rectilinear: draw each sensor edge on its own. A closed-loop walk + near
 * clip was punching the concentric arcs in the middle of the Mano fan.
 */
function projectRectilinearOpticalStrokes(
  shotYawDeg: number,
  shotPitchDeg: number,
  tanHalfH: number,
  tanHalfV: number,
  look: { forward: Vec3; right: Vec3; up: Vec3 },
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
  samples = 48,
): Pt2[][] {
  const shot = cameraBasis(shotYawDeg, shotPitchDeg)
  const corners: [number, number][] = [
    [-tanHalfH, tanHalfV],
    [tanHalfH, tanHalfV],
    [tanHalfH, -tanHalfV],
    [-tanHalfH, -tanHalfV],
  ]
  const minZ = nearClipMinZForStage()
  const strokes: Pt2[][] = []
  const n = Math.max(8, samples)
  for (let e = 0; e < 4; e += 1) {
    const a = corners[e]!
    const b = corners[(e + 1) % 4]!
    let current: Pt2[] = []
    const flush = () => {
      if (current.length >= 2) strokes.push(current)
      current = []
    }
    for (let i = 0; i <= n; i += 1) {
      const t = i / n
      const dir = normalize(
        lockLocalVec(
          shot,
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
        ),
      )
      if (!dir) {
        flush()
        continue
      }
      const eye = dirToEye(dir, look)
      if (eye.z < minZ) {
        flush()
        continue
      }
      const pt = eyeToScreen(eye, stageW, stageH, stageVfovDeg)
      if (!pt || !isFinitePt(pt) || !isUsableStrokePt(pt, stageW, stageH)) {
        flush()
        continue
      }
      current.push(pt)
    }
    flush()
  }
  return strokes
}

/**
 * Project a closed direction loop as continuous strokes (stereo / equi).
 * Never draw a near-plane / antipode chord across the screen.
 */
function projectBoundaryStrokes(
  dirs: Vec3[],
  look: { forward: Vec3; right: Vec3; up: Vec3 },
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
): Pt2[][] {
  if (dirs.length < 2) return []
  const eyes: EyePt[] = []
  for (const d of dirs) {
    const n = normalize(d) ?? d
    eyes.push(dirToEye(n, look))
  }
  return projectBoundaryStrokesSplit(eyes, stageW, stageH, stageVfovDeg)
}

/** Split-at-near-plane / wrap path used by stereo & equi (and recti fallback). */
function projectBoundaryStrokesSplit(
  eyes: EyePt[],
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
): Pt2[][] {
  const minZ = nearClipMinZForStage()
  const strokes: Pt2[][] = []
  let current: Pt2[] = []
  const flush = () => {
    if (current.length >= 2) strokes.push(current)
    current = []
  }
  const push = (p: Pt2 | null) => {
    if (!p) {
      flush()
      return
    }
    if (current.length > 0) {
      const prev = current[current.length - 1]!
      if (segmentIsProjectionWrap(prev, p, stageW, stageH)) {
        flush()
      }
    }
    current.push(p)
  }

  const eyeOk = (e: EyePt) => !Number.isFinite(minZ) || e.z >= minZ
  const n = eyes.length
  for (let i = 0; i < n; i += 1) {
    const a = eyes[i]!
    const b = eyes[(i + 1) % n]!
    const aIn = eyeOk(a)
    const bIn = eyeOk(b)
    if (aIn && bIn) {
      if (current.length === 0) {
        push(projectEyeSample(a, stageW, stageH, stageVfovDeg))
      }
      push(projectEyeSample(b, stageW, stageH, stageVfovDeg))
      continue
    }
    if (aIn && !bIn) {
      if (current.length === 0) {
        push(projectEyeSample(a, stageW, stageH, stageVfovDeg))
      }
      if (Number.isFinite(minZ)) {
        const hit = projectEyeSample(
          eyeNearIntersect(a, b, minZ),
          stageW,
          stageH,
          stageVfovDeg,
        )
        if (hit) push(hit)
      }
      flush()
      continue
    }
    if (!aIn && bIn) {
      flush()
      if (Number.isFinite(minZ)) {
        const hit = projectEyeSample(
          eyeNearIntersect(a, b, minZ),
          stageW,
          stageH,
          stageVfovDeg,
        )
        if (hit) push(hit)
      }
      push(projectEyeSample(b, stageW, stageH, stageVfovDeg))
      continue
    }
    flush()
  }
  flush()
  // Drop tiny near-plane crumbs (Recti Mano shred) — keep real frame edges.
  return strokes.filter((s) => s.length >= 8)
}

function flattenCells(cells: Pt2[][]): Pt2[] {
  if (cells.length === 0) return []
  // Representative poly for envelope: largest cell by |area|.
  let best = cells[0]!
  let bestA = Math.abs(polygonSignedArea(best))
  for (let i = 1; i < cells.length; i += 1) {
    const a = Math.abs(polygonSignedArea(cells[i]!))
    if (a > bestA) {
      best = cells[i]!
      bestA = a
    }
  }
  return best
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

      const yaw0 = cyaw - halfHDeg
      const yaw1 = cyaw + halfHDeg
      const pitch0 = cpitch - halfVDeg
      const pitch1 = cpitch + halfVDeg

      // Recti: hide only shots aimed clearly behind the camera.
      const aimEyeZ = dirToEye(aim, look).z
      const rectiHidden =
        getStageProjection() === 'rectilinear' && aimEyeZ < 0.02

      const cells = rectiHidden
        ? []
        : mode === 'spherical'
          ? projectSphericalPatchMesh(
              yaw0,
              yaw1,
              pitch0,
              pitch1,
              look,
              input.stageW,
              input.stageH,
              input.stageVfovDeg,
            )
          : projectOpticalFrustumMesh(
              cyaw,
              cpitch,
              tanHalfH,
              tanHalfV,
              look,
              input.stageW,
              input.stageH,
              input.stageVfovDeg,
            )

      const strokes = rectiHidden
        ? []
        : getStageProjection() === 'rectilinear' && mode === 'optical'
          ? projectRectilinearOpticalStrokes(
              cyaw,
              cpitch,
              tanHalfH,
              tanHalfV,
              look,
              input.stageW,
              input.stageH,
              input.stageVfovDeg,
              48,
            )
          : projectBoundaryStrokes(
              mode === 'spherical'
                ? sphericalRectDirs(yaw0, yaw1, pitch0, pitch1)
                : opticalFrustumEdgeDirs(
                    cyaw,
                    cpitch,
                    tanHalfH,
                    tanHalfV,
                    PANO_EDGE_SAMPLES,
                  ),
              look,
              input.stageW,
              input.stageH,
              input.stageVfovDeg,
            )

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
        yaw: cyaw,
        pitch: cpitch,
        cells,
        strokes,
        polygon: flattenCells(cells),
        center,
        badge,
      })
      index += 1
    }
  }

  /**
   * Overlap bands follow the assemblage mode:
   * - spherical → az/alt FOV ∩ FOV
   * - optical → sky inside BOTH sensor frustums (must match white optical frames)
   */
  const overlaps: LockedPanoOverlap[] = []
  const byKey = new Map(tiles.map((t) => [`${t.col},${t.row}`, t]))

  const overlapMeshBetween = (
    a: LockedPanoTile,
    b: LockedPanoTile,
    axis: 'h' | 'v',
  ): Pt2[][] => {
    if (mode === 'spherical') {
      const div: SphericalMeshDiv =
        axis === 'h'
          ? {
              divYaw: 3,
              divPitch: Math.max(PANO_MESH_DIV, 14),
              edgeSamples: PANO_MESH_EDGE_SAMPLES,
            }
          : {
              divYaw: Math.max(PANO_MESH_DIV, 14),
              divPitch: 3,
              edgeSamples: PANO_MESH_EDGE_SAMPLES,
            }
      const yaw0 = Math.max(a.yaw - halfHDeg, b.yaw - halfHDeg)
      const yaw1 = Math.min(a.yaw + halfHDeg, b.yaw + halfHDeg)
      const pitch0 = Math.max(a.pitch - halfVDeg, b.pitch - halfVDeg)
      const pitch1 = Math.min(a.pitch + halfVDeg, b.pitch + halfVDeg)
      return projectSphericalPatchMesh(
        yaw0,
        yaw1,
        pitch0,
        pitch1,
        look,
        input.stageW,
        input.stageH,
        input.stageVfovDeg,
        div,
      )
    }
    // Optical: exact sensor-A ∩ frustum-B (no voxel stairs).
    return projectOpticalOverlapMesh(
      a.yaw,
      a.pitch,
      b.yaw,
      b.pitch,
      halfHDeg,
      halfVDeg,
      tanHalfH,
      tanHalfV,
      look,
      input.stageW,
      input.stageH,
      input.stageVfovDeg,
    )
  }

  for (const tile of tiles) {
    const right = byKey.get(`${tile.col + 1},${tile.row}`)
    if (right) {
      const cells = overlapMeshBetween(tile, right, 'h')
      if (cells.length > 0) {
        overlaps.push({ key: `h-${tile.col}-${tile.row}`, cells })
      }
    }
    const below = byKey.get(`${tile.col},${tile.row + 1}`)
    if (below) {
      const cells = overlapMeshBetween(tile, below, 'v')
      if (cells.length > 0) {
        overlaps.push({ key: `v-${tile.col}-${tile.row}`, cells })
      }
    }
  }

  return { tiles, overlaps }
}

function pointsToSvg(points: Pt2[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}

/** Map normalized frame UV (top-left origin) into lock tan-space. */
function uvToTan(
  u: number,
  v: number,
  tanHalfH: number,
  tanHalfV: number,
): { x: number; y: number } {
  return {
    x: -tanHalfH + 2 * tanHalfH * u,
    y: tanHalfV - 2 * tanHalfV * v,
  }
}

function projectUvLine(
  bases: LockLookBases,
  tanHalfH: number,
  tanHalfV: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  samples = 12,
): Pt2[] {
  const pts: Pt2[] = []
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples
    const uv = {
      u: u0 + (u1 - u0) * t,
      v: v0 + (v1 - v0) * t,
    }
    const tan = uvToTan(uv.u, uv.v, tanHalfH, tanHalfV)
    const pt = projectLockTanPoint(bases, tan.x, tan.y)
    if (pt) pts.push(pt)
  }
  return pts
}

function lockedCompositionGuidePolylines(input: {
  mode: CompositionGuideMode
  orientation: ViewfinderOrientation
  bases: LockLookBases
  tanHalfH: number
  tanHalfV: number
}): Pt2[][] {
  const { mode, orientation, bases, tanHalfH, tanHalfV } = input
  if (mode === 'off') return []
  const line = (u0: number, v0: number, u1: number, v1: number) =>
    projectUvLine(bases, tanHalfH, tanHalfV, u0, v0, u1, v1)

  if (mode === 'thirds') {
    return [
      line(1 / 3, 0, 1 / 3, 1),
      line(2 / 3, 0, 2 / 3, 1),
      line(0, 1 / 3, 1, 1 / 3),
      line(0, 2 / 3, 1, 2 / 3),
    ].filter((p) => p.length >= 2)
  }
  if (mode === 'phi') {
    const a = 1 - PHI_INV
    const b = PHI_INV
    return [
      line(a, 0, a, 1),
      line(b, 0, b, 1),
      line(0, a, 1, a),
      line(0, b, 1, b),
    ].filter((p) => p.length >= 2)
  }
  if (mode === 'center') {
    const c = 0.5
    const arm = 0.045
    const corner = 0.06
    const out: Pt2[][] = [
      line(c, c - arm, c, c + arm),
      line(c - arm, c, c + arm, c),
      line(0, corner, 0, 0),
      line(0, 0, corner, 0),
      line(1 - corner, 0, 1, 0),
      line(1, 0, 1, corner),
      line(0, 1 - corner, 0, 1),
      line(0, 1, corner, 1),
      line(1 - corner, 1, 1, 1),
      line(1, 1 - corner, 1, 1),
    ]
    return out.filter((p) => p.length >= 2)
  }
  const width = orientation === 'landscape' ? 3 : 2
  const height = orientation === 'landscape' ? 2 : 3
  const feet = goldenTriangleFeet(width, height)
  return [
    line(0, 1, 1, 0),
    line(0, 0, feet.fromTopLeft.x / width, feet.fromTopLeft.y / height),
    line(
      1,
      1,
      feet.fromBottomRight.x / width,
      feet.fromBottomRight.y / height,
    ),
  ].filter((p) => p.length >= 2)
}

/** SVG viewfinder rectangle — optical frame projected onto the stage. */
export function PhotoFrameOverlay({
  stageW,
  stageH,
  orientation,
  frameMode = 'dslr',
  stageVfovDeg,
  opticalVfovDeg,
  opticalHfovDeg,
  panorama = null,
  worldLock = null,
  frameRollDeg = 0,
  hideGrid = false,
  compositionGuide = 'off',
  outsideDimOpacity = 0.28,
}: PhotoFrameOverlayProps) {
  if (stageW < 2 || stageH < 2) return null
  if (frameMode === 'off') return null

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

  const panoOn = frameMode === 'pano' && panorama != null

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
  // Keep every tile that still has at least one mesh cell — never drop half-in FOV.
  const panoTiles = (projectedPano?.tiles ?? []).filter(
    (t) => t.cells.length > 0 || t.strokes.length > 0,
  )
  const panoOverlaps = projectedPano?.overlaps ?? []

  const showLockedFrame = !panoOn && lockedPoly != null
  const showProjectedPano = panoOn && canProjectAngles
  const showFollowFrame = !panoOn && !locked
  // Soft outside matte for Photo / Pano — keep it very light so a wide stage
  // (stage FOV ≫ optical) still reads as landscape, not a black letterbox.
  const showDim = showProjectedPano || locked || showFollowFrame

  const left = (stageW - frameW) / 2
  const top = (stageH - frameH) / 2
  const frameCx = left + frameW / 2
  const frameCy = top + frameH / 2
  const followRoll =
    showFollowFrame && Number.isFinite(frameRollDeg) && frameRollDeg !== 0
      ? frameRollDeg
      : 0
  const followRollTransform =
    followRoll !== 0
      ? `rotate(${followRoll} ${frameCx} ${frameCy})`
      : undefined

  const showFrames = panoOn && panorama.showFrames
  const showOverlap = panoOn && panorama.showOverlap

  const badgeR = Math.max(5, Math.min(frameW, frameH) * 0.018)

  const quadPoints = lockedPoly ? pointsToSvg(lockedPoly) : ''
  const dimAlpha = Math.min(1, Math.max(0, outsideDimOpacity))
  const showGuides =
    !hideGrid && compositionGuide !== 'off' && (showFollowFrame || showLockedFrame)

  const lockedGuidePolys =
    showGuides && showLockedFrame && canProjectAngles && locked
      ? lockedCompositionGuidePolylines({
          mode: compositionGuide,
          orientation,
          bases: {
            lock: cameraBasis(worldLock!.lockYawDeg, worldLock!.lockPitchDeg),
            look: cameraBasis(worldLock!.lookYawDeg, worldLock!.lookPitchDeg),
            stageW,
            stageH,
            stageVfovDeg: stageVfovDeg!,
          },
          tanHalfH: Math.tan(
            ((Math.max(derivedHfov!, 0.5) / 2) * Math.PI) / 180,
          ),
          tanHalfV: Math.tan(
            ((Math.max(opticalVfovDeg!, 0.5) / 2) * Math.PI) / 180,
          ),
        })
      : []

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
                ? panoTiles.flatMap((tile) =>
                    tile.cells.map((cell, ci) => (
                      <polygon
                        key={`mask-${tile.index}-${ci}`}
                        points={pointsToSvg(cell)}
                        fill="black"
                      />
                    )),
                  )
                : showLockedFrame ? (
                    <polygon points={quadPoints} fill="black" />
                  ) : showFollowFrame ? (
                    <g transform={followRollTransform}>
                      <rect
                        x={left}
                        y={top}
                        width={frameW}
                        height={frameH}
                        fill="black"
                        rx={2}
                      />
                    </g>
                  ) : null}
            </mask>
          ) : null}
        </defs>

        {showDim ? (
          <rect
            width={stageW}
            height={stageH}
            fill={`rgba(0, 0, 0, ${dimAlpha})`}
            mask="url(#photo-frame-mask)"
          />
        ) : null}

        {showOverlap && showProjectedPano
          ? panoOverlaps.flatMap((band) =>
              band.cells.map((cell, ci) => (
                <polygon
                  key={`ov-${band.key}-${ci}`}
                  points={pointsToSvg(cell)}
                  fill={accentRgba(0.32)}
                  stroke="none"
                />
              )),
            )
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
                  {tile.strokes.map((stroke, si) => (
                    <polyline
                      key={`stroke-${tile.index}-${si}`}
                      points={pointsToSvg(stroke)}
                      fill="none"
                      stroke="rgba(232, 244, 255, 0.88)"
                      strokeWidth={1.6}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}
                  {badgeOnStage ? (
                    <>
                      <circle
                        cx={badge!.x}
                        cy={badge!.y}
                        r={badgeR}
                        fill="rgba(8, 12, 20, 0.82)"
                        stroke={accentRgba(0.8)}
                        strokeWidth={0.9}
                      />
                      <text
                        x={badge!.x}
                        y={badge!.y + 0.4}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="var(--ui-action-primary-text)"
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
              stroke={accentRgba(0.98)}
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
            {lockedGuidePolys.map((pts, i) => (
              <polyline
                key={`guide-${i}`}
                points={pointsToSvg(pts)}
                fill="none"
                stroke="rgba(255, 255, 255, 0.48)"
                strokeWidth={1}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </>
        ) : null}

        {showFollowFrame ? (
          <g transform={followRollTransform}>
            <rect
              x={left}
              y={top}
              width={frameW}
              height={frameH}
              fill="none"
              stroke={accentRgba(0.98)}
              strokeWidth={2.5}
              rx={2}
            />
          </g>
        ) : null}
      </svg>

      {showGuides && showFollowFrame ? (
        <div
          className="photo-frame__guide"
          style={{
            left,
            top,
            width: frameW,
            height: frameH,
            transform:
              followRoll !== 0 ? `rotate(${followRoll}deg)` : undefined,
          }}
        >
          <CompositionGuideOverlay
            mode={compositionGuide}
            orientation={orientation}
          />
        </div>
      ) : null}
    </div>
  )
}
