import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  buildObjectLiveInfo,
  celestialObjectDisplayName,
  horizonNote,
  typeLabel,
  type CelestialObject,
} from './celestialObjects'
import { useT } from './i18n'
import { OPERATE_PHONE_MQ, useMatchMedia } from './useMatchMedia'

type CelestialTargetCardProps = {
  object: CelestialObject
  date: string
  playheadUtcMs: number
  lat: number
  lon: number
  elevationM: number
  canCenter: boolean
  targetLocked: boolean
  onToggleTargetLock: () => void
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
    .filter((a) => a !== object.name && a !== celestialObjectDisplayName(object))
    .slice(0, 3)
  for (const a of extras) {
    if (!parts.includes(a)) parts.push(a)
  }
  return parts.length ? parts.join(' · ') : null
}

function visibilityStatusLabel(
  status: ReturnType<typeof buildObjectLiveInfo>['visibility']['status'],
  t: ReturnType<typeof useT>,
): string {
  switch (status) {
    case 'circumpolar':
      return t('celestial.target.status.circumpolar')
    case 'never_rises':
      return t('celestial.target.status.never')
    case 'unknown':
      return t('celestial.target.status.unknown')
    default:
      return t('celestial.target.status.riseSet')
  }
}

/** Lucide-style crosshair — lock view on the selected target. */
function TargetLockIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  )
}

export function CelestialTargetCard({
  object,
  date,
  playheadUtcMs,
  lat,
  lon,
  elevationM,
  canCenter,
  targetLocked,
  onToggleTargetLock,
  onCenter,
  onClose,
}: CelestialTargetCardProps) {
  const t = useT()
  const isPhone = useMatchMedia(OPERATE_PHONE_MQ)
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
  const canAim = canCenter && info.position != null && !pitchClamped

  const card = (
    <aside
      className={
        isPhone ? 'celestial-target celestial-target--sheet' : 'celestial-target'
      }
      aria-label={t('celestial.target.aria')}
    >
      <header className="celestial-target__header">
        <div className="celestial-target__titles">
          <p className="celestial-target__type">
            {typeLabel(object.type)}
          </p>
          <h2 className="celestial-target__name">{celestialObjectDisplayName(object)}</h2>
          {ids ? <p className="celestial-target__ids">{ids}</p> : null}
        </div>
        <button
          type="button"
          className="celestial-target__close"
          aria-label={t('celestial.target.close')}
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
            <dt>{t('celestial.target.mag')}</dt>
            <dd>{object.mag.toFixed(1)}</dd>
          </div>
        ) : null}
        {info.constellationLabel ? (
          <div>
            <dt>{t('celestial.target.constellation')}</dt>
            <dd>{info.constellationLabel}</dd>
          </div>
        ) : null}
        {info.position ? (
          <>
            <div>
              <dt>{t('celestial.target.azimuth')}</dt>
              <dd>{formatAz(info.position.azimuthDeg)}</dd>
            </div>
            <div>
              <dt>{t('celestial.target.altitude')}</dt>
              <dd>{formatDeg(info.position.altitudeDeg)}</dd>
            </div>
          </>
        ) : (
          <div className="celestial-target__span">
            <dt>{t('celestial.target.position')}</dt>
            <dd>{t('celestial.target.unavailable')}</dd>
          </div>
        )}
      </dl>

      <section className="celestial-target__vis" aria-label={t('celestial.target.visAria')}>
        <p className="celestial-target__vis-status">
          {visibilityStatusLabel(info.visibility.status, t)}
        </p>
        <div className="celestial-target__vis-times">
          <div>
            <span>{t('celestial.target.rise')}</span>
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
            <span>{t('celestial.target.culmination')}</span>
            <strong>{info.visibility.culmination?.datetimeLocal ?? '—'}</strong>
          </div>
          <div>
            <span>{t('celestial.target.set')}</span>
            <strong>
              {info.visibility.set?.datetimeLocal ??
                (info.visibility.status === 'circumpolar' ? '—' : '—')}
            </strong>
          </div>
        </div>
        {object.type === 'constellation' ? (
          <p className="celestial-target__note">
            {t('celestial.target.constNote')}
          </p>
        ) : null}
        <p className="celestial-target__note">{horizonNote()}</p>
        {info.visibility.multiplePassages ? (
          <p className="celestial-target__note">
            {t('celestial.target.multiPass')}
          </p>
        ) : null}
      </section>

      {belowHorizon ? (
        <p className="celestial-target__warn" role="status">
          {t('celestial.target.belowHorizon')}
          {pitchClamped ? ` ${t('celestial.target.pitchClamp')}` : ''}.
        </p>
      ) : null}

      <div className="celestial-target__actions">
        <button
          type="button"
          className={
            targetLocked
              ? 'celestial-target__lock is-locked'
              : 'celestial-target__lock'
          }
          disabled={!canAim && !targetLocked}
          aria-pressed={targetLocked}
          title={
            targetLocked
              ? t('celestial.target.unlockTitle')
              : t('celestial.target.lockTitle')
          }
          aria-label={
            targetLocked
              ? t('celestial.target.unlock')
              : t('celestial.target.lock')
          }
          onClick={onToggleTargetLock}
        >
          <TargetLockIcon />
        </button>
        <button
          type="button"
          className="celestial-target__center"
          disabled={!canAim}
          onClick={onCenter}
        >
          {t('celestial.target.center')}
        </button>
      </div>
    </aside>
  )

  if (!isPhone) return card
  if (typeof document === 'undefined') return null
  const host = document.querySelector('.immersive')
  if (!host) return card
  return createPortal(card, host)
}
