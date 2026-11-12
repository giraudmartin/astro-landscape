import { useEffect, useMemo, useRef, useState } from 'react'
import { loadAppSettings, patchAppSettings } from './appSettings'
import {
  buildDayInfo,
  buildMonthCalendar,
  civilClockFromUtc,
  civilDateFromUtc,
  civilDayStartUtcMs,
  isMorningAt,
  shiftIsoDate,
  sunAltitudeDegAt,
  type DayInfo,
  type HorizonKind,
} from './celestial'
import {
  DayTimeline,
  TIMELINE_VISIBLE_RADIUS_STEPS_MS,
} from './DayTimeline'
import { CalendarPopover } from './CalendarPopover'
import {
  CalendarClockIcon,
  CalendarIcon,
  ChevronDownIcon,
} from './psIcons'
import { skyEventFromSunAltitude } from './skyLighting'

type TimelineDockProps = {
  lat: number
  lon: number
  elevationM: number
  date: string
  playheadUtcMs: number
  onDateChange: (date: string) => void
  onPlayheadChange: (utcMs: number) => void
}

function formatDockDate(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return isoDate
  return `${match[3]} / ${match[2]} / ${match[1]}`
}

export function TimelineDock({
  lat,
  lon,
  elevationM,
  date,
  playheadUtcMs,
  onDateChange,
  onPlayheadChange,
}: TimelineDockProps) {
  const [zoomIndex, setZoomIndex] = useState(
    () => loadAppSettings().timeline.zoomIndex,
  )
  const [collapsed, setCollapsed] = useState(
    () => loadAppSettings().timeline.collapsed,
  )
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [jumpRequest, setJumpRequest] = useState(0)
  const [editingClock, setEditingClock] = useState(false)
  const [clockDraft, setClockDraft] = useState('12:00:00')
  const calendarBtnRef = useRef<HTMLButtonElement | null>(null)

  const dayInfo: DayInfo = useMemo(
    () => buildDayInfo(date, lat, lon, elevationM),
    [date, lat, lon, elevationM],
  )

  const calKey = date.slice(0, 7)
  const [calYear, setCalYear] = useState(() => Number(date.slice(0, 4)))
  const [calMonth, setCalMonth] = useState(() => Number(date.slice(5, 7)))

  useEffect(() => {
    setCalYear(Number(date.slice(0, 4)))
    setCalMonth(Number(date.slice(5, 7)))
  }, [calKey])

  useEffect(() => {
    patchAppSettings({ timeline: { zoomIndex, collapsed } })
  }, [zoomIndex, collapsed])

  const collapseTimeline = () => {
    setCalendarOpen(false)
    setEditingClock(false)
    setCollapsed(true)
  }

  const calendarDays = useMemo(
    () => buildMonthCalendar(calYear, calMonth, lat, lon, elevationM),
    [calYear, calMonth, lat, lon, elevationM],
  )

  const canZoomIn = zoomIndex > 0
  const canZoomOut = zoomIndex < TIMELINE_VISIBLE_RADIUS_STEPS_MS.length - 1
  const zoomMinutes = Math.round(
    TIMELINE_VISIBLE_RADIUS_STEPS_MS[zoomIndex]! / 60_000,
  )

  const playheadClock = civilClockFromUtc(playheadUtcMs, lon)
  const sunAlt = sunAltitudeDegAt(lat, lon, elevationM, playheadUtcMs)
  const phase = skyEventFromSunAltitude(sunAlt, {
    morning: isMorningAt(playheadUtcMs, lon),
  })

  const focusUtc =
    dayInfo.sunset?.datetimeUtc ??
    dayInfo.sunrise?.datetimeUtc ??
    dayInfo.moonrise?.datetimeUtc ??
    dayInfo.moonset?.datetimeUtc ??
    null

  // Land playhead on a sensible event when day changes and clock is outside day.
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
  }, [date, lon]) // eslint-disable-line react-hooks/exhaustive-deps

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
    return (
      <div className="moon-timeline-dock__collapsed map-quick-actions">
        <button
          type="button"
          className="map-quick-actions__button"
          aria-label="Afficher la timeline"
          title="Afficher la timeline"
          onClick={() => setCollapsed(false)}
        >
          <CalendarClockIcon />
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="moon-timeline-dock" role="region" aria-label="Timeline">
        <div className="moon-timeline-dock__controls">
          <div className="moon-timeline-dock__controls-left">
            <button
              type="button"
              className="moon-timeline-dock__icon-btn"
              aria-label="Jour précédent"
              onClick={() => {
                const prev = shiftIsoDate(date, -1)
                if (prev) onDateChange(prev)
              }}
            >
              ‹‹
            </button>
            <button
              type="button"
              className="moon-timeline-dock__icon-btn"
              aria-label="Dézoomer la timeline"
              title={`Fenêtre ±${zoomMinutes} min`}
              disabled={!canZoomOut}
              onClick={() => setZoomIndex((z) => Math.min(z + 1, TIMELINE_VISIBLE_RADIUS_STEPS_MS.length - 1))}
            >
              −
            </button>
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
              {formatDockDate(date)}
            </button>
            <span className="moon-timeline-dock__time">
              {editingClock ? (
                <input
                  autoFocus
                  className="moon-timeline-dock__time-input"
                  type="time"
                  step="1"
                  value={clockDraft}
                  aria-label="Régler l’heure"
                  onChange={(event) => applyClockDraft(event.currentTarget.value)}
                  onBlur={() => setEditingClock(false)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' || event.key === 'Enter') {
                      setEditingClock(false)
                      event.currentTarget.blur()
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="moon-timeline-dock__time-main"
                  title="Régler l’heure exacte"
                  onClick={() => {
                    setClockDraft(playheadClock)
                    setEditingClock(true)
                  }}
                >
                  {playheadClock.slice(0, 5)}
                </button>
              )}
            </span>
          </div>

          <div className="moon-timeline-dock__controls-right">
            <button
              type="button"
              className="moon-timeline-dock__icon-btn"
              aria-label="Zoomer la timeline"
              title={`Fenêtre ±${zoomMinutes} min`}
              disabled={!canZoomIn}
              onClick={() => setZoomIndex((z) => Math.max(z - 1, 0))}
            >
              +
            </button>
            <button
              type="button"
              className="moon-timeline-dock__icon-btn"
              aria-label="Jour suivant"
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
              aria-label="Calendrier"
              aria-pressed={calendarOpen}
              title="Calendrier"
              onClick={() => setCalendarOpen((o) => !o)}
            >
              <CalendarIcon />
            </button>
            <button
              type="button"
              className="moon-timeline-dock__icon-btn"
              aria-label="Réduire la timeline"
              title="Réduire la timeline"
              onClick={collapseTimeline}
            >
              <ChevronDownIcon />
            </button>
          </div>
        </div>

        <div className="moon-timeline-dock__timeline">
          <DayTimeline
            dayInfo={dayInfo}
            playheadUtcMs={playheadUtcMs}
            onPlayheadChange={onPlayheadChange}
            zoomIndex={zoomIndex}
            jumpRequest={jumpRequest}
            onHorizonEventClick={onHorizon}
          />
        </div>

        <div className="moon-timeline-dock__ephemeris">
          <span>
            {phase.label} · Soleil {sunAlt.toFixed(1)}°
          </span>
          <span>
            Lune {dayInfo.illuminationPercent}% · {dayInfo.phaseLabel}
          </span>
          {dayInfo.sunrise ? <span>↑☉ {dayInfo.sunrise.datetimeLocal}</span> : null}
          {dayInfo.sunset ? <span>↓☉ {dayInfo.sunset.datetimeLocal}</span> : null}
          {dayInfo.moonrise ? (
            <span>↑☾ {dayInfo.moonrise.datetimeLocal}</span>
          ) : null}
          {dayInfo.moonset ? <span>↓☾ {dayInfo.moonset.datetimeLocal}</span> : null}
        </div>
      </div>

      <CalendarPopover
        open={calendarOpen}
        selectedDate={date}
        year={calYear}
        month={calMonth}
        days={calendarDays}
        anchorRef={calendarBtnRef}
        onClose={() => setCalendarOpen(false)}
        onMonthChange={(y, m) => {
          setCalYear(y)
          setCalMonth(m)
        }}
        onSelectDate={(nextDate) => {
          onDateChange(nextDate)
          setCalendarOpen(false)
        }}
        onNow={() => {
          const now = Date.now()
          onDateChange(civilDateFromUtc(now, lon))
          onPlayheadChange(now)
          setCalendarOpen(false)
          setJumpRequest((n) => n + 1)
        }}
      />
    </>
  )
}
