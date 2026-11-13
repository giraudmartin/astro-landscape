import * as THREE from 'three'
import {
  Body,
  Equator,
  Horizon,
  HourAngle,
  Libration,
  Observer,
  RotateVector,
  Rotation_EQJ_HOR,
  RotationAxis,
} from 'astronomy-engine'
import {
  applyHorizonTurbulenceSettings,
  createHorizonTurbulenceUniforms,
  HORIZON_TURBULENCE_GLSL,
  type HorizonTurbulenceSettings,
} from './horizonTurbulence'
import { totalOpticalDepthRgb } from './moonHorizonExtinction'

/** −1 new → 0 quarter → +1 full (same as API terminatorCos). */
export function terminatorCosFromIllumination(
  illuminationFraction: number,
): number {
  const k = Math.min(1, Math.max(0, illuminationFraction))
  return 2 * k - 1
}

export function isWaxingMoon(phaseDeg: number): boolean {
  const phase = ((phaseDeg % 360) + 360) % 360
  return phase < 180
}

/**
 * Yaw so lon 0° / UV u=0.5 (+X on SphereGeometry) faces the camera.
 * Object3D.lookAt points the object's **+Z** at the target; −π/2 maps +X → +Z.
 */
export const MOON_NEAR_SIDE_YAW = -Math.PI / 2

/**
 * Bump when moon globe shading/orientation contract changes so the trajectory
 * preview remounts its WebGL scene (HMR alone keeps the old ShaderMaterial).
 */
export const MOON_GLOBE_SCENE_REVISION = 26
/** Bump when `prepareMoonTopoModel` bake changes so the GLB prototype rebakes. */
export const MOON_TOPO_BAKE_REVISION = 3

export function orientMoonNearSide(root: THREE.Object3D): void {
  root.rotation.set(0, MOON_NEAR_SIDE_YAW, 0)
  root.scale.set(1, 1, 1)
}

/** Astronomy Engine HOR: x=north, y=west, z=zenith. */
export type AeHorDirection = { n: number; w: number; z: number }

/** Legacy south/east/zenith (n=−s, w=−e). */
export type HorDirection = { s: number; e: number; z: number }

/**
 * AE HOR (north, west, zenith) → scene: +Y up, +Z toward `targetAzimuthDeg`,
 * +X = screen-left (north when facing east, east when facing south).
 */
export function aeHorDirectionToScene(
  hor: AeHorDirection,
  targetAzimuthDeg: number,
): THREE.Vector3 {
  const A = (targetAzimuthDeg * Math.PI) / 180
  return new THREE.Vector3(
    Math.sin(A) * hor.n + Math.cos(A) * hor.w,
    hor.z,
    Math.cos(A) * hor.n - Math.sin(A) * hor.w,
  )
}

/**
 * south/east/zenith → scene (via AE north/west/zenith).
 */
export function horDirectionToScene(
  hor: HorDirection,
  targetAzimuthDeg: number,
): THREE.Vector3 {
  return aeHorDirectionToScene(
    { n: -hor.s, w: -hor.e, z: hor.z },
    targetAzimuthDeg,
  )
}

function rejectAeHor(v: AeHorDirection, axis: AeHorDirection): AeHorDirection {
  const d = v.n * axis.n + v.w * axis.w + v.z * axis.z
  return {
    n: v.n - d * axis.n,
    w: v.w - d * axis.w,
    z: v.z - d * axis.z,
  }
}

function normalizeAeHor(v: AeHorDirection): AeHorDirection | null {
  const len = Math.hypot(v.n, v.w, v.z)
  if (len < 1e-12) return null
  return { n: v.n / len, w: v.w / len, z: v.z / len }
}

/**
 * Lunar-north direction on the sky plane (⊥ line of sight), in scene coords.
 * Mesh +Y (texture north) must be twisted to match this after billboard.lookAt.
 */
export function lunarNorthDirectionScene(input: {
  datetimeUtc: string | Date
  latitudeDeg: number
  longitudeDeg: number
  elevationMeters?: number
  targetAzimuthDeg: number
}): THREE.Vector3 | null {
  if (
    !Number.isFinite(input.latitudeDeg) ||
    !Number.isFinite(input.longitudeDeg) ||
    !Number.isFinite(input.targetAzimuthDeg)
  ) {
    return null
  }
  const date =
    typeof input.datetimeUtc === 'string'
      ? new Date(input.datetimeUtc)
      : input.datetimeUtc
  if (Number.isNaN(date.getTime())) return null

  const observer = new Observer(
    input.latitudeDeg,
    input.longitudeDeg,
    input.elevationMeters ?? 0,
  )
  const eq = Equator(Body.Moon, date, observer, true, true)
  const hor = Horizon(date, observer, eq.ra, eq.dec, 'normal')
  const alt = (hor.altitude * Math.PI) / 180
  const az = (hor.azimuth * Math.PI) / 180
  // AE HOR: x=north, y=west, z=zenith
  const moonHor: AeHorDirection = {
    n: Math.cos(alt) * Math.cos(az),
    w: -Math.cos(alt) * Math.sin(az),
    z: Math.sin(alt),
  }

  const axis = RotationAxis(Body.Moon, date)
  const rot = Rotation_EQJ_HOR(date, observer)
  const northVec = RotateVector(rot, axis.north)
  const northHor: AeHorDirection = {
    n: northVec.x,
    w: northVec.y,
    z: northVec.z,
  }

  const projected = normalizeAeHor(rejectAeHor(northHor, moonHor))
  if (!projected) return null
  return aeHorDirectionToScene(projected, input.targetAzimuthDeg).normalize()
}

