/** Timelapse planner — exposure cadence + mount mode for sequence preview. */

export type TimelapseSupport = 'fixed' | 'equatorial'

/** How equatorial field rotation is shown during preview. */
export type TimelapseEqRotation = 'scene' | 'frame'

export const TIMELAPSE_SUPPORTS: readonly TimelapseSupport[] = [
  'fixed',
  'equatorial',
] as const

export const TIMELAPSE_EQ_ROTATIONS: readonly TimelapseEqRotation[] = [
  'scene',
  'frame',
] as const

export const TIMELAPSE_SUPPORT_LABELS: Record<TimelapseSupport, string> = {
  fixed: 'Trépied fixe',
  equatorial: 'Monture équatoriale',
}

export const TIMELAPSE_EQ_ROTATION_LABELS: Record<TimelapseEqRotation, string> =
  {
    scene: 'Sol (roll caméra)',
    frame: 'Cadre seul',
  }

export type TimelapsePlan = {
  /** Exposure length (seconds) — planning only; interval starts next pose. */
  poseS: number
  /** Seconds between successive exposure starts. */
  intervalS: number
  /** Total capture window (minutes). */
  durationMin: number
  /** Playback rate for the preview / resulting video (images per second). */
  playbackFps: number
  support: TimelapseSupport
  /**
   * Equatorial field rotation visualisation:
   * - scene: roll the 3D camera (horizon tips — true EQ feel)
   * - frame: keep horizon level, rotate the photo frame overlay
   */
  eqRotation: TimelapseEqRotation
}

export const DEFAULT_TIMELAPSE_PLAN: TimelapsePlan = {
  poseS: 20,
  intervalS: 25,
  durationMin: 120,
  playbackFps: 25,
  support: 'fixed',
  eqRotation: 'scene',
}

export const TIMELAPSE_POSE_MIN_S = 1
export const TIMELAPSE_POSE_MAX_S = 900
export const TIMELAPSE_INTERVAL_MIN_S = 1
export const TIMELAPSE_INTERVAL_MAX_S = 3600
export const TIMELAPSE_DURATION_MIN_MIN = 1
export const TIMELAPSE_DURATION_MAX_MIN = 24 * 60
export const TIMELAPSE_FPS_MIN = 1
export const TIMELAPSE_FPS_MAX = 60
/** Soft cap so preview stays interactive on long plans. */
export const TIMELAPSE_PREVIEW_MAX_WALL_S = 20

export function normalizeTimelapseSupport(value: unknown): TimelapseSupport {
  return TIMELAPSE_SUPPORTS.includes(value as TimelapseSupport)
    ? (value as TimelapseSupport)
    : DEFAULT_TIMELAPSE_PLAN.support
}

