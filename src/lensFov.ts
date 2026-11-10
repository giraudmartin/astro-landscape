/** Full-frame sensor FOV helpers (same math as Photo Sightline). */

export const FOCAL_LENGTH_PRESETS_MM = [
  14, 16, 20, 24, 28, 35, 50, 70, 85, 100, 135, 200, 300, 400,
] as const

export type FocalLengthMm = (typeof FOCAL_LENGTH_PRESETS_MM)[number]
export type ViewfinderOrientation = 'portrait' | 'landscape'

export const DEFAULT_FOCAL_LENGTH_MM: FocalLengthMm = 20
export const DEFAULT_ORIENTATION: ViewfinderOrientation = 'landscape'

export const FOCAL_LENGTH_MIN_MM = 14
export const FOCAL_LENGTH_MAX_MM = 1200

/** Sensor format — crop factor shrinks FOV relative to full-frame (PS). */
export const SENSOR_FORMATS = ['ff', 'apsc15', 'apsc16'] as const
export type SensorFormat = (typeof SENSOR_FORMATS)[number]

export const DEFAULT_SENSOR_FORMAT: SensorFormat = 'ff'

export const SENSOR_FORMAT_LABEL: Record<SensorFormat, string> = {
  ff: 'Plein Format',
  apsc15: 'APS-C 1.5',
  apsc16: 'APS-C 1.6',
}

export const SENSOR_CROP_FACTOR: Record<SensorFormat, number> = {
  ff: 1,
  apsc15: 1.5,
  apsc16: 1.6,
}

export function clampFocalLengthMm(focalMm: number): number {
  if (!Number.isFinite(focalMm)) return DEFAULT_FOCAL_LENGTH_MM
  return Math.min(
    FOCAL_LENGTH_MAX_MM,
    Math.max(FOCAL_LENGTH_MIN_MM, Math.round(focalMm)),
  )
}

export function isFocalLengthPreset(focalMm: number): boolean {
  return (FOCAL_LENGTH_PRESETS_MM as readonly number[]).includes(focalMm)
}

const FULL_FRAME_SENSOR_WIDTH_MM = 36
const FULL_FRAME_SENSOR_HEIGHT_MM = 24

export const FULL_FRAME_LANDSCAPE_ASPECT =
  FULL_FRAME_SENSOR_WIDTH_MM / FULL_FRAME_SENSOR_HEIGHT_MM

export function viewfinderAspectRatio(
  orientation: ViewfinderOrientation,
): number {
  return orientation === 'landscape'
    ? FULL_FRAME_LANDSCAPE_ASPECT
    : FULL_FRAME_SENSOR_HEIGHT_MM / FULL_FRAME_SENSOR_WIDTH_MM
}

function verticalSensorMm(orientation: ViewfinderOrientation): number {
  return orientation === 'landscape'
    ? FULL_FRAME_SENSOR_HEIGHT_MM
    : FULL_FRAME_SENSOR_WIDTH_MM
}

function horizontalSensorMm(orientation: ViewfinderOrientation): number {
  return orientation === 'landscape'
    ? FULL_FRAME_SENSOR_WIDTH_MM
    : FULL_FRAME_SENSOR_HEIGHT_MM
}

export function verticalFovDegFromFocalMm(
  focalMm: number,
  orientation: ViewfinderOrientation = DEFAULT_ORIENTATION,
  cropFactor = 1,
): number {
  const f = Math.max(focalMm, 1)
  const crop = Math.max(cropFactor, 1)
  const sensorH = verticalSensorMm(orientation) / crop
  return (2 * Math.atan(sensorH / (2 * f)) * 180) / Math.PI
}

export function horizontalFovDegFromFocalMm(
  focalMm: number,
  orientation: ViewfinderOrientation = DEFAULT_ORIENTATION,
  cropFactor = 1,
): number {
  const f = Math.max(focalMm, 1)
  const crop = Math.max(cropFactor, 1)
  const sensorW = horizontalSensorMm(orientation) / crop
  return (2 * Math.atan(sensorW / (2 * f)) * 180) / Math.PI
}

/** Frame size contained in the stage (object-fit: contain). */
export function viewfinderFrameSizeInStage(
  stageW: number,
  stageH: number,
  orientation: ViewfinderOrientation,
): { frameW: number; frameH: number } {
  const sensorAspect = viewfinderAspectRatio(orientation)
  const stageAspect = stageW / Math.max(stageH, 1e-6)
  if (stageAspect > sensorAspect) {
    return { frameH: stageH, frameW: stageH * sensorAspect }
  }
  return { frameW: stageW, frameH: stageW / sensorAspect }
}

