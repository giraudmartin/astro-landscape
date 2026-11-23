/** Supported UI locales. */
export type Locale = 'fr' | 'en'

export const LOCALES: readonly Locale[] = ['fr', 'en'] as const

export function isLocale(value: unknown): value is Locale {
  return value === 'fr' || value === 'en'
}

/** BCP 47 tag for `Intl` / `document.documentElement.lang`. */
export function intlLocale(locale: Locale): string {
  return locale === 'fr' ? 'fr-FR' : 'en-US'
}
