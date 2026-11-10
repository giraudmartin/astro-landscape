import {
  bearingToCardinal,
  formatBearingLabel,
  normalizeBearingDeg,
} from './viewCompass'

type ViewBearingHudProps = {
  bearingDeg: number
  /** Lens altitude above mean sea level (DEM ground + eye height). */
  altitudeMslM?: number | null
  altitudeAriaLabel?: string
}

const PX_PER_DEG = 2.6
/** Labeled marks every 45°. Dense mini ticks between them → step 5°. */
const TICK_STEP_DEG = 5

function tickClassName(deg: number): string {
  if (deg % 90 === 0) return 'moon-preview-bearing-tape__mark is-major'
  if (deg % 45 === 0) return 'moon-preview-bearing-tape__mark is-medium'
  if (deg % 15 === 0) return 'moon-preview-bearing-tape__mark is-sub'
  return 'moon-preview-bearing-tape__mark is-minor'
}

function formatAltitudeMsl(altitudeMslM: number): string {
  const abs = Math.abs(altitudeMslM)
  const digits = abs >= 100 ? 0 : 1
  return `${altitudeMslM.toFixed(digits)} m`
}

/** Heading tape (boat / aircraft style) — Photo Sightline viewfinder. */
export function ViewBearingHud({
  bearingDeg,
  altitudeMslM = null,
  altitudeAriaLabel,
}: ViewBearingHudProps) {
  const bearing = normalizeBearingDeg(bearingDeg)
  const altitudeText =
    typeof altitudeMslM === 'number' && Number.isFinite(altitudeMslM)
      ? formatAltitudeMsl(altitudeMslM)
      : null
  const aria = altitudeText
    ? `${formatBearingLabel(bearing)} · ${altitudeAriaLabel ?? altitudeText}`
    : `Cap ${formatBearingLabel(bearing)}`

  return (
    <div className="moon-preview-bearing-tape" aria-label={aria}>
      <div className="moon-preview-bearing-tape__window">
        <div
          className="moon-preview-bearing-tape__track"
          style={{
            // Anchor at mid-window; px scroll only (track width is 0 with abs marks).
            left: '50%',
            transform: `translateX(${-bearing * PX_PER_DEG}px)`,
          }}
        >
          {[-360, 0, 360].flatMap((shift) =>
            Array.from({ length: 360 / TICK_STEP_DEG }, (_, i) => {
              const deg = i * TICK_STEP_DEG
              const abs = deg + shift
              const major = deg % 90 === 0
              const labeled = deg % 45 === 0
              return (
                <span
                  key={`${shift}-${deg}`}
                  className={tickClassName(deg)}
                  style={{ left: abs * PX_PER_DEG }}
                >
                  <i />
                  {labeled ? (
                    <em>{major ? bearingToCardinal(deg) : deg}</em>
                  ) : null}
                </span>
              )
            }),
          )}
        </div>
        <div className="moon-preview-bearing-tape__caret" aria-hidden="true" />
      </div>
      <span className="moon-preview-bearing-tape__readout">
        {formatBearingLabel(bearing)}
        {altitudeText ? (
          <span className="moon-preview-bearing-tape__altitude">
            {' '}
            · {altitudeText}
          </span>
        ) : null}
      </span>
    </div>
  )
}