export function normalizeTimelapseEqRotation(
  value: unknown,
): TimelapseEqRotation {
  return TIMELAPSE_EQ_ROTATIONS.includes(value as TimelapseEqRotation)
    ? (value as TimelapseEqRotation)
    : DEFAULT_TIMELAPSE_PLAN.eqRotation
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampTimelapsePoseS(value: number): number {
  return clampInt(
    value,
    TIMELAPSE_POSE_MIN_S,
    TIMELAPSE_POSE_MAX_S,
    DEFAULT_TIMELAPSE_PLAN.poseS,
  )
}

export function clampTimelapseIntervalS(value: number, poseS?: number): number {
  const pose = poseS == null ? TIMELAPSE_INTERVAL_MIN_S : clampTimelapsePoseS(poseS)
  const min = Math.max(TIMELAPSE_INTERVAL_MIN_S, pose)
  return clampInt(
    value,
    min,
    TIMELAPSE_INTERVAL_MAX_S,
    Math.max(min, DEFAULT_TIMELAPSE_PLAN.intervalS),
  )
}

export function clampTimelapseDurationMin(value: number): number {
  return clampInt(
    value,
    TIMELAPSE_DURATION_MIN_MIN,
    TIMELAPSE_DURATION_MAX_MIN,
    DEFAULT_TIMELAPSE_PLAN.durationMin,
  )
}

export function clampTimelapsePlaybackFps(value: number): number {
  return clampInt(
    value,
    TIMELAPSE_FPS_MIN,
    TIMELAPSE_FPS_MAX,
    DEFAULT_TIMELAPSE_PLAN.playbackFps,
  )
}

export function normalizeTimelapsePlan(value: unknown): TimelapsePlan {
  const row =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null
  if (!row) return { ...DEFAULT_TIMELAPSE_PLAN }
  const poseS = clampTimelapsePoseS(Number(row.poseS))
  return {
    poseS,
    intervalS: clampTimelapseIntervalS(Number(row.intervalS), poseS),
    durationMin: clampTimelapseDurationMin(Number(row.durationMin)),
    playbackFps: clampTimelapsePlaybackFps(Number(row.playbackFps)),
    support: normalizeTimelapseSupport(row.support),
    eqRotation: normalizeTimelapseEqRotation(row.eqRotation),
  }
}

/**
 * Camera / frame roll (deg) that freezes celestial orientation from t0.
 * q is Meeus parallactic angle (east negative); Δq = q0 − q_t.
 */
export function timelapseFieldRollDeg(q0Rad: number, qRad: number): number {
  return ((q0Rad - qRad) * 180) / Math.PI
}

/** Shot count from capture window ÷ interval between starts. */
export function timelapseShotCount(
  durationMin: number,
  intervalS: number,
): number {
  const duration = clampTimelapseDurationMin(durationMin)
  const interval = clampTimelapseIntervalS(intervalS)
  if (interval <= 0) return 0
  return Math.max(1, Math.floor((duration * 60) / interval))
}

/** Resulting video length at the chosen playback rate. */
export function timelapseVideoSeconds(
  shotCount: number,
  playbackFps: number,
): number {
  const fps = clampTimelapsePlaybackFps(playbackFps)
  if (fps <= 0 || shotCount <= 0) return 0
  return shotCount / fps
}

export function formatTimelapseVideoSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 s'
  if (seconds < 10) return `${seconds.toFixed(1)} s`
  if (seconds < 60) return `${Math.round(seconds * 10) / 10} s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds - m * 60)
  return s > 0 ? `${m} min ${s} s` : `${m} min`
}

/**
 * Wall-clock delay between preview frames. Speeds up very long sequences
 * so preview finishes within TIMELAPSE_PREVIEW_MAX_WALL_S.
 */
export function timelapsePreviewFrameDelayMs(
  shotCount: number,
  playbackFps: number,
): number {
  const fps = clampTimelapsePlaybackFps(playbackFps)
  const naturalMs = 1000 / fps
  if (shotCount <= 1) return naturalMs
  const naturalWallS = shotCount / fps
  if (naturalWallS <= TIMELAPSE_PREVIEW_MAX_WALL_S) return naturalMs
  return (TIMELAPSE_PREVIEW_MAX_WALL_S * 1000) / shotCount
}

/** UTC of shot index `i` (0-based) from sequence start. */
export function timelapseShotUtcMs(
  startUtcMs: number,
  intervalS: number,
  shotIndex: number,
): number {
  return startUtcMs + shotIndex * clampTimelapseIntervalS(intervalS) * 1000
}

/** Sidereal day (IAU) — sky turns 2π in this many seconds. */
export const SIDEREAL_DAY_S = 86_164.0905

/** Earth rotation rate on the celestial equator (° / s). */
export const SIDEREAL_DEG_PER_S = 360 / SIDEREAL_DAY_S

/**
 * Rule-of-500 style max pose (s) before trailing becomes obvious on
 * full-frame at the given focal length.
 */
export function timelapseRuleOf500PoseS(focalMm: number): number {
  const f = Number.isFinite(focalMm) && focalMm > 0 ? focalMm : 24
  return Math.max(1, Math.round(500 / f))
}

/**
 * Sky arc (rad) swept during one exposure on a fixed tripod.
 * Equatorial tracking → 0 (no trail).
 */
export function timelapseStarTrailArcRad(
  poseS: number,
  support: TimelapseSupport,
): number {
  if (support !== 'fixed') return 0
  const pose = clampTimelapsePoseS(poseS)
  return (pose * 2 * Math.PI) / SIDEREAL_DAY_S
}
