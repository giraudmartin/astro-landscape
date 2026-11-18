import { BORTLE_MAP_STOPS } from './lightPollution/bortleMapColors'

/** Compact Bortle 1–9 strip shown while the coloured PL overlay is on. */
export function PlMapOverlayLegend() {
  const gradient = BORTLE_MAP_STOPS.map(
    ([r, g, b]) => `rgb(${r},${g},${b})`,
  ).join(', ')

  return (
    <div className="pl-map-legend" role="img" aria-label="Légende Bortle 1 à 9">
      <span className="pl-map-legend__edge">1</span>
      <div
        className="pl-map-legend__bar"
        style={{ background: `linear-gradient(90deg, ${gradient})` }}
      />
      <span className="pl-map-legend__edge">9</span>
    </div>
  )
}
