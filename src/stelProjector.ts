import * as THREE from 'three'
import {
  EQUIRECT_VFOV_MAX_DEG,
  ORTHOGRAPHIC_VFOV_MAX_DEG,
  PERSPECTIVE_CAMERA_VFOV_MAX_DEG,
  RECTILINEAR_VFOV_MAX_DEG,
  STAGE_VFOV_MAX_DEG,
  STAGE_VFOV_MIN_DEG,
  STEREOGRAPHIC_VFOV_MAX_DEG,
} from './lensFov'

/**
 * View projections for the tripod stage.
 *
 * The nonlinear step only remaps the view ray. A perspective matrix then
 * clips, so large triangles are cut instead of stretching across the screen.
 *
 * - stereographic: Stellarium default, r = 2·tan(θ/2)
 * - equirectangular: λ = azimuth, φ = altitude, both in radians
 * - rectilinear: r = tan(θ), same stretch as a real lens
 * - orthographic: r = sin(θ), hemisphere as a disk
 */
export type StageProjection =
  | 'stereographic'
  | 'equirectangular'
  | 'rectilinear'
  | 'orthographic'

export const STAGE_PROJECTIONS: readonly {
  id: StageProjection
  label: string
  shortLabel: string
  title: string
}[] = [
  {
    id: 'stereographic',
    label: 'Stéréographique',
    shortLabel: 'Stéréo',
    title: 'Champ large',
  },
  {
    id: 'equirectangular',
    label: 'Équirectangulaire',
    shortLabel: 'Équi',
    title: 'Azimut et hauteur, horizon droit',
  },
  {
    id: 'rectilinear',
    label: 'Rectiligne',
    shortLabel: 'Recti',
    title: "Ce que voit l'objectif. Les bords s'étirent, comme sur la photo",
  },
  {
    id: 'orthographic',
    label: 'Orthographique',
    shortLabel: 'Ortho',
    title: "Tout le ciel au-dessus de l'horizon dans un disque",
  },
]

/** Shared by every projected material. 0 stereo, 1 equirect, 2 recti, 3 ortho. */
export const stelModeUniform = { value: 0 }

let activeProjection: StageProjection = 'stereographic'

function modeUniformValue(mode: StageProjection): number {
  switch (mode) {
    case 'equirectangular':
      return 1
    case 'rectilinear':
      return 2
    case 'orthographic':
      return 3
    default:
      return 0
  }
}

export function normalizeStageProjection(value: unknown): StageProjection {
  if (
    value === 'equirectangular' ||
    value === 'rectilinear' ||
    value === 'orthographic'
  ) {
    return value
  }
  return 'stereographic'
}

export function getStageProjection(): StageProjection {
  return activeProjection
}

export function setStageProjection(mode: StageProjection): void {
  activeProjection = mode
  stelModeUniform.value = modeUniformValue(mode)
}

export function clampStageVfov(fovDeg: number): number {
  if (!Number.isFinite(fovDeg)) return 72
  return Math.min(STAGE_VFOV_MAX_DEG, Math.max(STAGE_VFOV_MIN_DEG, fovDeg))
}

/** Perspective FOV (degrees) that frames `stageDeg` in the active projection. */
export function framedStageVfov(stageDeg: number): number {
  const fov = clampStageVfov(stageDeg)
  if (activeProjection === 'equirectangular') {
    return Math.min(fov, EQUIRECT_VFOV_MAX_DEG)
  }
  if (activeProjection === 'rectilinear') {
    return Math.min(fov, RECTILINEAR_VFOV_MAX_DEG)
  }
  if (activeProjection === 'orthographic') {
    return Math.min(fov, ORTHOGRAPHIC_VFOV_MAX_DEG)
  }
  return Math.min(fov, STEREOGRAPHIC_VFOV_MAX_DEG)
}

