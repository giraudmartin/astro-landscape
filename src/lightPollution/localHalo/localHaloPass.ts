/**
 * Local light-pollution halo — screen pass (port of the Chamonix prototype).
 *
 * When active, the frame is drawn into an offscreen target (colour + depth),
 * then one fullscreen shader:
 *   1. rebuilds the view ray of each pixel for the active projection,
 *   2. stops it at the opaque depth (terrain / LOD rings),
 *   3. integrates the precomputed 3D illumination field over 112 steps,
 *   4. composites halo + scene, then the optional VIIRS ground diagnostic.
 *
 * Inactive (halos and diagnostic off, or daylight) → the caller keeps its
 * direct-to-canvas path, so the existing scene is untouched.
 */
import * as THREE from 'three'
import { EARTH_RADIUS_M } from '../../globeConstants'
import { stelModeUniform } from '../../stelProjector'
import {
  ENU_M_PER_DEG,
  HALO_FIELD_SPEC,
  toHalfBits,
  type HaloGroundGrid,
  type HaloProjector,
  type HaloRaster,
} from './haloFieldCore'

/** Prototype tint mapping (artistic, not a blackbody conversion). */
export function localHaloTint(tempK: number): [number, number, number] {
  const f = (tempK - 1800) / 3700
  return [1, 0.3 + f * 0.58, 0.075 + f * 0.7]
}

/** Prototype diagnostic palette scale: log(1 + r) / log(1 + 35). */
export function viirsDiagnosticT(radiance: number): number {
  return Math.min(1, Math.max(0, Math.log1p(radiance) / Math.log1p(35)))
}

export type LocalHaloTuning = {
  enabled: boolean
  blocking: boolean
  /** 0…2.5 (prototype slider / 100). */
  intensity: number
  heightKm: number
  /** 0.05…1 (prototype slider / 100). */
  haze: number
  tempK: number
  groundView: boolean
  groundAlpha: number
  /** 0…1 — 1 at full night, 0 in daylight (halo only, not the diagnostic). */
  night: number
}

export type LocalHaloField = {
  field: Uint16Array
  raster: HaloRaster
  /** Relief used by the screening — also stops rays where depth has holes. */
  ground: HaloGroundGrid
  projector: HaloProjector
  /** Volume vertical bounds (km MSL). */
  yMinKm: number
  yMaxKm: number
  referenceAltitudeKm: number
  /** Zone centre in scene metres (x east, z south). */
  centerScene: { x: number; z: number }
}

export type LocalHaloTerrainFrame = {
  baseElevationM: number
  verticalExaggeration: number
}

const STEPS = 112
/** Below the screening relief by more than this → the ray is inside rock. */
const GROUND_STOP_MARGIN_KM = '0.05'

const VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform sampler3D uVolume;
uniform sampler2D uRaw;
uniform sampler2D uGround;
uniform float uGroundExtentKm;
uniform float uStelMode;
uniform vec2 uNdcScale;
uniform mat3 uCamRot;
uniform vec3 uEye;
uniform float uLog2Far;

// Scene (m, x east, z south, y mesh) → prototype frame (km, y MSL).
uniform vec2 uCenter;
uniform float uBaseElevM;
uniform float uExag;
uniform float uEarthR;
uniform vec3 uBoxMinScene;
uniform vec3 uBoxMaxScene;
uniform vec3 uBoxMinKm;
uniform vec3 uBoxSizeKm;
uniform float uRefAltKm;

uniform float uPower;
uniform float uVertical;
uniform float uHaze;
uniform float uBlocking;
uniform vec3 uTint;
uniform float uNight;

uniform float uGroundView;
uniform float uGroundAlpha;
uniform int uGeoMode;
uniform vec2 uGeoOrigin;
uniform vec2 uGeoScale;
uniform vec4 uRaster;
uniform ivec2 uRasterSize;

vec3 viewDirFromScreen(vec2 uv) {
  vec2 st = (uv * 2.0 - 1.0) * uNdcScale;
  if (uStelMode < 0.5) {
    float s2 = dot(st, st);
    float denom = s2 + 4.0;
    return normalize(vec3(st * (4.0 / denom), (s2 - 4.0) / denom));
  } else if (uStelMode < 1.5) {
    float ca = cos(st.y);
    return normalize(vec3(sin(st.x) * ca, sin(st.y), -cos(st.x) * ca));
  }
  return normalize(vec3(st, -1.0));
}