/**
 * Parallactic angle q (rad), Meeus formula via hour angle.
 * Negative east of the meridian, positive west (≈ −40° Paris ENE rise).
 */
export function parallacticAngleRadFromHourAngle(
  hourAngleHours: number,
  declinationDeg: number,
  latitudeDeg: number,
): number {
  const H = (hourAngleHours / 24) * 2 * Math.PI
  const dec = (declinationDeg * Math.PI) / 180
  const lat = (latitudeDeg * Math.PI) / 180
  return Math.atan2(
    Math.sin(H),
    Math.cos(dec) * Math.tan(lat) - Math.sin(dec) * Math.cos(H),
  )
}

/** Fallback when only alt-az is available (same Meeus sign: east → q < 0). */
export function parallacticAngleRad(
  azimuthDeg: number,
  altitudeDeg: number,
  latitudeDeg: number,
): number {
  const az = (azimuthDeg * Math.PI) / 180
  const alt = (altitudeDeg * Math.PI) / 180
  const lat = (latitudeDeg * Math.PI) / 180
  const y = -Math.sin(az)
  const x = Math.tan(lat) * Math.cos(alt) - Math.cos(az) * Math.sin(alt)
  return Math.atan2(y, x)
}

/**
 * Position angle of the lunar north pole from celestial north (rad),
 * measured N→E on the sky. `moonRaHours` / `poleRaHours` are in hours.
 */
export function lunarNorthPositionAngleRad(
  moonRaHours: number,
  moonDecDeg: number,
  poleRaHours: number,
  poleDecDeg: number,
): number {
  const a = (moonRaHours / 24) * 2 * Math.PI
  const d = (moonDecDeg * Math.PI) / 180
  const a1 = (poleRaHours / 24) * 2 * Math.PI
  const d1 = (poleDecDeg * Math.PI) / 180
  const da = a1 - a
  // PA of (a1,d1) from (a,d), N→E: y ∝ sin Δα cos δ1,
  // x ∝ cos δ sin δ1 − sin δ cos δ1 cos Δα (Meeus / spherical trig).
  const y = Math.sin(da) * Math.cos(d1)
  const x =
    Math.cos(d) * Math.sin(d1) - Math.sin(d) * Math.cos(d1) * Math.cos(da)
  return Math.atan2(y, x)
}

/**
 * Roll after lookAt(camera) (−Z toward viewer, +Y ≈ zenith).
 * Lunar north at (PA − q) from zenith; looking along +Z, +rotateZ is CCW
 * ⇒ twist = PA − q. Paris ENE rise ≈ +19° (Tycho near 6 h).
 */
export function moonZenithUpTwistRad(paNorthRad: number, qRad: number): number {
  return paNorthRad - qRad
}

export type MoonSkyOrientation = {
  /** Meeus parallactic angle q (rad). */
  qRad: number
  /** Lunar north PA from celestial north (rad). */
  paNorthRad: number
  /**
   * Billboard twist so mesh +Y (texture north) matches sky lunar north.
   * Prefer `applyMoonSkyOrientation` (vector align); this is PA − q diagnostic.
   */
  twistRad: number
  /** Optical libration in longitude (rad), applied on mesh yaw. */
  yawRad: number
  /** Optical libration in latitude (rad), applied on mesh pitch. */
  pitchRad: number
}

export type MoonSkyOrientationInput = {
  datetimeUtc: string | Date
  latitudeDeg: number
  longitudeDeg: number
  elevationMeters?: number
  /** Sightline azimuth (° from north) — scene +Z; required for vector twist. */
  targetAzimuthDeg?: number
  /**
   * Rotation from the local horizontal frame into world space. Omit for the
   * LiDAR scene, whose horizontal frame is already the world frame.
   */
  localToWorld?: THREE.Quaternion
}

/**
 * Ephemeris for moon disc orientation at an observer (face + sky roll inputs).
 */
export function computeMoonSkyOrientation(
  input: MoonSkyOrientationInput,
): MoonSkyOrientation {
  const empty: MoonSkyOrientation = {
    qRad: 0,
    paNorthRad: 0,
    twistRad: 0,
    yawRad: 0,
    pitchRad: 0,
  }
  if (
    !Number.isFinite(input.latitudeDeg) ||
    !Number.isFinite(input.longitudeDeg)
  ) {
    return empty
  }
  const date =
    typeof input.datetimeUtc === 'string'
      ? new Date(input.datetimeUtc)
      : input.datetimeUtc
  if (Number.isNaN(date.getTime())) return empty

  const observer = new Observer(
    input.latitudeDeg,
    input.longitudeDeg,
    input.elevationMeters ?? 0,
  )
  const eq = Equator(Body.Moon, date, observer, true, true)
  const H = HourAngle(Body.Moon, date, observer)
  const qRad = parallacticAngleRadFromHourAngle(H, eq.dec, input.latitudeDeg)
  const axis = RotationAxis(Body.Moon, date)
  const paNorthRad = lunarNorthPositionAngleRad(
    eq.ra,
    eq.dec,
    axis.ra,
    axis.dec,
  )
  const lib = Libration(date)
  return {
    qRad,
    paNorthRad,
    twistRad: moonZenithUpTwistRad(paNorthRad, qRad),
    yawRad: (-lib.elon * Math.PI) / 180,
    pitchRad: (lib.elat * Math.PI) / 180,
  }
}

