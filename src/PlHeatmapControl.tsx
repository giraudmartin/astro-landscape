import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useT } from './i18n'

type PlHeatmapControlProps = {
  enabled: boolean
  /** True while the heatmap is fetching tiles before the first reveal. */
  loading?: boolean
  opacity: number
  onEnabledChange: (next: boolean) => void
  /** Live drag updates (may be coalesced upstream). */
  onOpacityChange: (next: number) => void
  /** Pointer/keyboard commit — flush persisted state. */
  onOpacityCommit?: (next: number) => void
  /** Bortle legend panel visibility (info toggle on the PL bar). */
  legendOpen?: boolean
  onLegendOpenChange?: (next: boolean) => void
}

const OP_MIN = 0.15
const OP_MAX = 1
/**
 * Must match `.pl-heatmap-control__groove` top/bottom inset in App.css.
 * Hit-testing and thumb travel share this pad so % matches the visual.
 */
const TRACK_PAD_PX = 9

function clampOpacity(value: number): number {
  return Math.min(OP_MAX, Math.max(OP_MIN, value))
}

/** Map pointer Y on the track to opacity — same range as the thumb/groove. */
export function opacityFromTrackClientY(
  clientY: number,
  trackTop: number,
  trackHeight: number,
): number {
  if (trackHeight <= 0) return OP_MIN
  const usable = trackHeight - 2 * TRACK_PAD_PX
  if (usable <= 0) return OP_MIN
  // Top of groove = max opacity, bottom = min.
  const t = 1 - (clientY - trackTop - TRACK_PAD_PX) / usable
  return clampOpacity(OP_MIN + Math.min(1, Math.max(0, t)) * (OP_MAX - OP_MIN))
}

/** Standalone control below the map button group — toggle + vertical opacity. */
export function PlHeatmapControl({
  enabled,
  loading = false,
  opacity,
  onEnabledChange,
  onOpacityChange,
  onOpacityCommit,
  legendOpen = false,
  onLegendOpenChange,
}: PlHeatmapControlProps) {
  const tr = useT()
  const trackRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  // Local value so the thumb tracks the pointer without waiting on App re-render.
  const [liveOpacity, setLiveOpacity] = useState(() => clampOpacity(opacity))
  const liveOpacityRef = useRef(liveOpacity)

  useEffect(() => {
    if (draggingRef.current) return
    const next = clampOpacity(opacity)
    liveOpacityRef.current = next
    setLiveOpacity(next)
  }, [opacity])

  const commitLive = useCallback(
    (next: number) => {
      const opacityNext = clampOpacity(next)
      liveOpacityRef.current = opacityNext
      setLiveOpacity(opacityNext)
      onOpacityChange(opacityNext)
    },
    [onOpacityChange],
  )

  const finishDrag = useCallback(() => {
    draggingRef.current = false
    ;(onOpacityCommit ?? onOpacityChange)(liveOpacityRef.current)
  }, [onOpacityChange, onOpacityCommit])

  const pct = Math.round(liveOpacity * 100)
  const t = (clampOpacity(liveOpacity) - OP_MIN) / (OP_MAX - OP_MIN)

  const setFromClientY = useCallback(
    (clientY: number) => {
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      // During open animation the track can be clipped — don't map on a dead height.
      if (rect.height < 24) return
      commitLive(opacityFromTrackClientY(clientY, rect.top, rect.height))
    },
    [commitLive],
  )

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    event.preventDefault()
    event.stopPropagation()
    draggingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    setFromClientY(event.clientY)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    setFromClientY(event.clientY)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (draggingRef.current) finishDrag()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled) return
    const step = event.shiftKey ? 0.1 : 0.05
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      commitLive(liveOpacityRef.current + step)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      commitLive(liveOpacityRef.current - step)
    } else if (event.key === 'Home') {
      event.preventDefault()
      commitLive(OP_MAX)
    } else if (event.key === 'End') {
      event.preventDefault()
      commitLive(OP_MIN)
    }
  }

  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled) return
    if (
      event.key === 'ArrowUp' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowDown' ||
      event.key === 'ArrowLeft' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      ;(onOpacityCommit ?? onOpacityChange)(liveOpacityRef.current)
    }
  }

  const className = [
    'pl-heatmap-control',
    enabled ? 'pl-heatmap-control--on' : '',
    loading ? 'pl-heatmap-control--loading' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      style={{ ['--pl-t' as string]: String(t) }}
    >
      <button
        type="button"
        className="pl-heatmap-control__toggle"
        data-pl-heatmap-toggle=""
        data-loading={loading ? 'true' : undefined}
        aria-pressed={enabled}
        aria-busy={loading}
        aria-label={
          loading
            ? tr('map.pl.loading')
            : enabled
              ? tr('map.pl.toggleOn')
              : tr('map.pl.toggleOff')
        }
        title={loading ? tr('map.pl.loading') : tr('map.pl.title')}
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

      <div className="pl-heatmap-control__slider" aria-hidden={!enabled}>
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
            aria-valuetext={tr('map.pl.opacityValueText', { pct })}
            aria-label={tr('map.pl.opacityAria')}
            aria-disabled={!enabled}
            title={tr('map.pl.opacityTitle', { pct })}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
          >
            <div className="pl-heatmap-control__groove" aria-hidden="true">
              <div className="pl-heatmap-control__fill" />
            </div>
            <div className="pl-heatmap-control__thumb" aria-hidden="true" />
          </div>
        </div>
      </div>

      {enabled && onLegendOpenChange ? (
        <button
          type="button"
          className={
            legendOpen
              ? 'pl-heatmap-control__info is-active'
              : 'pl-heatmap-control__info'
          }
          aria-pressed={legendOpen}
          aria-label={
            legendOpen ? tr('map.pl.legendHide') : tr('map.pl.legendShow')
          }
          title={
            legendOpen ? tr('map.pl.legendHide') : tr('map.pl.legendShow')
          }
          onClick={() => onLegendOpenChange(!legendOpen)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 10.5v6.5" />
            <circle
              cx="12"
              cy="7.25"
              r="1.25"
              fill="currentColor"
              stroke="none"
            />
          </svg>
        </button>
      ) : null}
    </div>
  )
}
