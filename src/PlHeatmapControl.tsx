import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react'

type PlHeatmapControlProps = {
  enabled: boolean
  opacity: number
  onEnabledChange: (next: boolean) => void
  onOpacityChange: (next: number) => void
}

const OP_MIN = 0.15
const OP_MAX = 1

function clampOpacity(value: number): number {
  return Math.min(OP_MAX, Math.max(OP_MIN, value))
}

/** Standalone control below the map button group — toggle + vertical opacity. */
export function PlHeatmapControl({
  enabled,
  opacity,
  onEnabledChange,
  onOpacityChange,
}: PlHeatmapControlProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const pct = Math.round(opacity * 100)
  const t = (clampOpacity(opacity) - OP_MIN) / (OP_MAX - OP_MIN)

  const setFromClientY = useCallback(
    (clientY: number) => {
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      if (rect.height <= 0) return
      // Top = max opacity, bottom = min.
      const next =
        OP_MAX - ((clientY - rect.top) / rect.height) * (OP_MAX - OP_MIN)
      onOpacityChange(clampOpacity(next))
    },
    [onOpacityChange],
  )

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    event.preventDefault()
    draggingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    setFromClientY(event.clientY)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    setFromClientY(event.clientY)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled) return
    const step = event.shiftKey ? 0.1 : 0.05
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      onOpacityChange(clampOpacity(opacity + step))
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      onOpacityChange(clampOpacity(opacity - step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      onOpacityChange(OP_MAX)
    } else if (event.key === 'End') {
      event.preventDefault()
      onOpacityChange(OP_MIN)
    }
  }

  return (
    <div
      className={
        enabled
          ? 'pl-heatmap-control pl-heatmap-control--on'
          : 'pl-heatmap-control'
      }
      style={{ ['--pl-t' as string]: String(t) }}
    >
      <button
        type="button"
        className="pl-heatmap-control__toggle"
        data-pl-heatmap-toggle=""
        aria-pressed={enabled}
        aria-label={
          enabled
            ? 'Masquer la heatmap pollution lumineuse'
            : 'Afficher la heatmap pollution lumineuse'
        }
        title="Heatmap pollution lumineuse"
        onClick={() => onEnabledChange(!enabled)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      </button>

      <div
        className="pl-heatmap-control__slider"
        aria-hidden={!enabled}
      >
        <div className="pl-heatmap-control__slider-inner">
          <div
            ref={trackRef}
            className="pl-heatmap-control__track"
            role="slider"
            tabIndex={enabled ? 0 : -1}
            aria-orientation="vertical"
            aria-valuemin={Math.round(OP_MIN * 100)}
            aria-valuemax={Math.round(OP_MAX * 100)}
            aria-valuenow={pct}
            aria-valuetext={`${pct} pour cent`}
            aria-label="Opacité de la heatmap"
            aria-disabled={!enabled}
            title={`Opacité ${pct}%`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
          >
            <div className="pl-heatmap-control__groove" aria-hidden="true">
              <div className="pl-heatmap-control__fill" />
            </div>
            <div className="pl-heatmap-control__thumb" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  )
}
