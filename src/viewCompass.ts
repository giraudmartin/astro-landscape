/** Normalize geographic azimuth to [0, 360). */
export function normalizeBearingDeg(deg: number): number {
  const x = deg % 360
  return x < 0 ? x + 360 : x
}

/** Compact cardinal for a bearing (16-wind, French labels like PS). */
export function bearingToCardinal(bearingDeg: number): string {
  const labels = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSO',
    'SO',
    'OSO',
    'O',
    'ONO',
    'NO',
    'NNO',
  ] as const
  const idx = Math.round(normalizeBearingDeg(bearingDeg) / 22.5) % 16
  return labels[idx]!
}

export function formatBearingLabel(bearingDeg: number): string {
  const deg = Math.round(normalizeBearingDeg(bearingDeg))
  return `${bearingToCardinal(deg)} ${deg}°`
}
