/** Accent / case folding for celestial search. */

const COMBINING = /[\u0300-\u036f]/g

export function normalizeSearchText(input: string): string {
  return input
    .normalize('NFD')
    .replace(COMBINING, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9+\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Compact catalog id form: "ngc 7000" → "ngc7000", "m 42" → "m42". */
export function compactCatalogToken(input: string): string {
  return normalizeSearchText(input).replace(/\s+/g, '')
}
