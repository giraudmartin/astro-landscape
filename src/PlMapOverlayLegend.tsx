import { BORTLE_MAP_STOPS } from './lightPollution/bortleMapColors'
import { bortleLabel } from './lightPollution/bortleFromRadiance'
import { useT } from './i18n'

const BORTLE_CLASSES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const SOURCE_LINK_TOKEN = '\u0001'

/** Compact Bortle scale + class legend while the coloured PL overlay is on. */
export function PlMapOverlayLegend() {
  const t = useT()
  const gradient = BORTLE_MAP_STOPS.map(
    ([r, g, b]) => `rgb(${r},${g},${b})`,
  ).join(', ')
  // The source sentence embeds a link: split around a sentinel placeholder.
  const [sourceBefore, sourceAfter = ''] = t('map.pl.legendSource', {
    link: SOURCE_LINK_TOKEN,
  }).split(SOURCE_LINK_TOKEN)

  return (
    <aside className="pl-map-legend" aria-label={t('map.pl.legendAria')}>
      <header className="pl-map-legend__head">
        <span className="pl-map-legend__title">{t('map.pl.legendTitle')}</span>
        <span className="pl-map-legend__subtitle">
          {t('map.pl.legendSubtitle')}
        </span>
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
                {bortleLabel(n)}
              </span>
            </li>
          )
        })}
      </ul>

      <p className="pl-map-legend__source">
        {sourceBefore}
        <a
          className="pl-map-legend__source-link"
          href="https://doi.org/10.5281/zenodo.17294744"
          target="_blank"
          rel="noreferrer"
        >
          EOG VIIRS VNL 2024
        </a>
        {sourceAfter}
      </p>
    </aside>
  )
}
