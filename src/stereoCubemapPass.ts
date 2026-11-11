import * as THREE from 'three'

/**
 * Stereographic dezoom without DEM vertex warp.
 *
 * 6× RT2D eye-relative faces → Stellarium remap.
 * Critical: ONE full scene render per face (no sky/terrain split, no
 * clearDepth mid-pass) — the split painted black holes at the ridgeline.
 */

const FACE_FOV_DEG = 90
const FACE_SIZE_MIN = 1024
const FACE_SIZE_MAX = 2048

const STEREO_COMPOSITE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/**
 * Major-axis cubemap sample (no first-hit miss → black wedges).
 * Face layout matches capture: 0=+Z look, 1=-Z, 2=+Y, 3=-Y, 4=+X, 5=-X
 * in camera basis (forward/right/up).
 */
const STEREO_COMPOSITE_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uFace0;
uniform sampler2D uFace1;
uniform sampler2D uFace2;
uniform sampler2D uFace3;
uniform sampler2D uFace4;
uniform sampler2D uFace5;
uniform float uHalfFovRad;
uniform float uAspect;
uniform float uDebugAtlas;
uniform float uTanHalf;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamForward;
uniform vec3 uClearColor;

varying vec2 vUv;

vec4 texFace(int i, vec2 uv) {
  if (i == 0) return texture2D(uFace0, uv);
  if (i == 1) return texture2D(uFace1, uv);
  if (i == 2) return texture2D(uFace2, uv);
  if (i == 3) return texture2D(uFace3, uv);
  if (i == 4) return texture2D(uFace4, uv);
  return texture2D(uFace5, uv);
}

// dir in camera basis: +X right, +Y up, +Z forward
vec4 sampleCube(vec3 dir) {
  vec3 a = abs(dir);
  float ma;
  vec2 uv;
  int face;
  if (a.z >= a.x && a.z >= a.y) {
    ma = a.z;
    if (dir.z > 0.0) {
      face = 0;
      uv = vec2(dir.x, dir.y);
    } else {
      face = 1;
      uv = vec2(-dir.x, dir.y);
    }
  } else if (a.y >= a.x) {
    ma = a.y;
    if (dir.y > 0.0) {
      face = 2;
      uv = vec2(dir.x, -dir.z);
    } else {
      face = 3;
      uv = vec2(dir.x, dir.z);
    }
  } else {
    ma = a.x;
    if (dir.x > 0.0) {
      face = 4;
      uv = vec2(-dir.z, dir.y);
    } else {
      face = 5;
      uv = vec2(dir.z, dir.y);
    }
  }
  // Perspective divide for 90° faces: ndc = xy / z, z = ma along look.
  vec2 ndc = uv / max(ma, 1e-6);
  // Map through face FOV tanHalf (90° → tan(45°)=1).
  ndc /= uTanHalf;
  vec2 st = clamp(ndc * 0.5 + 0.5, 0.0, 1.0);
  return texFace(face, st);
}

