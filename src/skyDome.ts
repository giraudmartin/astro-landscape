import * as THREE from 'three'
import {
  Observer,
  RotateVector,
  Rotation_ECL_HOR,
  Vector,
} from 'astronomy-engine'
import { EARTH_RADIUS_M } from './globeConstants'
import {
  airglowColorFromHue,
  clampAirglowAmount,
  clampAirglowHue,
  clampAirglowWaves,
  clampLightPollutionAmount,
  clampZodiacalAmount,
  skyPaletteFromSunAltitude,
} from './skyLighting'
import {
  STEL_FRAGMENT_GLSL,
  STEL_PROJECT_GLSL,
  stelModeUniform,
} from './stelProjector'

export { EARTH_RADIUS_M }

export type AstroSkyDome = {
  mesh: THREE.Mesh
  /**
   * Fullscreen LP overlay mesh — NOT in the main scene.
   * Drawn after the frame via {@link renderImmersiveLightPollution}.
   */
  lightPollutionMesh: THREE.Mesh
  /** Additive ecliptic glow — drawn after light pollution. */
  zodiacalMesh: THREE.Mesh
  geometry: THREE.SphereGeometry
  material: THREE.ShaderMaterial
  lightPollutionMaterial: THREE.ShaderMaterial
  zodiacalMaterial: THREE.ShaderMaterial
  /** 1D azimuth PL profile (R channel). */
  lightPollutionProfile: THREE.DataTexture
  /** Private overlay scene for post-frame LP (no stereo mesh). */
  _lpOverlay: {
    scene: THREE.Scene
    camera: THREE.OrthographicCamera
  }
}

/**
 * After MW (20+z) + LP overlay + constellation figures (23); stars sit at 24.
 * Must stay above `renderOrder + tileZ` for milkyway tiles.
 */
const ZODIACAL_RENDER_ORDER = 27

/** Immersive PL profile resolution (1D R texture). */
export const LP_PROFILE_TEX_WIDTH = 128

/** Must match GLSL `live * (glow * X + …)` — keep tests in sync. */
export const LP_IMMERSIVE_GLOW_GAIN = 2.2

/**
 * CPU mirror of immersive LP brightness at one sample (for unit tests).
 * Returns RGB length² proxy — must be clearly > 0 toward a city on the horizon.
 */
export function estimateImmersiveLpGlow01(input: {
  amount: number
  bortle01: number
  peak01: number
  mean01: number
  city01: number
  elevN: number
  sunAltDeg: number
}): number {
  const lpAmt = Math.min(1, Math.max(0, input.amount))
  const lpClass = Math.min(1, Math.max(0, input.bortle01))
  const lpPeak = Math.min(1, Math.max(0, input.peak01))
  // smoothstep(1.5, -10, alt)
  const t = Math.min(1, Math.max(0, (1.5 - input.sunAltDeg) / 11.5))
  const night = t * t * (3 - 2 * t)
  const site = Math.max(lpClass, lpPeak)
  const live = lpAmt * site * night
  if (live < 0.0005) return 0
  const blob = Math.pow(Math.min(1, Math.max(0, input.city01)), 0.7)
  const dir = Math.max(0, blob - input.mean01 * 0.18)
  const elevDeg = input.elevN * 90
  const h = 12 + (26 - 12) * Math.max(blob, lpPeak)
  let elevFall = Math.exp(-elevDeg / Math.max(h, 7))
  const a = h * 1.35
  const b = h * 2.9
  const u = elevDeg <= a ? 0 : elevDeg >= b ? 1 : (elevDeg - a) / (b - a)
  elevFall *= 1 - u * u * (3 - 2 * u)
  const limb =
    Math.min(1, Math.max(0, input.elevN / 0.05)) *
    Math.pow(Math.min(1, Math.max(0, 1 - input.elevN)), 1)
  const glow = dir * elevFall * limb
  const wash =
    input.mean01 * 0.14 * elevFall * limb * (0.35 + 0.55 * lpClass)
  return live * (glow * LP_IMMERSIVE_GLOW_GAIN + wash * 0.55)
}

/**
 * Inverse Stellarium stereographic: st = n.xy / (0.5·(1−n.z)).
 */
export function invertStereographicSt(
  stX: number,
  stY: number,
): [number, number, number] {
  const s2 = stX * stX + stY * stY
  const denom = s2 + 4
  const nz = (s2 - 4) / denom
  const h = 4 / denom
  return [stX * h, stY * h, nz]
}

/**
 * Immersive PL — post-frame fullscreen overlay (NOT the sky sphere).
 * Sphere + interpolated vDir under stereo = concentric “tuiles”.
 * Per-pixel screen ray after the warped frame = continuous sodium domes.
 */
