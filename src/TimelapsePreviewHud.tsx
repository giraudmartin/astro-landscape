import type { ChangeEvent, SyntheticEvent } from 'react'
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
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onReplay: () => void
  onExit: () => void
  onOpenSettings: () => void
  onSeek: (shotIndex: number) => void
}

function stopProp(event: SyntheticEvent) {
  event.preventDefault()
  event.stopPropagation()
}

/**
 * Bottom playback capsule — compact strip aligned with capture chrome.
 */
export function TimelapsePreviewHud({
  phase,
  shotIndex,
  shotCount,
  onPause,
  onResume,
  onStop,
  onReplay,
  onExit,
  onOpenSettings,
  onSeek,
}: TimelapsePreviewHudProps) {
  if (phase === 'idle') return null

  const ended = phase === 'ended'
  const paused = phase === 'paused'
  const total = Math.max(shotCount, 1)
  const current = Math.min(shotIndex + 1, total)
  const progress = ended ? 100 : (current / total) * 100

  const primaryLabel = ended ? 'Rejouer' : paused ? 'Reprendre' : 'Pause'
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
            aria-label="Image de la séquence"
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

        <button
          type="button"
          className="tlapse-hud__btn tlapse-hud__btn--ghost"
          onClick={(event) => {
            stopProp(event)
            onOpenSettings()
          }}
          onPointerDown={stopProp}
          title="Réglages timelapse"
          aria-label="Réglages timelapse"
        >
          <SettingsSlidersIcon size={18} />
        </button>

        {!ended ? (
          <button
            type="button"
            className="tlapse-hud__btn tlapse-hud__btn--stop"
            onClick={(event) => {
              stopProp(event)
              onStop()
            }}
            onPointerDown={stopProp}
            title="Arrêter et revenir au début"
            aria-label="Arrêter et revenir au début"
          >
            <CompactStopIcon size={18} />
          </button>
        ) : null}

        <button
          type="button"
          className="tlapse-hud__btn tlapse-hud__btn--exit"
          onClick={(event) => {
            stopProp(event)
            onExit()
          }}
          onPointerDown={stopProp}
          title="Quitter la lecture"
          aria-label="Quitter la lecture"
        >
          <CompactCloseIcon size={18} />
        </button>
      </div>
    </div>
  )
}
