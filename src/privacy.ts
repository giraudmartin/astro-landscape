/**
 * Minimal in-app privacy notice (Settings).
 * Keep in sync with docs/PRIVACY.md.
 * Title / body text live in the i18n catalogs under `settings.privacy.<key>`.
 */
export type PrivacyPoint = {
  id: string
  /** `settings.privacy.<textKey>.title` / `.body` */
  textKey: string
}

export const APP_PRIVACY_POINTS: readonly PrivacyPoint[] = [
  { id: 'local-only', textKey: 'local' },
  { id: 'geolocation', textKey: 'geo' },
  { id: 'network-apis', textKey: 'network' },
  { id: 'bug-report', textKey: 'bug' },
  { id: 'no-tracking', textKey: 'tracking' },
]