const LIGHT_POLLUTION_GLSL = /* glsl */ `
  uniform float uLightPollution;
  uniform float uLpBortle;
  uniform float uLpIntensity;
  uniform float uLpMean;
  uniform sampler2D uLpProfile;
  uniform vec2 uLpResolution;
  uniform vec2 uLpNdcScale;
  uniform mat3 uLpInvMv;

  vec3 lpDirFromScreen() {
    vec2 res = max(uLpResolution, vec2(1.0));
    vec2 ndc = (gl_FragCoord.xy / res) * 2.0 - 1.0;
    vec2 st = ndc * uLpNdcScale;
    vec3 vd;
    if (uStelMode < 0.5) {
      float s2 = dot(st, st);
      float denom = s2 + 4.0;
      float nz = (s2 - 4.0) / denom;
      float h = 4.0 / denom;
      vd = normalize(vec3(st * h, nz));
    } else if (uStelMode < 1.5) {
      float ca = cos(st.y);
      vd = normalize(vec3(sin(st.x) * ca, sin(st.y), -cos(st.x) * ca));
    } else {
      vd = normalize(vec3(st, -1.0));
    }
    return normalize(uLpInvMv * vd);
  }

  vec3 lightPollutionRgb(vec3 v, float elevN, float alt, float below) {
    float lpAmt = clamp(uLightPollution, 0.0, 1.0);
    float lpClass = clamp(uLpBortle, 0.0, 1.0);
    float lpPeak = clamp(uLpIntensity, 0.0, 1.0);
    float nightLp = smoothstep(1.5, -10.0, alt);
    float site = max(lpClass, lpPeak);
    float live = lpAmt * site * nightLp;
    if (live < 0.0005 || below >= 0.55) return vec3(0.0);

    float az = atan(v.x, -v.z);
    float az01 = fract(az / (6.2831853) + 1.0);

    float t = 1.5 / 128.0;
    float c0 = texture2D(uLpProfile, vec2(az01, 0.5)).r;
    float c1 = texture2D(uLpProfile, vec2(fract(az01 + t), 0.5)).r;
    float c2 = texture2D(uLpProfile, vec2(fract(az01 - t + 1.0), 0.5)).r;
    float c3 = texture2D(uLpProfile, vec2(fract(az01 + 3.0 * t), 0.5)).r;
    float c4 = texture2D(uLpProfile, vec2(fract(az01 - 3.0 * t + 1.0), 0.5)).r;
    float city = clamp(c0 * 0.4 + (c1 + c2) * 0.2 + (c3 + c4) * 0.1, 0.0, 1.0);
    float blob = pow(city, 0.72);
    float dir = max(0.0, blob - uLpMean * 0.16);

    float elevDeg = elevN * 90.0;
    float h = mix(13.0, 28.0, max(blob, lpPeak));
    float hh = max(h, 7.0);
    float elevFall = exp(-elevDeg / hh);
    elevFall *= 1.0 - smoothstep(h * 1.2, h * 3.4, elevDeg);
    float limb = smoothstep(0.0, 0.08, elevN) * pow(clamp(1.0 - elevN, 0.0, 1.0), 0.95);

    float glow = dir * elevFall * limb;
    float wash = uLpMean * 0.12 * elevFall * limb * mix(0.3, 0.85, lpClass);
    float gain = live * (glow * ${LP_IMMERSIVE_GLOW_GAIN.toFixed(1)} + wash * 0.5);

    vec3 sodium = vec3(1.2, 0.82, 0.18);
    vec3 amber = vec3(1.0, 0.62, 0.14);
    vec3 col = mix(amber, sodium, clamp(blob, 0.0, 1.0));
    return col * gain;
  }
`

/** Warm inland fill when the eye is near sea level. */
const GROUND_FILL = new THREE.Color(0x8a7349)
/** Soft limb fill past the DEM edge — cooler sea haze under a clear coastal horizon. */
const SEA_FILL = new THREE.Color(0x5a7a90)

/** sin(altitude) of the geometric sea horizon from eye elevation MSL. */
export function geometricHorizonSin(eyeElevationMslM: number): number {
  const h = Math.max(0, eyeElevationMslM)
  if (h < 0.5) return 0
  return -Math.sqrt(h * (2 * EARTH_RADIUS_M + h)) / (EARTH_RADIUS_M + h)
}

