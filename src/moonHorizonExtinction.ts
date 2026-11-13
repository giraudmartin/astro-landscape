/**
 * Atmospheric extinction / reddening of the Moon near the horizon.
 *
 * Sources:
 * - Extinction airmass X(z) for the Moon itself:
 *   Krisciunas & Schaefer 1991, PASP 103, 1033, eq. (14)
 *   X = [cos z + 0.025 exp(−11 cos z)]⁻¹  (≈1 at zenith, ≈40 at horizon).
 * - Rayleigh optical depth (sea-level form used in moonlight models):
 *   Liou (2002) via Noll et al. 2012, A&A 543, A92 / Jones et al. moonlight:
 *   τ_R(λ) = (P/1013)(8.6×10⁻³ + 6.5×10⁻⁶ H) λ^{−(3.9+0.074λ+0.050/λ)}
 *   with λ in μm, H observer height in km.
 * - Aerosols: Ångström law τ_a(λ) = τ550 (λ/0.55)^(−α), moderate continental
 *   clear-night values (τ550 ≈ 0.10, α ≈ 1.3) — Paris-scale, not pristine alpine.
 *
 * Transmission: T(λ) = exp(−τ(λ) X). Applied per limb altitude across the disc
 * (bottom limb has higher X → stronger blue loss → orange).
 */

export type Rgb = readonly [number, number, number]

/** Effective wavelengths for sRGB-ish channels (μm). */
export const LAMBDA_RGB_UM: Rgb = [0.64, 0.55, 0.45]

/** Paris / lowland observer defaults. */
export const OBSERVER_PRESSURE_HPA = 1013
export const OBSERVER_HEIGHT_KM = 0.035
/** Moderate clear-night aerosol optical depth at 550 nm. */
export const AEROSOL_TAU_550 = 0.1
export const AEROSOL_ANGSTROM = 1.3

/**
 * Extinction airmass from apparent altitude (deg).
 * Krisciunas & Schaefer 1991 eq. (14); capped at 40 air masses.
 */
export function extinctionAirmassFromAltitudeDeg(altitudeDeg: number): number {
  const alt = Math.min(90, Math.max(-1, altitudeDeg))
  const zenithDeg = 90 - alt
  const z = (zenithDeg * Math.PI) / 180
  const cosZ = Math.cos(z)
  // Horizon singularity guard — formula already limits ~40.
  const X = 1 / (cosZ + 0.025 * Math.exp(-11 * cosZ))
  if (!Number.isFinite(X) || X < 1) return 1
  return Math.min(X, 40)
}

/** Liou / Noll Rayleigh optical depth at wavelength λ (μm). */
export function rayleighOpticalDepth(
  lambdaUm: number,
  pressureHpa = OBSERVER_PRESSURE_HPA,
  heightKm = OBSERVER_HEIGHT_KM,
): number {
  const lam = Math.max(lambdaUm, 0.3)
  const expo = 3.9 + 0.074 * lam + 0.05 / lam
  return (pressureHpa / 1013) * (8.6e-3 + 6.5e-6 * heightKm) * lam ** -expo
}

/** Ångström aerosol optical depth. */
export function aerosolOpticalDepth(
  lambdaUm: number,
  tau550 = AEROSOL_TAU_550,
  angstrom = AEROSOL_ANGSTROM,
): number {
  return tau550 * (lambdaUm / 0.55) ** -angstrom
}

export function totalOpticalDepthRgb(): Rgb {
  return LAMBDA_RGB_UM.map(
    (lam) => rayleighOpticalDepth(lam) + aerosolOpticalDepth(lam),
  ) as unknown as Rgb
}

/** Beam transmittance for one airmass path: T = e^(−τ X). */
export function transmittanceRgb(airmass: number, tau: Rgb = totalOpticalDepthRgb()): Rgb {
  const X = Math.max(airmass, 0)
  return [
    Math.exp(-tau[0] * X),
    Math.exp(-tau[1] * X),
    Math.exp(-tau[2] * X),
  ]
}

/**
 * Apparent altitude of a point on the lunar disc.
 * `limbY` = −1 bottom … +1 top (camera-facing local +Y ≈ celestial up).
 */
export function limbAltitudeDeg(
  moonAltitudeDeg: number,
  angularDiameterDeg: number,
  limbY: number,
): number {
  const radius = Math.max(angularDiameterDeg, 0.1) * 0.5
  return moonAltitudeDeg + Math.max(-1, Math.min(1, limbY)) * radius
}

/** RGB transmittance at a disc point (for tests / CPU preview). */
export function moonLimbTransmittance(
  moonAltitudeDeg: number,
  angularDiameterDeg: number,
  limbY: number,
): Rgb {
  const alt = limbAltitudeDeg(moonAltitudeDeg, angularDiameterDeg, limbY)
  return transmittanceRgb(extinctionAirmassFromAltitudeDeg(alt))
}

/** Reddening diagnostic: higher = more orange (R/B). */
export function reddeningRatio(t: Rgb): number {
  return t[0] / Math.max(t[2], 1e-6)
}

/**
 * Display mapping: gentle warm cast (not solid red). Scales physical τ×X down
 * and blends chroma toward neutral for a photo-like amber limb.
 */
export function displayExtinctionRgb(t: Rgb, strength = 0.32): Rgb {
  // Approximate shader path: T_disp = T^0.32
  const soft: Rgb = [
    Math.pow(Math.max(t[0], 1e-8), 0.32),
    Math.pow(Math.max(t[1], 1e-8), 0.32),
    Math.pow(Math.max(t[2], 1e-8), 0.32),
  ]
  const lum = 0.2126 * soft[0] + 0.7152 * soft[1] + 0.0722 * soft[2]
  const safe = Math.max(lum, 1e-4)
  const chroma: Rgb = [soft[0] / safe, soft[1] / safe, soft[2] / safe]
  const s = Math.min(1, Math.max(0, strength))
  const blended: Rgb = [
    1 + (chroma[0] - 1) * s,
    1 + (chroma[1] - 1) * s,
    1 + (chroma[2] - 1) * s,
  ]
  const dim = 1 - 0.45 * (1 - Math.min(1, lum) ** 0.45)
  return [blended[0] * dim, blended[1] * dim, blended[2] * dim]
}
