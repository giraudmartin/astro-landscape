import { useEffect, useMemo, useRef, useState } from 'react'
import { loadAppSettings, patchAppSettings } from './appSettings'
import {
  buildDayInfo,
  buildMonthCalendar,
  civilClockFromUtc,
  civilDayStartUtcMs,
  isMorningAt,
  shiftIsoDate,
  galacticCenterAltitudeDegAt,
  moonAltitudeDegAt,
  sunAltitudeDegAt,
  toCalendarDay,
  type DayInfo,
  type HorizonKind,
} from './celestial'
import {
  DayTimeline,
  TIMELINE_VISIBLE_RADIUS_STEPS_MS,
} from './DayTimeline'
import { CalendarPopover } from './CalendarPopover'
import { useLocale } from './i18n'
import {
  CalendarIcon,
  ChevronDownIcon,
  AltitudeCurvesIcon,
} from './psIcons'
import { skyEventFromSunAltitude } from './skyLighting'
import { EXPAND_TIMELINE_EVENT } from './ViewfinderCaptureCapsule'
import { OPERATE_PHONE_MQ, useMatchMedia } from './useMatchMedia'
import { useSwipeToDismiss } from './useSwipeToDismiss'

type TimelineDockProps = {
  lat: number
  lon: number
  elevationM: number
  date: string
  playheadUtcMs: number
  /** When true, clock/day are UTC (no spot yet). */
  clockIsUtc?: boolean
  /** PL Bortle legend is docking in this slot — slide the timeline away. */
  coveredByLegend?: boolean
  onDateChange: (date: string) => void
  onScrubbingChange: (active: boolean) => void
  onPlayheadChange: (utcMs: number) => void
}

function formatDockDate(isoDate: string, compact = false): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return isoDate
  // Phone: no spaced slashes — "24 / 11 / 2026" was wrapping mid-token and
  // colliding with the day/zoom buttons in the crushed 3-column row.
  if (compact) return `${match[3]}/${match[2]}/${match[1]}`
  return `${match[3]} / ${match[2]} / ${match[1]}`
}

/** Collapsed pill: day/month only (`25/11`). */
function formatDockDateShort(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return isoDate
  return `${match[3]}/${match[2]}`
}