function createLightPollutionProfileTexture(): THREE.DataTexture {
  // 128×1 RGBA (R=G=B=glow) — RedFormat alone sampled black on some paths.
  const data = new Uint8Array(LP_PROFILE_TEX_WIDTH * 4)
  const tex = new THREE.DataTexture(
    data,
    LP_PROFILE_TEX_WIDTH,
    1,
    THREE.RGBAFormat,
  )
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

/** Physical sky dome — same Rayleigh/Mie shader as Photo Sightline. */
export function createAstroSkyDome(): AstroSkyDome {
  // Past far-terrain LOD radius (~300 km) so distant ridges aren't painted over.
  // Dense tessellation — stereo chords on a coarse dome = sky “tuiles”.
  const geometry = new THREE.SphereGeometry(360_000, 768, 512)
  const lightPollutionProfile = createLightPollutionProfileTexture()
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    // Depth-test so real terrain can occlude the dome; never write depth.
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
    uniforms: {
      uStelMode: stelModeUniform,
      uSunDir: { value: new THREE.Vector3(0.2, 0.6, 0.8) },
      uSunAltitude: { value: 45 },
      uExposure: { value: 0.55 },
      uEyeElevM: { value: 0 },
      uAtmosphere: { value: 1 },
      uAirglow: { value: 0 },
      uAirglowHue: { value: 0 },
      uAirglowWaves: { value: 0.55 },
      uAirglowColor: { value: new THREE.Vector3(0.22, 1.15, 0.4) },
      uAirglowTime: { value: 0 },
      uGroundColor: {
        value: new THREE.Vector3(GROUND_FILL.r, GROUND_FILL.g, GROUND_FILL.b),
      },
      uSeaColor: {
        value: new THREE.Vector3(SEA_FILL.r, SEA_FILL.g, SEA_FILL.b),
      },
    },
    vertexShader: /* glsl */ `
      ${STEL_PROJECT_GLSL}
      varying vec3 vDir;
      // Match Mesh*Materials under logarithmicDepthBuffer (required for cube faces).
      #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
        varying float vFragDepth;
        varying float vIsPerspective;
        bool isPerspectiveMatrix(mat4 m) { return m[2][3] == -1.0; }
      #endif
      void main() {
        vDir = normalize(position);
        gl_Position = stelProject(modelViewMatrix * vec4(position, 1.0));
        #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
          vFragDepth = 1.0 + gl_Position.w;
          vIsPerspective = float(isPerspectiveMatrix(projectionMatrix));
        #endif
      }
    `,
    fragmentShader: /* glsl */ `
      ${STEL_FRAGMENT_GLSL}
      #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
        uniform float logDepthBufFC;
        varying float vFragDepth;
        varying float vIsPerspective;
      #endif
      uniform vec3 uSunDir;
      uniform float uSunAltitude;
      uniform float uExposure;
      uniform float uEyeElevM;
      uniform float uAtmosphere;
      uniform float uAirglow;
      uniform float uAirglowHue;
      uniform float uAirglowWaves;
      uniform vec3 uAirglowColor;
      uniform float uAirglowTime;
      uniform vec3 uGroundColor;
      uniform vec3 uSeaColor;
      varying vec3 vDir;

      const vec3 BETA_R = vec3(5.8e-6, 13.5e-6, 33.1e-6);
      const vec3 BETA_M = vec3(21e-6);
      const float MIE_G = 0.76;
      const float H_R = 8400.0;
      const float H_M = 1200.0;
      const vec3 SUN_RAD = vec3(20.0, 18.5, 16.0);
      const float EARTH_R = 6371000.0;

      float opticalAirMass(float cosElev) {
        float c = clamp(cosElev, 0.0, 1.0);
        float ang = acos(c) * 57.2957795;
        return 1.0 / (c + 0.15 * pow(max(0.001, 93.885 - ang), -1.253));
      }

      float rayleighPhase(float cosTheta) {
        return 0.75 * (1.0 + cosTheta * cosTheta);
      }

      float miePhase(float cosTheta) {
        float g2 = MIE_G * MIE_G;
        float num = (1.0 - g2) * (1.0 + cosTheta * cosTheta);
        float den = (2.0 + g2) * pow(1.0 + g2 - 2.0 * MIE_G * cosTheta, 1.5);
        return 1.5 * num / max(den, 1e-6);
      }

      void main() {
        #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
          gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2(vFragDepth) * logDepthBufFC * 0.5;
        #endif
        stelDiscardBow();
        vec3 v = normalize(vDir);
        vec3 s = normalize(uSunDir);

        // Geometric sea horizon dips below alt=0° with eye height (Earth curvature).
        float hEye = max(uEyeElevM, 0.0);
        float horSin = hEye > 0.5
          ? -sqrt(hEye * (2.0 * EARTH_R + hEye)) / (EARTH_R + hEye)
          : 0.0;
        // Elevation above the true horizon (0 at sea limb, 1 toward zenith).
        float aboveHor = max(0.0, v.y - horSin);
        float elevN = clamp(aboveHor / max(1.0 - horSin, 1e-3), 0.0, 1.0);
        // Optical path: sample as if looking just above the geometric limb.
        float viewCos = clamp(max(v.y, horSin + 0.002), 0.002, 1.0);
        float sunCos = s.y;
        float cosTheta = clamp(dot(v, s), -1.0, 1.0);

        float mView = opticalAirMass(viewCos);
        float mSun = sunCos > 0.002
          ? opticalAirMass(clamp(sunCos, 0.002, 1.0))
          : opticalAirMass(0.002) + (-sunCos) * 22.0;

        vec3 tSunR = exp(-BETA_R * H_R * mSun);
        vec3 tSunM = exp(-BETA_M * H_M * mSun);
        vec3 sunIrr = SUN_RAD * tSunR * tSunM;

        float phaseR = rayleighPhase(cosTheta);
        float phaseM = miePhase(cosTheta);
        vec3 tViewR = exp(-BETA_R * H_R * mView);
        vec3 tViewM = exp(-BETA_M * H_M * mView);
        float mieAmt = 0.08 * (0.35 + 0.65 * smoothstep(0.2, 0.95, cosTheta));
        vec3 rgb = sunIrr * phaseR * (1.0 - tViewR)
          + sunIrr * phaseM * (1.0 - tViewM) * mieAmt;

        float alt = uSunAltitude;
        float dayFactor = 1.0;
        float beltFactor = 0.0;
        float coolZenith = 0.0;
        if (alt >= 6.0) {
          dayFactor = 1.0;
        } else if (alt >= 0.0) {
          float t = clamp((6.0 - alt) / 6.0, 0.0, 1.0);
          float midPeak = sin(t * 3.14159265);
          beltFactor = t * 0.15;
          coolZenith = t * 0.25 + midPeak * 0.35;
        } else if (alt >= -4.0) {
          float t = clamp((-alt) / 4.0, 0.0, 1.0);
          dayFactor = 1.0 - t * 0.25;
          beltFactor = 0.15 + t * 0.85;
          coolZenith = 0.25 + t * 0.55;
        } else if (alt >= -8.0) {
          float t = clamp((-alt - 4.0) / 4.0, 0.0, 1.0);
          dayFactor = 0.75 * (1.0 - t * 0.45);
          beltFactor = 1.0 - t;
          coolZenith = 0.8 + t * 0.15;
        } else if (alt >= -12.0) {
          float t = clamp((-alt - 8.0) / 4.0, 0.0, 1.0);
          dayFactor = 0.4 * (1.0 - t * 0.7);
          beltFactor = 0.0;
          coolZenith = 0.95;
        } else if (alt >= -18.0) {
          float t = clamp((-alt - 12.0) / 6.0, 0.0, 1.0);
          dayFactor = 0.12 * (1.0 - t);
          coolZenith = 1.0;
        } else {
          dayFactor = 0.02;
          coolZenith = 1.0;
        }
        rgb *= dayFactor;

        vec3 vh = normalize(vec3(v.x, 0.0, v.z) + vec3(1e-4));
        vec3 sh = normalize(vec3(s.x, 0.0, s.z) + vec3(1e-4));
        float toward = clamp(dot(vh, sh) * 0.5 + 0.5, 0.0, 1.0);
        float anti = pow(1.0 - toward, 1.6);

        if (coolZenith > 0.01) {
          float nightAmt = smoothstep(2.0, -2.0, alt);
          vec3 zenithCool = mix(vec3(0.22, 0.42, 0.82), vec3(0.06, 0.10, 0.28), nightAmt);
          vec3 midCool = mix(vec3(0.45, 0.48, 0.58), vec3(0.12, 0.16, 0.32), nightAmt);
          vec3 cool = mix(midCool, zenithCool, smoothstep(0.08, 0.65, elevN));
          float keepWarm = toward * toward * (1.0 - smoothstep(0.0, 0.32, elevN));
          rgb = mix(rgb, cool, coolZenith * (1.0 - keepWarm * 0.9));
        }

        if (alt > -8.0 && alt < 8.0) {
          float sunGlow = toward * toward
            * (1.0 - smoothstep(0.0, 0.22, elevN))
            * clamp(1.0 - abs(alt) / 8.0, 0.0, 1.0);
          vec3 glowCol = vec3(
            min(sunIrr.r * 0.45, 2.2),
            min(sunIrr.g * 0.22, 1.1),
            min(sunIrr.b * 0.08, 0.45)
          );
          rgb += glowCol * sunGlow * 0.55;
        }

        if (beltFactor > 0.02 && alt < 0.5 && alt > -8.0) {
          float depression = max(-alt, 0.3);
          float shadowTop = sin(depression * 0.017453292);
          float beltLo = shadowTop + 0.02;
          float beltHi = shadowTop + 0.10;
          float beltFade = shadowTop + 0.18;
          float inShadow = anti
            * (1.0 - smoothstep(0.0, max(shadowTop, 0.03), elevN))
            * beltFactor;
          rgb = mix(rgb, vec3(0.05, 0.07, 0.16), inShadow * 0.85);
          float beltBand = anti
            * smoothstep(beltLo, beltHi, elevN)
            * (1.0 - smoothstep(beltHi, beltFade, elevN))
            * beltFactor;
          rgb = mix(rgb, vec3(0.55, 0.28, 0.38), beltBand * 0.55);
        }

        if (alt < -10.0) {
          float night = clamp((-alt - 10.0) / 8.0, 0.0, 1.0);
          // Cool night base (not OI airglow — that is additive below).
          rgb = mix(rgb, vec3(0.02, 0.03, 0.07), night * (0.5 + 0.5 * elevN));
        }

        float peak = max(max(rgb.r, rgb.g), rgb.b);
        if (peak > 3.5) rgb *= 3.5 / peak;

        vec3 mapped = rgb * uExposure;
        mapped = mapped / (vec3(1.0) + mapped * 0.85);
        mapped = pow(max(mapped, vec3(0.0)), vec3(1.0 / 2.2));

        // Below the geometric horizon where DEM didn't write depth: soft haze /
        // ground fill only (never invent a blue sea — ocean comes from DEM+ortho).
        float farAmt = smoothstep(120.0, 900.0, hEye);
        vec3 distant = mix(uGroundColor, uSeaColor, farAmt);
        float nightDim = clamp((-alt - 2.0) / 14.0, 0.0, 1.0);
        distant = mix(distant, distant * vec3(0.22, 0.24, 0.32), nightDim);
        float below = smoothstep(horSin + 0.004, horSin - 0.03, v.y);

        // OI airglow.
        // Dégradé = horizon→zenith falloff. Vagues = seamless sheets on the sphere
        // (no atan seam / zenith pinch). Amount = intensity + how high it climbs.
        float agAmt = clamp(uAirglow, 0.0, 1.0);
        float nightAg = clamp((-alt - 10.0) / 8.0, 0.0, 1.0);
        float agHue = clamp(uAirglowHue, 0.0, 1.0);
        float agWaves = clamp(uAirglowWaves, 0.0, 1.0);
        vec3 airglowRgb = vec3(0.0);
        if (agAmt > 0.001 && nightAg > 0.001 && below < 0.5) {
          // Horizon-bright gradient (soft, not a hard ring).
          float horizonGlow = mix(1.2, 0.12, pow(elevN, 0.75));
          float limb = smoothstep(0.0, 0.04, elevN);
          // Low amount → only near horizon; high amount reaches zenith.
          float reach = mix(0.18, 1.05, agAmt);
          float heightMask = 1.0 - smoothstep(reach * 0.45, reach, elevN);
          float env = limb * horizonGlow * heightMask;

          float t = uAirglowTime;
          // Seamless 3D noise — stretched in elevation → horizontal fibres.
          vec3 p3 = vec3(v.x * 2.6, v.y * 9.5, v.z * 2.6)
            + vec3(t * 0.018, t * 0.012, -t * 0.015);
          float n = 0.0;
          float a = 0.5;
          vec3 q3 = p3;
          for (int i = 0; i < 4; i++) {
            vec3 ii = floor(q3);
            vec3 f = fract(q3);
            float n000 = fract(sin(dot(ii + vec3(0.0, 0.0, 0.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
            float n100 = fract(sin(dot(ii + vec3(1.0, 0.0, 0.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
            float n010 = fract(sin(dot(ii + vec3(0.0, 1.0, 0.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
            float n110 = fract(sin(dot(ii + vec3(1.0, 1.0, 0.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
            float n001 = fract(sin(dot(ii + vec3(0.0, 0.0, 1.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
            float n101 = fract(sin(dot(ii + vec3(1.0, 0.0, 1.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
            float n011 = fract(sin(dot(ii + vec3(0.0, 1.0, 1.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
            float n111 = fract(sin(dot(ii + vec3(1.0, 1.0, 1.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
            vec3 u = f * f * (3.0 - 2.0 * f);
            float x00 = mix(n000, n100, u.x);
            float x10 = mix(n010, n110, u.x);
            float x01 = mix(n001, n101, u.x);
            float x11 = mix(n011, n111, u.x);
            float y0 = mix(x00, x10, u.y);
            float y1 = mix(x01, x11, u.y);
            n += a * mix(y0, y1, u.z);
            q3 = q3 * 2.05 + vec3(1.7, 3.2, 2.4);
            a *= 0.5;
          }
          // Horizontal-ish sheets (phase dominated by elevation + slight tilt).
          float sheet =
            0.5
            + 0.5 * sin(elevN * 16.0 + v.x * 1.6 + v.z * 0.9 + n * 2.2 + t * 0.028);
          float sheet2 =
            0.5
            + 0.5 * sin(elevN * 10.5 - v.x * 0.8 + v.z * 1.4 - n * 1.6 + t * 0.02);
          float wave = clamp(n * 0.35 + sheet * 0.4 + sheet2 * 0.25, 0.0, 1.0);
          float structure = mix(1.0, mix(0.06, 1.5, wave), agWaves);

          // Teinte: hard solos at the ends (full rouge = zero green, period).
          float greenW = 1.0 - smoothstep(0.28, 0.72, agHue);
          float redW = smoothstep(0.28, 0.72, agHue);
          if (agHue >= 0.82) greenW = 0.0;
          if (agHue <= 0.18) redW = 0.0;
          float overlap = min(greenW, redW);

          vec3 greenC = vec3(0.22, 1.15, 0.4);
          // Orange-red with low G — high G was reading as a green limb band.
          vec3 redC = vec3(1.55, 0.26, 0.02);
          float base = agAmt * nightAg * env * structure * 0.55;

          if (overlap < 0.02) {
            // Pure vert or pure rouge — no dual-mask leftovers.
            airglowRgb =
              greenC * (base * greenW)
              + redC * (base * redW * 1.45);
          } else {
            // Mid only: soft organic patches of each.
            float pat = mix(n, wave, clamp(agWaves * 1.2, 0.0, 1.0));
            float split = smoothstep(0.12, 0.88, pat);
            float midPunch = 1.0 + overlap * 0.15;
            airglowRgb =
              greenC * (base * greenW * (1.0 - split) * midPunch)
              + redC * (base * redW * split * midPunch * 1.45);
          }
        }

        float atmo = clamp(uAtmosphere, 0.0, 1.0);

        if (atmo < 0.001) {
          // Full Rayleigh off: keep ground fill; sky only if airglow needs it.
          // Zodiacal / LP are separate additive meshes (above Milky Way).
          if (below < 0.01 && agAmt * nightAg < 0.001) discard;
          mapped = below >= 0.01
            ? distant * (0.55 + 0.45 * (1.0 - nightDim))
            : vec3(0.0);
          mapped += airglowRgb;
          gl_FragColor = vec4(mapped, 1.0);
          return;
        }

        mapped = mix(mapped, mix(mapped, distant, 0.92), below);
        // Partial amount: darken Rayleigh so additive stars read through.
        if (below < 0.5) {
          mapped *= atmo;
        }
        // Airglow on top of atmosphere — never scaled by uAtmosphere.
        mapped += airglowRgb;

        gl_FragColor = vec4(mapped, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  // Draw after terrain so depth-test keeps mountains in front of the sky.
  mesh.renderOrder = 10

  // Fullscreen overlay — never in the main scene (stereo sphere = tuiles).
  // depthTest against the kept terrain buffer so mountains stay in front.
  const lpGeometry = new THREE.PlaneGeometry(2, 2)
  const lightPollutionMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uStelMode: stelModeUniform,
      uSunAltitude: { value: -20 },
      uEyeElevM: { value: 0 },
      uLightPollution: { value: 0 },
      uLpBortle: { value: 0 },
      uLpIntensity: { value: 0 },
      uLpMean: { value: 0 },
      uLpProfile: { value: lightPollutionProfile },
      uLpResolution: { value: new THREE.Vector2(1, 1) },
      uLpNdcScale: { value: new THREE.Vector2(1, 1) },
      uLpInvMv: { value: new THREE.Matrix3() },
      uLpCameraFar: { value: 450_000 },
    },
    vertexShader: /* glsl */ `
      uniform float uLpCameraFar;
      #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
        varying float vFragDepth;
      #endif
      void main() {
        // NDC fullscreen; log-depth forced to camera far so terrain wins.
        gl_Position = vec4(position.xy, 1.0, 1.0);
        #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
          vFragDepth = 1.0 + max(uLpCameraFar, 1.0);
        #endif
      }
    `,
    fragmentShader: /* glsl */ `
      #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
        uniform float logDepthBufFC;
        varying float vFragDepth;
      #endif
      uniform float uStelMode;
      uniform float uSunAltitude;
      uniform float uEyeElevM;
      const float EARTH_R = 6371000.0;
      ${LIGHT_POLLUTION_GLSL}

      void main() {
        #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
          gl_FragDepth = log2(vFragDepth) * logDepthBufFC * 0.5;
        #endif
        vec3 v = lpDirFromScreen();
        float alt = uSunAltitude;
        float hEye = max(uEyeElevM, 0.0);
        float horSin = hEye > 0.5
          ? -sqrt(hEye * (2.0 * EARTH_R + hEye)) / (EARTH_R + hEye)
          : 0.0;
        float aboveHor = max(0.0, v.y - horSin);
        float elevN = clamp(aboveHor / max(1.0 - horSin, 1e-3), 0.0, 1.0);
        float below = smoothstep(horSin + 0.004, horSin - 0.03, v.y);
        vec3 lpRgb = lightPollutionRgb(v, elevN, alt, below);
        if (dot(lpRgb, lpRgb) < 1.0e-8) discard;
        gl_FragColor = vec4(lpRgb, 1.0);
      }
    `,
  })
  const lightPollutionMesh = new THREE.Mesh(lpGeometry, lightPollutionMaterial)
  lightPollutionMesh.frustumCulled = false
  lightPollutionMesh.name = 'lightPollutionGlow'
  const lpOverlayScene = new THREE.Scene()
  lpOverlayScene.add(lightPollutionMesh)
  const lpOverlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  // Separate additive pass so zodiacal glows *over* NASA Milky Way tiles
  // (those sit at renderOrder 20+z; atmosphere alone was painted underneath).
  const zodiacalMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uStelMode: stelModeUniform,
      uSunDir: { value: new THREE.Vector3(0.2, 0.6, 0.8) },
      uSunAltitude: { value: -20 },
      uEyeElevM: { value: 0 },
      uZodiacal: { value: 0 },
      uEclipticPole: { value: new THREE.Vector3(0, 0.4, 0.9) },
    },
    vertexShader: /* glsl */ `
      ${STEL_PROJECT_GLSL}
      varying vec3 vDir;
      #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
        varying float vFragDepth;
        varying float vIsPerspective;
        bool isPerspectiveMatrix(mat4 m) { return m[2][3] == -1.0; }
      #endif
      void main() {
        vDir = normalize(position);
        gl_Position = stelProject(modelViewMatrix * vec4(position, 1.0));
        #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
          vFragDepth = 1.0 + gl_Position.w;
          vIsPerspective = float(isPerspectiveMatrix(projectionMatrix));
        #endif
      }
    `,
    fragmentShader: /* glsl */ `
      ${STEL_FRAGMENT_GLSL}
      #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
        uniform float logDepthBufFC;
        varying float vFragDepth;
        varying float vIsPerspective;
      #endif
      uniform vec3 uSunDir;
      uniform float uSunAltitude;
      uniform float uEyeElevM;
      uniform float uZodiacal;
      uniform vec3 uEclipticPole;
      varying vec3 vDir;
      const float EARTH_R = 6371000.0;

      void main() {
        #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
          gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2(vFragDepth) * logDepthBufFC * 0.5;
        #endif
        stelDiscardBow();
        float zlAmt = clamp(uZodiacal, 0.0, 1.0);
        float alt = uSunAltitude;
        float nightZl = 1.0 - smoothstep(-18.0, -6.0, alt);
        if (zlAmt < 0.001 || nightZl < 0.001) discard;

        vec3 v = normalize(vDir);
        vec3 s = normalize(uSunDir);
        float hEye = max(uEyeElevM, 0.0);
        float horSin = hEye > 0.5
          ? -sqrt(hEye * (2.0 * EARTH_R + hEye)) / (EARTH_R + hEye)
          : 0.0;
        float aboveHor = max(0.0, v.y - horSin);
        float elevN = clamp(aboveHor / max(1.0 - horSin, 1e-3), 0.0, 1.0);
        float below = smoothstep(horSin + 0.004, horSin - 0.03, v.y);
        if (below >= 0.5) discard;

        // Soft sparse false-dawn haze — no hard ribbon / clipped white plate.
        vec3 pole = normalize(uEclipticPole + vec3(1e-6));
        float sinBeta = clamp(dot(v, pole), -1.0, 1.0);
        float betaDeg = abs(asin(sinBeta)) * 57.2957795;
        float cosElong = clamp(dot(v, s), -1.0, 1.0);
        float elongDeg = acos(cosElong) * 57.2957795;

        // Wider, slower taper — diffuse triangle, not a thin tube.
        float halfW = mix(14.0, 4.0, pow(clamp(elevN, 0.0, 1.0), 0.55));
        float s2 = halfW * halfW;
        float core = exp(-0.5 * betaDeg * betaDeg / max(s2 * 0.7, 1.2));
        float mid = exp(-0.5 * betaDeg * betaDeg / max(s2 * 2.4, 3.0)) * 0.7;
        float outer = exp(-0.5 * betaDeg * betaDeg / max(s2 * 6.0, 6.0)) * 0.32;
        float latGlow = core + mid + outer;
        // Very soft kill far off-plane (no contour step).
        latGlow *= 1.0 - smoothstep(22.0, 48.0, betaDeg);

        float cone = exp(-0.5 * pow(max(elongDeg - 2.5, 0.0) / 50.0, 1.75));
        float gegen = 0.03 * exp(-0.5 * pow((elongDeg - 180.0) / 18.0, 2.0));
        float along = cone + gegen;

        float limb = smoothstep(0.0, 0.05, elevN);
        float elevShape = exp(-pow(max(elevN - 0.02, 0.0) / 0.78, 1.05));
        float energy = along * latGlow * elevShape * limb;
        // Gentle curve — keeps falloff readable, avoids white plateau edges.
        float punch = pow(max(energy, 0.0), 0.95);

        float edgeT = smoothstep(0.0, halfW * 3.2, betaDeg);
        vec3 zlCore = vec3(0.92, 0.96, 1.08);
        vec3 zlEdge = vec3(0.62, 0.78, 1.15);
        vec3 zlColor = mix(zlCore, zlEdge, edgeT);
        float gain = zlAmt * nightZl * punch * 0.38;
        if (gain < 0.0015) discard;
        gl_FragColor = vec4(zlColor * gain, 1.0);
      }
    `,
  })
  const zodiacalMesh = new THREE.Mesh(geometry, zodiacalMaterial)
  zodiacalMesh.frustumCulled = false
  zodiacalMesh.renderOrder = ZODIACAL_RENDER_ORDER
  zodiacalMesh.name = 'zodiacalGlow'

  return {
    mesh,
    lightPollutionMesh,
    zodiacalMesh,
    geometry,
    material,
    lightPollutionMaterial,
    zodiacalMaterial,
    lightPollutionProfile,
    _lpOverlay: {
      scene: lpOverlayScene,
      camera: lpOverlayCamera,
    },
  }
}

/**
 * Sample a peak-normalized azimuth ring with linear interpolation.
 */
function sampleAz01(azimuth01: ArrayLike<number>, az01: number): number {
  const n = azimuth01.length
  if (n < 1) return 0
  const x = ((az01 % 1) + 1) % 1 * n
  const i0 = Math.floor(x) % n
  const i1 = (i0 + 1) % n
  const f = x - Math.floor(x)
  return (
    Math.min(1, Math.max(0, azimuth01[i0]!)) * (1 - f) +
    Math.min(1, Math.max(0, azimuth01[i1]!)) * f
  )
}

/** Immersive dome width (σ°) — city mounds, not a uniform wash. */
export const LP_IMMERSIVE_DOME_SIGMA_DEG = 16

const _lpInvMv = new THREE.Matrix3()
const _lpDrawSize = new THREE.Vector2()

/** Sync screen-ray + far-depth uniforms — call immediately before overlay draw. */
export function syncImmersiveLpScreenUniforms(
  sky: AstroSkyDome,
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
): void {
  const u = sky.lightPollutionMaterial.uniforms
  renderer.getDrawingBufferSize(_lpDrawSize)
  ;(u.uLpResolution.value as THREE.Vector2).copy(_lpDrawSize)
  camera.updateMatrixWorld(true)
  _lpInvMv.setFromMatrix4(camera.matrixWorld)
  ;(u.uLpInvMv.value as THREE.Matrix3).copy(_lpInvMv)
  const persp = camera as THREE.PerspectiveCamera
  const p = persp.projectionMatrix.elements
  const sx = Math.abs(p[0]!) > 1e-8 ? 1 / p[0]! : 1
  const sy = Math.abs(p[5]!) > 1e-8 ? 1 / p[5]! : 1
  ;(u.uLpNdcScale.value as THREE.Vector2).set(sx, sy)
  u.uLpCameraFar.value =
    typeof persp.far === 'number' && Number.isFinite(persp.far)
      ? Math.max(persp.far, 1)
      : 450_000
}

/**
 * Draw LP after the main/cubemap frame. Keeps the color/depth buffers —
 * terrain depth already written occludes the far-plane glow.
 */
export function renderImmersiveLightPollution(
  sky: AstroSkyDome,
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
): void {
  if (!sky.lightPollutionMesh.visible) return
  const amt = sky.lightPollutionMaterial.uniforms.uLightPollution.value as number
  if (!(amt > 0.0005)) return
  syncImmersiveLpScreenUniforms(sky, renderer, camera)
  const prevAutoClear = renderer.autoClear
  // Color + depth stay; only add sodium where terrain did not write closer depth.
  renderer.autoClear = false
  renderer.render(sky._lpOverlay.scene, sky._lpOverlay.camera)
  renderer.autoClear = prevAutoClear
}

/**
 * Upload an azimuthal PL profile into the sky-dome 1D RGBA texture.
 * Upsamples + mild Gaussian; peak-normalized so city lobes stay hot.
 */
export function setLightPollutionProfile(
  sky: AstroSkyDome,
  azimuth01: ArrayLike<number>,
  mean01 = 0,
): void {
  const tex = sky.lightPollutionProfile
  const data = tex.image.data as Uint8Array
  const n = LP_PROFILE_TEX_WIDTH
  const srcN = azimuth01.length
  if (srcN < 1 || data.length < n * 4) return

  const row = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    row[i] = sampleAz01(azimuth01, (i + 0.5) / n)
  }
  const sigmaBins = (LP_IMMERSIVE_DOME_SIGMA_DEG / 360) * n
  const radius = Math.min(n >> 1, Math.max(2, Math.ceil(sigmaBins * 3)))
  const twoS2 = 2 * sigmaBins * sigmaBins
  const blurred = new Float32Array(n)
  let peak = 0
  for (let i = 0; i < n; i++) {
    let sum = 0
    let w = 0
    for (let d = -radius; d <= radius; d++) {
      const ww = Math.exp(-(d * d) / twoS2)
      sum += row[(i + d + n * 4) % n]! * ww
      w += ww
    }
    blurred[i] = sum / w
    peak = Math.max(peak, blurred[i]!)
  }
  const invPeak = peak > 1e-6 ? 1 / peak : 1
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.min(1, Math.max(0, blurred[i]! * invPeak)) * 255)
    const o = i * 4
    data[o] = v
    data[o + 1] = v
    data[o + 2] = v
    data[o + 3] = 255
  }
  tex.needsUpdate = true
  sky.lightPollutionMaterial.uniforms.uLpMean.value = Math.min(
    1,
    Math.max(0, mean01),
  )
}

export function updateAstroSkyDome(
  sky: AstroSkyDome,
  input: {
    sunAltitudeDeg: number
    sunDirection: THREE.Vector3
    /** Eye height above mean sea level (m) — drives geometric horizon dip. */
    eyeElevationMslM: number
    /**
     * Rayleigh amount 0…1 (0 = space, 1 = full sky).
     * `showAtmosphere: false` still accepted as amount 0.
     */
    atmosphereAmount?: number
    showAtmosphere?: boolean
    /** Additive OI airglow 0…1 (independent of atmosphereAmount). */
    airglowAmount?: number
    /** 0 = green 557 nm, 1 = red 630 nm. */
    airglowHue?: number
    /** 0 = van Rhijn gradient, 1 = gravity waves. */
    airglowWaves?: number
    /** Seconds — drifts gravity-wave phase. */
    airglowTimeSec?: number
    /** Additive zodiacal light 0…1 (ecliptic dust glow). */
    zodiacalAmount?: number
    /** Light-pollution display intensity 0…1 (sky settings slider). */
    lightPollutionAmount?: number
    /** Spot Bortle pollution factor 0…1 (Bortle 1 → 0, Bortle 9 → 1). */
    lightPollutionBortleFactor?: number
    /**
     * Absolute horizon-peak intensity 0…1 (`peakIntensity01`).
     * Drives city lobes under pristine zeniths (Spitzkoppe / La Palma).
     */
    lightPollutionPeakIntensity?: number
    /** Mean of azimuthal profile 0…1 (optional — setLightPollutionProfile also sets it). */
    lightPollutionMean?: number
    /**
     * North ecliptic pole in local ENU (east, up, south).
     * Required for a correctly oriented zodiacal band.
     */
    eclipticPole?: THREE.Vector3
  },
): void {
  const palette = skyPaletteFromSunAltitude(input.sunAltitudeDeg)
  ;(sky.material.uniforms.uSunDir.value as THREE.Vector3).copy(
    input.sunDirection,
  )
  sky.material.uniforms.uSunAltitude.value = input.sunAltitudeDeg
  sky.material.uniforms.uExposure.value = palette.exposure
  sky.material.uniforms.uEyeElevM.value = Math.max(0, input.eyeElevationMslM)
  const amount =
    typeof input.atmosphereAmount === 'number' &&
    Number.isFinite(input.atmosphereAmount)
      ? Math.min(1, Math.max(0, input.atmosphereAmount))
      : input.showAtmosphere === false
        ? 0
        : 1
  sky.material.uniforms.uAtmosphere.value = amount
  const agAmt = clampAirglowAmount(input.airglowAmount ?? 0)
  const agHue = clampAirglowHue(input.airglowHue ?? 0)
  const agWaves = clampAirglowWaves(input.airglowWaves ?? 0.55)
  const agCol = airglowColorFromHue(agHue)
  sky.material.uniforms.uAirglow.value = agAmt
  sky.material.uniforms.uAirglowHue.value = agHue
  sky.material.uniforms.uAirglowWaves.value = agWaves
  ;(sky.material.uniforms.uAirglowColor.value as THREE.Vector3).set(
    agCol.r,
    agCol.g,
    agCol.b,
  )
  if (
    typeof input.airglowTimeSec === 'number' &&
    Number.isFinite(input.airglowTimeSec)
  ) {
    sky.material.uniforms.uAirglowTime.value = input.airglowTimeSec
  }
  const zlAmt = clampZodiacalAmount(input.zodiacalAmount ?? 0)
  const zlMat = sky.zodiacalMaterial
  ;(zlMat.uniforms.uSunDir.value as THREE.Vector3).copy(input.sunDirection)
  zlMat.uniforms.uSunAltitude.value = input.sunAltitudeDeg
  zlMat.uniforms.uEyeElevM.value = Math.max(0, input.eyeElevationMslM)
  zlMat.uniforms.uZodiacal.value = zlAmt
  if (input.eclipticPole) {
    ;(zlMat.uniforms.uEclipticPole.value as THREE.Vector3)
      .copy(input.eclipticPole)
      .normalize()
  }
  const lpMat = sky.lightPollutionMaterial
  lpMat.uniforms.uSunAltitude.value = input.sunAltitudeDeg
  lpMat.uniforms.uEyeElevM.value = Math.max(0, input.eyeElevationMslM)
  lpMat.uniforms.uLightPollution.value = clampLightPollutionAmount(
    input.lightPollutionAmount ?? 0,
  )
  const lpBortle =
    typeof input.lightPollutionBortleFactor === 'number' &&
    Number.isFinite(input.lightPollutionBortleFactor)
      ? Math.min(1, Math.max(0, input.lightPollutionBortleFactor))
      : 0
  lpMat.uniforms.uLpBortle.value = lpBortle
  const lpPeak =
    typeof input.lightPollutionPeakIntensity === 'number' &&
    Number.isFinite(input.lightPollutionPeakIntensity)
      ? Math.min(1, Math.max(0, input.lightPollutionPeakIntensity))
      : 0
  lpMat.uniforms.uLpIntensity.value = lpPeak
  if (
    typeof input.lightPollutionMean === 'number' &&
    Number.isFinite(input.lightPollutionMean)
  ) {
    lpMat.uniforms.uLpMean.value = Math.min(
      1,
      Math.max(0, input.lightPollutionMean),
    )
  }
  // Always keep the dome: it paints sea/ground under the geometric horizon
  // even when Rayleigh atmosphere is toggled off (avoids a black void).
  // ImmersiveView may still hide meshes via render-diag showSky.
  sky.mesh.visible = true
}

/** ENU-ish: +X east, +Y up, +Z south. Azimuth clockwise from north. */
export function sunDirectionFromAltAz(
  altitudeDeg: number,
  azimuthDeg: number,
): THREE.Vector3 {
  const alt = (altitudeDeg * Math.PI) / 180
  const az = (azimuthDeg * Math.PI) / 180
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(alt),
    Math.sin(alt),
    -Math.cos(az) * Math.cos(alt),
  ).normalize()
}

/**
 * North ecliptic pole → Three local ENU (east, up, south).
 * Astronomy Engine HOR is (north, west, zenith).
 */
export function eclipticNorthPoleThreeLocal(
  when: Date,
  latitudeDeg: number,
  longitudeDeg: number,
  elevationM = 0,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const observer = new Observer(latitudeDeg, longitudeDeg, elevationM / 1000)
  const poleEcl = new Vector(0, 0, 1, when)
  const hor = RotateVector(Rotation_ECL_HOR(when, observer), poleEcl)
  return target.set(-hor.y, hor.z, -hor.x).normalize()
}