/** @deprecated use computeMoonSkyOrientation */
export function moonParallacticAngleRad(input: {
  datetimeUtc: string | Date
  latitudeDeg: number
  longitudeDeg: number
  elevationMeters?: number
}): number {
  return computeMoonSkyOrientation(input).qRad
}

/** @deprecated use moonZenithUpTwistRad(PA, q) */
export function moonParallacticTwistRad(qRad: number): number {
  return -qRad
}

export type MoonGlobeUniforms = {
  uTerminatorCos: { value: number }
  uWaxing: { value: number }
  uBrightness: { value: number }
  uAlbedoGain: { value: number }
  uMoonAltDeg: { value: number }
  uMoonRadiusDeg: { value: number }
  uTauRgb: { value: THREE.Vector3 }
  uLightViewDir: { value: THREE.Vector3 }
  uUseSunLight: { value: number }
  /** 1 when disc mesh carries real topographic normals / depressions. */
  uTopoRelief: { value: number }
  uMap: { value: THREE.Texture | null }
  uHasMap: { value: number }
  /** Seconds — drives horizon shimmer animation. */
  uTime: { value: number }
  /** 0…1 horizon turbulence (toggle × altitude fade). */
  uTurbulence: { value: number }
  uTurbStrength: { value: number }
  uTurbSize: { value: number }
  uTurbSpeed: { value: number }
  uTurbLimb: { value: number }
  uTurbVertical: { value: number }
}

function createMoonUniforms(map: THREE.Texture | null): MoonGlobeUniforms {
  const tau = totalOpticalDepthRgb()
  if (map) {
    map.colorSpace = THREE.SRGBColorSpace
    map.wrapS = THREE.RepeatWrapping
    map.wrapT = THREE.ClampToEdgeWrapping
    map.anisotropy = 4
    map.needsUpdate = true
  }
  const turb = createHorizonTurbulenceUniforms()
  return {
    uTerminatorCos: { value: 1 },
    uWaxing: { value: 1 },
    // Stellarium-like: luminous cream disc, low local contrast.
    uBrightness: { value: 1.16 },
    uAlbedoGain: { value: map ? 1.35 : 1.08 },
    uMoonAltDeg: { value: 45 },
    uMoonRadiusDeg: { value: 0.25 },
    uTauRgb: { value: new THREE.Vector3(tau[0], tau[1], tau[2]) },
    uLightViewDir: { value: new THREE.Vector3(0, 0, 1) },
    uUseSunLight: { value: 0 },
    uTopoRelief: { value: 0 },
    uMap: { value: map },
    uHasMap: { value: map ? 1 : 0 },
    ...turb,
  }
}

/**
 * Lunar disc: texture + soft phase + altitude colour (pink→gold like telephoto).
 */
