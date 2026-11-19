/**
 * Local light-pollution halo + volumetric clouds — screen pass (Chamonix HTML
 * prototype port).
 *
 * When active, the frame is drawn into an offscreen target (colour + depth),
 * then one fullscreen shader:
 *   1. rebuilds the view ray for the active projection (recti / stereo / …),
 *   2. stops it at the opaque depth (terrain / LOD rings),
 *   3. integrates PL volume (when loaded) and/or three cloud layers,
 *   4. composites attenuated scene + glow (stars / MW behind clouds fade).
 *
 * Inactive (no clouds, no halo, no diagnostic) → caller keeps a direct path.
 */

/** Bump when the composite shader changes so ImmersiveView remounts the pass. */
export const LOCAL_HALO_PASS_REV = 49
import * as THREE from 'three'
import { EARTH_RADIUS_M } from '../../globeConstants'
import { stelModeUniform } from '../../stelProjector'
import type { ViewfinderWeather } from '../../viewfinderWeather'
import { weatherLayersForShader, weatherWantsVolumePass } from '../../viewfinderWeather'
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

export type LocalHaloCloudFrame = {
  weather: ViewfinderWeather
  /** Display-referred sky colour driving cloud ambient (daytime). */
  moonDirection: THREE.Vector3
  moonStrength: number
  sunDirection: THREE.Vector3
  skyLight: THREE.Color
  /** Seconds to advance cloud wind (0 when animation frozen). */
  deltaSec: number
  /** Integrate inside the prototype box when comparing Chamonix. */
  reference: boolean
  /** Regional sky contribution before twilight attenuation. */
  skyLp: number
  /** 0 at night → force proto #0b1423 ambient; 1 = use skyLight. */
  dayFactor: number
}

const STEPS_HALO = 112
const STEPS_CLOUDS = 192
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
uniform sampler3D uNoise;
uniform sampler2D uRaw;
uniform sampler2D uGround;
uniform float uGroundExtentKm;
uniform float uHasVolume;
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
/** 1 when local-halo toggle is on — gates AIR glow only (not cloud city fill). */
uniform float uHaloAir;
uniform float uVertical;
uniform float uHaze;
uniform float uBlocking;
uniform vec3 uTint;
uniform float uReference;

uniform float uCloudOn;
uniform float uCloudTime;

uniform vec3 uSkyLight, uSunDir, uMoonDir;
uniform float uMoonStrength;
uniform vec4 uLayers[3];
uniform float uCloudSteps;
/** Max ray length for full-sky cloud slabs (scene metres). */
uniform float uCloudFarM;
/** Sky-panel PL × night (≈0…2) — under-lights clouds when volume ill is weak. */
uniform float uSkyLp;
/** 0 = full night ambient (#0b1423), 1 = daytime skyLight. */
uniform float uDayFactor;

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
vec2 geoFromProto(vec2 xz) {
  if (uGeoMode == 1) {
    vec2 merc = uGeoOrigin + xz * uGeoScale.x;
    return vec2(merc.x * 360.0 - 180.0,
      atan(sinh(3.14159265359 * (1.0 - 2.0 * merc.y))) * 57.2957795131);
  }
  return vec2(uGeoOrigin.x + xz.x * uGeoScale.x, uGeoOrigin.y - xz.y * uGeoScale.y);
}

float noiseField(vec3 q) {
  return texture(uNoise, q).r * 0.62
    + texture(uNoise, q * 2.07 + vec3(0.17, 0.41, 0.31)).r * 0.26
    + texture(uNoise, q * 4.13 + vec3(0.53, 0.23, 0.67)).r * 0.12;
}

