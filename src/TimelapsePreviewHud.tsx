import type { SyntheticEvent } from 'react'
import {
  PauseSequenceIcon,
  PlaySequenceIcon,
  StopSequenceIcon,
} from './psIcons'
import type { TimelapsePreviewPhase } from './useTimelapsePreview'

type TimelapsePreviewHudProps = {
  phase: TimelapsePreviewPhase
  shotIndex: number
  shotCount: number
  onPause: () => void
  onResume: () => void
  onStopToEnded: () => void
  onReplay: () => void
  onExit: () => void
}

function stopProp(event: SyntheticEvent) {
  event.preventDefault()
  event.stopPropagation()
}

/**
 * Bottom playback strip — replaces the timeline while active.
 */
export function TimelapsePreviewHud({
  phase,
  shotIndex,
  shotCount,
  onPause,
  onResume,
  onStopToEnded,
  onReplay,
  onExit,
}: TimelapsePreviewHudProps) {
  if (phase === 'idle') return null

  const progress = shotCount > 0 ? ((shotIndex + 1) / shotCount) * 100 : 0

  const ended = phase === 'ended'
  const paused = phase === 'paused'

  return (
    <div
      className={ended ? 'tlapse-hud is-ended' : 'tlapse-hud'}
      role="status"
      aria-live="polite"
    >
      <div className="tlapse-hud__bar" aria-hidden="true">
        <span
          className="tlapse-hud__bar-fill"
          style={{ width: `${ended ? 100 : progress}%` }}
        />
      </div>
      <div className="tlapse-hud__row">
        <div className="tlapse-hud__actions">
          {ended ? (
            <>
              <button
                type="button"
                className="tlapse-hud__btn tlapse-hud__btn--primary"
                onClick={(event) => {
                  stopProp(event)
                  onReplay()
                }}
                onPointerDown={stopProp}
                title="Rejouer la séquence"
                aria-label="Rejouer la séquence"
              >
                <PlaySequenceIcon size={15} />
                Rejouer
              </button>
              <button
                type="button"
                className="tlapse-hud__btn tlapse-hud__btn--ghost"
                onClick={(event) => {
                  stopProp(event)
                  onExit()
                }}
                onPointerDown={stopProp}
                title="Quitter le mode lecture"
                aria-label="Quitter le mode lecture"
              >
                Quitter la lecture
              </button>
            </>
          ) : (
            <>
              {paused ? (
                <button
                  type="button"
                  className="tlapse-hud__btn tlapse-hud__btn--primary"
                  onClick={(event) => {
                    stopProp(event)
                    onResume()
                  }}
                  onPointerDown={stopProp}
                  title="Reprendre"
                  aria-label="Reprendre"
                >
                  <PlaySequenceIcon size={15} />
                  Reprendre
                </button>
              ) : (
                <button
                  type="button"
                  className="tlapse-hud__btn tlapse-hud__btn--primary"
                  onClick={(event) => {
                    stopProp(event)
                    onPause()
                  }}
                  onPointerDown={stopProp}
                  title="Pause"
                  aria-label="Pause"
                >
                  <PauseSequenceIcon size={15} />
                  Pause
                </button>
              )}
              <button
                type="button"
                className="tlapse-hud__btn tlapse-hud__btn--stop"
                onClick={(event) => {
                  stopProp(event)
                  onStopToEnded()
                }}
                onPointerDown={stopProp}
                title="Arrêter (écran de fin)"
                aria-label="Arrêter"
              >
                <StopSequenceIcon size={15} />
                Stop
              </button>
            </>
          )}
        </div>

        <div className="tlapse-hud__status">
          <span className="tlapse-hud__count">
            {shotIndex + 1}
            <span className="tlapse-hud__slash">/</span>
            {shotCount}
            {paused ? <span className="tlapse-hud__badge">pause</span> : null}
            {ended ? <span className="tlapse-hud__badge">fin</span> : null}
          </span>
        </div>
      </div>
    </div>
  )
}
