import type { ChangeEvent, SyntheticEvent } from 'react'
import { useT } from './i18n'
import {
  CompactCloseIcon,
  CompactPauseIcon,
  CompactPlayIcon,
  CompactReplayIcon,
  CompactStopIcon,
  SettingsSlidersIcon,
} from './psIcons'
import type { TimelapsePreviewPhase } from './useTimelapsePreview'

type TimelapsePreviewHudProps = {
  phase: TimelapsePreviewPhase
  shotIndex: number
  shotCount: number
  /** 0 / 90 / 180 / 270 — visual render rotation only. */
  renderRollDeg: number
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onReplay: () => void
  onExit: () => void
  onOpenSettings: () => void
  onSeek: (shotIndex: number) => void
  /** Rotate the preview render 90° CW (does not touch DSLR settings). */
  onRotateRender: () => void
}

function stopProp(event: SyntheticEvent) {
  event.preventDefault()
  event.stopPropagation()
}

/** Lucide rotate-cw-square — preview render orientation only. */
function RotateRenderIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5H6a2 2 0 0 0-2 2v3" />
      <path d="m9 8 3-3-3-3" />
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
    </svg>
  )
}

/**
 * Bottom playback capsule — compact strip aligned with capture chrome.
 */
export function TimelapsePreviewHud({
  phase,
  shotIndex,
  shotCount,
  renderRollDeg,
  onPause,
  onResume,
  onStop,
  onReplay,
  onExit,
  onOpenSettings,
  onSeek,
  onRotateRender,
}: TimelapsePreviewHudProps) {
  const t = useT()
  if (phase === 'idle') return null

  const ended = phase === 'ended'
  const paused = phase === 'paused'
  const total = Math.max(shotCount, 1)
  const current = Math.min(shotIndex + 1, total)
  const progress = ended ? 100 : (current / total) * 100

  const primaryLabel = ended
    ? t('immersive.tlapse.replay')
    : paused
      ? t('immersive.tlapse.resume')
      : t('immersive.tlapse.pause')
  const PrimaryIcon = ended
    ? CompactReplayIcon
    : paused
      ? CompactPlayIcon
      : CompactPauseIcon

  const onRangeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value)
    if (!Number.isFinite(value)) return
    onSeek(value - 1)
  }

  const rotated = renderRollDeg !== 0

  return (
    <div
      className={ended ? 'tlapse-hud is-ended' : 'tlapse-hud'}
      role="status"
      aria-live="polite"
    >
      <div className="tlapse-hud__row">
        <button
          type="button"
          className="tlapse-hud__btn tlapse-hud__btn--primary"
          onClick={(event) => {
            stopProp(event)
            if (ended) onReplay()
            else if (paused) onResume()
            else onPause()
          }}
          onPointerDown={stopProp}
          title={primaryLabel}
          aria-label={primaryLabel}
        >
          <PrimaryIcon size={18} />
        </button>

        <div className="tlapse-hud__track">
          <input
            type="range"
            className="tlapse-hud__range"
            min={1}
            max={total}
            step={1}
            value={current}
            style={{ ['--progress' as string]: `${progress}%` }}
            aria-label={t('immersive.tlapse.seekAria')}
            onChange={onRangeChange}
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
            }}
          />
        </div>

        <span className="tlapse-hud__count">
          {current}
          <em>
            {' '}
            / {shotCount}
          </em>
        </span>

        <span className="tlapse-hud__divider" aria-hidden="true" />

        {!ended ? (
          <button
            type="button"
            className="tlapse-hud__btn tlapse-hud__btn--stop"
            onClick={(event) => {
              stopProp(event)
              onStop()
            }}
            onPointerDown={stopProp}
            title={t('immersive.tlapse.stop')}
            aria-label={t('immersive.tlapse.stop')}
          >
            <CompactStopIcon size={18} />
          </button>
        ) : null}

        <button
          type="button"
          className={
            rotated
              ? 'tlapse-hud__btn tlapse-hud__btn--rotate is-hot'
              : 'tlapse-hud__btn tlapse-hud__btn--rotate'
          }
          onClick={(event) => {
            stopProp(event)
            onRotateRender()
          }}
          onPointerDown={stopProp}
          title={t('immersive.tlapse.rotateTitle')}
          aria-label={t('immersive.tlapse.rotateAria')}
        >
          <RotateRenderIcon size={18} />
        </button>

        <button
          type="button"
          className="tlapse-hud__btn tlapse-hud__btn--ghost"
          onClick={(event) => {
            stopProp(event)
            onOpenSettings()
          }}
          onPointerDown={stopProp}
          title={t('immersive.tlapse.settings')}
          aria-label={t('immersive.tlapse.settings')}
        >
          <SettingsSlidersIcon size={18} />
        </button>

        <button
          type="button"
          className="tlapse-hud__btn tlapse-hud__btn--exit"
          onClick={(event) => {
            stopProp(event)
            onExit()
          }}
          onPointerDown={stopProp}
          title={t('immersive.tlapse.exit')}
          aria-label={t('immersive.tlapse.exit')}
        >
          <CompactCloseIcon size={18} />
        </button>
      </div>
    </div>
  )
}