export function perspectiveFovDeg(stageDeg: number): number {
  const fov = framedStageVfov(stageDeg)
  const fovy = (fov * Math.PI) / 180
  let camFov: number
  if (activeProjection === 'stereographic') {
    // Stage FOV is stereographic (r = 2·tan(θ/2)). Camera stays perspective
    // at the matching framing FOV; GLSL vertex warp does the Stellarium stretch.
    // 270° stage → ~157° — never a raw 270° perspective tunnel.
    camFov = (2 * Math.atan(2 * Math.tan(fovy / 4)) * 180) / Math.PI
    return Math.min(camFov, 165)
  }
  if (activeProjection === 'rectilinear') {
    // Warp is already tan(θ); the camera FOV matches the stage.
    camFov = fov
  } else if (activeProjection === 'orthographic') {
    // Edge of the disk is sin(θ/2).
    camFov = (2 * Math.atan(Math.sin(fovy / 2)) * 180) / Math.PI
  } else {
    // Equirectangular is linear in angle.
    camFov = (2 * Math.atan(fovy / 2) * 180) / Math.PI
  }
  return Math.min(camFov, PERSPECTIVE_CAMERA_VFOV_MAX_DEG)
}

/**
 * Store the real stage field and point the Three.js camera at the
 * framing FOV of the active projection.
 */
export function applyStageProjection(
  camera: THREE.PerspectiveCamera,
  stageVfovDeg: number,
): number {
  const fov = framedStageVfov(stageVfovDeg)
  camera.userData.stageVfovDeg = fov
  camera.userData.stageProjection = activeProjection
  camera.fov = perspectiveFovDeg(fov)
  camera.updateProjectionMatrix()
  return fov
}

export type StelEye = { x: number; y: number; z: number }

/**
 * NDC for the active projection. Eye space is x right, y up, z forward
 * (the overlay convention, opposite Three's −Z).
 */
export function stelProjectEye(
  eye: StelEye,
  fovDeg: number,
  aspect: number,
): { ndcX: number; ndcY: number } | null {
  const dist = Math.hypot(eye.x, eye.y, eye.z)
  if (dist < 1e-8) return null
  const tanHalf = Math.tan((perspectiveFovDeg(fovDeg) * Math.PI) / 360)
  const safeAspect = Math.max(aspect, 1e-4)
  const warp = warpEye(eye.x / dist, eye.y / dist, eye.z / dist)
  if (!warp) return null
  return {
    ndcX: warp.x / (tanHalf * safeAspect),
    ndcY: warp.y / tanHalf,
  }
}

/** Unit eye direction → projection plane. Null at a singularity. */
function warpEye(
  x: number,
  y: number,
  z: number,
): { x: number; y: number } | null {
  if (activeProjection === 'equirectangular') {
    return { x: Math.atan2(x, z), y: Math.asin(Math.min(1, Math.max(-1, y))) }
  }
  if (activeProjection === 'rectilinear') {
    if (z < 1e-4) return null
    return { x: x / z, y: y / z }
  }
  if (activeProjection === 'orthographic') {
    if (z < -1e-4) return null
    return { x, y }
  }
  // Stereographic (eye z forward): same as GLSL h = 0.5*(1 - n.z) with n.z = -z.
  const nz = -z
  const h = 0.5 * (1 - nz)
  if (h < 1e-4) return null
  const invH = 1 / h
  return { x: x * invH, y: y * invH }
}

/**
 * View-space remap, then the camera's perspective matrix.
 * Three.js looks down −Z.
 *
 * Points past the window stay on their own ray, just outside the frame.
 * Snapping them to a vertical line stretched columns down the side.
 */