export function createMoonGlobeMaterial(
  map: THREE.Texture | null = null,
): THREE.ShaderMaterial & {
  userData: { uniforms: MoonGlobeUniforms }
} {
  const uniforms = createMoonUniforms(map)

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    fog: false,
    // Mostly opaque so the trajectory depth-tests behind the disc; tiny night
    // translucency still lets sky bleed without showing the arc through.
    transparent: true,
    depthTest: true,
    depthWrite: true,
    // Bias moon closer in Z so the arc (same km range) loses the depth fight.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      ${HORIZON_TURBULENCE_GLSL}

      uniform float uTopoRelief;

      varying vec3 vViewNormal;
      varying vec3 vRadialView;
      varying vec3 vLocalPos;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vec3 radial = normalize(position);
        // Radial from authored position (pre-turbulence) for sphere-vs-mesh shade.
        vRadialView = normalize(normalMatrix * radial);
        // Limb only: pull silhouette toward the mean sphere; keep centre relief.
        vec3 shadedPos = position;
        if (uTopoRelief > 0.5) {
          float facing = abs(vRadialView.z);
          float keep = mix(0.45, 1.0, smoothstep(0.15, 0.85, facing));
          float r = length(position);
          shadedPos = radial * mix(1.0, r, keep);
        }
        // Topo mesh normals are not radial — displacing along them spikes the limb.
        // Keep seeing shimmer along the mean sphere only.
        vec3 turbDir = uTopoRelief > 0.5 ? radial : normal;
        vec3 pos = applyHorizonTurbulence(shadedPos, turbDir);
        vLocalPos = pos;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTerminatorCos;
      uniform float uWaxing;
      uniform float uBrightness;
      uniform float uAlbedoGain;
      uniform float uMoonAltDeg;
      uniform float uMoonRadiusDeg;
      uniform vec3 uTauRgb;
      uniform vec3 uLightViewDir;
      uniform float uUseSunLight;
      uniform float uTopoRelief;
      uniform sampler2D uMap;
      uniform float uHasMap;

      varying vec3 vViewNormal;
      varying vec3 vRadialView;
      varying vec3 vLocalPos;
      varying vec2 vUv;

      float extinctionAirmass(float altDeg) {
        float alt = clamp(altDeg, -1.0, 90.0);
        float z = radians(90.0 - alt);
        float cosZ = cos(z);
        float X = 1.0 / (cosZ + 0.025 * exp(-11.0 * cosZ));
        return clamp(X, 1.0, 40.0);
      }

      float softBlob(vec3 p) {
        return 0.5
          + 0.5 * sin(p.x * 2.1 + p.z * 1.4)
          * sin(p.y * 1.7 - p.x * 0.9);
      }

      void main() {
        // Mesh normals (topo) or sphere normals — never rebuild from ideal radius.
        vec3 N = normalize(vViewNormal);
        vec3 Ns = normalize(vRadialView);

        vec3 L;
        if (uUseSunLight > 0.5) {
          L = normalize(uLightViewDir);
        } else {
          float alphaPhase = acos(clamp(uTerminatorCos, -1.0, 1.0));
          float sx = uWaxing > 0.5 ? 1.0 : -1.0;
          L = normalize(vec3(sx * sin(alphaPhase), 0.0, cos(alphaPhase)));
        }

        float ndotl = dot(N, L);
        float ndotlSphere = dot(Ns, L);

        // Soft telephoto terminator. Phase from mean sphere so crater walls
        // cannot light the night side.
        float wrap = 0.08;
        float phaseNdotL = uTopoRelief > 0.5 ? ndotlSphere : ndotl;
        float wrapped = (phaseNdotL + wrap) / (1.0 + wrap);
        float lit = smoothstep(0.02, 0.18, wrapped);
        float slopeShade = 1.0;

        if (uTopoRelief > 0.5) {
          // Crater relief on the sunlit crescent only — never on earthshine.
          float dayMask = smoothstep(0.08, 0.55, lit);
          float grazing = 1.0 - smoothstep(0.04, 0.42, abs(ndotlSphere));
          float meshSlope = clamp(ndotl - ndotlSphere, -0.45, 0.45);
          slopeShade = 1.0 + grazing * meshSlope * 1.8 * dayMask;
          float away = 1.0 - smoothstep(-0.05, 0.2, ndotl);
          slopeShade *= 1.0 - grazing * away * 0.55 * dayMask;
          float meshGate = smoothstep(-0.03, 0.16, ndotl);
          lit *= mix(1.0, meshGate, grazing * 0.55 * dayMask);
          slopeShade = clamp(slopeShade, 0.65, 1.35);
        }

        // Opaque enough that the arc stays behind; still a soft night disc.
        float alpha = mix(0.78, 1.0, lit);

        vec3 p = normalize(vLocalPos);
        vec3 mapRgb;
        if (uHasMap > 0.5) {
          mapRgb = texture2D(uMap, vUv).rgb;
        } else {
          float maria = smoothstep(0.35, 0.75, softBlob(p)) * 0.22;
          mapRgb = vec3(0.9, 0.89, 0.86) - vec3(maria);
        }

        float mapLuma = dot(mapRgb, vec3(0.2126, 0.7152, 0.0722));

        // Lit path: luminous cream telephoto with readable maria near full.
        vec3 litAlbedo = mix(vec3(mapLuma), mapRgb, 0.34);
        litAlbedo = mix(vec3(0.60), litAlbedo, 0.46);
        litAlbedo = pow(max(litAlbedo, vec3(0.0)), vec3(0.88));
        litAlbedo *= vec3(1.03, 1.0, 0.94);
        litAlbedo *= uAlbedoGain;

        float facing = clamp(Ns.z, 0.0, 1.0);
        litAlbedo *= mix(0.98, 1.03, pow(facing, 0.6));

        vec3 litColor = litAlbedo * uBrightness * slopeShade;

        // Earthshine = the REAL moon surface, softly lit (not a flat gray plate).
        // Mild contrast: maria readable, never hard topo shadows.
        float detail = smoothstep(0.10, 0.82, mapLuma);
        detail = pow(detail, 0.8);
        vec3 shineLo = vec3(0.48, 0.50, 0.58);
        vec3 shineHi = vec3(0.72, 0.73, 0.78);
        vec3 moonshine = mix(shineLo, shineHi, detail);
        moonshine *= mix(vec3(1.0), mapRgb / max(mapLuma, 0.08), 0.42);
        // Soften only — keep surface identity.
        float shineFlat = dot(moonshine, vec3(0.2126, 0.7152, 0.0722));
        moonshine = mix(vec3(shineFlat), moonshine, 0.72);
        moonshine = mix(moonshine, vec3(0.62, 0.63, 0.68), 0.12);

        // Scientific extinction (Krisciunas–Schaefer X × τ_R+a), display-softened:
        // keep luminance high, apply mild cream/amber chroma — never tomato/rose.
        float limbAlt = uMoonAltDeg + p.y * uMoonRadiusDeg;
        float X = extinctionAirmass(limbAlt);
        vec3 T = exp(-uTauRgb * X);
        // Display scale ≈ displayExtinctionArgb: T^k then chroma blend.
        vec3 Tsoft = pow(max(T, vec3(1e-6)), vec3(0.28));
        float lumT = dot(Tsoft, vec3(0.2126, 0.7152, 0.0722));
        vec3 chroma = Tsoft / max(lumT, 1e-4);
        float low = smoothstep(22.0, 1.0, uMoonAltDeg);
        chroma = mix(vec3(1.0), chroma, 0.22 + 0.38 * low);
        // Cream bias on the sunlit limb only (Stellarium twilight Moon).
        vec3 cream = mix(vec3(1.0), vec3(1.06, 1.0, 0.88), low);
        litColor *= chroma * cream;
        litColor *= mix(1.0, 0.92 + 0.08 * pow(clamp(lumT, 0.0, 1.0), 0.35), low);
        // Soft highlight roll-off on the bright side only.
        litColor = litColor / (vec3(0.64) + litColor * 0.46);

        // Glow = sunlight colour on the lit face (crescent + full stay cream).
        float lightGlow = pow(max(phaseNdotL, 0.0), 0.45) * lit;
        litColor += litColor * lightGlow * 0.22;

        vec3 color = mix(moonshine, litColor, lit);

        gl_FragColor = vec4(color, alpha);
      }
    `,
  }) as THREE.ShaderMaterial & {
    userData: { uniforms: MoonGlobeUniforms }
  }

  material.userData = { uniforms }
  if (map) {
    // Albedo is sampled via uMap; keep Three's `.map` for tooling / fallbacks.
    ;(material as THREE.ShaderMaterial & { map?: THREE.Texture }).map = map
  }
  return material
}

/**
 * Soft bloom sprite behind the disc. Kept subtle — the real “glow” is the
 * sunlight colour on the lit face in the globe shader, not this orange ring.
 */
export function createMoonGlowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uBrightness: { value: 1 },
      uLit: { value: 1 },
      uGlowTint: { value: new THREE.Color(1, 0.97, 0.9) },
      uTime: { value: 0 },
      uTurbulence: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uBrightness;
      uniform float uLit;
      uniform vec3 uGlowTint;
      uniform float uTime;
      uniform float uTurbulence;
      varying vec2 vUv;

      float glowHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float glowNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = glowHash(i);
        float b = glowHash(i + vec2(1.0, 0.0));
        float c = glowHash(i + vec2(0.0, 1.0));
        float d = glowHash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float turb = uTurbulence;
        if (turb > 0.001) {
          float t = uTime;
          float ang = atan(p.y, p.x);
          float n1 = glowNoise(vec2(ang * 6.0, t * 1.8)) * 2.0 - 1.0;
          float n2 = glowNoise(vec2(ang * 11.0 - t * 2.2, t * 2.6)) * 2.0 - 1.0;
          p *= 1.0 + (n1 * 0.028 + n2 * 0.018) * turb;
        }
        float r = length(p);
        // Quiet atmospheric spill only — do not stamp a loud orange disc.
        float halo = exp(-r * r * 3.2) * 0.22;
        float rim = smoothstep(1.05, 0.5, r) * 0.06;
        float glowScale = mix(1.0, 0.72, turb);
        float a = (halo + rim) * uBrightness * mix(0.25, 0.7, uLit) * glowScale;
        gl_FragColor = vec4(uGlowTint * a, a);
      }
    `,
  })
}

