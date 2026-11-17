/**
 * Zenith sky brightness from VIIRS upward radiance — First Rig / Duriscoe form.
 *
 * Source of constants (do not invent replacements):
 * https://firstrig.com/method/sky-brightness
 * (zenith re-fit of Duriscoe et al. 2018, JQSRT 214:133–145, CC BY 4.0)
 *
 *   S    = Σ rᵢ · Aᵢ · dᵢ^(−α(dᵢ))     every cell within 300 km
 *   α(d) = 2.47 · (d / 350 km)^0.158
 *   ZLR  = S / 66.89
 *   10^(−0.4 m) = 10^(−0.4 × 21.83) + ZLR · 10^(−0.4 × 22.0)
 *
 * Duriscoe zeros radiance &lt; 0.5 nW cm⁻² sr⁻¹ (airglow / noise).
 */

/** Max source distance (km). */
export const DURISCOE_MAX_KM = 300

/** First Rig zenith α scale (Duriscoe all-sky published 2.3). */
export const FIRST_RIG_ALPHA_SCALE = 2.47

/** First Rig zenith α power (Duriscoe all-sky published 0.28). */
export const FIRST_RIG_ALPHA_POWER = 0.158

/**
 * Duriscoe 2018 **all-sky** α (published). Used for horizon / dome lobes —
 * distant cities matter more on the horizon than at the zenith, so we must
 * NOT reuse the steeper First Rig zenith kernel for panoramas.
 */
export const ALL_SKY_ALPHA_SCALE = 2.3
export const ALL_SKY_ALPHA_POWER = 0.28

/** First Rig calibration: S → ZLR (units of 171 µcd/m²). */
export const FIRST_RIG_ZLR_DIVISOR = 66.89

/** NPS median natural zenith (mag/arcsec²) — First Rig §1. */
export const FIRST_RIG_NATURAL_MAG = 21.83

/** Textbook 22.0 used as the ZLR unit reference in the mag equation. */
export const FIRST_RIG_ZLR_UNIT_MAG = 22.0

/** Duriscoe background clip (nW cm⁻² sr⁻¹). */
export const VIIRS_BG_CLIP_NW = 0.5

export function firstRigAlpha(distanceKm: number): number {
  if (!(distanceKm > 0)) return 0
  return (
    FIRST_RIG_ALPHA_SCALE *
    Math.pow(distanceKm / 350, FIRST_RIG_ALPHA_POWER)
  )
}

export function allSkyAlpha(distanceKm: number): number {
  if (!(distanceKm > 0)) return 0
  return (
    ALL_SKY_ALPHA_SCALE * Math.pow(distanceKm / 350, ALL_SKY_ALPHA_POWER)
  )
}

/**
 * Distance weight d^(−α). Observer / near-field: clamp d to `minDistanceKm`
 * so the power law stays finite (half-cell ≈ 0.23 km at 15″).
 */
export function firstRigKernel(
  distanceKm: number,
  minDistanceKm = 0.25,
): number {
  if (distanceKm > DURISCOE_MAX_KM) return 0
  const d = Math.max(distanceKm, minDistanceKm)
  return Math.pow(d, -firstRigAlpha(d))
}

/** Duriscoe all-sky weight — horizon / panoramic domes. */
export function allSkyKernel(
  distanceKm: number,
  minDistanceKm = 0.25,
  maxKm = DURISCOE_MAX_KM,
): number {
  if (distanceKm > maxKm) return 0
  const d = Math.max(distanceKm, minDistanceKm)
  return Math.pow(d, -allSkyAlpha(d))
}

/**
 * Horizon / dome distance weight: Duriscoe all-sky × mild mid-range lift.
 * Cities ~30–80 km (e.g. Hilo from Mauna Kea) matter more on the horizon
 * than the raw all-sky power law admits; lift is ~Gaussian around 50 km
 * and stays small for alpine near-field (5–15 km).
 */
export const HORIZON_MIDRANGE_KM = 50
export const HORIZON_MIDRANGE_SIGMA_KM = 28
export const HORIZON_MIDRANGE_BOOST = 1.8

