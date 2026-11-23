import { t } from './i18n'

export type BasemapMode = 'satellite' | 'hybrid' | 'plan'

export const BASEMAP_MODE_ORDER: BasemapMode[] = [
  'satellite',
  'hybrid',
  'plan',
]

export function nextBasemapMode(current: BasemapMode): BasemapMode {
  const i = BASEMAP_MODE_ORDER.indexOf(current)
  return BASEMAP_MODE_ORDER[(i + 1) % BASEMAP_MODE_ORDER.length]!
}

/** Localised label (reads the active locale — call during render / events). */
export function basemapModeLabel(mode: BasemapMode): string {
  switch (mode) {
    case 'satellite':
      return t('map.basemap.satellite')
    case 'hybrid':
      return t('map.basemap.hybrid')
    case 'plan':
      return t('map.basemap.plan')
  }
}
