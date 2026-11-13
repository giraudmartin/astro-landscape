/**
 * Atmospheric seeing near the horizon — fine, continuous limb shimmer.
 * Strength, size and speed are user-tunable from the Viewfinder UI.
 */

/** Altitude (°) at/below which turbulence is at full strength. */
export const HORIZON_TURBULENCE_FULL_ALT_DEG = 5
/** Altitude (°) at/above which turbulence is off. */
export const HORIZON_TURBULENCE_FADE_ALT_DEG = 18

export type HorizonTurbulenceSettings = {
  /** Peak radial displacement as % of body radius (0.5…5). */
  strengthPct: number
  /** Feature size — higher = larger / coarser ripples (0.25…4). */
  size: number
  /** Animation speed multiplier (0.2…3). */
  speed: number
  /** Limb band width — higher = shimmer reaches further inward (0.3…1.5). */
  limb: number
  /** Extra vertical stretch bias (0…1). */
  vertical: number
}

/** Tuned look signed off in the Viewfinder (2026-10-29). */
export const DEFAULT_HORIZON_TURBULENCE_SETTINGS: HorizonTurbulenceSettings = {
  strengthPct: 2.4,
  size: 2.4,
  speed: 0.7,
  limb: 0.95,
  vertical: 0,
}

/** Slider bounds for feature size (coarse ↔ fine ripples). */
export const HORIZON_TURBULENCE_SIZE_MIN = 0.25
export const HORIZON_TURBULENCE_SIZE_MAX = 4

export function clampHorizonTurbulenceSettings(
  partial:
    | (Partial<HorizonTurbulenceSettings> & { scale?: number })
    | null
    | undefined,
): HorizonTurbulenceSettings {
  const src = partial ?? {}
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  // Legacy `scale` was spatial frequency (higher = finer). Invert → size.
  const legacySize =
    src.size == null && typeof src.scale === 'number' && Number.isFinite(src.scale)
      ? 2.9 - src.scale
      : undefined
  return {
    strengthPct: Math.min(
      5,
      Math.max(
        0.5,
        num(src.strengthPct, DEFAULT_HORIZON_TURBULENCE_SETTINGS.strengthPct),
      ),
    ),
    size: Math.min(
      HORIZON_TURBULENCE_SIZE_MAX,
      Math.max(
        HORIZON_TURBULENCE_SIZE_MIN,
        num(legacySize ?? src.size, DEFAULT_HORIZON_TURBULENCE_SETTINGS.size),
      ),
    ),
    speed: Math.min(
      3,
      Math.max(0.2, num(src.speed, DEFAULT_HORIZON_TURBULENCE_SETTINGS.speed)),
    ),
    limb: Math.min(
      1.5,
      Math.max(0.3, num(src.limb, DEFAULT_HORIZON_TURBULENCE_SETTINGS.limb)),
    ),
    vertical: Math.min(
      1,
      Math.max(0, num(src.vertical, DEFAULT_HORIZON_TURBULENCE_SETTINGS.vertical)),
    ),
  }
}

export function horizonTurbulenceAmount(
  altitudeDeg: number,
  enabled: boolean,
): number {
  if (!enabled) return 0
  if (!Number.isFinite(altitudeDeg)) return 0
  if (altitudeDeg < -1) return 0
  if (altitudeDeg <= HORIZON_TURBULENCE_FULL_ALT_DEG) return 1
  if (altitudeDeg >= HORIZON_TURBULENCE_FADE_ALT_DEG) return 0
  const t =
    (altitudeDeg - HORIZON_TURBULENCE_FULL_ALT_DEG) /
    (HORIZON_TURBULENCE_FADE_ALT_DEG - HORIZON_TURBULENCE_FULL_ALT_DEG)
  const s = t * t * (3 - 2 * t)
  return 1 - s
}

export type HorizonTurbulenceUniforms = {
  uTime: { value: number }
  uTurbulence: { value: number }
  uTurbStrength: { value: number }
  uTurbSize: { value: number }
  uTurbSpeed: { value: number }
  uTurbLimb: { value: number }
  uTurbVertical: { value: number }
}