export function setMoonGlobePhase(
  material: THREE.ShaderMaterial,
  input: {
    illuminationFraction: number
    waxing: boolean
    brightness?: number
    moonAltitudeDeg?: number
    angularDiameterDeg?: number
    /** Direction toward the sun in view space (moon-centred). */
    lightViewDir?: THREE.Vector3
  },
): void {
  const u = material.uniforms as unknown as MoonGlobeUniforms
  u.uTerminatorCos.value = terminatorCosFromIllumination(
    input.illuminationFraction,
  )
  u.uWaxing.value = input.waxing ? 1 : 0
  u.uBrightness.value = input.brightness ?? 1.16
  if (input.moonAltitudeDeg != null) {
    u.uMoonAltDeg.value = input.moonAltitudeDeg
  }
  if (input.angularDiameterDeg != null) {
    u.uMoonRadiusDeg.value = Math.max(input.angularDiameterDeg, 0.1) * 0.5
  }
  if (input.lightViewDir) {
    u.uLightViewDir.value.copy(input.lightViewDir).normalize()
    u.uUseSunLight.value = 1
  } else {
    // Lab / callers that drive phase from illumination alone.
    u.uUseSunLight.value = 0
  }
}

/** Animate horizon shimmer on the lunar disc (and keep altitude fade in sync). */
export function setMoonGlobeTurbulence(
  material: THREE.ShaderMaterial,
  input: { timeSec: number; amount: number },
): void {
  const amount = Math.min(1, Math.max(0, input.amount))
  const u = material.uniforms as unknown as MoonGlobeUniforms
  u.uTime.value = input.timeSec
  u.uTurbulence.value = amount
}

/** Same seeing amount on the bloom sprite so it does not mask the limb. */
export function setMoonGlowTurbulence(
  material: THREE.ShaderMaterial,
  input: { timeSec: number; amount: number },
): void {
  const amount = Math.min(1, Math.max(0, input.amount))
  if (material.uniforms.uTime) material.uniforms.uTime.value = input.timeSec
  if (material.uniforms.uTurbulence) {
    material.uniforms.uTurbulence.value = amount
  }
}

