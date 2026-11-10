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

export function basemapModeLabel(mode: BasemapMode): string {
  switch (mode) {
    case 'satellite':
      return 'Satellite'
    case 'hybrid':
      return 'Satellite + plan'
    case 'plan':
      return 'Plan'
  }
}
