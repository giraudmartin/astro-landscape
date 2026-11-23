import { useId, type CSSProperties } from 'react'
import { useT } from './i18n'
import {
  bortleColorCss,
  bortleLabel,
  clampBortle,
} from './lightPollution/bortleFromRadiance'
import { ChevronDownIcon } from './psIcons'

type SpotBortleCardProps = {
  bortle: number
  /** @deprecated Ignored — label is derived from ortle in the active locale. */
  label?: string
  lat: number
  lon: number
  elevM: number
  /** Zenith sky brightness (mag/arcsec²) when known. */
  skyBrightnessMag?: number
  /** Shown in the footer — VIIRS COG vs Black Marble proxy. */
  sourceHint?: string
  onOpenSkyBrightness?: () => void
}

function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`
}

function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`
}

/**
 * Compact map card — Bortle header (collapsible coords) + light-pollution CTA.
 * Visual reference: bortle-propositions.html § `.proposal.test.t06`.
 */
export function SpotBortleCard({
  bortle,
  lat,
  lon,
  elevM,
  skyBrightnessMag,
  sourceHint,
  onOpenSkyBrightness,
}: SpotBortleCardProps) {
  const t = useT()
  const n = clampBortle(bortle)
  const label = bortleLabel(n)
  const sourceText = sourceHint ?? t('bortle.card.defaultSourceHint')
  const detailsId = useId()
  const tone = bortleColorCss(n)
  const sqm =
    typeof skyBrightnessMag === 'number' && Number.isFinite(skyBrightnessMag)
      ? skyBrightnessMag.toFixed(2)
      : null

  return (
    <div
      className="spot-bortle-card"
      aria-label={`Bortle ${n}, ${label}`}
      style={{ '--bortle-tone': tone } as CSSProperties}
    >
      <details className="spot-bortle-card__fold">
        <summary
          className="spot-bortle-card__summary"
          aria-controls={detailsId}
        >
          <div className="spot-bortle-card__badge">
            <span className="spot-bortle-card__number">{n}</span>
          </div>
          <div className="spot-bortle-card__head-text">
            <div className="spot-bortle-card__tag">{t('bortle.card.tag')}</div>
            <div className="spot-bortle-card__quality">{label}</div>
            {sqm ? (
              <div className="spot-bortle-card__sqm">{sqm} mag/arcsec²</div>
            ) : null}
          </div>
          <ChevronDownIcon
            className="spot-bortle-card__chevron"
            size={14}
          />
        </summary>
        <div id={detailsId} className="spot-bortle-card__details">
          <div className="spot-bortle-card__detail-row">
            <span>{t('bortle.card.lat')}</span>
            <span>{formatLat(lat)}</span>
          </div>
          <div className="spot-bortle-card__detail-row">
            <span>{t('bortle.card.lon')}</span>
            <span>{formatLon(lon)}</span>
          </div>
          <div className="spot-bortle-card__detail-row">
            <span>{t('bortle.card.alt')}</span>
            <span>{Math.round(elevM)} m</span>
          </div>
          <div className="spot-bortle-card__source">
            {t('bortle.card.source', { hint: sourceText })}
          </div>
          {elevM >= 900 ? (
            <div className="spot-bortle-card__source">
              {t('bortle.card.highSiteNote')}
            </div>
          ) : null}
        </div>
      </details>
      {onOpenSkyBrightness ? (
        <div className="spot-bortle-card__action">
          <button
            type="button"
            className="spot-bortle-card__sky-btn"
            onClick={(event) => {
              event.stopPropagation()
              onOpenSkyBrightness()
            }}
            title={t('bortle.card.openSkyTitle')}
          >
            {t('bortle.card.openSky')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
