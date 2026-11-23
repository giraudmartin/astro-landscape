import { tList } from './i18n'

/** Terrain-loading anecdotes in the active locale (catalog: `tips.loader`). */
export function getAstroLoaderTips(): readonly string[] {
  return tList('tips.loader')
}

/** Fisher–Yates shuffle (of the active-locale tips by default). Returns a new array. */
export function shuffleAstroLoaderTips(
  tips: readonly string[] = getAstroLoaderTips(),
): string[] {
  const out = [...tips]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = out[i]!
    out[i] = out[j]!
    out[j] = a
  }
  return out
}
