import type { Locale } from './types'

/**
 * Browser / OS language → app locale.
 * French (any `fr*`) → `fr`, everything else → `en`.
 */
export function detectBrowserLocale(
  languages: readonly string[] = typeof navigator !== 'undefined'
    ? navigator.languages?.length
      ? navigator.languages
      : [navigator.language]
    : [],
): Locale {
  for (const raw of languages) {
    const tag = String(raw ?? '')
      .trim()
      .toLowerCase()
    if (!tag) continue
    const primary = tag.split('-')[0] ?? tag
    if (primary === 'fr') return 'fr'
  }
  return 'en'
}