// Prototype cloudLayer — p in km, y = MSL km. layers = (alt, thick, cover, density).
float cloudLayer(vec3 p, int k) {
  vec4 layer = uLayers[k];
  float h = (p.y - layer.x) / max(layer.y, 1e-4);
  if (h <= 0.0 || h >= 1.0 || layer.z <= 0.0 || layer.w <= 0.0) return 0.0;
  vec3 q = p * vec3(0.023, 0.055, 0.023) + vec3(float(k) * 0.31, float(k) * 0.17, float(k) * 0.43);
  if (k == 1) q *= vec3(1.5, 0.8, 1.5);
  if (k == 2) q *= vec3(0.35, 1.7, 3.2);
  vec2 wind = vec2(0.00009, 0.000045) * uCloudTime * (1.0 + float(k) * 0.6);
  q.xz += wind;
  if (uReference < 0.5) {
    vec2 xy = p.xz + wind / 0.023;
    // Broad variations break up the deck into groups with their own orientation.
    vec2 warp = vec2(texture(uNoise, vec3(xy * 0.0027, 0.27)).r,
                     texture(uNoise, vec3(xy * 0.0039, 0.71)).r) - 0.5;
    vec2 local = vec2(dot(vec2(0.95, 0.31), xy), dot(vec2(-0.31, 0.95), xy));
    float envelope = texture(uNoise, vec3(xy * 0.006 + warp * 0.07, 0.38)).r;
    float threshold = mix(0.78, 0.18, layer.z);
    if (k < 2) {
      // Rounded updrafts share a condensation level, but reach different tops.
      // The finer mid-level cells cluster inside the same broad weather envelope.
      float frequency = k == 0 ? 0.14 : 0.29;
      vec3 cellPos = vec3((xy + warp * 2.2) * frequency, h * 0.14 + float(k) * 0.37);
      float turret = texture(uNoise, cellPos).g;
      float smallLobes = texture(uNoise, cellPos * 2.13 + vec3(0.19, 0.33, 0.51)).g;
      float billows = 0.72 * turret + 0.28 * smallLobes;
      float mass = 0.50 * envelope + 0.50 * billows;
      float cloudTop = clamp(0.20 + 0.90 * billows + 0.22 * (envelope - 0.5), 0.22, 1.0);
      float base = 0.05 + 0.06 * (1.0 - smallLobes);
      float profile = smoothstep(base, base + 0.12, h)
        * (1.0 - smoothstep(cloudTop - 0.19, cloudTop, h));
      float erosion = texture(uNoise, cellPos * 1.7 + vec3(0.27)).r;
      return smoothstep(threshold - 0.09, threshold + 0.14, mass - 0.09 * erosion)
        * profile * layer.w;
    }
    // A continuous moisture field creates cloud families and clear gaps.
    // Backtrace the falling ice through shear: a compact source aloft can
    // spread into several fine streaks lower down, all in world coordinates.
    float fall = (1.0 - h) * (1.0 - h);
    vec2 flow = local + warp * vec2(5.7, 4.4);
    flow -= fall * vec2(3.6 + 5.3 * envelope, 2.8 * warp.y);
    vec2 oblique = vec2(0.83 * flow.x + 0.56 * flow.y,
                        -0.56 * flow.x + 0.83 * flow.y);
    float bank = noiseField(vec3(oblique * vec2(0.0026, 0.0053), 0.38));
    float moisture = 0.70 * bank + 0.30 * envelope;
    float family = smoothstep(threshold - 0.11, threshold + 0.13, moisture);
    float source = noiseField(vec3(flow * vec2(0.011, 0.024), 0.57));
    float heads = smoothstep(0.52, 0.76, source);
    float curl = texture(uNoise, vec3(oblique * 0.014, 0.72)).r - 0.5;
    vec2 fibrePos = vec2(flow.x, flow.y + 1.7 * curl + fall * warp.x);
    float coarse = noiseField(vec3(fibrePos * vec2(0.0057, 0.047), 0.21));
    float fine = texture(uNoise, vec3(fibrePos * vec2(0.012, 0.12), 0.46)).r;
    float wisps = smoothstep(0.37, 0.72, coarse * 0.73 + fine * 0.27);
    float veil = smoothstep(0.26, 0.62, source);
    float profile = smoothstep(0.0, 0.23, h) * (1.0 - smoothstep(0.66, 1.0, h));
    return family * (heads * smoothstep(0.25, 0.72, h) + veil * wisps * 1.4)
      * profile * layer.w;
  }
  float n = noiseField(q);
  float threshold = mix(0.78, 0.18, layer.z);
  float body = smoothstep(threshold, threshold + 0.19, n);
  float profile = smoothstep(0.0, 0.18, h) * (1.0 - smoothstep(0.65, 1.0, h));
  return body * profile * layer.w;
}