/** Live-tune form / animation from the Viewfinder sliders. */
export function setMoonTurbulenceSettings(
  materials: readonly THREE.ShaderMaterial[],
  settings: HorizonTurbulenceSettings,
): void {
  for (const material of materials) {
    applyHorizonTurbulenceSettings(
      material.uniforms as Record<string, { value: unknown }>,
      settings,
    )
  }
}

/**
 * Fit a moon GLB so its **mean** surface radius ≈ 1.
 * Do not use the topographic peak — that would shrink the apparent disc.
 */
export function normalizeMoonModel(root: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  const meshes: THREE.Mesh[] = []
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh && mesh.geometry?.attributes?.position) meshes.push(mesh)
  })
  if (meshes.length === 0) {
    const box = new THREE.Box3().setFromObject(root)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.x, size.y, size.z, 1e-6) * 0.5
    root.position.sub(center)
    root.scale.setScalar(1 / radius)
    root.updateMatrixWorld(true)
    return
  }

  const worldPos = new THREE.Vector3()
  let sumX = 0
  let sumY = 0
  let sumZ = 0
  let count = 0
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      worldPos.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      sumX += worldPos.x
      sumY += worldPos.y
      sumZ += worldPos.z
      count++
    }
  }
  const cx = sumX / count
  const cy = sumY / count
  const cz = sumZ / count
  let sumR = 0
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      worldPos.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      sumR += Math.hypot(worldPos.x - cx, worldPos.y - cy, worldPos.z - cz)
    }
  }
  const meanR = Math.max(sumR / count, 1e-6)
  root.position.sub(new THREE.Vector3(cx, cy, cz))
  root.scale.multiplyScalar(1 / meanR)
  root.updateMatrixWorld(true)
}

/** Swap each triangle's winding (needed after a negative-determinant bake). */
export function flipTriangleWinding(geometry: THREE.BufferGeometry): void {
  const index = geometry.index
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1)
      const c = index.getX(i + 2)
      index.setX(i + 1, c)
      index.setX(i + 2, b)
    }
    index.needsUpdate = true
    return
  }
  const pos = geometry.attributes.position
  if (!pos || pos.count < 3) return
  const swapAttr = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
    const item = attr.itemSize
    const tmp = new Float32Array(item)
    for (let i = 0; i < attr.count; i += 3) {
      for (let k = 0; k < item; k++) tmp[k] = attr.getComponent(i + 1, k)
      for (let k = 0; k < item; k++) {
        attr.setComponent(i + 1, k, attr.getComponent(i + 2, k))
        attr.setComponent(i + 2, k, tmp[k])
      }
    }
    attr.needsUpdate = true
  }
  swapAttr(pos)
  if (geometry.attributes.normal) swapAttr(geometry.attributes.normal)
  if (geometry.attributes.uv) swapAttr(geometry.attributes.uv)
}

const _moonTopoYFlip = new THREE.Matrix4().makeScale(1, -1, 1)

/**
 * KHR_mesh_quantization stores POSITION/NORMAL as normalized int16.
 * Baking floats into that array truncates to ±1 and flips the globe.
 */
export function ensureFloatMeshAttributes(geometry: THREE.BufferGeometry): void {
  for (const name of ['position', 'normal'] as const) {
    const attr = geometry.attributes[name]
    if (!attr) continue
    const array = (attr as THREE.BufferAttribute).array
    if (array instanceof Float32Array && !attr.normalized) continue
    const itemSize = attr.itemSize
    const floats = new Float32Array(attr.count * itemSize)
    for (let i = 0; i < attr.count; i++) {
      for (let k = 0; k < itemSize; k++) {
        floats[i * itemSize + k] = attr.getComponent(i, k)
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(floats, itemSize))
  }
  const uv = geometry.attributes.uv
  if (uv && (!(uv.array instanceof Float32Array) || uv.normalized)) {
    const itemSize = uv.itemSize
    const floats = new Float32Array(uv.count * itemSize)
    for (let i = 0; i < uv.count; i++) {
      for (let k = 0; k < itemSize; k++) {
        floats[i * itemSize + k] = uv.getComponent(i, k)
      }
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(floats, itemSize))
  }
}

/**
 * Bake NASA LRO topo GLB into the SphereGeometry contract:
 * mean radius 1, lon0 at +X, UV-north at +Y (export ships north on −Y).
 */
export function prepareMoonTopoModel(root: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  const meshes: THREE.Mesh[] = []
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh && mesh.geometry?.attributes?.position) meshes.push(mesh)
  })
  if (meshes.length === 0) return

  const worldMatrices = meshes.map((mesh) => mesh.matrixWorld.clone())
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i]!
    mesh.geometry = mesh.geometry.clone()
    ensureFloatMeshAttributes(mesh.geometry)
    mesh.geometry.applyMatrix4(worldMatrices[i]!)
  }

  root.traverse((obj) => {
    obj.position.set(0, 0, 0)
    obj.quaternion.identity()
    obj.scale.set(1, 1, 1)
  })
  root.updateMatrixWorld(true)

  let sumX = 0
  let sumY = 0
  let sumZ = 0
  let count = 0
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      sumX += pos.getX(i)
      sumY += pos.getY(i)
      sumZ += pos.getZ(i)
      count++
    }
  }
  const cx = sumX / count
  const cy = sumY / count
  const cz = sumZ / count
  let sumR = 0
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      sumR += Math.hypot(pos.getX(i) - cx, pos.getY(i) - cy, pos.getZ(i) - cz)
    }
  }
  const invR = 1 / Math.max(sumR / count, 1e-6)
  // Soften raw LRO height so the disc stays round, but keep enough for crater
  // slopes on the lit crescent (Stellarium-like terminator relief).
  const RELIEF_KEEP = 0.58

  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = (pos.getX(i) - cx) * invR
      const y = (pos.getY(i) - cy) * invR
      const z = (pos.getZ(i) - cz) * invR
      const r = Math.hypot(x, y, z)
      if (r < 1e-8) {
        pos.setXYZ(i, x, y, z)
        continue
      }
      const h = r - 1
      const s = (1 + h * RELIEF_KEEP) / r
      pos.setXYZ(i, x * s, y * s, z * s)
    }
    pos.needsUpdate = true
    // Export: UV north (−Y). Contract: +Y north like SphereGeometry.
    mesh.geometry.applyMatrix4(_moonTopoYFlip)
    flipTriangleWinding(mesh.geometry)
    // Rebuild normals from displaced triangles so crater slopes drive lighting.
    mesh.geometry.computeVertexNormals()
    mesh.geometry.computeBoundingBox()
    mesh.geometry.computeBoundingSphere()
    // Clones share this buffer — scene dispose must skip it.
    mesh.geometry.userData.moonTopoShared = true
  }
  root.updateMatrixWorld(true)
}

