import { useEffect, useMemo, useRef, useState } from 'react'
import {
  civilDayStartUtcMs,
  civilFractionFromUtc,
  type DayInfo,
  type HorizonKind,
} from './celestial'
import { dayLightGradientCssAlongUtc } from './dayLight'

export const TIMELINE_VISIBLE_RADIUS_STEPS_MS = [
  15 * 60_000,
  30 * 60_000,
  55 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
  8 * 60 * 60_000,
] as const

export const TIMELINE_DEFAULT_ZOOM_INDEX = 2

const TIMELINE_TICK_STEPS_MS = [
  1 * 60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  3 * 60 * 60_000,
  4 * 60 * 60_000,
] as const

const TIMELINE_MIN_TICK_PX = 36

function pickTickStepMs(pxPerMs: number): number {
  for (const step of TIMELINE_TICK_STEPS_MS) {
    if (step * pxPerMs >= TIMELINE_MIN_TICK_PX) return step
  }
  return TIMELINE_TICK_STEPS_MS[TIMELINE_TICK_STEPS_MS.length - 1]!
}

function formatTick(utcMs: number, lon: number, stepMs: number): string {
  const iso = new Date(utcMs + Math.round(lon / 15) * 3600_000).toISOString()
  const hour = iso.slice(11, 13)
  const minute = iso.slice(14, 16)
  // Midnight: show the civil date so multi-day scrub reads like Photo Sightline.
  if (hour === '00' && minute === '00') {
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
  }
  if (stepMs >= 60 * 60_000) return hour
  return `${hour}:${minute}`
}

type Mark = {
  kind: HorizonKind
  utcMs: number
  label: string
}

type DayTimelineProps = {
  dayInfo: DayInfo
  playheadUtcMs: number
  onPlayheadChange: (utcMs: number) => void
  zoomIndex: number
  jumpRequest?: number
  onHorizonEventClick?: (kind: HorizonKind) => void
}

/**
 * Film-strip scrubber (same as Photo Sightline):
 * drag right → earlier time (grab the world under a fixed caret).
 * Absolute click-to-position on a centered window causes yoyo jitter.
 */