float cloudDensity(vec3 p) {
  if (uCloudOn < 0.5) return 0.0;
  return cloudLayer(p, 0) + cloudLayer(p, 1) + cloudLayer(p, 2);
}

// The air is sampled inside the VIIRS box. For cloud lighting only, extend
// its boundary values with a smooth falloff and filter over a wider footprint.
float fieldLight(vec3 p) {
  vec3 uvw = clamp((p - uBoxMinKm) / uBoxSizeKm, vec3(0.0), vec3(1.0));
  vec2 light = texture(uVolume, uvw).rg;
  return mix(light.g, light.r, uBlocking) * exp(-max(p.y - 8.3, 0.0) / 2.0);
}

float cloudLightTap(vec3 p, float reach) {
  vec2 outside = max(abs(p.xz) - vec2(12.0), vec2(0.0));
  return fieldLight(p) * exp(-dot(outside, outside) / (reach * reach));
}

float diffuseCloudLight(vec3 p) {
  float height = max(p.y - uRefAltKm, 0.0);
  float radius = clamp(0.45 * height, 0.6, 3.6);
  float reach = 2.0 + radius;
  vec3 dx = vec3(radius, 0.0, 0.0);
  vec3 dz = dx.yyx;
  return 0.36 * cloudLightTap(p, reach) + 0.16 * (
    cloudLightTap(p + dx, reach) + cloudLightTap(p - dx, reach) +
    cloudLightTap(p + dz, reach) + cloudLightTap(p - dz, reach));
}

