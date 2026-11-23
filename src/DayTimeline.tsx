import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  civilDayStartUtcMs,
  civilFractionFromUtc,
  galacticCenterAltitudeDegAt,
  moonAltitudeDegAt,
  sunAltitudeDegAt,
  type DayInfo,
  type HorizonKind,
} from './celestial'
import { dayLightGradientCssAlongUtc } from './dayLight'
import { useT } from './i18n'

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

/**
 * Symmetric altitude frame so the horizon (0°) sits in the vertical middle.
 * Values outside the frame are not clamped — paths exit and clip cleanly
 * (no flat “ceiling / floor” segments).
 */
const CHART_ALT_MIN_DEG = -50
const CHART_ALT_MAX_DEG = 50
const CHART_BAND_HEIGHT_PX = 128
const CHART_INNER_PAD_PX = 10

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

function polylinePath(
  xs: number[],
  alts: number[],
  yFor: (alt: number) => number,
): string {
  if (xs.length === 0) return ''
  let d = `M ${xs[0]!.toFixed(2)} ${yFor(alts[0]!).toFixed(2)}`
  for (let i = 1; i < xs.length; i += 1) {
    d += ` L ${xs[i]!.toFixed(2)} ${yFor(alts[i]!).toFixed(2)}`
  }
  return d
}

function markLabel(kind: HorizonKind, t: ReturnType<typeof useT>): string {
  return t(`celestial.schedule.${kind}`)
}

type Mark = {
  kind: HorizonKind
  utcMs: number
}

type DayTimelineProps = {
  dayInfo: DayInfo
  elevationM: number
  playheadUtcMs: number
  onScrubbingChange?: (active: boolean) => void
  onPlayheadChange: (utcMs: number) => void
  zoomIndex: number
  jumpRequest?: number
  onHorizonEventClick?: (kind: HorizonKind) => void
  /** Expand the day-light band into an altitude chart. */
  advanced?: boolean
}

/**
 * Film-strip scrubber (same as Photo Sightline):
 * drag right → earlier time (grab the world under a fixed caret).
 * Absolute click-to-position on a centered window causes yoyo jitter.
 */
