import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import {
  formatDurationMinutes,
  monthCalendarCells,
  shiftMonth,
  type CalendarDay,
} from './celestial'

type CalendarPopoverProps = {
  open: boolean
  selectedDate: string
  year: number
  month: number
  days: CalendarDay[]
  anchorRef: RefObject<HTMLElement | null>
  /** Timeline dock uses above; Overview date capsule uses below. */
  placement?: 'above' | 'below'
  onClose: () => void
  onMonthChange: (year: number, month: number) => void
  onSelectDate: (date: string) => void
  onNow: () => void
}

type PopoverPos = {
  top?: number
  bottom?: number
  left: number
}

function placeAboveAnchor(anchor: DOMRect): PopoverPos {
  const width = Math.min(340, window.innerWidth - 24)
  const gap = 10
  let left = Math.min(
    window.innerWidth - width - 12,
    Math.max(12, anchor.right - width),
  )
  const bottom = Math.max(12, window.innerHeight - anchor.top + gap)
  return { bottom, left }
}

function placeBelowAnchor(anchor: DOMRect): PopoverPos {
  const width = Math.min(340, window.innerWidth - 24)
  const gap = 10
  const left = Math.min(
    window.innerWidth - width - 12,
    Math.max(12, anchor.left),
  )
  const top = Math.min(window.innerHeight - 24, anchor.bottom + gap)
  return { top, left }
}

function moonNightFraction(day: CalendarDay): number {
  if (day.nightMinutes <= 0) return 0
  return Math.min(1, day.moonInNightMinutes / day.nightMinutes)
}

export function CalendarPopover({
  open,
  selectedDate,
  year,
  month,
  days,
  anchorRef,
  placement = 'above',
  onClose,
  onMonthChange,
  onSelectDate,
  onNow,
}: CalendarPopoverProps) {
  const byDate = useMemo(
    () => new Map(days.map((day) => [day.date, day])),
    [days],
  )
  const cells = monthCalendarCells(year, month)
  const title = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    'fr-FR',
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  )
  const prev = shiftMonth(year, month, -1)
  const next = shiftMonth(year, month, 1)
  const [pos, setPos] = useState<PopoverPos | null>(null)

  const selectedDay = byDate.get(selectedDate) ?? null

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const update = () => {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPos(
        placement === 'below'
          ? placeBelowAnchor(rect)
          : placeAboveAnchor(rect),
      )
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, anchorRef, placement])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (anchorRef.current?.contains(target)) return
      const pop = document.querySelector('.moon-calendar-popover')
      if (pop?.contains(target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open, onClose, anchorRef])

  if (!open || !pos) return null

  const style: CSSProperties = {
    left: pos.left,
    ...(pos.bottom != null
      ? { bottom: pos.bottom, top: 'auto' }
      : { top: pos.top }),
  }

  const weekdays = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di']

  return createPortal(
    <div
      className="moon-calendar-popover"
      role="dialog"
      aria-label="Calendrier"
      style={style}
    >
      <div className="moon-calendar-popover__header">
        <p className="moon-calendar-popover__title">Calendrier</p>
        <div className="moon-calendar-popover__header-actions">
          <button
            type="button"
            className="moon-calendar-popover__now"
            aria-label="Maintenant"
            onClick={onNow}
          >
            Maintenant
          </button>
          <button
            type="button"
            className="moon-calendar-popover__close"
            aria-label="Fermer le calendrier"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>

      <div className="moon-cal">
        <div className="moon-cal__nav">
          <button
            type="button"
            className="moon-cal__nav-btn"
            aria-label="Mois précédent"
            onClick={() => onMonthChange(prev.year, prev.month)}
          >
            ‹
          </button>
          <p className="moon-cal__title">{title}</p>
          <button
            type="button"
            className="moon-cal__nav-btn"
            aria-label="Mois suivant"
            onClick={() => onMonthChange(next.year, next.month)}
          >
            ›
          </button>
        </div>
        <div className="moon-cal__weekdays" aria-hidden="true">
          {weekdays.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="moon-cal__grid" role="grid" aria-label="Calendrier lunaire">
          {cells.map((cellDate, index) => {
            if (!cellDate) {
              return (
                <div
                  key={`empty-${index}`}
                  className="moon-cal__cell moon-cal__cell--empty"
                />
              )
            }
            const day = byDate.get(cellDate)
            const selected = cellDate === selectedDate
            const dayNum = Number(cellDate.slice(8, 10))
            const illum = day?.illuminationPercent ?? 0
            const nightFrac = day ? moonNightFraction(day) : 0
            const moonNight = day
              ? formatDurationMinutes(day.moonInNightMinutes)
              : '—'
            return (
              <button
                key={cellDate}
                type="button"
                role="gridcell"
                aria-selected={selected}
                title={
                  day
                    ? `Lune ${illum}% · ${moonNight} dans la nuit`
                    : undefined
                }
                className={
                  selected
                    ? 'moon-cal__cell moon-cal__cell--selected'
                    : 'moon-cal__cell'
                }
                onClick={() => onSelectDate(cellDate)}
              >
                <span className="moon-cal__daynum">{dayNum}</span>
                <span className="moon-cal__illum">{illum}%</span>
                <span
                  className={
                    nightFrac >= 0.55
                      ? 'moon-cal__nightmoon is-long'
                      : nightFrac <= 0.15
                        ? 'moon-cal__nightmoon is-short'
                        : 'moon-cal__nightmoon'
                  }
                >
                  {moonNight}
                </span>
              </button>
            )
          })}
        </div>

        {selectedDay ? (
          <p className="moon-cal__readout" aria-live="polite">
            <span className="moon-cal__readout-illum">
              {selectedDay.illuminationPercent}%
            </span>
            <span className="moon-cal__readout-sep">·</span>
            <span>
              {formatDurationMinutes(selectedDay.moonInNightMinutes)} de lune
              dans la nuit
            </span>
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
