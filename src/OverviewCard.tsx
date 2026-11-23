/** Overview card — Photo Sightline chrome, without moon lighting tags. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPopover } from './CalendarPopover'
import { intlLocale, useLocale } from './i18n'
import { MapCard } from './MapCard'
import { MoonPhaseDisc } from './moonVisuals'
import {
  buildDayInfo,
  buildDaySchedule,
  buildMonthCalendar,
  toCalendarDay,
  formatDurationMinutes,
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
  /** Phone info drawer: bare body without the MapCard chrome. */
  embedded?: boolean
  /** Controlled MapCard collapse (e.g. auto-fold when a spot is picked). */
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

function formatOverviewDate(isoDate: string, locale: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return isoDate
  const value = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12),
  )
  return value.toLocaleDateString(locale, {
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
  embedded = false,
  collapsed,
  onCollapsedChange,
}: OverviewCardProps) {
  const { locale: appLocale, t } = useLocale()
  const dateLocale = intlLocale(appLocale)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const dateBtnRef = useRef<HTMLButtonElement | null>(null)
  const dayInfo = useMemo(
    () => buildDayInfo(date, lat, lon, elevationM),
    // appLocale: phase labels are baked in via module-level t()
    [date, lat, lon, elevationM, appLocale],
  )
  const schedule = useMemo(
    () => buildDaySchedule(dayInfo),
    // appLocale: schedule labels are baked in via module-level t()
    [dayInfo, appLocale],
  )
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
    [calYear, calMonth, lat, lon, elevationM, appLocale],
  )

  const illuminatedLabel = t('overview.illuminated', {
    pct: dayInfo.illuminationPercent,
  })
  const moonInNightLabel = t('overview.moonInNight', {
    duration: formatDurationMinutes(dayInfo.moonInNightMinutes),
  })

  const dateCapsule = (
    <button
      ref={dateBtnRef}
      type="button"
      className="ov-capsule ov-capsule--date"
      onClick={() => setCalendarOpen(true)}
    >
      <span className="ov-status ov-status--live" aria-hidden="true" />
      <span className="ov-capsule__main">{formatOverviewDate(date, dateLocale)}</span>
      <span className="ov-capsule__action">{t('overview.calendarAction')}</span>
    </button>
  )

  const selectEvent = (datetimeUtc: string) => {
    const utcMs = Date.parse(datetimeUtc)
    if (!Number.isFinite(utcMs)) return
    onPlayheadChange(utcMs)
  }

  const body = (
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
          <p className="ov-capsule__meta">{moonInNightLabel}</p>
        </div>
      </div>
      {schedule.length === 0 ? (
        <p className="ov-hint">
          {t('overview.emptySchedule')}
        </p>
      ) : (
        <ol className="ov-schedule" aria-label={t('overview.scheduleAria')}>
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
                  <span className="ov-schedule__chip-spacer" aria-hidden />
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )

  return (
    <>
      {embedded ? (
        body
      ) : (
        <MapCard
          title={t('overview.title')}
          className="map-card--overview"
          collapsible
          glow
          collapsed={collapsed}
          onCollapsedChange={onCollapsedChange}
          collapsedSummary={dateCapsule}
        >
          {body}
        </MapCard>
      )}

      <CalendarPopover
        open={calendarOpen}
        selectedDate={date}
        selectedDay={toCalendarDay(dayInfo)}
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
        onSelectDate={onDateChange}
        onNow={() => {
          onPlayheadChange(Date.now())
          setCalendarOpen(false)
        }}
      />
    </>
  )
}