export function DayTimeline({
  dayInfo,
  elevationM,
  playheadUtcMs,
  onPlayheadChange,
  onScrubbingChange,
  zoomIndex,
  jumpRequest = 0,
  onHorizonEventClick,
  advanced = false,
}: DayTimelineProps) {
  const t = useT()
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const chartDomId = useId().replace(/:/g, '')
  const clipId = `tl-curve-clip-${chartDomId}`
  const glowId = `tl-curve-glow-${chartDomId}`
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
  const lat = dayInfo.lat

  const marks = useMemo(() => {
    const list: Mark[] = []
    const push = (kind: HorizonKind, utc: string | undefined) => {
      if (!utc) return
      const ms = Date.parse(utc)
      if (!Number.isFinite(ms)) return
      if (ms < dayStart - 60_000 || ms > dayEnd + 60_000) return
      list.push({ kind, utcMs: ms })
    }
    push('sunrise', dayInfo.sunrise?.datetimeUtc)
    push('sunset', dayInfo.sunset?.datetimeUtc)
    push('moonrise', dayInfo.moonrise?.datetimeUtc)
    push('moonset', dayInfo.moonset?.datetimeUtc)
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

  // Quantize the sample window so fine scrub does not recompute every frame.
  const sampleBucketMs = 2 * 60_000
  const sampleStart = Math.floor(windowStart / sampleBucketMs) * sampleBucketMs
  const sampleEnd = Math.ceil(windowEnd / sampleBucketMs) * sampleBucketMs
  const sampleCount = Math.min(
    96,
    Math.max(advanced ? 48 : 24, Math.round(width / (advanced ? 7 : 12))),
  )

  const altitudeSamples = useMemo(() => {
    if (!advanced) return null
    const times: number[] = []
    const sun: number[] = []
    const moon: number[] = []
    const milky: number[] = []
    const denom = Math.max(1, sampleCount - 1)
    for (let i = 0; i < sampleCount; i += 1) {
      const t = sampleStart + ((sampleEnd - sampleStart) * i) / denom
      times.push(t)
      sun.push(sunAltitudeDegAt(lat, lon, elevationM, t))
      moon.push(moonAltitudeDegAt(lat, lon, elevationM, t))
      milky.push(galacticCenterAltitudeDegAt(lat, lon, elevationM, t))
    }
    return { times, sun, moon, milky }
  }, [
    advanced,
    sampleStart,
    sampleEnd,
    sampleCount,
    lat,
    lon,
    elevationM,
  ])

  const altitudeCurves = useMemo(() => {
    if (!altitudeSamples || !(width > 0)) return null
    const xs = altitudeSamples.times.map(
      (t) => ((t - windowStart) / span) * width,
    )
    return {
      xs,
      sun: altitudeSamples.sun,
      moon: altitudeSamples.moon,
      milky: altitudeSamples.milky,
    }
  }, [altitudeSamples, windowStart, span, width])

  const playheadAlts = useMemo(() => {
    if (!advanced) return null
    return {
      sun: sunAltitudeDegAt(lat, lon, elevationM, playheadUtcMs),
      moon: moonAltitudeDegAt(lat, lon, elevationM, playheadUtcMs),
      milky: galacticCenterAltitudeDegAt(lat, lon, elevationM, playheadUtcMs),
    }
  }, [advanced, lat, lon, elevationM, playheadUtcMs])

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
      if (!dragRef.current.active) return
      dragRef.current.active = false
      onScrubbingChange?.(false)
      setScrubbing(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('blur', onUp)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      if (dragRef.current.active) onUp()
      window.removeEventListener('blur', onUp)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [onScrubbingChange])

  const chartHeight = advanced ? CHART_BAND_HEIGHT_PX : 0
  const plotHeight = Math.max(
    1,
    chartHeight - CHART_INNER_PAD_PX * 2,
  )
  const yForAlt = (alt: number) => {
    const t =
      (CHART_ALT_MAX_DEG - alt) / (CHART_ALT_MAX_DEG - CHART_ALT_MIN_DEG)
    return CHART_INNER_PAD_PX + t * plotHeight
  }
  const horizonY = yForAlt(0)
  const playheadX = width * 0.5
  const altInFrame = (alt: number) =>
    alt >= CHART_ALT_MIN_DEG && alt <= CHART_ALT_MAX_DEG

  return (
    <div
      className={[
        'moon-preview-timeline',
        'moon-preview-timeline--compact',
        advanced ? 'moon-preview-timeline--advanced' : '',
        scrubbing ? 'is-scrubbing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {advanced ? (
        <ul className="moon-preview-timeline__legend" aria-label={t('timeline.curvesAria')}>
          <li>
            <span className="moon-preview-timeline__legend-mark moon-preview-timeline__legend-mark--sun" />
            {t('timeline.legend.sun')}
          </li>
          <li>
            <span className="moon-preview-timeline__legend-mark moon-preview-timeline__legend-mark--moon" />
            {t('timeline.legend.moon')}
          </li>
          <li>
            <span className="moon-preview-timeline__legend-mark moon-preview-timeline__legend-mark--milkyway" />
            {t('timeline.legend.milkyWay')}
          </li>
        </ul>
      ) : null}
      <div
        ref={viewportRef}
        className="moon-preview-timeline__viewport"
        role="slider"
        tabIndex={0}
        aria-valuenow={playheadUtcMs}
        aria-label={t('timeline.region')}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          dragRef.current = {
            active: true,
            lastX: event.clientX,
            utcMs: playheadUtcMs,
          }
          onScrubbingChange?.(true)
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
          {advanced && altitudeCurves ? (
            <svg
              className="moon-preview-timeline__chart"
              width={width}
              height={chartHeight}
              viewBox={`0 0 ${width} ${chartHeight}`}
              aria-hidden="true"
            >
              <defs>
                <clipPath id={clipId}>
                  <rect
                    x={0}
                    y={0}
                    width={width}
                    height={chartHeight}
                    rx={12}
                    ry={12}
                  />
                </clipPath>
                <filter
                  id={glowId}
                  x="-20%"
                  y="-40%"
                  width="140%"
                  height="180%"
                >
                  <feDropShadow
                    dx="0"
                    dy="0"
                    stdDeviation="0.8"
                    floodColor="rgba(0,0,0,0.45)"
                    floodOpacity="0.55"
                  />
                </filter>
              </defs>
              <g clipPath={`url(#${clipId})`}>
                <line
                  className="moon-preview-timeline__chart-grid"
                  x1={0}
                  x2={width}
                  y1={yForAlt(30)}
                  y2={yForAlt(30)}
                />
                <line
                  className="moon-preview-timeline__chart-grid"
                  x1={0}
                  x2={width}
                  y1={yForAlt(-30)}
                  y2={yForAlt(-30)}
                />
                <line
                  className="moon-preview-timeline__chart-horizon"
                  x1={0}
                  x2={width}
                  y1={horizonY}
                  y2={horizonY}
                />
                {/* Dark understroke for contrast on bright day bands */}
                <path
                  className="moon-preview-timeline__curve moon-preview-timeline__curve--under"
                  d={polylinePath(
                    altitudeCurves.xs,
                    altitudeCurves.milky,
                    yForAlt,
                  )}
                />
                <path
                  className="moon-preview-timeline__curve moon-preview-timeline__curve--under"
                  d={polylinePath(
                    altitudeCurves.xs,
                    altitudeCurves.moon,
                    yForAlt,
                  )}
                />
                <path
                  className="moon-preview-timeline__curve moon-preview-timeline__curve--under"
                  d={polylinePath(
                    altitudeCurves.xs,
                    altitudeCurves.sun,
                    yForAlt,
                  )}
                />
                <path
                  className="moon-preview-timeline__curve moon-preview-timeline__curve--milkyway"
                  d={polylinePath(
                    altitudeCurves.xs,
                    altitudeCurves.milky,
                    yForAlt,
                  )}
                  filter={`url(#${glowId})`}
                />
                <path
                  className="moon-preview-timeline__curve moon-preview-timeline__curve--moon"
                  d={polylinePath(
                    altitudeCurves.xs,
                    altitudeCurves.moon,
                    yForAlt,
                  )}
                  filter={`url(#${glowId})`}
                />
                <path
                  className="moon-preview-timeline__curve moon-preview-timeline__curve--sun"
                  d={polylinePath(
                    altitudeCurves.xs,
                    altitudeCurves.sun,
                    yForAlt,
                  )}
                  filter={`url(#${glowId})`}
                />
                <line
                  className="moon-preview-timeline__chart-playhead"
                  x1={playheadX}
                  x2={playheadX}
                  y1={0}
                  y2={chartHeight}
                />
                {playheadAlts && altInFrame(playheadAlts.milky) ? (
                  <circle
                    className="moon-preview-timeline__curve-dot moon-preview-timeline__curve-dot--milkyway"
                    cx={playheadX}
                    cy={yForAlt(playheadAlts.milky)}
                    r={4}
                  />
                ) : null}
                {playheadAlts && altInFrame(playheadAlts.moon) ? (
                  <circle
                    className="moon-preview-timeline__curve-dot moon-preview-timeline__curve-dot--moon"
                    cx={playheadX}
                    cy={yForAlt(playheadAlts.moon)}
                    r={4}
                  />
                ) : null}
                {playheadAlts && altInFrame(playheadAlts.sun) ? (
                  <circle
                    className="moon-preview-timeline__curve-dot moon-preview-timeline__curve-dot--sun"
                    cx={playheadX}
                    cy={yForAlt(playheadAlts.sun)}
                    r={4}
                  />
                ) : null}
              </g>
            </svg>
          ) : null}
          {marks.map((mark) => {
            const left = xFor(mark.utcMs)
            if (left < -20 || left > width + 20) return null
            const label = markLabel(mark.kind, t)
            return (
              <button
                key={`${mark.kind}-${mark.utcMs}`}
                type="button"
                className={`moon-preview-timeline__mark moon-preview-timeline__mark--button moon-preview-timeline__mark--${mark.kind}`}
                style={{ left }}
                title={label}
                aria-label={label}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onPlayheadChange(mark.utcMs)
                  onHorizonEventClick?.(mark.kind)
                }}
              >
                <span className="moon-preview-timeline__mark-dot" />
              </button>
            )
          })}
        </div>
        {!advanced ? (
          <>
            <span className="moon-preview-timeline__caret moon-preview-timeline__caret--top" />
            <span className="moon-preview-timeline__caret moon-preview-timeline__caret--bottom" />
          </>
        ) : null}
      </div>
    </div>
  )
}