vec2 columnOcclusion(vec3 p) {
  float above = 0.0;
  float below = 0.0;
  for (int k = 0; k < 3; k++) {
    vec4 l = uLayers[k];
    float mid = l.x + l.y * 0.45;
    float local = cloudLayer(vec3(p.x, mid, p.z), k);
    above += local * clamp(l.x + l.y - p.y, 0.0, l.y) * 1.4;
    below += local * clamp(p.y - l.x, 0.0, l.y) * 0.65;
  }
  return exp(-vec2(above, below));
}

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
  vec2 box = boxRange(uEye, rd);
  vec2 ranges[4];
  ranges[0] = vec2(max(0.0, box.x), min(dist, box.y));
  if (uHaloAir <= 0.0 && uReference < 0.5) ranges[0] = vec2(0.0);
  float farM = min(dist, uCloudFarM);
  // Enclose each curved MSL slab with a ray interval. The tangent altitude
  // underestimates the exact altitude by a positive quadratic remainder.
  float eyeKm = toProtoKm(uEye).y;
  float slope = (rd.y + dot(uEye.xz, rd.xz) / uEarthR) * 0.001 / uExag;
  float curve = dot(rd.xz, rd.xz) * 0.001 / (2.0 * uEarthR * uExag);
  for (int k = 0; k < 3; k++) {
    vec4 layer = uLayers[k];
    vec2 r = vec2(0.0);
    if (uReference < 0.5 && uCloudOn > 0.5 && layer.z * layer.w > 0.0) {
      // Intersect the upper surface exactly. Clip to the lower surface on
      // monotonic segments; a ray crossing the tangent can visit a slab twice.
      float top = eyeKm - layer.x - layer.y;
      if (curve * farM * farM < 0.00001) {
        if (abs(slope) * farM < 0.00001) {
          if (top <= 0.0 && top + layer.y >= 0.0) r.y = farM;
        } else {
          vec2 t = -vec2(top, top + layer.y) / slope;
          r = vec2(max(0.0, min(t.x,t.y)), min(farM, max(t.x,t.y)));
        }
      } else {
        float d = slope * slope - 4.0 * curve * top;
        if (d >= 0.0) {
          float root = sqrt(d);
          r = vec2(max(0.0, (-slope-root)/(2.0*curve)), min(farM, (-slope+root)/(2.0*curve)));
          float lowerD = d - 4.0 * curve * layer.y;
          if (lowerD > 0.0) {
            vec2 gap = (-slope + vec2(-1.0,1.0)*sqrt(lowerD))/(2.0*curve);
            if (r.x >= gap.x) r.x = max(r.x, gap.y);
            else if (r.y <= gap.y) r.y = min(r.y, gap.x);
          }
        }
      }
    }
    ranges[k + 1] = r;
  }
  // Sort and remove overlap before distributing samples over occupied space.
  for (int i = 1; i < 4; i++) {
    for (int j = i; j > 0; j--) {
      if (ranges[j].x >= ranges[j-1].x) break;
      vec2 tmp = ranges[j]; ranges[j] = ranges[j-1]; ranges[j-1] = tmp;
    }
  }
  float last = 0.0;
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    ranges[i].x = max(last, ranges[i].x);
    total += max(0.0, ranges[i].y - ranges[i].x);
    last = max(last, ranges[i].y);
  }
  if (total > 0.0 && (uHaloAir > 0.0 || uCloudOn > 0.5)) {
    int steps = int(uCloudSteps + 0.5);
    float stride = total / float(steps);
    float strideKm = stride * 0.001 * length(vec3(rd.x, rd.y / uExag, rd.z));
    // A common midpoint keeps adjacent cloud rays coherent at grazing angles.
    float jitter = uCloudOn > 0.5 ? 0.5 : hash(gl_FragCoord.xy);
    int band = 0;
    float offset = 0.0;
    for (int i = 0; i < ${STEPS_CLOUDS}; i++) {
      if (i >= steps || trans < 0.002) break;
      float t = (float(i) + jitter) * stride;
      while (band < 3) {
        float span = max(0.0, ranges[band].y - ranges[band].x);
        if (t < offset + span) break;
        offset += span;
        band++;
      }
      vec3 pScene = uEye + rd * (ranges[band].x + t - offset);
      vec3 p = toProtoKm(pScene);
      // Skip underground samples but KEEP marching. A ridge false-positive used
      // to break the whole sky ray before it reached the cloud slab (Meteo ON
      // showed no clouds, yet path/lighting differed from Meteo OFF).
      if (uHasVolume > 0.5 && abs(p.x) < uGroundExtentKm * 0.5
          && abs(p.z) < uGroundExtentKm * 0.5) {
        float groundKm = texture(uGround, p.xz / uGroundExtentKm + 0.5).r;
        if (p.y < groundKm - ${GROUND_STOP_MARGIN_KM}) continue;
      }
      // Prototype edge / lighting coefficients — verbatim from chamonix-threejs.html.
      float edge = 1.0 - smoothstep(11.0, 12.0, max(abs(p.x), abs(p.z)));
      float ill = uHasVolume > 0.5 && max(abs(p.x), abs(p.z)) <= 12.0 ? fieldLight(p) : 0.0;
      // Air glow ONLY when local halo is enabled — not when clouds alone boost power.
      float air = uHaloAir > 0.0
        ? exp(-max(p.y - uRefAltKm, 0.0) / max(uVertical, 1e-3)) * uHaloAir * uHaze * edge * 0.045
        : 0.0;
      float midDensity = cloudLayer(p, 1) * uCloudOn;
      float lowDensity = cloudLayer(p, 0) * uCloudOn;
      float density = midDensity + lowDensity + uCloudOn * cloudLayer(p, 2);
      // Empty space contributes neither light nor extinction.
      if (density == 0.0 && air == 0.0) continue;
      float rangeKm = length(pScene.xz - uEye.xz) * 0.001;
      float distant = exp(-rangeKm / 95.0) * (1.0 - smoothstep(120.0, 390.0, rangeKm));
      float cd = density * mix(distant, edge, uReference);
      float cloudExt = cd * 2.2;
      vec3 cloudColour = vec3(0.0);
      if (cd > 0.001) {
        vec2 occ = columnOcclusion(p);
        float selfShade = exp(-cloudDensity(p + vec3(0.12, 0.18, 0.08)) * 0.8);
        // Proto night sky #0b1423 — never the washed PL horizon (that → chalk white).
        vec3 nightSky = srgbToLinear(vec3(11., 20., 35.) / 255.);
        vec3 skyAmb = mix(nightSky, srgbToLinear(uSkyLight), clamp(uDayFactor, 0.0, 1.0));
        vec3 ambient = (skyAmb * 3.2 + vec3(0.009, 0.012, 0.019))
          * mix(0.16, 1.0, occ.x) * selfShade;
        if (uReference < 0.5) {
          vec3 daylight = ambient * 0.55;
          if (uDayFactor > 0.001) {
            // Two sunward samples distinguish a lit rim from a shaded interior.
            float tau = cloudDensity(p + uSunDir * 0.22) * 0.65
                      + cloudDensity(p + uSunDir * 0.85) * 1.35;
            float silver = pow(max(dot(rd, uSunDir), 0.0), 8.0);
            float sun = smoothstep(-0.06, 0.12, uSunDir.y);
            vec3 sunColor = mix(vec3(1.0, 0.53, 0.28), vec3(1.0, 0.97, 0.90),
                                smoothstep(0.0, 0.32, uSunDir.y));
            daylight += sunColor * sun * exp(-tau) * (0.50 + 0.55 * silver) * mix(0.28, 1.0, occ.x);
          }
          ambient = mix(ambient, daylight, smoothstep(0.0, 0.65, uDayFactor));
        }
        if (uMoonStrength > 0.001 && uDayFactor < 0.65) {
          float moonDepth = cloudDensity(p + 0.26 * uMoonDir) * 0.75
                          + cloudDensity(p + 0.94 * uMoonDir) * 1.35;
          float ridgeLight = 1.0;
          if (uHasVolume > 0.5 && uMoonDir.y < 0.65) {
            float distanceKm = 0.5;
            for (int k = 0; k < 5; ++k) {
              vec3 probe = p + distanceKm * uMoonDir;
              vec2 uv = probe.xz / uGroundExtentKm + 0.5;
              if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
                float clearance = probe.y - texture(uGround, uv).r;
                ridgeLight = min(ridgeLight, smoothstep(-0.06, 0.12, clearance));
              }
              distanceKm *= 2.2;
            }
            ridgeLight = mix(ridgeLight, 1.0, smoothstep(0.5, 0.65, uMoonDir.y));
          }
          float rim = pow(max(dot(rd, uMoonDir), 0.0), 6.0);
          ambient += vec3(0.94, 0.98, 1.0) * uMoonStrength * ridgeLight
                     * (1.0 - smoothstep(0.0, 0.65, uDayFactor)) * exp(-moonDepth) * (0.035 + 0.045 * rim) * mix(0.3, 1.0, occ.x);
        }
        float under = exp(-max(p.y - uRefAltKm, 0.0) / max(uVertical, 1e-3));
        float cloudIll = ill;
        if (uReference < 0.5 && uHasVolume > 0.5 && uPower * uHaloAir > 0.0)
          cloudIll = diffuseCloudLight(p);
        float cityAmt = cloudIll * uPower * uHaloAir + uSkyLp * 1.25 * under;
        vec3 city = uTint * cityAmt * 0.9 * mix(0.12, 1.0, occ.y);
        cloudColour = ambient + city;
      }
      float extinction = air + cloudExt;
      float opacity = 1.0 - exp(-extinction * strideKm);
      vec3 incident = (air * uTint * ill * uPower * 3.5 + cloudExt * cloudColour)
        / max(extinction, 1e-6);
      glow += trans * incident * opacity;
      trans *= 1.0 - opacity;
    }
  }

  vec3 sceneDisplay = texture(uScene, vUv).rgb;
  vec3 col = sceneDisplay;
  if (trans < 1.0 || any(greaterThan(glow, vec3(0.0)))) {
    // The backdrop already has its display look. Recover the equivalent input
    // of the reference curve so an empty volume round-trips unchanged.
    vec3 background = -log(max(vec3(1e-5), 1.0 - pow(sceneDisplay, vec3(2.2)))) / 1.5;
    col = pow(1.0 - exp(-1.5 * (background * trans + glow)), vec3(1.0 / 2.2));
  }

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
  isActive: (
    tuning: LocalHaloTuning,
    clouds?: ViewfinderWeather | null,
  ) => boolean
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
    clouds?: LocalHaloCloudFrame | null,
  ) => void
  dispose: () => void
}