export const STEL_PROJECT_GLSL = /* glsl */ `
uniform float uStelMode;
varying vec3 vStelRay;
varying vec2 vStelSt;
varying float vStelBad;
// Mild azimuth park for equirect/ortho singularities ONLY.
// NEVER *50 full-screen park, NEVER shared-radius clamp (that = hublot disk).
vec2 stelOffscreenSt(vec3 n) {
  float pl = length(n.xy);
  return (pl > 1e-8 ? n.xy / pl : vec2(1.0, 0.0)) * 2.8;
}
vec4 stelProject(vec4 mv) {
  float d = length(mv.xyz);
  if (d < 1e-6) {
    vStelRay = vec3(0.0, 0.0, -1.0);
    vStelSt = vec2(0.0);
    vStelBad = 0.0;
    return projectionMatrix * mv;
  }
  vec3 n = mv.xyz / d;
  vStelRay = n;
  vec2 st;
  if (uStelMode < 0.5) {
    // Stereographic Stellarium: r = 2·tan(θ/2) ≡ n.xy / (0.5·(1−n.z)).
    // No |st| clamp — clamping antipodes onto one circle = gray hublot.
    float h = 0.5 * (1.0 - n.z);
    if (h < 1e-3) {
      vec2 dir = length(n.xy) > 1e-8 ? normalize(n.xy) : vec2(1.0, 0.0);
      st = dir * 12.0;
      vStelBad = 1.0;
    } else {
      st = n.xy / h;
      vStelBad = 0.0;
    }
  } else if (uStelMode < 1.5) {
    float az = atan(n.x, -n.z);
    st = vec2(az, asin(clamp(n.y, -1.0, 1.0)));
    vStelBad = abs(az) > 2.85 ? 1.0 : 0.0;
  } else if (uStelMode < 2.5) {
    // Rectilinear = native perspective — no second tan-warp.
    vStelSt = n.xy / max(-n.z, 1e-4);
    vStelBad = 0.0;
    return projectionMatrix * mv;
  } else {
    if (n.z > 0.0) {
      st = stelOffscreenSt(n);
      vStelBad = 1.0;
    } else {
      st = n.xy;
      vStelBad = 0.0;
    }
  }
  vStelSt = st;
  vec3 warped = vec3(st, -1.0) * d;
  return projectionMatrix * vec4(warped, 1.0);
}
`

/**
 * Terrain: stereographic warp (Stellarium). Rectilinear = pass-through.
 * Antipode verts set vStelBad — fragment discard kills sky-crossing needles
 * (wireframe: those lines ARE terrain edges). Never discard n.z>0 (hublot).
 */
export const STEL_PROJECT_TERRAIN_GLSL = /* glsl */ `
uniform float uStelMode;
varying vec3 vStelRay;
varying vec2 vStelSt;
varying float vStelBad;
vec2 stelOffscreenSt(vec3 n) {
  float pl = length(n.xy);
  return (pl > 1e-8 ? n.xy / pl : vec2(1.0, 0.0)) * 2.8;
}
vec4 stelProject(vec4 mv) {
  float d = length(mv.xyz);
  if (d < 1e-6) {
    vStelRay = vec3(0.0, 0.0, -1.0);
    vStelSt = vec2(0.0);
    vStelBad = 0.0;
    return projectionMatrix * mv;
  }
  vec3 n = mv.xyz / d;
  vStelRay = n;
  vec2 st;
  if (uStelMode < 0.5) {
    // Same Stellarium stereo as sky. Flag antipode so fragments can discard
    // straddling tris (dir*12 ↔ normal st = black pillars / sky needles).
    float h = 0.5 * (1.0 - n.z);
    if (h < 1e-3) {
      vec2 dir = length(n.xy) > 1e-8 ? normalize(n.xy) : vec2(1.0, 0.0);
      st = dir * 12.0;
      vStelBad = 1.0;
    } else {
      st = n.xy / h;
      vStelBad = 0.0;
    }
  } else if (uStelMode < 1.5) {
    float az = atan(n.x, -n.z);
    st = vec2(az, asin(clamp(n.y, -1.0, 1.0)));
    vStelBad = abs(az) > 2.85 ? 1.0 : 0.0;
  } else if (uStelMode < 2.5) {
    vStelSt = n.xy / max(-n.z, 1e-4);
    vStelBad = 0.0;
    return projectionMatrix * mv;
  } else {
    if (n.z > 0.0) {
      st = stelOffscreenSt(n);
      vStelBad = 1.0;
    } else {
      st = n.xy;
      vStelBad = 0.0;
    }
  }
  vStelSt = st;
  vec3 warped = vec3(st, -1.0) * d;
  return projectionMatrix * vec4(warped, 1.0);
}
`