export function createHorizonTurbulenceUniforms(
  settings: HorizonTurbulenceSettings = DEFAULT_HORIZON_TURBULENCE_SETTINGS,
): HorizonTurbulenceUniforms {
  const s = clampHorizonTurbulenceSettings(settings)
  return {
    uTime: { value: 0 },
    uTurbulence: { value: 0 },
    uTurbStrength: { value: s.strengthPct / 100 },
    uTurbSize: { value: s.size },
    uTurbSpeed: { value: s.speed },
    uTurbLimb: { value: s.limb },
    uTurbVertical: { value: s.vertical },
  }
}

export function applyHorizonTurbulenceSettings(
  uniforms: Record<string, { value: unknown }>,
  settings: HorizonTurbulenceSettings,
): void {
  const s = clampHorizonTurbulenceSettings(settings)
  if (uniforms.uTurbStrength) uniforms.uTurbStrength.value = s.strengthPct / 100
  if (uniforms.uTurbSize) uniforms.uTurbSize.value = s.size
  if (uniforms.uTurbSpeed) uniforms.uTurbSpeed.value = s.speed
  if (uniforms.uTurbLimb) uniforms.uTurbLimb.value = s.limb
  if (uniforms.uTurbVertical) uniforms.uTurbVertical.value = s.vertical
}

/**
 * GLSL: continuous 3D value-noise FBM on the silhouette.
 * Uniforms: uTime, uTurbulence, uTurbStrength, uTurbSize, uTurbSpeed,
 * uTurbLimb, uTurbVertical.
 */
export const HORIZON_TURBULENCE_GLSL = /* glsl */ `
uniform float uTime;
uniform float uTurbulence;
uniform float uTurbStrength;
uniform float uTurbSize;
uniform float uTurbSpeed;
uniform float uTurbLimb;
uniform float uTurbVertical;

float turbHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.23));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float turbValueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = turbHash(i + vec3(0.0, 0.0, 0.0));
  float n100 = turbHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = turbHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = turbHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = turbHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = turbHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = turbHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = turbHash(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  float nxy0 = mix(nx00, nx10, u.y);
  float nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}

float turbFbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int o = 0; o < 5; o++) {
    sum += amp * turbValueNoise(p);
    norm += amp;
    p = p * 2.11 + vec3(1.7, 3.2, 2.5);
    amp *= 0.5;
  }
  return (sum / max(norm, 1e-4)) * 2.0 - 1.0;
}

vec3 applyHorizonTurbulence(vec3 pos, vec3 nor) {
  if (uTurbulence < 0.001 || uTurbStrength < 1e-5) return pos;
  vec3 n = normalize(nor);
  vec3 viewN = normalize(normalMatrix * n);
  float facing = clamp(abs(viewN.z), 0.0, 1.0);
  // limb: 1 = default rim; higher values pull shimmer inward.
  float rimStart = mix(0.98, 0.78, clamp(uTurbLimb, 0.3, 1.5) / 1.5);
  float rimEnd = mix(0.35, 0.05, clamp(uTurbLimb, 0.3, 1.5) / 1.5);
  float limb = smoothstep(rimStart, rimEnd, facing);
  float amp = uTurbStrength * uTurbulence * limb;
  if (amp < 1e-5) return pos;

  float t = uTime * max(uTurbSpeed, 0.05);
  // Strong size curve: 0.25 → ~140 (grains), 1 → ~28, 4 → ~2.2 (big lobes).
  float size = clamp(uTurbSize, 0.2, 4.5);
  float spat = 28.0 * pow(1.0 / size, 1.9);
  vec3 seed = n * spat;
  float boil = turbFbm(seed + vec3(t * 1.55, t * 1.95, t * 1.12));
  // Fine octave tracks size too — otherwise large size still looks grainy.
  float fineMul = mix(3.4, 1.25, clamp((size - 0.25) / 3.75, 0.0, 1.0));
  float fine = turbFbm(seed * fineMul + vec3(-t * 2.45, t * 1.85, t * 3.1));
  float field = boil * 0.62 + fine * 0.38;

  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 tangent = up - n * dot(up, n);
  float tLen = length(tangent);
  tangent = tLen > 1e-4
    ? tangent / tLen
    : normalize(cross(n, vec3(1.0, 0.0, 0.0)));
  return pos + n * (field * amp) + tangent * (fine * amp * uTurbVertical);
}
`