const NOISE_SIZE = 32
let cachedNoise: Uint8Array<ArrayBuffer> | undefined

function generateNoise(size: number) {
  const bytes = new Uint8Array(size ** 3 * 2)
  let seed = 7823
  for (let i = 0; i < size ** 3; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    bytes[i * 2] = seed >>> 24
  }
  // Periodic Worley noise in green. Red retains the original reference noise.
  const cells = 4
  const centers = new Float32Array(cells ** 3 * 3)
  for (let i = 0; i < centers.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    centers[i] = 0.15 + 0.7 * (seed / 4294967296)
  }
  for (let i = 0; i < size ** 3; i++) {
    const x = (i % size + 0.5) * cells / size
    const y = (Math.floor(i / size) % size + 0.5) * cells / size
    const z = (Math.floor(i / (size * size)) + 0.5) * cells / size
    let nearest = 1
    for (let k = Math.floor(z) - 1; k <= Math.floor(z) + 1; k++) {
      for (let j = Math.floor(y) - 1; j <= Math.floor(y) + 1; j++) {
        for (let h = Math.floor(x) - 1; h <= Math.floor(x) + 1; h++) {
          const index = ((k & 3) * 16 + (j & 3) * 4 + (h & 3)) * 3
          const dx = h + centers[index]! - x
          const dy = j + centers[index + 1]! - y
          const dz = k + centers[index + 2]! - z
          nearest = Math.min(nearest, dx * dx + dy * dy + dz * dz)
        }
      }
    }
    bytes[i * 2 + 1] = Math.round(255 * (1 - Math.sqrt(nearest)))
  }
  return bytes
}

