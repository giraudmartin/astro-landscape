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
  geometry: THREE.SphereGeometry
  material: THREE.ShaderMaterial
}

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

/** Physical sky dome — same Rayleigh/Mie shader as Photo Sightline. */
export function createAstroSkyDome(): AstroSkyDome {
  // Past far-terrain LOD radius (~300 km) so distant ridges aren't painted over.
  // Dense tessellation — stereo is nonlinear; coarse spheres stretch into columns.
  const geometry = new THREE.SphereGeometry(360_000, 384, 256)
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
      uZodiacal: { value: 0 },
      // North ecliptic pole in local ENU (east, up, south).
      uEclipticPole: { value: new THREE.Vector3(0, 0.4, 0.9) },
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
      uniform float uZodiacal;
      uniform vec3 uEclipticPole;
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

        // Zodiacal light — sunlight scattered by the interplanetary dust disk.
        // Aligned on the ecliptic (not the horizon): bright false-dawn/dusk
        // pyramid near the Sun, faint band around the sky, Gegenschein opposite.
        float zlAmt = clamp(uZodiacal, 0.0, 1.0);
        // Visible from deep twilight; washed out once the Sun is higher than ~−6°.
        float nightZl = 1.0 - smoothstep(-18.0, -6.0, alt);
        vec3 zodiacalRgb = vec3(0.0);
        if (zlAmt > 0.001 && nightZl > 0.001 && below < 0.5) {
          vec3 pole = normalize(uEclipticPole + vec3(1e-6));
          float sinBeta = clamp(dot(v, pole), -1.0, 1.0);
          float beta = abs(asin(sinBeta)); // ecliptic latitude (rad)
          float cosElong = clamp(dot(v, s), -1.0, 1.0);
          float elongDeg = acos(cosElong) * 57.2957795;

          // Thin dust disk (~10–15° FWHM near the Sun, slightly wider far out).
          float betaScale = mix(0.20, 0.32, smoothstep(25.0, 120.0, elongDeg));
          float latFall = exp(-pow(beta / max(betaScale, 0.05), 1.55));

          // Heliospheric brightness vs elongation (Leinert-ish empirical shape).
          float cone =
            exp(-pow(max(elongDeg - 6.0, 0.0) / 26.0, 1.28)); // false dawn/dusk
          float band =
            0.07 * exp(-pow(max(elongDeg - 35.0, 0.0) / 75.0, 1.15));
          float gegen =
            0.22 * exp(-pow((elongDeg - 180.0) / 16.0, 2.0)); // Gegenschein
          // Soft shoulder so the pyramid base reads wider near the Sun.
          float baseWiden =
            0.35 * exp(-pow(max(elongDeg - 4.0, 0.0) / 14.0, 1.6))
            * exp(-pow(beta / 0.42, 2.0));

          float profile = (cone * 1.15 + band + gegen + baseWiden) * latFall;

          // Atmospheric extinction near the geometric limb (pyramid softens).
          float extinction = mix(0.28, 1.0, smoothstep(0.0, 0.18, elevN));
          // Slight horizon lift — classic photographic false-dawn look.
          float pyramidLift =
            mix(1.15, 0.85, smoothstep(0.05, 0.55, elevN));

          // Warm sunlight tint (slightly redder than airglow-neutral white).
          vec3 zlColor = vec3(1.08, 0.90, 0.62);
          float gain = zlAmt * nightZl * profile * extinction * pyramidLift * 0.2;
          zodiacalRgb = zlColor * gain;
        }

        float atmo = clamp(uAtmosphere, 0.0, 1.0);
        if (atmo < 0.001) {
          // Full Rayleigh off: keep ground fill; sky only if glow layers need it.
          if (below < 0.01 && agAmt * nightAg < 0.001 && zlAmt * nightZl < 0.001)
            discard;
          mapped = below >= 0.01
            ? distant * (0.55 + 0.45 * (1.0 - nightDim))
            : vec3(0.0);
          mapped += airglowRgb;
          mapped += zodiacalRgb;
          gl_FragColor = vec4(mapped, 1.0);
          return;
        }

        mapped = mix(mapped, mix(mapped, distant, 0.92), below);
        // Partial amount: darken Rayleigh so additive stars read through.
        if (below < 0.5) {
          mapped *= atmo;
        }
        // Airglow + zodiacal on top of atmosphere — never scaled by uAtmosphere.
        mapped += airglowRgb;
        mapped += zodiacalRgb;

        gl_FragColor = vec4(mapped, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  // Draw after terrain so depth-test keeps mountains in front of the sky.
  mesh.renderOrder = 10
  return { mesh, geometry, material }
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
  sky.material.uniforms.uZodiacal.value = clampZodiacalAmount(
    input.zodiacalAmount ?? 0,
  )
  if (input.eclipticPole) {
    ;(sky.material.uniforms.uEclipticPole.value as THREE.Vector3)
      .copy(input.eclipticPole)
      .normalize()
  }
  // Always keep the dome: it paints sea/ground under the geometric horizon
  // even when Rayleigh atmosphere is toggled off (avoids a black void).
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
