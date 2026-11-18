import { BORTLE_MAP_STOPS } from './lightPollution/bortleMapColors'
import { bortleLabelFr } from './lightPollution/bortleFromRadiance'

const BORTLE_CLASSES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

/** Compact Bortle scale + class legend while the coloured PL overlay is on. */
export function PlMapOverlayLegend() {
  const gradient = BORTLE_MAP_STOPS.map(
    ([r, g, b]) => `rgb(${r},${g},${b})`,
  ).join(', ')

  return (
    <aside
      className="pl-map-legend"
      aria-label="Échelle de pollution lumineuse Bortle 1 à 9"
    >
      <header className="pl-map-legend__head">
        <span className="pl-map-legend__title">Échelle Bortle</span>
        <span className="pl-map-legend__subtitle">Pollution lumineuse</span>
      </header>

      <div className="pl-map-legend__scale">
        <div
          className="pl-map-legend__bar"
          style={{ background: `linear-gradient(90deg, ${gradient})` }}
          role="img"
          aria-hidden
        />
        <div className="pl-map-legend__ticks" aria-hidden>
          {BORTLE_CLASSES.map((n) => (
            <span key={n} className="pl-map-legend__tick">
              {n}
            </span>
          ))}
        </div>
      </div>

      <ul className="pl-map-legend__classes">
        {BORTLE_CLASSES.map((n, i) => {
          const [r, g, b] = BORTLE_MAP_STOPS[i]!
          return (
            <li key={n} className="pl-map-legend__class">
              <span
                className="pl-map-legend__swatch"
                style={{ background: `rgb(${r},${g},${b})` }}
                aria-hidden
              />
              <span className="pl-map-legend__class-n">{n}</span>
              <span className="pl-map-legend__class-label">
                {bortleLabelFr(n)}
              </span>
            </li>
          )
        })}
      </ul>

      <p className="pl-map-legend__source">
        Données :{' '}
        <a
          className="pl-map-legend__source-link"
          href="https://doi.org/10.5281/zenodo.17294744"
          target="_blank"
          rel="noreferrer"
        >
          EOG VIIRS VNL 2024
        </a>
        {' '}
        (~500&nbsp;m, CC BY 4.0 · OpenLandMap/Zenodo) — fausse couleur Bortle,
        pas World Atlas.
      </p>
    </aside>
  )
}
