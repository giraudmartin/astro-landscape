/** Fixed decorative space backdrop params behind the MapLibre globe. */

import { HYG_BRIGHT_STAR_COUNT } from './hygBrightStars'

export const GLOBE_SPACE_STAR_MAX = HYG_BRIGHT_STAR_COUNT

export type GlobeSpaceSettings = {
  enabled: boolean
  showMilkyWay: boolean
  showStars: boolean
  brightness: number
  contrast: number
  saturation: number
  opacity: number
  starCount: number
  starBrightness: number
  starSize: number
}

export const DEFAULT_GLOBE_SPACE_SETTINGS: GlobeSpaceSettings = {
  enabled: true,
  showMilkyWay: true,
  showStars: true,
  brightness: 0.9,
  contrast: 0.85,
  saturation: 1.55,
  opacity: 0.9,
  starCount: GLOBE_SPACE_STAR_MAX,
  starBrightness: 1,
  starSize: 1.35,
}