function makeNoise3D(): THREE.Data3DTexture {
  cachedNoise ??= generateNoise(NOISE_SIZE)
  const tex = new THREE.Data3DTexture(cachedNoise, NOISE_SIZE, NOISE_SIZE, NOISE_SIZE)
  tex.format = THREE.RGFormat
  tex.type = THREE.UnsignedByteType
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.wrapR = THREE.RepeatWrapping
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
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
  const noiseTex = makeNoise3D()

  let volumeTex: THREE.Data3DTexture | null = null
  let rawTex: THREE.DataTexture | null = null
  let groundTex: THREE.DataTexture | null = null
  let current: LocalHaloField | null = null
  let cloudTimeSec = 0

  const uniforms = {
    uScene: { value: target.texture as THREE.Texture },
    uDepth: { value: depthTexture as THREE.Texture },
    uVolume: { value: emptyVolume as THREE.Texture },
    uNoise: { value: noiseTex as THREE.Texture },
    uRaw: { value: emptyRaw as THREE.Texture },
    uGround: { value: emptyGround as THREE.Texture },
    uGroundExtentKm: { value: 1 },
    uHasVolume: { value: 0 },
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
    uHaloAir: { value: 0 },
    uVertical: { value: 1.4 },
    uHaze: { value: 0.45 },
    uBlocking: { value: 1 },
    uTint: { value: new THREE.Vector3(1, 0.48, 0.19) },
    uReference: { value: 0 },
    uCloudOn: { value: 0 },
    uCloudTime: { value: 0 },
    uMoonStrength: { value: 0 },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSkyLight: { value: new THREE.Color(0.4, 0.55, 0.75) },
    uLayers: {
      value: [
        new THREE.Vector4(2.2, 1.1, 0, 1.1),
        new THREE.Vector4(4.6, 1.4, 0, 0.7),
        new THREE.Vector4(7.4, 0.7, 0, 0.35),
      ],
    },
    uCloudSteps: { value: STEPS_HALO },
    // ~80 km: enough for horizon rays to cross ASL slabs without the ±12 km boule.
    uCloudFarM: { value: 400_000 },
    uSkyLp: { value: 0 },
    uDayFactor: { value: 0 },
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
      uniforms.uHasVolume.value = 0
      return
    }
    uniforms.uHasVolume.value = 1
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

  const isActive = (
    t: LocalHaloTuning,
    clouds?: ViewfinderWeather | null,
  ) => {
    if (clouds && weatherWantsVolumePass(clouds)) return true
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
    clouds: LocalHaloCloudFrame | null = null,
  ) => {
    renderer.setRenderTarget(null)
    const cloudsOn = clouds != null && weatherWantsVolumePass(clouds.weather)
    if (!current && !cloudsOn && !t.groundView) return

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

    const halfKm = current ? spec.halfExtentKm : 48
    const half = halfKm * 1000
    const cx = current?.centerScene.x ?? uniforms.uEye.value.x
    const cz = current?.centerScene.z ?? uniforms.uEye.value.z
    uniforms.uCenter.value.set(cx, cz)
    const yMinKm = current?.yMinKm ?? 0.2
    const yMaxKm = Math.max(current?.yMaxKm ?? 9.5, cloudsOn ? (clouds?.reference ? 11.5 : 9.5) : yMinKm + 1)
    const far = Math.hypot(Math.abs(cx) + half, Math.abs(cz) + half)
    const maxDrop = (far * far) / (2 * EARTH_RADIUS_M)
    uniforms.uBoxMinScene.value.set(
      cx - half,
      (yMinKm * 1000 - base) * exag - maxDrop,
      cz - half,
    )
    uniforms.uBoxMaxScene.value.set(
      cx + half,
      (yMaxKm * 1000 - base) * exag,
      cz + half,
    )
    if (!current) {
      uniforms.uBoxMinKm.value.set(-halfKm, yMinKm, -halfKm)
      uniforms.uBoxSizeKm.value.set(halfKm * 2, yMaxKm - yMinKm, halfKm * 2)
      uniforms.uRefAltKm.value = base * 0.001
      uniforms.uHasVolume.value = 0
    }

    const night01 = Math.min(1, Math.max(0, t.night))
    const haloOn = Boolean(current) && t.enabled && night01 > 0.001
    uniforms.uPower.value = haloOn ? t.intensity : 0
    uniforms.uHaloAir.value = haloOn && t.intensity > 0 ? night01 : 0
    uniforms.uVertical.value = t.heightKm
    uniforms.uHaze.value = t.haze
    uniforms.uBlocking.value = t.blocking ? 1 : 0
    const tint = localHaloTint(t.tempK)
    uniforms.uTint.value.set(tint[0], tint[1], tint[2])
    uniforms.uReference.value = clouds?.reference ? 1 : 0
    uniforms.uGroundView.value = t.groundView && current ? 1 : 0
    uniforms.uGroundAlpha.value = t.groundAlpha

    uniforms.uCloudOn.value = cloudsOn ? 1 : 0
    uniforms.uCloudSteps.value = cloudsOn ? STEPS_CLOUDS : STEPS_HALO
    if (clouds) {
      cloudTimeSec += Math.max(0, Math.min(0.1, clouds.deltaSec)) * clouds.weather.wind
      uniforms.uCloudTime.value = cloudTimeSec
      uniforms.uMoonStrength.value = clouds.moonStrength
      uniforms.uMoonDir.value.copy(clouds.moonDirection)
      uniforms.uSunDir.value.copy(clouds.sunDirection)
      uniforms.uSkyLight.value.copy(clouds.skyLight)
      const skyLp = clouds.reference ? 0 : Math.max(0, clouds.skyLp) * night01
      uniforms.uSkyLp.value = skyLp
      // Day factor from skyLight vs proto night — ImmersiveView also sets this.
      uniforms.uDayFactor.value = Math.min(
        1,
        Math.max(0, clouds.dayFactor ?? 1 - night01),
      )
      const packed = weatherLayersForShader(clouds.weather)
      const layers = uniforms.uLayers.value as THREE.Vector4[]
      layers[0]!.copy(packed[0])
      layers[1]!.copy(packed[1])
      layers[2]!.copy(packed[2])
    } else {
      uniforms.uSkyLp.value = 0
      uniforms.uDayFactor.value = 0
      const layers = uniforms.uLayers.value as THREE.Vector4[]
      layers[0]!.z = 0
      layers[1]!.z = 0
      layers[2]!.z = 0
    }

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
      noiseTex.dispose()
      target.dispose()
      depthTexture.dispose()
      material.dispose()
      quad.geometry.dispose()
    },
  }
}
