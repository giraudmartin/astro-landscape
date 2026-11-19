/**
 * Satellite upward-radiance → estimated sky brightness → Bortle class.
 * Heuristic for scouting only — not a ground SQM reading.
 *
 * Inspired by common VIIRS→Bortle conversions (e.g. GeoInsight / Falchi-style):
 * artificial glow ∝ radiance, plus a natural night-sky floor (~22 mag/arcsec²).
 */

export const BORTLE_MIN = 1
export const BORTLE_MAX = 9

/** Natural night-sky background ≈ 22.00 mag/arcsec² in mcd/m². */
const NATURAL_SKY_MCD = 0.171168465

/** Radiance (nW/cm²/sr) → artificial sky brightness (mcd/m²). */
const RADIANCE_TO_ARTIFICIAL_MCD = 0.5

const BORTLE_FROM_MAG: ReadonlyArray<{ bortle: number; minMag: number }> = [
  { bortle: 1, minMag: 21.99 },
  { bortle: 2, minMag: 21.89 },
  { bortle: 3, minMag: 21.69 },
  { bortle: 4, minMag: 20.49 },
  { bortle: 5, minMag: 19.5 },
  { bortle: 6, minMag: 18.94 },
  { bortle: 7, minMag: 18.38 },
  { bortle: 8, minMag: 17.8 },
  { bortle: 9, minMag: -Infinity },
]

const BORTLE_LABELS_FR: Record<number, string> = {
  1: 'Ciel excellent',
  2: 'Site vraiment sombre',
  3: 'Ciel rural',
  4: 'Rural / périurbain',
  5: 'Ciel suburbain',
  6: 'Suburbain clair',
  7: 'Suburbain / urbain',
  8: 'Ciel de ville',
  9: 'Centre-ville',
}

export function clampBortle(value: number): number {
  if (!Number.isFinite(value)) return 4
  return Math.min(BORTLE_MAX, Math.max(BORTLE_MIN, Math.round(value)))
}

export function skyBrightnessMagFromRadiance(radianceNwCm2Sr: number): number {
  const rad = Math.max(0, radianceNwCm2Sr)
  const total = RADIANCE_TO_ARTIFICIAL_MCD * rad + NATURAL_SKY_MCD
  return Math.log10(total / 108_000_000) / -0.4
}

/** Inverse of {@link skyBrightnessMagFromRadiance} — for reporting / shaders. */
export function radianceFromSkyBrightnessMag(magArcsec2: number): number {
  if (!Number.isFinite(magArcsec2)) return 0
  const total = 108_000_000 * Math.pow(10, -0.4 * magArcsec2)
  return Math.max(0, (total - NATURAL_SKY_MCD) / RADIANCE_TO_ARTIFICIAL_MCD)
}

export function bortleFromSkyBrightnessMag(magArcsec2: number): number {
  for (const row of BORTLE_FROM_MAG) {
    if (magArcsec2 >= row.minMag) return row.bortle
  }
  return 9
}

// ZLR expresses artificial zenith luminance in units of the 22 mag reference.
// Classify site pollution on that same reference sky, independently of airglow.
export function bortleFromZenithLightRatio(zlr: number): number {
  const referenceMag = 22 - 2.5 * Math.log10(1 + Math.max(0, zlr))
  return bortleFromSkyBrightnessMag(referenceMag)
}

export function bortleFromRadiance(radianceNwCm2Sr: number): number {
  return bortleFromSkyBrightnessMag(skyBrightnessMagFromRadiance(radianceNwCm2Sr))
}

/**
 * GIBS Black Marble is a *visualization*: unlit land is a navy pedestal
 * (luma ~0.06–0.15), not black. Treating raw luma as radiance made Spitzkoppe
 * read as Bortle 6. Subtract that pedestal and ignore blue-dominated pixels.
 */
export const BLACK_MARBLE_LUMA_FLOOR = 0.155

/**
 * 0…1 artificial glow from a Black Marble RGB pixel (channels 0…1).
 * Navy / blue background → 0; white city cores → ~1.
 */
export function glowFromBlackMarbleRgb(
  r01: number,
  g01: number,
  b01: number,
): number {
  const r = Math.min(1, Math.max(0, r01))
  const g = Math.min(1, Math.max(0, g01))
  const b = Math.min(1, Math.max(0, b01))
  const avg = (r + g + b) / 3
  const blueDom = b >= r - 0.02 && b >= g - 0.02
  // Unlit Black Marble backdrop (Spitzkoppe / Sahara / La Palma).
  if (blueDom && avg < 0.28) return 0
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const excess = (luma - BLACK_MARBLE_LUMA_FLOOR) / (1 - BLACK_MARBLE_LUMA_FLOOR)
  return Math.min(1, Math.max(0, excess))
}

/**
 * Black Marble glow (0…1) → approximate VIIRS-like radiance for the
 * shared radiance→Bortle heuristic.
 */
export function radianceFromBlackMarbleGlow(glow01: number): number {
  const g = Math.min(1, Math.max(0, glow01))
  if (g < 0.01) return 0
  // Softened vs older *55: white BM cores → ~17.6 mag (Tokyo/Paris zenith),
  // not ~16.5 which over-brightened every city center vs LPM sb_2025.
  return Math.pow(g, 1.25) * 18
}

/** @deprecated Prefer glowFromBlackMarbleRgb — luma alone includes the navy floor. */
export function radianceFromTileLuminance(luminance01: number): number {
  const y = Math.min(1, Math.max(0, luminance01))
  const excess = Math.max(0, y - BLACK_MARBLE_LUMA_FLOOR)
  return radianceFromBlackMarbleGlow(
    excess / (1 - BLACK_MARBLE_LUMA_FLOOR),
  )
}

export function bortleFromTileLuminance(luminance01: number): number {
  return bortleFromRadiance(radianceFromTileLuminance(luminance01))
}

export function bortleFromBlackMarbleRgb(
  r01: number,
  g01: number,
  b01: number,
): number {
  return bortleFromRadiance(
    radianceFromBlackMarbleGlow(glowFromBlackMarbleRgb(r01, g01, b01)),
  )
}

export function bortleLabelFr(bortle: number): string {
  return BORTLE_LABELS_FR[clampBortle(bortle)] ?? 'Estimé'
}

/** 0 = pristine, 1 = inner-city — for sky glow scaling. */
export function bortlePollutionFactor(bortle: number): number {
  return (clampBortle(bortle) - 1) / (BORTLE_MAX - 1)
}

/**
 * Curated Bortle tones for badges on dark glass (text-friendly, not neon).
 * 1–3 brand mint, then soft gold → amber → coral → rose → crimson.
 */
const BORTLE_TONES: ReadonlyArray<string> = [
  '#7ddea8', // 1
  '#7ddea8', // 2
  '#7ddea8', // 3
  '#e5d06a', // 4 soft gold
  '#efb85c', // 5 amber
  '#f0925a', // 6 tangerine
  '#ee7462', // 7 coral
  '#e85d6e', // 8 rose
  '#e04a5a', // 9 crimson
]

/** CSS color for Bortle badges / chips (1–9). */
export function bortleColorCss(bortle: number): string {
  return BORTLE_TONES[clampBortle(bortle) - 1] ?? '#7ddea8'
}