void main() {
  if (uDebugAtlas > 0.5) {
    vec2 g = vUv * vec2(3.0, 2.0);
    float col = floor(g.x);
    float row = floor(g.y);
    vec2 luv = fract(g);
    if (row > 0.5) {
      if (col < 0.5) gl_FragColor = texture2D(uFace0, luv);
      else if (col < 1.5) gl_FragColor = texture2D(uFace1, luv);
      else gl_FragColor = texture2D(uFace2, luv);
    } else {
      if (col < 0.5) gl_FragColor = texture2D(uFace3, luv);
      else if (col < 1.5) gl_FragColor = texture2D(uFace4, luv);
      else gl_FragColor = texture2D(uFace5, luv);
    }
    return;
  }

  vec2 ndc = vUv * 2.0 - 1.0;
  ndc.x *= uAspect;
  float rEdge = 2.0 * tan(max(uHalfFovRad, 1e-4) * 0.5);
  vec2 st = ndc * rEdge;
  float r = length(st);
  float theta = 2.0 * atan(r * 0.5);
  if (theta > 3.14159265) {
    gl_FragColor = vec4(uClearColor, 1.0);
    return;
  }
  float sinT = sin(theta);
  float cosT = cos(theta);
  vec2 dir2 = r > 1e-8 ? st / r : vec2(0.0);
  // Camera-local direction: +Z forward, +X right, +Y up
  vec3 localDir = normalize(vec3(dir2.x * sinT, dir2.y * sinT, cosT));
  gl_FragColor = sampleCube(localDir);
}
`

/** Cubemap only when perspective framing can't cover the stage FOV cleanly. */
export const STEREO_CUBEMAP_STAGE_MIN_DEG = 125

export type StereoCubemapPass = {
  render: (
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    eyeCamera: THREE.PerspectiveCamera,
    stageVfovDeg: number,
  ) => void
  /** Show 6 face RTs as a 3×2 atlas (source before stereographic composite). */
  setAtlasPreview: (on: boolean) => void
  getAtlasPreview: () => boolean
  dispose: () => void
}

function makeFaceTarget(size: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
  })
  // Three.js render targets are already top-left origin for sampling in
  // custom shaders when flipY is false and we don't use WebGLRenderTarget.texture
  // through a Mesh with default UVs incorrectly — keep flipY false.
  rt.texture.flipY = false
  rt.texture.colorSpace = THREE.SRGBColorSpace
  return rt
}

function wantsAtlasDebug(): boolean {
  if (typeof window === 'undefined') return false
  return /(?:\?|&)stereoDebug=atlas(?:&|$)/.test(window.location.search)
}

function pickFaceSize(renderer: THREE.WebGLRenderer): number {
  const size = new THREE.Vector2()
  renderer.getDrawingBufferSize(size)
  // Match screen short side — center face ≈ native zoom sharpness.
  const m = Math.max(size.x, size.y)
  return Math.min(FACE_SIZE_MAX, Math.max(FACE_SIZE_MIN, Math.floor(m)))
}

export function createStereoCubemapPass(): StereoCubemapPass {
  let faceSize = FACE_SIZE_MIN
  let targets = Array.from({ length: 6 }, () => makeFaceTarget(faceSize))

  const faceCam = new THREE.PerspectiveCamera(FACE_FOV_DEG, 1, 0.5, 450_000)
  const lookTarget = new THREE.Vector3()
  const worldPos = new THREE.Vector3()
  const camRight = new THREE.Vector3()
  const camUp = new THREE.Vector3()
  const camForward = new THREE.Vector3()
  const drawSize = new THREE.Vector2()

  let atlasPreview = wantsAtlasDebug()

  const uniforms = {
    uFace0: { value: targets[0]!.texture },
    uFace1: { value: targets[1]!.texture },
    uFace2: { value: targets[2]!.texture },
    uFace3: { value: targets[3]!.texture },
    uFace4: { value: targets[4]!.texture },
    uFace5: { value: targets[5]!.texture },
    uHalfFovRad: { value: 1 },
    uAspect: { value: 1 },
    uDebugAtlas: { value: atlasPreview ? 1 : 0 },
    uTanHalf: { value: Math.tan((FACE_FOV_DEG * Math.PI) / 360) },
    uCamRight: { value: new THREE.Vector3(1, 0, 0) },
    uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uCamForward: { value: new THREE.Vector3(0, 0, -1) },
    uClearColor: { value: new THREE.Color(0x000000) },
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: STEREO_COMPOSITE_VERT,
    fragmentShader: STEREO_COMPOSITE_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  const compositeScene = new THREE.Scene()
  compositeScene.add(quad)
  const compositeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  type SideRestore = { mat: THREE.Material; side: THREE.Side }

  function isTerrainOrSeaMat(mat: THREE.Material): boolean {
    return !!(mat.userData?.isOrthoTerrain || mat.userData?.isSea)
  }

  function ensureFaceSize(renderer: THREE.WebGLRenderer): void {
    const next = pickFaceSize(renderer)
    if (next === faceSize) return
    faceSize = next
    for (const rt of targets) rt.dispose()
    targets = Array.from({ length: 6 }, () => makeFaceTarget(faceSize))
    uniforms.uFace0.value = targets[0]!.texture
    uniforms.uFace1.value = targets[1]!.texture
    uniforms.uFace2.value = targets[2]!.texture
    uniforms.uFace3.value = targets[3]!.texture
    uniforms.uFace4.value = targets[4]!.texture
    uniforms.uFace5.value = targets[5]!.texture
  }

  /** DoubleSide only during face capture — cliff backs visible to side cams. */
  function withTerrainDoubleSide(scene: THREE.Scene, fn: () => void): void {
    const sideRestored: SideRestore[] = []
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) {
        if (!mat || !isTerrainOrSeaMat(mat)) continue
        if (mat.side !== THREE.DoubleSide) {
          sideRestored.push({ mat, side: mat.side })
          mat.side = THREE.DoubleSide
        }
      }
    })
    try {
      fn()
    } finally {
      for (const { mat, side } of sideRestored) mat.side = side
    }
  }

  function captureFaces(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    eyeCamera: THREE.PerspectiveCamera,
  ): void {
    ensureFaceSize(renderer)

    eyeCamera.getWorldPosition(worldPos)
    eyeCamera.matrixWorld.extractBasis(camRight, camUp, camForward)
    camForward.negate()

    // Face looks in WORLD space — same order as sampleCube local axes.
    const looks = [
      camForward.clone(),
      camForward.clone().negate(),
      camUp.clone(),
      camUp.clone().negate(),
      camRight.clone(),
      camRight.clone().negate(),
    ]
    const ups = [
      camUp.clone(),
      camUp.clone(),
      camForward.clone().negate(),
      camForward.clone(),
      camUp.clone(),
      camUp.clone(),
    ]

    faceCam.near = Math.min(eyeCamera.near, 0.5)
    faceCam.far = eyeCamera.far
    faceCam.fov = FACE_FOV_DEG
    faceCam.aspect = 1
    faceCam.updateProjectionMatrix()
    faceCam.position.copy(worldPos)

    const prevTarget = renderer.getRenderTarget()
    const prevAutoClear = renderer.autoClear
    renderer.autoClear = true

    withTerrainDoubleSide(scene, () => {
      for (let i = 0; i < 6; i++) {
        lookTarget.copy(worldPos).add(looks[i]!)
        faceCam.up.copy(ups[i]!)
        faceCam.lookAt(lookTarget)
        faceCam.updateMatrixWorld(true)
        renderer.setRenderTarget(targets[i]!)
        // ONE pass: sky + terrain + lights together. No mid clearDepth.
        renderer.clear(true, true, true)
        renderer.render(scene, faceCam)
      }
    })

    renderer.setRenderTarget(prevTarget)
    renderer.autoClear = prevAutoClear
  }

  function render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    eyeCamera: THREE.PerspectiveCamera,
    stageVfovDeg: number,
  ): void {
    captureFaces(renderer, scene, eyeCamera)

    // Kept for atlas/debug; composite uses camera-local sampleCube.
    uniforms.uCamRight.value.copy(camRight)
    uniforms.uCamUp.value.copy(camUp)
    uniforms.uCamForward.value.copy(camForward)
    uniforms.uHalfFovRad.value =
      (Math.max(1, stageVfovDeg) * 0.5 * Math.PI) / 180
    renderer.getDrawingBufferSize(drawSize)
    uniforms.uAspect.value = drawSize.x / Math.max(1, drawSize.y)
    renderer.getClearColor(uniforms.uClearColor.value)
    uniforms.uDebugAtlas.value = atlasPreview ? 1 : 0
    uniforms.uTanHalf.value = Math.tan((FACE_FOV_DEG * Math.PI) / 360)

    const prevAutoClear = renderer.autoClear
    renderer.autoClear = true
    renderer.setRenderTarget(null)
    renderer.render(compositeScene, compositeCam)
    renderer.autoClear = prevAutoClear
  }

  function setAtlasPreview(on: boolean): void {
    atlasPreview = on
    uniforms.uDebugAtlas.value = on ? 1 : 0
  }

  function getAtlasPreview(): boolean {
    return atlasPreview
  }

  function dispose(): void {
    for (const rt of targets) rt.dispose()
    material.dispose()
    quad.geometry.dispose()
  }

  return { render, setAtlasPreview, getAtlasPreview, dispose }
}