/**
 * Vertical FOV of the Three.js camera so the optical frame sits centered
 * with context visible around it (letterbox / pillarbox scene).
 * @deprecated Prefer wheel-controlled stage FOV + projection frame sizing.
 */
export function stageVerticalFovDeg(
  opticalVfovDeg: number,
  stageW: number,
  stageH: number,
  orientation: ViewfinderOrientation,
): number {
  const { frameH } = viewfinderFrameSizeInStage(stageW, stageH, orientation)
  return opticalVfovDeg * (stageH / Math.max(frameH, 1e-6))
}

/**
 * Photo frame size on the stage.
 * Narrower focal → smaller rectangle; wider than stage FOV → fills stage.
 */
export function viewfinderFrameSizeForProjection(
  stageW: number,
  stageH: number,
  stageVfovDeg: number,
  opticalVfovDeg: number,
  orientation: ViewfinderOrientation,
  projection:
    | 'stereographic'
    | 'equirectangular'
    | 'rectilinear'
    | 'orthographic' = 'stereographic',
): { frameW: number; frameH: number } {
  const sensorAspect = viewfinderAspectRatio(orientation)
  const stageCap =
    projection === 'equirectangular'
      ? EQUIRECT_VFOV_MAX_DEG
      : projection === 'rectilinear'
        ? RECTILINEAR_VFOV_MAX_DEG
        : projection === 'orthographic'
          ? ORTHOGRAPHIC_VFOV_MAX_DEG
          : 359
  const stage = Math.min(Math.max(stageVfovDeg, 1), stageCap)
  const optic = Math.max(opticalVfovDeg, 0.5)
  const toRad = Math.PI / 180
  let scale: number
  if (projection === 'stereographic') {
    scale =
      Math.tan((optic / 4) * toRad) /
      Math.max(Math.tan((stage / 4) * toRad), 1e-6)
  } else if (projection === 'rectilinear') {
    scale =
      Math.tan((optic / 2) * toRad) /
      Math.max(Math.tan((stage / 2) * toRad), 1e-6)
  } else if (projection === 'orthographic') {
    scale =
      Math.sin((optic / 2) * toRad) /
      Math.max(Math.sin((stage / 2) * toRad), 1e-6)
  } else {
    scale = optic / stage
  }
  let frameH = stageH * scale
  let frameW = frameH * sensorAspect
  if (frameW > stageW) {
    frameW = stageW
    frameH = frameW / sensorAspect
  }
  if (frameH > stageH) {
    frameH = stageH
    frameW = frameH * sensorAspect
  }
  return { frameW, frameH }
}

export const STAGE_VFOV_MIN_DEG = 18
/**
 * Stereographic field. Stellarium's slider stops at 185°; past that the
 * same projection still opens the view, until it collapses near 360°.
 * Wide stage FOV is OK — camera.fov stays small via perspectiveFovDeg warp.
 */
export const STAGE_VFOV_MAX_DEG = 270
export const STAGE_VFOV_DEFAULT_DEG = 72
/** Same ceiling as STAGE — stereo uses vertex warp, not raw perspective FOV. */
export const STEREOGRAPHIC_VFOV_MAX_DEG = STAGE_VFOV_MAX_DEG
/**
 * Equirectangular altitude only exists between −90° and +90°.
 * Past that the frame is empty, and a widescreen view reaches the
 * ±180° seam. Keep the 2D panorama inside the sphere.
 */
export const EQUIRECT_VFOV_MAX_DEG = 150
/** Rectilinear / gnomonic blows up at 180°. Stay clear of the singularity. */
export const RECTILINEAR_VFOV_MAX_DEG = 170
/** Orthographic covers at most a hemisphere (disk of radius 1). */
export const ORTHOGRAPHIC_VFOV_MAX_DEG = 180
/**
 * Safety net for Three.PerspectiveCamera.fov (non-stereo projections).
 * Stereographic display uses a cubemap remap; HUD framing still uses
 * 2·atan(2·tan(θ/4)) (~157° at stage 270°).
 */
export const PERSPECTIVE_CAMERA_VFOV_MAX_DEG = 145