export function TimelineDock({
  lat,
  lon,
  elevationM,
  date,
  playheadUtcMs,
  clockIsUtc = false,
  coveredByLegend = false,
  onDateChange,
  onPlayheadChange,
  onScrubbingChange,
}: TimelineDockProps) {
  const { locale: appLocale, t } = useLocale()
  const isPhone = useMatchMedia(OPERATE_PHONE_MQ)
  const [zoomIndex, setZoomIndex] = useState(
    () => loadAppSettings().timeline.zoomIndex,
  )
  const [collapsed, setCollapsed] = useState(
    () => loadAppSettings().timeline.collapsed,
  )
  const [advanced, setAdvanced] = useState(
    () => loadAppSettings().timeline.advanced,
  )
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [jumpRequest, setJumpRequest] = useState(0)
  const [editingClock, setEditingClock] = useState(false)
  const [clockDraft, setClockDraft] = useState('12:00:00')
  const calendarBtnRef = useRef<HTMLButtonElement | null>(null)

  const dayInfo: DayInfo = useMemo(
    () => buildDayInfo(date, lat, lon, elevationM),
    // appLocale: phase labels are baked in via module-level t()
    [date, lat, lon, elevationM, appLocale],
  )

  const calKey = date.slice(0, 7)
  const [calYear, setCalYear] = useState(() => Number(date.slice(0, 4)))
  const [calMonth, setCalMonth] = useState(() => Number(date.slice(5, 7)))

  useEffect(() => {
    setCalYear(Number(date.slice(0, 4)))
    setCalMonth(Number(date.slice(5, 7)))
  }, [calKey])

  useEffect(() => {
    patchAppSettings({ timeline: { zoomIndex, collapsed, advanced } })
  }, [zoomIndex, collapsed, advanced])

  useEffect(() => {
    const onExpand = () => {
      setCalendarOpen(false)
      setEditingClock(false)
      setCollapsed(false)
    }
    window.addEventListener(EXPAND_TIMELINE_EVENT, onExpand)
    return () => window.removeEventListener(EXPAND_TIMELINE_EVENT, onExpand)
  }, [])

  const collapseTimeline = () => {
    setCalendarOpen(false)
    setEditingClock(false)
    setCollapsed(true)
  }

  const swipeCollapse = useSwipeToDismiss(collapseTimeline, isPhone)

  const calendarDays = useMemo(
    () => buildMonthCalendar(calYear, calMonth, lat, lon, elevationM),
    [calYear, calMonth, lat, lon, elevationM, appLocale],
  )

  const canZoomIn = zoomIndex > 0
  const canZoomOut = zoomIndex < TIMELINE_VISIBLE_RADIUS_STEPS_MS.length - 1
  const zoomMinutes = Math.round(
    TIMELINE_VISIBLE_RADIUS_STEPS_MS[zoomIndex]! / 60_000,
  )

  const playheadClock = civilClockFromUtc(playheadUtcMs, lon)
  const sunAlt = sunAltitudeDegAt(lat, lon, elevationM, playheadUtcMs)
  const moonAlt = advanced
    ? moonAltitudeDegAt(lat, lon, elevationM, playheadUtcMs)
    : null
  const milkyAlt = advanced
    ? galacticCenterAltitudeDegAt(lat, lon, elevationM, playheadUtcMs)
    : null
  const phase = skyEventFromSunAltitude(sunAlt, {
    morning: isMorningAt(playheadUtcMs, lon),
  })

  const focusUtc =
    dayInfo.sunset?.datetimeUtc ??
    dayInfo.sunrise?.datetimeUtc ??
    dayInfo.moonrise?.datetimeUtc ??
    dayInfo.moonset?.datetimeUtc ??
    null

  // Land playhead on a sensible event when the civil *date* changes and the
  // clock sits outside that day (calendar / day buttons). Scrub across
  // midnight already updates playhead+date together — leave that alone.
  // Do NOT depend on lon: selecting a spot must keep the UTC instant
  // (App syncs the civil date label instead).
  useEffect(() => {
    const start = civilDayStartUtcMs(date, lon)
    const end = start + 24 * 60 * 60_000
    if (playheadUtcMs >= start && playheadUtcMs < end) return
    if (focusUtc) {
      onPlayheadChange(Date.parse(focusUtc))
      setJumpRequest((n) => n + 1)
      return
    }
    onPlayheadChange(start + 12 * 3600_000)
  }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyClockDraft = (nextClock: string) => {
    setClockDraft(nextClock)
    const parts = nextClock.split(':').map(Number)
    if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return
    const [h, m, s = 0] = parts
    const start = civilDayStartUtcMs(date, lon)
    onPlayheadChange(start + ((h! * 60 + m!) * 60 + s!) * 1000)
  }

  const onHorizon = (kind: HorizonKind) => {
    const event = dayInfo[kind]
    if (!event) return
    onPlayheadChange(Date.parse(event.datetimeUtc))
    setJumpRequest((n) => n + 1)
  }

  if (collapsed) {
    const timeHm = playheadClock.slice(0, 5)
    const zoneLabel = clockIsUtc ? t('timeline.utc') : t('timeline.local')
    return (
      <div
        className={[
          'moon-timeline-dock__collapsed',
          coveredByLegend ? 'is-legend-covered' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-hidden={coveredByLegend}
      >
        <button
          type="button"
          className="moon-timeline-dock__collapsed-pill"
          aria-label={t('timeline.show')}
          title={t('timeline.show')}
          tabIndex={coveredByLegend ? -1 : undefined}
          onClick={() => setCollapsed(false)}
        >
          <span className="moon-timeline-dock__collapsed-date">
            {formatDockDateShort(date)}
          </span>
          <span className="moon-timeline-dock__collapsed-meta">
            <span className="moon-timeline-dock__collapsed-time">{timeHm}</span>
            <span className="moon-timeline-dock__collapsed-zone">
              {zoneLabel}
            </span>
          </span>
        </button>
      </div>
    )
  }

  return (
    <>
      <div
        className={[
          advanced
            ? 'moon-timeline-dock moon-timeline-dock--advanced'
            : 'moon-timeline-dock',
          swipeCollapse.isDragging ? 'is-dragging' : '',
          coveredByLegend ? 'is-legend-covered' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="region"
        aria-label={t('timeline.region')}
        aria-hidden={coveredByLegend}
        style={
          isPhone && !coveredByLegend ? swipeCollapse.sheetStyle : undefined
        }
      >
        {isPhone ? (
          <button
            type="button"
            className="moon-timeline-dock__handle"
            aria-label={t('timeline.collapseHandle')}
            title={t('timeline.collapse')}
            onPointerDown={swipeCollapse.onHandlePointerDown}
            onPointerMove={swipeCollapse.onHandlePointerMove}
            onPointerUp={swipeCollapse.onHandlePointerUp}
            onPointerCancel={swipeCollapse.onHandlePointerCancel}
            onClick={collapseTimeline}
          >
            <span className="moon-timeline-dock__handle-bar" aria-hidden="true" />
          </button>
        ) : null}
        <div className="moon-timeline-dock__controls">
          <div className="moon-timeline-dock__controls-left">
            <button
              type="button"
              className={
                advanced
                  ? 'moon-timeline-dock__icon-btn is-active'
                  : 'moon-timeline-dock__icon-btn'
              }
              aria-label={
                advanced
                  ? t('timeline.hideCurves')
                  : t('timeline.showCurves')
              }
              aria-pressed={advanced}
              title={
                advanced
                  ? t('timeline.modeSimple')
                  : t('timeline.modeAdvanced')
              }
              onClick={() => setAdvanced((v) => !v)}
            >
              <AltitudeCurvesIcon />
            </button>
            <button
              type="button"
              className="moon-timeline-dock__icon-btn"
              aria-label={t('timeline.prevDay')}
              onClick={() => {
                const prev = shiftIsoDate(date, -1)
                if (prev) onDateChange(prev)
              }}
            >
              ‹‹
            </button>
            {!isPhone ? (
              <button
                type="button"
                className="moon-timeline-dock__icon-btn"
                aria-label={t('timeline.zoomOut')}
                title={t('timeline.zoomWindow', { min: zoomMinutes })}
                disabled={!canZoomOut}
                onClick={() =>
                  setZoomIndex((z) =>
                    Math.min(z + 1, TIMELINE_VISIBLE_RADIUS_STEPS_MS.length - 1),
                  )
                }
              >
                −
              </button>
            ) : null}
          </div>

          <div className="moon-timeline-dock__datetime">
            <button
              type="button"
              className="moon-timeline-dock__date"
              onClick={() => {
                if (focusUtc) {
                  onPlayheadChange(Date.parse(focusUtc))
                  setJumpRequest((n) => n + 1)
                }
              }}
            >
              {formatDockDate(date, isPhone)}
            </button>
            <span className="moon-timeline-dock__time">
              {editingClock && !isPhone ? (
                <input
                  autoFocus
                  className="moon-timeline-dock__time-input"
                  type="time"
                  step="1"
                  value={clockDraft}
                  aria-label={
                    clockIsUtc ? t('timeline.setUtc') : t('timeline.setLocal')
                  }
                  onChange={(event) => applyClockDraft(event.currentTarget.value)}
                  onBlur={() => setEditingClock(false)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' || event.key === 'Enter') {
                      setEditingClock(false)
                      event.currentTarget.blur()
                    }
                  }}
                />
              ) : isPhone ? (
                <span
                  className="moon-timeline-dock__time-main"
                  title={
                    clockIsUtc
                      ? t('timeline.utcExact')
                      : t('timeline.localExact')
                  }
                >
                  {playheadClock.slice(0, 5)}
                </span>
              ) : (
                <button
                  type="button"
                  className="moon-timeline-dock__time-main"
                  title={
                    clockIsUtc
                      ? t('timeline.utcExact')
                      : t('timeline.localExact')
                  }
                  onClick={() => {
                    setClockDraft(playheadClock)
                    setEditingClock(true)
                  }}
                >
                  {playheadClock.slice(0, 5)}
                </button>
              )}
              <span
                className="moon-timeline-dock__time-shot"
                title={
                  clockIsUtc
                    ? t('timeline.noSpotUtc')
                    : t('timeline.civilApprox')
                }
              >
                {clockIsUtc ? t('timeline.utc') : t('timeline.local')}
              </span>
            </span>
          </div>

          <div className="moon-timeline-dock__controls-right">
            {!isPhone ? (
              <button
                type="button"
                className="moon-timeline-dock__icon-btn"
                aria-label={t('timeline.zoomIn')}
                title={t('timeline.zoomWindow', { min: zoomMinutes })}
                disabled={!canZoomIn}
                onClick={() => setZoomIndex((z) => Math.max(z - 1, 0))}
              >
                +
              </button>
            ) : null}
            <button
              type="button"
              className="moon-timeline-dock__icon-btn"
              aria-label={t('timeline.nextDay')}
              onClick={() => {
                const next = shiftIsoDate(date, 1)
                if (next) onDateChange(next)
              }}
            >
              ››
            </button>
            <button
              ref={calendarBtnRef}
              type="button"
              className={
                calendarOpen
                  ? 'moon-timeline-dock__icon-btn moon-timeline-dock__icon-btn--accent is-active'
                  : 'moon-timeline-dock__icon-btn moon-timeline-dock__icon-btn--accent'
              }
              aria-label={t('timeline.calendar')}
              aria-pressed={calendarOpen}
              title={t('timeline.calendar')}
              onClick={() => setCalendarOpen((o) => !o)}
            >
              <CalendarIcon />
            </button>
            {!isPhone ? (
              <button
                type="button"
                className="moon-timeline-dock__icon-btn"
                aria-label={t('timeline.collapse')}
                title={t('timeline.collapse')}
                onClick={collapseTimeline}
              >
                <ChevronDownIcon />
              </button>
            ) : null}
          </div>
        </div>

        <div className="moon-timeline-dock__timeline">
          <DayTimeline
            dayInfo={dayInfo}
            elevationM={elevationM}
            playheadUtcMs={playheadUtcMs}
            onScrubbingChange={onScrubbingChange}
            onPlayheadChange={onPlayheadChange}
            zoomIndex={zoomIndex}
            onZoomIndexChange={setZoomIndex}
            jumpRequest={jumpRequest}
            onHorizonEventClick={onHorizon}
            advanced={advanced}
          />
        </div>

        <div className="moon-timeline-dock__ephemeris">
          <span>
            {phase.label} · {t('timeline.legend.sun')} {sunAlt.toFixed(1)}°
            {moonAlt != null
              ? ` · ${t('timeline.legend.moon')} ${moonAlt.toFixed(1)}°`
              : ''}
            {milkyAlt != null
              ? ` · ${t('timeline.legend.milkyWayShort')} ${milkyAlt.toFixed(1)}°`
              : ''}
          </span>
          <span>
            {t('timeline.legend.moon')} {dayInfo.illuminationPercent}% ·{' '}
            {dayInfo.phaseLabel}
          </span>
        </div>
      </div>

      <CalendarPopover
        open={calendarOpen}
        selectedDate={date}
        selectedDay={toCalendarDay(dayInfo)}
        year={calYear}
        month={calMonth}
        days={calendarDays}
        anchorRef={calendarBtnRef}
        onClose={() => setCalendarOpen(false)}
        onMonthChange={(y, m) => {
          setCalYear(y)
          setCalMonth(m)
        }}
        onSelectDate={onDateChange}
        onNow={() => {
          onPlayheadChange(Date.now())
          setCalendarOpen(false)
          setJumpRequest((n) => n + 1)
        }}
      />
    </>
  )
}