vec2 boxRange(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / (rd + vec3(1e-9));
  vec3 a = (uBoxMinScene - ro) * inv;
  vec3 b = (uBoxMaxScene - ro) * inv;
  vec3 lo = min(a, b);
  vec3 hi = max(a, b);
  return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
}

vec3 toProtoKm(vec3 p) {
  float r2 = dot(p.xz, p.xz);
  float msl = (p.y + r2 / (2.0 * uEarthR)) / uExag + uBaseElevM;
  return vec3((p.x - uCenter.x) * 0.001, msl * 0.001, (p.z - uCenter.y) * 0.001);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float srgbToLinear(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
vec3 srgbToLinear(vec3 c) {
  return vec3(srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b));
}
float linearToSrgb(float c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}
vec3 linearToSrgb(vec3 c) {
  return vec3(linearToSrgb(c.r), linearToSrgb(c.g), linearToSrgb(c.b));
}

vec2 geoFromProto(vec2 xz) {
  if (uGeoMode == 1) {
    vec2 merc = uGeoOrigin + xz * uGeoScale.x;
    return vec2(merc.x * 360.0 - 180.0,
      atan(sinh(3.14159265359 * (1.0 - 2.0 * merc.y))) * 57.2957795131);
  }
  return vec2(uGeoOrigin.x + xz.x * uGeoScale.x, uGeoOrigin.y - xz.y * uGeoScale.y);
}

// Our terrain has 1–2 px cracks where the sky shows through. A crack pixel
// has nearer depth on both opposite sides; a ridge silhouette only on one.
float depthAt(ivec2 px, ivec2 hi) {
  return texelFetch(uDepth, clamp(px, ivec2(0), hi), 0).r;
}
float holeFilledDepth(ivec2 px) {
  ivec2 hi = textureSize(uDepth, 0) - 1;
  float depth = depthAt(px, hi);
  for (int d = 1; d <= 2; d++) {
    float h = max(depthAt(px - ivec2(d, 0), hi), depthAt(px + ivec2(d, 0), hi));
    float v = max(depthAt(px - ivec2(0, d), hi), depthAt(px + ivec2(0, d), hi));
    float pair = min(h, v);
    if (pair < depth - 0.01) depth = pair;
  }
  return depth;
}

void main() {
  float depth = holeFilledDepth(ivec2(gl_FragCoord.xy));
  vec3 nView = viewDirFromScreen(vUv);
  float w = exp2(depth * uLog2Far) - 1.0;
  float dist = uStelMode < 1.5 ? w : w / max(-nView.z, 1e-4);
  vec3 rd = normalize(uCamRot * nView);
  vec3 endPoint = uEye + rd * dist;

  vec3 glow = vec3(0.0);
  float trans = 1.0;
  vec2 range = boxRange(uEye, rd);
  float start = max(0.0, range.x);
  float end = min(range.y, dist);
  if (end > start && uPower > 0.0) {
    float stride = (end - start) / ${STEPS}.0;
    float strideKm = stride * 0.001 * length(vec3(rd.x, rd.y / uExag, rd.z));
    float jitter = hash(gl_FragCoord.xy);
    for (int i = 0; i < ${STEPS}; i++) {
      vec3 p = toProtoKm(uEye + rd * (start + (float(i) + jitter) * stride));
      // Wider cracks: the screening relief still stops the ray inside rock.
      float groundKm = texture(uGround, p.xz / uGroundExtentKm + 0.5).r;
      if (p.y < groundKm - ${GROUND_STOP_MARGIN_KM}) break;
      vec3 uvw = (p - uBoxMinKm) / uBoxSizeKm;
      float inside = step(0.0, uvw.y) * step(uvw.y, 1.0);
      vec2 light = texture(uVolume, uvw).rg;
      float illumination = mix(light.g, light.r, uBlocking);
      float edge = 1.0 - smoothstep(11.0, 12.0, max(abs(p.x), abs(p.z)));
      float density = exp(-max(p.y - uRefAltKm, 0.0) / uVertical) * uHaze * edge * inside;
      float opacity = 1.0 - exp(-density * 0.045 * strideKm);
      glow += trans * uTint * illumination * uPower * opacity * 3.5;
      trans *= 1.0 - opacity;
    }
  }

  vec3 sceneDisplay = texture(uScene, vUv).rgb;
  vec3 col = sceneDisplay;
  if (uPower > 0.0) {
    // Prototype output = (1 − exp(−1.5·c))^(1/2.2). The halo keeps exactly
    // that curve; the scene keeps our sRGB output. Both meet through the
    // screen operator the prototype curve applies to any sum of light.
    vec3 sceneLin = srgbToLinear(sceneDisplay) * trans;
    vec3 haloDisplay = pow(vec3(1.0) - exp(-glow * 1.5), vec3(1.0 / 2.2));
    vec3 haloLin = srgbToLinear(haloDisplay);
    vec3 outLin = sceneLin + haloLin * (vec3(1.0) - sceneLin);
    col = mix(sceneDisplay, linearToSrgb(clamp(outLin, 0.0, 1.0)), uNight);
  }

  // Diagnostic colours go on after the halo and the output curve, so they
  // stay readable (prototype order).
  vec3 pk = toProtoKm(endPoint);
  if (uGroundView > 0.5 && depth < 0.99999 && abs(pk.x) < 12.0 && abs(pk.z) < 12.0) {
    vec2 geo = geoFromProto(pk.xz);
    ivec2 px = ivec2(floor((geo - uRaster.xy) / uRaster.zw));
    px = clamp(px, ivec2(0), uRasterSize - 1);
    float r = texelFetch(uRaw, px, 0).r;
    vec3 diagnostic = vec3(0.085, 0.11, 0.15);
    if (r < 0.0) diagnostic = vec3(0.5);
    else if (r > 0.0) {
      float t = clamp(log(1.0 + r) / log(1.0 + 35.0), 0.0, 1.0);
      diagnostic = mix(vec3(0.02, 0.95, 1.0), vec3(1.0, 0.04, 0.78), t);
    }
    col = mix(col, diagnostic, uGroundAlpha);
  }
  fragColor = vec4(col, 1.0);
}
`

export type LocalHaloPass = {
  /** True when the frame must go through {@link LocalHaloPass.begin}. */
  isActive: (tuning: LocalHaloTuning) => boolean
  setField: (field: LocalHaloField | null) => void
  hasField: () => boolean
  /** Bind the offscreen target; draw the scene (and its overlays) after. */
  begin: (renderer: THREE.WebGLRenderer) => void
  /** Composite to the canvas. */
  end: (
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    terrain: LocalHaloTerrainFrame,
    tuning: LocalHaloTuning,
  ) => void
  dispose: () => void
}

export function createLocalHaloPass(): LocalHaloPass {
  const depthTexture = new THREE.DepthTexture(1, 1)
  // Single-sampled like the prototype: an MSAA depth resolve keeps one sample
  // per pixel, so ridge-edge pixels would take the far air's glow (needles).
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.UnsignedByteType,
    samples: 0,
    depthBuffer: true,
    depthTexture,
  })
  // Same storage and blending as the sRGB canvas: shaders encode to sRGB and
  // additive layers (stars, Milky Way, sky PL) blend on encoded 8-bit values.
  // Three only encodes into XR-flagged targets; RGBA8 avoids hardware sRGB.
  target.texture.colorSpace = THREE.SRGBColorSpace
  target.texture.internalFormat = 'RGBA8'
  ;(target as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true

  const emptyVolume = new THREE.Data3DTexture(new Uint16Array(2), 1, 1, 1)
  emptyVolume.format = THREE.RGFormat
  emptyVolume.type = THREE.HalfFloatType
  emptyVolume.needsUpdate = true
  const emptyRaw = new THREE.DataTexture(
    new Float32Array([0]),
    1,
    1,
    THREE.RedFormat,
    THREE.FloatType,
  )
  emptyRaw.needsUpdate = true
  const emptyGround = new THREE.DataTexture(
    new Uint16Array([0]),
    1,
    1,
    THREE.RedFormat,
    THREE.HalfFloatType,
  )
  emptyGround.needsUpdate = true

  let volumeTex: THREE.Data3DTexture | null = null
  let rawTex: THREE.DataTexture | null = null
  let groundTex: THREE.DataTexture | null = null
  let current: LocalHaloField | null = null

  const uniforms = {
    uScene: { value: target.texture as THREE.Texture },
    uDepth: { value: depthTexture as THREE.Texture },
    uVolume: { value: emptyVolume as THREE.Texture },
    uRaw: { value: emptyRaw as THREE.Texture },
    uGround: { value: emptyGround as THREE.Texture },
    uGroundExtentKm: { value: 1 },
    uStelMode: stelModeUniform,
    uNdcScale: { value: new THREE.Vector2(1, 1) },
    uCamRot: { value: new THREE.Matrix3() },
    uEye: { value: new THREE.Vector3() },
    uLog2Far: { value: 1 },
    uCenter: { value: new THREE.Vector2() },
    uBaseElevM: { value: 0 },
    uExag: { value: 1 },
    uEarthR: { value: EARTH_RADIUS_M },
    uBoxMinScene: { value: new THREE.Vector3() },
    uBoxMaxScene: { value: new THREE.Vector3() },
    uBoxMinKm: { value: new THREE.Vector3() },
    uBoxSizeKm: { value: new THREE.Vector3(1, 1, 1) },
    uRefAltKm: { value: 1.03 },
    uPower: { value: 0 },
    uVertical: { value: 1.4 },
    uHaze: { value: 0.45 },
    uBlocking: { value: 1 },
    uTint: { value: new THREE.Vector3(1, 0.48, 0.19) },
    uNight: { value: 1 },
    uGroundView: { value: 0 },
    uGroundAlpha: { value: 0.85 },
    uGeoMode: { value: 0 },
    uGeoOrigin: { value: new THREE.Vector2() },
    uGeoScale: { value: new THREE.Vector2(1, 1) },
    uRaster: { value: new THREE.Vector4(0, 0, 1, 1) },
    uRasterSize: { value: new THREE.Vector2(1, 1) },
  }

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  material.name = 'localHaloComposite'
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  const postScene = new THREE.Scene()
  postScene.add(quad)
  const postCamera = new THREE.Camera()
  const size = new THREE.Vector2()

  const setField = (field: LocalHaloField | null) => {
    volumeTex?.dispose()
    rawTex?.dispose()
    groundTex?.dispose()
    volumeTex = null
    rawTex = null
    groundTex = null
    current = field
    if (!field) {
      uniforms.uVolume.value = emptyVolume
      uniforms.uRaw.value = emptyRaw
      uniforms.uGround.value = emptyGround
      return
    }
    const g = field.ground
    const groundTexture = new THREE.DataTexture(
      Uint16Array.from(g.heightsKm, toHalfBits),
      g.size,
      g.size,
      THREE.RedFormat,
      THREE.HalfFloatType,
    )
    groundTexture.minFilter = THREE.LinearFilter
    groundTexture.magFilter = THREE.LinearFilter
    groundTexture.wrapS = THREE.ClampToEdgeWrapping
    groundTexture.wrapT = THREE.ClampToEdgeWrapping
    groundTexture.flipY = false
    groundTexture.unpackAlignment = 2
    groundTexture.needsUpdate = true
    groundTex = groundTexture
    uniforms.uGround.value = groundTexture
    uniforms.uGroundExtentKm.value = g.extentKm
    const spec = HALO_FIELD_SPEC
    const vol = new THREE.Data3DTexture(field.field, spec.nx, spec.ny, spec.nz)
    vol.format = THREE.RGFormat
    vol.type = THREE.HalfFloatType
    vol.minFilter = THREE.LinearFilter
    vol.magFilter = THREE.LinearFilter
    vol.unpackAlignment = 1
    vol.needsUpdate = true
    volumeTex = vol
    uniforms.uVolume.value = vol

    const r = field.raster
    const raw = new THREE.DataTexture(
      r.values,
      r.width,
      r.height,
      THREE.RedFormat,
      THREE.FloatType,
    )
    raw.minFilter = THREE.NearestFilter
    raw.magFilter = THREE.NearestFilter
    raw.flipY = false
    raw.needsUpdate = true
    rawTex = raw
    uniforms.uRaw.value = raw
    const gt = r.geotransform
    uniforms.uRaster.value.set(gt[0], gt[3], gt[1], gt[5])
    uniforms.uRasterSize.value.set(r.width, r.height)

    const p = field.projector
    if (p.kind === 'mercator') {
      uniforms.uGeoMode.value = 1
      uniforms.uGeoOrigin.value.set(p.mercator[0], p.mercator[1])
      uniforms.uGeoScale.value.set(p.unit, p.unit)
    } else {
      uniforms.uGeoMode.value = 0
      uniforms.uGeoOrigin.value.set(p.lon0, p.lat0)
      uniforms.uGeoScale.value.set(
        1000 / (ENU_M_PER_DEG * Math.cos((p.lat0 * Math.PI) / 180)),
        1000 / ENU_M_PER_DEG,
      )
    }
    uniforms.uCenter.value.set(field.centerScene.x, field.centerScene.z)
    uniforms.uRefAltKm.value = field.referenceAltitudeKm
    uniforms.uBoxMinKm.value.set(-spec.halfExtentKm, field.yMinKm, -spec.halfExtentKm)
    uniforms.uBoxSizeKm.value.set(
      spec.halfExtentKm * 2,
      field.yMaxKm - field.yMinKm,
      spec.halfExtentKm * 2,
    )
  }

  const isActive = (t: LocalHaloTuning) => {
    if (!current) return false
    const halo = t.enabled && t.intensity > 0 && t.night > 0.001
    return halo || t.groundView
  }

  const begin = (renderer: THREE.WebGLRenderer) => {
    renderer.getDrawingBufferSize(size)
    if (target.width !== size.x || target.height !== size.y) {
      target.setSize(size.x, size.y)
    }
    renderer.setRenderTarget(target)
  }

  const end = (
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    terrain: LocalHaloTerrainFrame,
    t: LocalHaloTuning,
  ) => {
    renderer.setRenderTarget(null)
    if (!current) return
    const spec = HALO_FIELD_SPEC
    camera.updateMatrixWorld(true)
    const pe = camera.projectionMatrix.elements
    uniforms.uNdcScale.value.set(1 / pe[0]!, 1 / pe[5]!)
    uniforms.uCamRot.value.setFromMatrix4(camera.matrixWorld)
    uniforms.uEye.value.setFromMatrixPosition(camera.matrixWorld)
    uniforms.uLog2Far.value = Math.log2(camera.far + 1)

    const exag = terrain.verticalExaggeration
    const base = terrain.baseElevationM
    uniforms.uExag.value = exag
    uniforms.uBaseElevM.value = base
    const half = spec.halfExtentKm * 1000
    const cx = current.centerScene.x
    const cz = current.centerScene.z
    const far = Math.hypot(Math.abs(cx) + half, Math.abs(cz) + half)
    const maxDrop = (far * far) / (2 * EARTH_RADIUS_M)
    uniforms.uBoxMinScene.value.set(
      cx - half,
      (current.yMinKm * 1000 - base) * exag - maxDrop,
      cz - half,
    )
    uniforms.uBoxMaxScene.value.set(
      cx + half,
      (current.yMaxKm * 1000 - base) * exag,
      cz + half,
    )

    const haloOn = t.enabled && t.night > 0.001
    uniforms.uPower.value = haloOn ? t.intensity : 0
    uniforms.uVertical.value = t.heightKm
    uniforms.uHaze.value = t.haze
    uniforms.uBlocking.value = t.blocking ? 1 : 0
    const tint = localHaloTint(t.tempK)
    uniforms.uTint.value.set(tint[0], tint[1], tint[2])
    uniforms.uNight.value = Math.min(1, Math.max(0, t.night))
    uniforms.uGroundView.value = t.groundView ? 1 : 0
    uniforms.uGroundAlpha.value = t.groundAlpha
    renderer.render(postScene, postCamera)
  }

  return {
    isActive,
    setField,
    hasField: () => current != null,
    begin,
    end,
    dispose: () => {
      setField(null)
      emptyVolume.dispose()
      emptyRaw.dispose()
      emptyGround.dispose()
      target.dispose()
      depthTexture.dispose()
      material.dispose()
      quad.geometry.dispose()
    },
  }
}