/** Enable crater-aware lighting terms on an existing moon shader. */
export function setMoonTopoReliefEnabled(
  material: THREE.ShaderMaterial,
  enabled: boolean,
): void {
  const u = material.uniforms as unknown as MoonGlobeUniforms
  if (u.uTopoRelief) u.uTopoRelief.value = enabled ? 1 : 0
}

/** Replace every mesh material with the shared phase/extinction shader. */
export function attachMoonGlobeMaterial(
  root: THREE.Object3D,
  material: THREE.ShaderMaterial,
): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.morphTargetInfluences = undefined
    mesh.morphTargetDictionary = undefined
    const prev = mesh.material
    mesh.material = material
    mesh.renderOrder = 2
    mesh.frustumCulled = false
    if (Array.isArray(prev)) {
      for (const m of prev) {
        if (m && m !== material) m.dispose()
      }
    } else if (prev && prev !== material) {
      prev.dispose()
    }
  })
}

/** Pull the first base-color map found on any mesh material. */
export function extractMoonAlbedoMap(root: THREE.Object3D): THREE.Texture | null {
  let albedo: THREE.Texture | null = null
  root.traverse((obj) => {
    if (albedo) return
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of list) {
      if (!mat || typeof mat !== 'object') continue
      const candidate =
        ('map' in mat ? (mat as THREE.MeshStandardMaterial).map : null) ??
        ('emissiveMap' in mat
          ? (mat as THREE.MeshStandardMaterial).emissiveMap
          : null)
      if (candidate) {
        albedo = candidate
        return
      }
    }
  })
  return albedo
}

/** Tycho crater — selenographic (IAU), near-side south. */
export const TYCHO_LAT_DEG = -43.3
export const TYCHO_LON_DEG = -11.2

/**
 * Mesh-local position for a lon/lat on Three.js SphereGeometry + our albedo
 * (same UV as the texture — marker sticks to the crater on the map).
 * With MOON_NEAR_SIDE_YAW = −π/2, lon 0° (u=0.5) faces the camera; west
 * (lon < 0) appears left on screen.
 */
export function selenographicToMoonLocal(
  latDeg: number,
  lonDeg: number,
  radius = 1,
): THREE.Vector3 {
  // Equirect: lon 0° at image centre → SphereGeometry +X (u=0.5).
  // IAU east-positive lon: u = 0.5 + lon/360 (west → u < 0.5).
  const u = 0.5 + lonDeg / 360
  const vTex = 0.5 + latDeg / 180
  // SphereGeometry: uv.v=0 south pole? Measured uv.v=0.25 → y≈−0.71 (south).
  const phi = (1 - vTex) * Math.PI
  const theta = u * Math.PI * 2
  const sinPhi = Math.sin(phi)
  const x = -Math.cos(theta) * sinPhi
  const y = Math.cos(phi)
  const z = Math.sin(theta) * sinPhi
  return new THREE.Vector3(x, y, z).multiplyScalar(radius)
}

/** Bright debug pin — parented to the moon mesh (follows albedo UVs). */
export function createTychoMarker(): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xff00aa,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  )
  marker.position.copy(
    selenographicToMoonLocal(TYCHO_LAT_DEG, TYCHO_LON_DEG, 1.02),
  )
  marker.renderOrder = 999
  marker.frustumCulled = false
  marker.name = 'tycho-marker'
  return marker
}

/** Build a unit sphere moon with predictable UVs (near-side after orient). */
export function createOrientedMoonMesh(
  material: THREE.ShaderMaterial,
): THREE.Mesh {
  // Dense tessellation so fine limb seeing does not read as hex facets.
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 112), material)
  mesh.renderOrder = 2
  mesh.frustumCulled = false
  orientMoonNearSide(mesh)
  return mesh
}

