import { useMemo } from 'react'
import {
  buildObjectLiveInfo,
  TYPE_LABEL_FR,
  type CelestialObject,
} from './celestialObjects'

type CelestialTargetCardProps = {
  object: CelestialObject
  date: string
  playheadUtcMs: number
  lat: number
  lon: number
  elevationM: number
  canCenter: boolean
  onCenter: () => void
  onClose: () => void
}

function formatDeg(value: number, digits = 1): string {
  const sign = value >= 0 ? '+' : '−'
  return `${sign}${Math.abs(value).toFixed(digits)}°`
}

function formatAz(value: number): string {
  const wrapped = ((value % 360) + 360) % 360
  return `${wrapped.toFixed(1)}°`
}

function catalogIdLine(object: CelestialObject): string | null {
  const parts: string[] = []
  const { hip, messier, ngc, ic, iau } = object.catalogIds
  if (messier != null) parts.push(`M${messier}`)
  if (ngc) parts.push(ngc)
  if (ic) parts.push(ic)
  if (hip != null) parts.push(`HIP ${hip}`)
  if (iau && object.type === 'constellation') parts.push(iau)
  const extras = object.aliases
    .filter((a) => a !== object.name)
    .slice(0, 3)
  for (const a of extras) {
    if (!parts.includes(a)) parts.push(a)
  }
  return parts.length ? parts.join(' · ') : null
}

function visibilityStatusLabel(
  status: ReturnType<typeof buildObjectLiveInfo>['visibility']['status'],
): string {
  switch (status) {
    case 'circumpolar':
      return 'Circumpolaire — ne se couche pas'
    case 'never_rises':
      return 'Jamais au-dessus de l’horizon'
    case 'unknown':
      return 'Horaires indisponibles'
    default:
      return 'Lever / coucher (horizon astronomique)'
  }
}

export function CelestialTargetCard({
  object,
  date,
  playheadUtcMs,
  lat,
  lon,
  elevationM,
  canCenter,
  onCenter,
  onClose,
}: CelestialTargetCardProps) {
  const info = useMemo(
    () =>
      buildObjectLiveInfo(object, date, playheadUtcMs, lat, lon, elevationM),
    [object, date, playheadUtcMs, lat, lon, elevationM],
  )

  const ids = catalogIdLine(object)
  const belowHorizon =
    info.position != null && info.position.altitudeDeg < 0
  const pitchClamped =
    info.position != null && Math.abs(info.position.altitudeDeg) > 85

  return (
    <aside className="celestial-target" aria-label="Objet sélectionné">
      <header className="celestial-target__header">
        <div className="celestial-target__titles">
          <p className="celestial-target__type">
            {TYPE_LABEL_FR[object.type]}
          </p>
          <h2 className="celestial-target__name">{object.name}</h2>
          {ids ? <p className="celestial-target__ids">{ids}</p> : null}
        </div>
        <button
          type="button"
          className="celestial-target__close"
          aria-label="Fermer la fiche"
          onClick={onClose}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <dl className="celestial-target__grid">
        {object.mag != null ? (
          <div>
            <dt>Magnitude</dt>
            <dd>{object.mag.toFixed(1)}</dd>
          </div>
        ) : null}
        {info.constellationLabel ? (
          <div>
            <dt>Constellation</dt>
            <dd>{info.constellationLabel}</dd>
          </div>
        ) : null}
        {info.position ? (
          <>
            <div>
              <dt>Azimut</dt>
              <dd>{formatAz(info.position.azimuthDeg)}</dd>
            </div>
            <div>
              <dt>Altitude</dt>
              <dd>{formatDeg(info.position.altitudeDeg)}</dd>
            </div>
          </>
        ) : (
          <div className="celestial-target__span">
            <dt>Position</dt>
            <dd>Indisponible</dd>
          </div>
        )}
      </dl>

      <section className="celestial-target__vis" aria-label="Visibilité">
        <p className="celestial-target__vis-status">
          {visibilityStatusLabel(info.visibility.status)}
        </p>
        <div className="celestial-target__vis-times">
          <div>
            <span>Lever</span>
            <strong>
              {info.visibility.rise?.datetimeLocal ??
                (info.visibility.status === 'circumpolar'
                  ? '—'
                  : info.visibility.status === 'never_rises'
                    ? '—'
                    : '—')}
            </strong>
          </div>
          <div>
            <span>Culmination</span>
            <strong>{info.visibility.culmination?.datetimeLocal ?? '—'}</strong>
          </div>
          <div>
            <span>Coucher</span>
            <strong>
              {info.visibility.set?.datetimeLocal ??
                (info.visibility.status === 'circumpolar' ? '—' : '—')}
            </strong>
          </div>
        </div>
        {object.type === 'constellation' ? (
          <p className="celestial-target__note">
            Horaires pour le point de référence de la constellation, pas pour
            toute sa surface.
          </p>
        ) : null}
        <p className="celestial-target__note">{info.visibility.horizonNote}</p>
        {info.visibility.multiplePassages ? (
          <p className="celestial-target__note">
            Plusieurs passages possibles ce jour — premier franchissement
            affiché.
          </p>
        ) : null}
      </section>

      {belowHorizon ? (
        <p className="celestial-target__warn" role="status">
          Sous l’horizon à l’instant sélectionné
          {pitchClamped ? ' (hors plage de pointage caméra ±85°)' : ''}.
        </p>
      ) : null}

      <div className="celestial-target__actions">
        <button
          type="button"
          className="celestial-target__center"
          disabled={!canCenter || !info.position || pitchClamped}
          onClick={onCenter}
        >
          Centrer sur la cible
        </button>
      </div>
    </aside>
  )
}
