/**
 * Continuous lunar-disk path for the northern-hemisphere convention:
 * waxing is illuminated on the right, waning on the left.
 *
 * Driven by illumination fraction (Astronomy Engine phase_fraction) plus an
 * explicit waxing flag (Astronomy Engine MoonPhase). Not by emoji bins.
 */
export function terminatorRxRatio(illuminationFraction: number): number {
  const k = Math.min(1, Math.max(0, illuminationFraction))
  return Math.abs(2 * k - 1)
}

export function illuminatedMoonPath(
  cx: number,
  cy: number,
  r: number,
  illuminationFraction: number,
  waxing: boolean,
): string {
  const k = Math.min(1, Math.max(0, illuminationFraction))
  if (k <= 0.001) return ''
  const north = `${cx} ${cy - r}`
  const south = `${cx} ${cy + r}`
  if (k >= 0.999) {
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
  }
  const rx = Math.max(r * terminatorRxRatio(k), 0.06)
  const limbSweep = waxing ? 1 : 0
  const termSweep = k > 0.5 ? limbSweep : 1 - limbSweep
  return `M ${north} A ${r} ${r} 0 0 ${limbSweep} ${south} A ${rx} ${r} 0 0 ${termSweep} ${north} Z`
}

export function moonLitSide(
  waxing: boolean,
  illuminationFraction: number,
): 'right' | 'left' | 'none' | 'full' {
  if (illuminationFraction <= 0.001) return 'none'
  if (illuminationFraction >= 0.999) return 'full'
  return waxing ? 'right' : 'left'
}