/**
 * root (pos/scale) → billboard (lookAt camera) → twist → mesh (near-side).
 * Pass a prepared NASA topo root to replace the procedural unit sphere.
 */
export function createMoonOrientationRig(
  material: THREE.ShaderMaterial,
  topoRoot?: THREE.Object3D | null,
): {
  root: THREE.Group
  billboard: THREE.Group
  twist: THREE.Group
  mesh: THREE.Object3D
} {
  const root = new THREE.Group()
  root.renderOrder = 2
  const billboard = new THREE.Group()
  const twist = new THREE.Group()
  let mesh: THREE.Object3D
  if (topoRoot) {
    attachMoonGlobeMaterial(topoRoot, material)
    setMoonTopoReliefEnabled(material, true)
    mesh = topoRoot
    mesh.renderOrder = 2
    orientMoonNearSide(mesh)
  } else {
    setMoonTopoReliefEnabled(material, false)
    mesh = createOrientedMoonMesh(material)
  }
  twist.add(mesh)
  billboard.add(twist)
  root.add(billboard)
  return { root, billboard, twist, mesh }
}

const _northLocal = new THREE.Vector3()
const _billboardInverse = new THREE.Matrix4()

/**
 * Screen vertical flip after sky orientation (Photoshop « hauteur −100% »).
 * On `twist.scale.y` so ephemeris roll is kept, then the disc is mirrored
 * over the view horizontal.
 */
export const MOON_DISC_VERTICAL_FLIP = -1

/**
 * Orient the near-side disc for an observer:
 * 1. billboard.lookAt(camera) — Object3D +Z toward camera, +Y ≈ zenith
 * 2. mesh yaw/pitch — near-side + optical libration (Astronomy Engine)
 * 3. twist — align mesh +Y with lunar north on the sky plane (vector)
 * 4. twist.scale.y = MOON_DISC_VERTICAL_FLIP (Photoshop height −100%)
 *
 * Uses Astronomy Engine RotateVector (EQJ→HOR, n/w/z).
 */
export function applyMoonSkyOrientation(
  rig: {
    billboard: THREE.Object3D
    twist: THREE.Object3D
    mesh: THREE.Object3D
  },
  camera: THREE.Object3D,
  input?: MoonSkyOrientationInput,
): void {
  camera.updateMatrixWorld(true)
  rig.billboard.lookAt(camera.position)
  rig.mesh.scale.set(1, 1, 1)
  rig.twist.rotation.set(0, 0, 0)
  rig.twist.scale.set(1, 1, 1)

  const applyVerticalFlip = (): void => {
    rig.twist.scale.set(1, MOON_DISC_VERTICAL_FLIP, 1)
  }

  if (
    !input ||
    !Number.isFinite(input.latitudeDeg) ||
    !Number.isFinite(input.longitudeDeg)
  ) {
    rig.mesh.rotation.set(0, MOON_NEAR_SIDE_YAW, 0)
    applyVerticalFlip()
    return
  }

  const orient = computeMoonSkyOrientation(input)
  rig.mesh.rotation.set(
    orient.pitchRad,
    MOON_NEAR_SIDE_YAW + orient.yawRad,
    0,
  )

  if (!Number.isFinite(input.targetAzimuthDeg)) {
    applyVerticalFlip()
    return
  }

  const northScene = lunarNorthDirectionScene({
    datetimeUtc: input.datetimeUtc,
    latitudeDeg: input.latitudeDeg,
    longitudeDeg: input.longitudeDeg,
    elevationMeters: input.elevationMeters,
    targetAzimuthDeg: input.targetAzimuthDeg as number,
  })
  if (!northScene) {
    applyVerticalFlip()
    return
  }

  rig.billboard.updateMatrixWorld(true)
  _billboardInverse.copy(rig.billboard.matrixWorld).invert()
  _northLocal.copy(northScene)
  if (input.localToWorld) _northLocal.applyQuaternion(input.localToWorld)
  _northLocal.transformDirection(_billboardInverse)
  if (_northLocal.x * _northLocal.x + _northLocal.y * _northLocal.y < 1e-12) {
    applyVerticalFlip()
    return
  }
  // R_z(θ)·(0,1,0) = (−sin θ, cos θ) → match projected lunar north in billboard XY.
  rig.twist.rotation.z = -Math.atan2(_northLocal.x, _northLocal.y)
  applyVerticalFlip()
}

/**
 * Replace GLB materials with a shared phase + extinction shader using the
 * model's base-color map when present.
 */
export function prepareMoonModelMaterials(root: THREE.Object3D): {
  material: THREE.ShaderMaterial
  albedo: THREE.Texture | null
} {
  const albedo = extractMoonAlbedoMap(root)
  const material = createMoonGlobeMaterial(albedo)
  if (albedo) {
    ;(material as THREE.ShaderMaterial & { map?: THREE.Texture }).map = albedo
    material.uniforms.uMap.value = albedo
    material.uniforms.uHasMap.value = 1
    material.needsUpdate = true
  }
  attachMoonGlobeMaterial(root, material)
  setMoonTopoReliefEnabled(material, true)
  orientMoonNearSide(root)
  return { material, albedo }
}