export function horizonDistanceWeight(
  distanceKm: number,
  minDistanceKm = 0.25,
  maxKm = DURISCOE_MAX_KM,
): number {
  const base = allSkyKernel(distanceKm, minDistanceKm, maxKm)
  if (base <= 0) return 0
  const d = Math.max(distanceKm, minDistanceKm)
  const u = (d - HORIZON_MIDRANGE_KM) / HORIZON_MIDRANGE_SIGMA_KM
  const mid = Math.exp(-(u * u))
  return base * (1 + HORIZON_MIDRANGE_BOOST * mid)
}

/** @deprecated alias — same as {@link firstRigKernel}. */
export function duriscoeKernel(distanceKm: number): number {
  return firstRigKernel(distanceKm)
}

/**
 * ZLR → zenith mag/arcsec² (First Rig equation, natural floor 21.83).
 */
export function skyBrightnessMagFromZlr(zlr: number): number {
  const z = Math.max(0, zlr)
  const nat = Math.pow(10, -0.4 * FIRST_RIG_NATURAL_MAG)
  const art = z * Math.pow(10, -0.4 * FIRST_RIG_ZLR_UNIT_MAG)
  return Math.log10(nat + art) / -0.4
}

export function zlrFromSumS(sumS: number): number {
  return Math.max(0, sumS) / FIRST_RIG_ZLR_DIVISOR
}

export function skyBrightnessMagFromSumS(sumS: number): number {
  return skyBrightnessMagFromZlr(zlrFromSumS(sumS))
}

/**
 * Accumulate one cell into S.
 * r: nW cm⁻² sr⁻¹ (after BG clip), A: km², d: km.
 */
export function cellContribution(
  radianceNw: number,
  areaKm2: number,
  distanceKm: number,
  minDistanceKm = 0.25,
): number {
  if (!(radianceNw >= VIIRS_BG_CLIP_NW)) return 0
  if (!(areaKm2 > 0)) return 0
  const k = firstRigKernel(distanceKm, minDistanceKm)
  if (k <= 0) return 0
  return radianceNw * areaKm2 * k
}

/**
 * Ring mid-radii + annulus widths (km) — BM / sparse fallback only.
 * Preferred path sums every VIIRS cell in a COG window.
 */
export const DURISCOE_RINGS: ReadonlyArray<{ d: number; w: number }> = [
  { d: 0, w: 2 },
  { d: 4, w: 4 },
  { d: 10, w: 6 },
  { d: 18, w: 10 },
  { d: 32, w: 16 },
  { d: 55, w: 24 },
  { d: 90, w: 36 },
  { d: 140, w: 50 },
  { d: 210, w: 60 },
  { d: 280, w: 40 },
]

export const DURISCOE_AZ_BINS = 24

/**
 * Approximate S from ring samples (sparse fallback when no COG window).
 * S ≈ Σ R · A_sample · K(d) — same units as the full cell sum.
 */
export function sumSFromRingSamples(
  rings: ReadonlyArray<{
    distanceKm: number
    widthKm: number
    radiances: ReadonlyArray<number>
  }>,
): number {
  let S = 0
  for (const ring of rings) {
    if (ring.radiances.length === 0) continue
    const areaRing =
      ring.distanceKm <= 0
        ? Math.PI * ring.widthKm * ring.widthKm
        : 2 * Math.PI * ring.distanceKm * ring.widthKm
    const areaSample = areaRing / ring.radiances.length
    const minD =
      ring.distanceKm <= 0 ? Math.max(0.25, ring.widthKm * 0.5) : 0.25
    for (const R of ring.radiances) {
      S += cellContribution(R, areaSample, ring.distanceKm, minD)
    }
  }
  return S
}

/** Approx cell area (km²) for a lon/lat grid cell at `latDeg`. */
export function cellAreaKm2(resDeg: number, latDeg: number): number {
  const ns = resDeg * 111.32
  const ew = resDeg * 111.32 * Math.max(0.05, Math.cos((latDeg * Math.PI) / 180))
  return ns * ew
}

/**
 * Black Marble is visualization only. Fallback path maps glow→radiance
 * with a fixed scale so city cores land near First Rig COG results
 * (Paris ~18, Tokyo ~18). Not used when the VIIRS COG is available.
 */
export const ZENITH_BM_RADIANCE_SCALE = 22