export function DayTimeline({
  dayInfo,
  playheadUtcMs,
  onPlayheadChange,
  zoomIndex,
  jumpRequest = 0,
  onHorizonEventClick,
}: DayTimelineProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(320)
  const [scrubbing, setScrubbing] = useState(false)
  const dragRef = useRef<{
    active: boolean
    lastX: number
    utcMs: number
  }>({ active: false, lastX: 0, utcMs: 0 })
  const scrubRef = useRef<{
    pxPerMs: number
    setUtcMs: (ms: number) => void
  }>({
    pxPerMs: 0,
    setUtcMs: () => {},
  })

  const radius =
    TIMELINE_VISIBLE_RADIUS_STEPS_MS[
      Math.max(0, Math.min(zoomIndex, TIMELINE_VISIBLE_RADIUS_STEPS_MS.length - 1))
    ]!

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 320))
    ro.observe(el)
    setWidth(el.clientWidth || 320)
    return () => ro.disconnect()
  }, [])

  const dayStart = civilDayStartUtcMs(dayInfo.date, dayInfo.lon)
  const dayEnd = dayStart + 24 * 60 * 60_000
  const lon = dayInfo.lon

  const marks = useMemo(() => {
    const list: Mark[] = []
    const push = (kind: HorizonKind, utc: string | undefined, label: string) => {
      if (!utc) return
      const ms = Date.parse(utc)
      if (!Number.isFinite(ms)) return
      if (ms < dayStart - 60_000 || ms > dayEnd + 60_000) return
      list.push({ kind, utcMs: ms, label })
    }
    push('sunrise', dayInfo.sunrise?.datetimeUtc, '↑☉')
    push('sunset', dayInfo.sunset?.datetimeUtc, '↓☉')
    push('moonrise', dayInfo.moonrise?.datetimeUtc, '↑☾')
    push('moonset', dayInfo.moonset?.datetimeUtc, '↓☾')
    return list
  }, [dayInfo, dayStart, dayEnd])

  const sunriseFrac = dayInfo.sunrise
    ? civilFractionFromUtc(Date.parse(dayInfo.sunrise.datetimeUtc), lon)
    : null
  const sunsetFrac = dayInfo.sunset
    ? civilFractionFromUtc(Date.parse(dayInfo.sunset.datetimeUtc), lon)
    : null

  const windowStart = playheadUtcMs - radius
  const windowEnd = playheadUtcMs + radius
  const span = Math.max(windowEnd - windowStart, 1)
  const pxPerMs = width / span

  const gradient = useMemo(
    () =>
      dayLightGradientCssAlongUtc(
        windowStart,
        windowEnd,
        sunriseFrac,
        sunsetFrac,
        (utcMs) => civilFractionFromUtc(utcMs, lon),
      ),
    [windowStart, windowEnd, sunriseFrac, sunsetFrac, lon],
  )

  const tickStep = pickTickStepMs(pxPerMs)
  const ticks: Array<{ utcMs: number; label: string; major: boolean }> = []
  const firstTick = Math.ceil(windowStart / tickStep) * tickStep
  for (let t = firstTick; t <= windowEnd; t += tickStep) {
    const label = formatTick(t, lon, tickStep)
    const isMidnight = label.includes('/')
    ticks.push({
      utcMs: t,
      label,
      major: isMidnight || t % (60 * 60_000) === 0,
    })
  }

  const xFor = (utcMs: number) => ((utcMs - windowStart) / span) * width

  useEffect(() => {
    if (!jumpRequest) return
  }, [jumpRequest])

  // Unbounded scrub — same as Photo Sightline: cross midnight into any day.
  const setUtcMs = (utcMs: number) => {
    if (!Number.isFinite(utcMs)) return
    onPlayheadChange(utcMs)
  }

  scrubRef.current = { pxPerMs, setUtcMs }

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      const scrub = scrubRef.current
      if (!drag.active || !(scrub.pxPerMs > 0)) return
      const dx = event.clientX - drag.lastX
      drag.lastX = event.clientX
      // PS: drag right → earlier (strip follows the finger under a fixed caret).
      drag.utcMs = drag.utcMs - dx / scrub.pxPerMs
      scrub.setUtcMs(drag.utcMs)
    }
    const onUp = () => {
      dragRef.current.active = false
      setScrubbing(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  return (
    <div
      className={
        scrubbing
          ? 'moon-preview-timeline moon-preview-timeline--compact is-scrubbing'
          : 'moon-preview-timeline moon-preview-timeline--compact'
      }
    >
      <div
        ref={viewportRef}
        className="moon-preview-timeline__viewport"
        role="slider"
        tabIndex={0}
        aria-valuenow={playheadUtcMs}
        aria-label="Timeline"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          dragRef.current = {
            active: true,
            lastX: event.clientX,
            utcMs: playheadUtcMs,
          }
          setScrubbing(true)
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 15 * 60_000 : 60_000
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            setUtcMs(playheadUtcMs - step)
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            setUtcMs(playheadUtcMs + step)
          }
        }}
      >
        <div
          className="moon-preview-timeline__strip"
          style={{ width, transform: 'translateX(0)' }}
        >
          <div className="moon-preview-timeline__hours">
            {ticks.map((tick) => (
              <span
                key={tick.utcMs}
                className={
                  tick.major
                    ? 'moon-preview-timeline__hour moon-preview-timeline__hour--major'
                    : 'moon-preview-timeline__hour'
                }
                style={{ left: xFor(tick.utcMs) }}
              >
                {tick.label}
              </span>
            ))}
          </div>
          <div
            className="moon-preview-timeline__gradient"
            style={{ background: gradient }}
          />
          {marks.map((mark) => {
            const left = xFor(mark.utcMs)
            if (left < -20 || left > width + 20) return null
            return (
              <button
                key={`${mark.kind}-${mark.utcMs}`}
                type="button"
                className={`moon-preview-timeline__mark moon-preview-timeline__mark--button moon-preview-timeline__mark--${mark.kind}`}
                style={{ left }}
                title={mark.kind}
                aria-label={mark.kind}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onPlayheadChange(mark.utcMs)
                  onHorizonEventClick?.(mark.kind)
                }}
              >
                <span className="moon-preview-timeline__mark-dot" />
                <span className="moon-preview-timeline__mark-label">
                  {mark.label}
                </span>
              </button>
            )
          })}
        </div>
        <span className="moon-preview-timeline__caret moon-preview-timeline__caret--top" />
        <span className="moon-preview-timeline__caret moon-preview-timeline__caret--bottom" />
      </div>
    </div>
  )
}