export const STEL_FRAGMENT_GLSL = /* glsl */ `
uniform float uStelMode;
varying vec3 vStelRay;
varying vec2 vStelSt;
varying float vStelBad;
void stelDiscardBow() {
  // Antipode / seam only (vStelBad). Sky + terrain. Never n.z>0 (hublot).
  if (uStelMode < 0.5) {
    if (vStelBad > 0.02) discard;
    return;
  }
  if (uStelMode >= 1.5 && uStelMode < 2.5) return;
  if (vStelBad > 0.02) discard;
}
`

/** Inject the projection remap into materials that use project_vertex. */
export function attachStelProjector(
  material: THREE.Material,
  opts?: { discardBow?: boolean; terrainSafe?: boolean },
): void {
  if (material.userData.stelProjector) return
  material.userData.stelProjector = true
  // Terrain: no |st| clamp. Antipode bow discard ON (kills sky needles).
  const terrainSafe = opts?.terrainSafe === true || opts?.discardBow === false
  const discardBow = opts?.discardBow !== false
  const projectGlsl = terrainSafe ? STEL_PROJECT_TERRAIN_GLSL : STEL_PROJECT_GLSL
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer)
    if (!shader.vertexShader.includes('#include <project_vertex>')) return
    if (shader.vertexShader.includes('vec4 stelProject')) return
    shader.uniforms.uStelMode = stelModeUniform
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${projectGlsl}`)
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\ngl_Position = stelProject(mvPosition);',
      )
    if (
      discardBow &&
      shader.fragmentShader.includes('#include <clipping_planes_fragment>') &&
      !shader.fragmentShader.includes('stelDiscardBow')
    ) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${STEL_FRAGMENT_GLSL}`)
        .replace(
          '#include <clipping_planes_fragment>',
          '#include <clipping_planes_fragment>\nstelDiscardBow();',
        )
    }
  }
  const previousKey = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () =>
    `stel-proj-v38-terrain-bow|t${terrainSafe ? 1 : 0}|d${discardBow ? 1 : 0}|${previousKey()}`
}

/**
 * Same Stellarium warp for custom ShaderMaterials that set gl_Position from
 * an eye-space `mv` (or `modelViewMatrix * vec4(position,1)`), e.g. Sun/Moon
 * discs. Without this, bodies/arcs swim vs stel-warped stars when panning.
 */
export function attachStelProjectorMv(
  material: THREE.ShaderMaterial,
  opts?: { discardBow?: boolean },
): void {
  if (material.userData.stelProjector) return
  if (material.vertexShader.includes('vec4 stelProject')) {
    material.userData.stelProjector = true
    return
  }
  material.userData.stelProjector = true
  const discardBow = opts?.discardBow !== false
  material.uniforms.uStelMode = stelModeUniform

  let vs = `${STEL_PROJECT_GLSL}\n${material.vertexShader}`
  vs = vs.replace(
    /gl_Position\s*=\s*projectionMatrix\s*\*\s*mv\s*;/,
    'gl_Position = stelProject(mv);',
  )
  vs = vs.replace(
    /gl_Position\s*=\s*projectionMatrix\s*\*\s*modelViewMatrix\s*\*\s*vec4\(\s*position\s*,\s*1\.0\s*\)\s*;/,
    'gl_Position = stelProject(modelViewMatrix * vec4(position, 1.0));',
  )
  material.vertexShader = vs

  if (discardBow && !material.fragmentShader.includes('stelDiscardBow')) {
    material.fragmentShader = `${STEL_FRAGMENT_GLSL}\n${material.fragmentShader}`
    material.fragmentShader = material.fragmentShader.replace(
      /void\s+main\s*\(\s*\)\s*\{/,
      'void main() {\n        stelDiscardBow();',
    )
  }

  const previousKey = material.customProgramCacheKey?.bind(material)
  material.customProgramCacheKey = () =>
    `stel-mv-v38-terrain-bow|d${discardBow ? 1 : 0}|${previousKey?.() ?? material.uuid}`
  material.needsUpdate = true
}
