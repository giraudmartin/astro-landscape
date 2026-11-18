import { useId, type CSSProperties } from 'react'
import {
  bortleColorCss,
  clampBortle,
} from './lightPollution/bortleFromRadiance'
import { ChevronDownIcon } from './psIcons'

type SpotBortleCardProps = {
  bortle: number
  label: string
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
  label,
  lat,
  lon,
  elevM,
  skyBrightnessMag,
  sourceHint = 'estimé · satellite',
  onOpenSkyBrightness,
}: SpotBortleCardProps) {
  const n = clampBortle(bortle)
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
            <div className="spot-bortle-card__tag">Bortle estimé</div>
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
            <span>Latitude</span>
            <span>{formatLat(lat)}</span>
          </div>
          <div className="spot-bortle-card__detail-row">
            <span>Longitude</span>
            <span>{formatLon(lon)}</span>
          </div>
          <div className="spot-bortle-card__detail-row">
            <span>Altitude</span>
            <span>{Math.round(elevM)} m</span>
          </div>
          <div className="spot-bortle-card__source">Source : {sourceHint}</div>
          {elevM >= 900 ? (
            <div className="spot-bortle-card__source">
              Site élevé : correction DEM approximative (ridges). Un écart
              résiduel vs LPM reste possible (~0,2–0,4&nbsp;mag).
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
            title="Voir la pollution lumineuse (fisheye / panoramique)"
          >
            Voir la pollution lumineuse
          </button>
        </div>
      ) : null}
    </div>
  )
}
