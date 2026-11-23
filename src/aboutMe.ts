/**
 * Author / product blurb shown in Settings → About.
 * Display text (tagline, paragraphs) lives in the i18n catalogs
 * (`settings.about.*`); only identity + links stay here.
 */
export type AboutLink = {
  id: string
  label: string
  url: string
}

export const APP_AUTHOR = 'Martin GIRAUD'

/** i18n key of the short role line under the name. */
export const APP_AUTHOR_TAGLINE_KEY = 'settings.about.tagline'

/** i18n keys of the body paragraphs. Keep concise — one idea per paragraph. */
export const APP_ABOUT_PARAGRAPH_KEYS: readonly string[] = [
  'settings.about.p1',
  'settings.about.p2',
]

/** Optional external links (site, Instagram, GitHub…). Leave empty to hide. */
export const APP_ABOUT_LINKS: readonly AboutLink[] = [
  {
    id: 'instagram',
    label: '@tinmar_g',
    url: 'https://www.instagram.com/tinmar_g/',
  },
]
