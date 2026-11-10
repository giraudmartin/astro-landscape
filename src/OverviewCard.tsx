/** Overview card — Photo Sightline chrome, without moon lighting tags. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPopover } from './CalendarPopover'
import { MapCard } from './MapCard'
import { MoonPhaseDisc } from './moonVisuals'
import {
  buildDayInfo,
  buildDaySchedule,
  buildMonthCalendar,
  civilDateFromUtc,
  nearestScheduleKind,
} from './celestial'

type OverviewCardProps = {
  lat: number
  lon: number
  elevationM: number
  date: string
  playheadUtcMs: number
  onDateChange: (date: string) => void
  onPlayheadChange: (utcMs: number) => void
}

function formatOverviewDate(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return isoDate
  const value = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12),
  )
  return value.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function OverviewCard({
  lat,
  lon,
  elevationM,
  date,
  playheadUtcMs,
  onDateChange,
  onPlayheadChange,
}: OverviewCardProps) {
  const [calendarOpen, setCalendarOpen] = useState(false)
  const dateBtnRef = useRef<HTMLButtonElement | null>(null)
  const dayInfo = useMemo(
    () => buildDayInfo(date, lat, lon, elevationM),
    [date, lat, lon, elevationM],
  )
  const schedule = useMemo(() => buildDaySchedule(dayInfo), [dayInfo])
  const activeKind = useMemo(
    () => nearestScheduleKind(schedule, playheadUtcMs),
    [schedule, playheadUtcMs],
  )

  const calKey = date.slice(0, 7)
  const [calYear, setCalYear] = useState(() => Number(date.slice(0, 4)))
  const [calMonth, setCalMonth] = useState(() => Number(date.slice(5, 7)))

  useEffect(() => {
    setCalYear(Number(date.slice(0, 4)))
    setCalMonth(Number(date.slice(5, 7)))
  }, [calKey])

  const calendarDays = useMemo(
    () => buildMonthCalendar(calYear, calMonth, lat, lon, elevationM),
    [calYear, calMonth, lat, lon, elevationM],
  )

  const illuminatedLabel = `${dayInfo.illuminationPercent} % illuminé`

  const dateCapsule = (
    <button
      ref={dateBtnRef}
      type="button"
      className="ov-capsule ov-capsule--date"
      onClick={() => setCalendarOpen(true)}
    >
      <span className="ov-status ov-status--live" aria-hidden="true" />
      <span className="ov-capsule__main">{formatOverviewDate(date)}</span>
      <span className="ov-capsule__action">Calendrier</span>
    </button>
  )

  const selectEvent = (datetimeUtc: string) => {
    const utcMs = Date.parse(datetimeUtc)
    if (!Number.isFinite(utcMs)) return
    onPlayheadChange(utcMs)
  }

  return (
    <>
      <MapCard
        title="Overview"
        className="map-card--overview"
        collapsible
        glow
        collapsedSummary={dateCapsule}
      >
        <div className="ov">
          {dateCapsule}
          <div className="ov-capsule ov-capsule--phase">
            <MoonPhaseDisc
              illuminationFraction={dayInfo.illuminationPercent / 100}
              waxing={dayInfo.waxing}
              label={`${dayInfo.phaseLabel}, ${illuminatedLabel}`}
            />
            <div className="ov-capsule__copy">
              <p className="ov-capsule__main">{dayInfo.phaseLabel}</p>
              <p className="ov-capsule__meta">{illuminatedLabel}</p>
            </div>
          </div>
          {schedule.length === 0 ? (
            <p className="ov-hint">
              Aucun lever/coucher soleil, Lune ou ventre galactique pour cette
              date.
            </p>
          ) : (
            <ol className="ov-schedule" aria-label="Horaires du jour">
              {schedule.map((row) => {
                const active = activeKind === row.kind
                return (
                  <li key={`${row.kind}-${row.datetimeUtc}`}>
                    <button
                      type="button"
                      className={
                        active
                          ? 'ov-schedule__row ov-schedule__row--button ov-schedule__row--active'
                          : 'ov-schedule__row ov-schedule__row--button'
                      }
                      onClick={() => selectEvent(row.datetimeUtc)}
                    >
                      <time className="ov-schedule__time">
                        {row.datetimeLocal}
                      </time>
                      <span className="ov-schedule__kind">{row.label}</span>
                      <span
                        className="ov-schedule__chip-spacer"
                        aria-hidden
                      />
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </MapCard>

      <CalendarPopover
        open={calendarOpen}
        selectedDate={date}
        year={calYear}
        month={calMonth}
        days={calendarDays}
        anchorRef={dateBtnRef}
        placement="below"
        onClose={() => setCalendarOpen(false)}
        onMonthChange={(year, month) => {
          setCalYear(year)
          setCalMonth(month)
        }}
        onSelectDate={(next) => {
          onDateChange(next)
          setCalendarOpen(false)
        }}
        onNow={() => {
          const now = Date.now()
          onDateChange(civilDateFromUtc(now, lon))
          onPlayheadChange(now)
          setCalendarOpen(false)
        }}
      />
    </>
  )
}
