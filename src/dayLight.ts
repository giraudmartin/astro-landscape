import { sampleAtmospherePalette } from './atmosphereSky'

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function dayLightFromAtmosphere() {
  const day = sampleAtmospherePalette(25)
  const gold = sampleAtmospherePalette(4)
  const sunset = sampleAtmospherePalette(-1)
  const blue = sampleAtmospherePalette(-5)
  const nautical = sampleAtmospherePalette(-10)
  const astronomical = sampleAtmospherePalette(-15)
  const night = sampleAtmospherePalette(-22)
  return {
    night: night.zenith,
    astronomical: astronomical.zenith,
    nautical: nautical.zenith,
    blueHour: blue.zenith,
    belt: sunset.belt,
    sunset: sunset.horizonSun,
    gold: gold.horizonSun,
    day: day.zenith,
  }
}

const DAY_LIGHT = dayLightFromAtmosphere()

export type DayLightGradientStop = { at: number; color: string }

export function buildDayLightGradientStops(
  sunriseFraction: number | null,
  sunsetFraction: number | null,
): DayLightGradientStop[] {
  if (
    sunriseFraction == null ||
    sunsetFraction == null ||
    sunriseFraction >= sunsetFraction
  ) {
    return [
      { at: 0, color: DAY_LIGHT.night },
      { at: 1, color: DAY_LIGHT.night },
    ]
  }
  const hour = 1 / 24
  const civil = 0.55 * hour
  const nautical = 1.05 * hour
  const astronomical = 1.55 * hour
  const night = 2.2 * hour
  const raw: DayLightGradientStop[] = [
    { at: 0, color: DAY_LIGHT.night },
    { at: sunriseFraction - night, color: DAY_LIGHT.night },
    { at: sunriseFraction - astronomical, color: DAY_LIGHT.astronomical },
    { at: sunriseFraction - nautical, color: DAY_LIGHT.nautical },
    { at: sunriseFraction - civil, color: DAY_LIGHT.blueHour },
    { at: sunriseFraction - 0.25 * hour, color: DAY_LIGHT.belt },
    { at: sunriseFraction - 0.08 * hour, color: DAY_LIGHT.sunset },
    { at: sunriseFraction, color: DAY_LIGHT.gold },
    { at: sunriseFraction + 0.9 * hour, color: DAY_LIGHT.day },
    { at: sunsetFraction - 0.9 * hour, color: DAY_LIGHT.day },
    { at: sunsetFraction - 0.08 * hour, color: DAY_LIGHT.gold },
    { at: sunsetFraction, color: DAY_LIGHT.sunset },
    { at: sunsetFraction + 0.25 * hour, color: DAY_LIGHT.belt },
    { at: sunsetFraction + civil, color: DAY_LIGHT.blueHour },
    { at: sunsetFraction + nautical, color: DAY_LIGHT.nautical },
    { at: sunsetFraction + astronomical, color: DAY_LIGHT.astronomical },
    { at: sunsetFraction + night, color: DAY_LIGHT.night },
    { at: 1, color: DAY_LIGHT.night },
  ]
  const sorted = raw
    .map((stop) => ({ ...stop, at: clamp01(stop.at) }))
    .sort((a, b) => a.at - b.at)
  const stops: DayLightGradientStop[] = []
  for (const stop of sorted) {
    const prev = stops[stops.length - 1]
    if (prev && Math.abs(prev.at - stop.at) < 1e-4) {
      prev.color = stop.color
      continue
    }
    stops.push(stop)
  }
  return stops
}

function parseHexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  if (h.length !== 6) return [0, 0, 0]
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ]
}

function mixHexCss(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHexRgb(a)
  const [br, bg, bb] = parseHexRgb(b)
  const u = clamp01(t)
  const r = Math.round(ar + (br - ar) * u)
  const g = Math.round(ag + (bg - ag) * u)
  const bl = Math.round(ab + (bb - ab) * u)
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`
}

export function dayLightColorAtFraction(
  fraction: number,
  stops: DayLightGradientStop[],
): string {
  if (stops.length === 0) return DAY_LIGHT.night
  const f = clamp01(fraction)
  if (f <= stops[0]!.at) return stops[0]!.color
  const last = stops[stops.length - 1]!
  if (f >= last.at) return last.color
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]!
    const b = stops[i + 1]!
    if (f > b.at) continue
    const span = Math.max(b.at - a.at, 1e-9)
    return mixHexCss(a.color, b.color, (f - a.at) / span)
  }
  return last.color
}

/** Daylight gradient along a UTC window using civil-day fractions. */
export function dayLightGradientCssAlongUtc(
  startMs: number,
  endMs: number,
  sunriseFraction: number | null,
  sunsetFraction: number | null,
  localFractionAtUtcMs: (utcMs: number) => number,
): string {
  const span = Math.max(endMs - startMs, 1)
  const stops = buildDayLightGradientStops(sunriseFraction, sunsetFraction)
  const parts: string[] = []
  const dayMs = 24 * 60 * 60_000
  const steps = Math.max(72, Math.round(72 * (span / dayMs)))
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const utcMs = startMs + t * span
    const frac = localFractionAtUtcMs(utcMs)
    parts.push(
      `${dayLightColorAtFraction(frac, stops)} ${(t * 100).toFixed(2)}%`,
    )
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`
}
