import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import { intlLocale, useLocale } from './i18n'
import { MoonPhaseDisc } from './moonVisuals'
import { createPortal } from 'react-dom'
import {
  monthCalendarCells,
  shiftMonth,
  type CalendarDay,
} from './celestial'

type CalendarPopoverProps = {
  open: boolean
  selectedDate: string
  /** Always-available readout for the app's selected date (any month). */
  selectedDay: CalendarDay
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
  width?: number
  maxHeight?: number
  left: number
}

function placeAboveAnchor(anchor: DOMRect, panelTop: number): PopoverPos {
  const width = Math.min(340, window.innerWidth - 24)
  const gap = 10
  const left = Math.min(
    window.innerWidth - width - 12,
    Math.max(12, anchor.right - width),
  )
  const bottom = Math.max(12, window.innerHeight - panelTop + gap)
  return { bottom, left }
}

function placeByMapDate(anchor: DOMRect, panel: DOMRect): PopoverPos {
  const margin = 12
  const gap = 10
  const width = Math.min(340, window.innerWidth - margin * 2)
  const height = Math.min(465, window.innerHeight - margin * 2)
  const top = Math.max(0, panel.top)
  const maxHeight = Math.max(0, window.innerHeight - top - margin)
  if (panel.right + gap + width <= window.innerWidth - margin) {
    return { left: panel.right + gap, top, maxHeight }
  }
  if (panel.left - gap - width >= margin) {
    return { left: panel.left - gap - width, top, maxHeight }
  }

  const fittedWidth = Math.min(anchor.width, width)
  const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - margin - fittedWidth))
  const below = window.innerHeight - anchor.bottom - gap - margin
  const above = anchor.top - gap - margin
  if (below < height && above > below) {
    return { left, width: fittedWidth, bottom: window.innerHeight - anchor.top + gap }
  }
  return { left, width: fittedWidth, top: anchor.bottom + gap, maxHeight: Math.max(0, below) }
}
function nightDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remainder = Math.round(minutes % 60)
  return [
    hours ? `${hours} h` : '',
    remainder ? `${remainder} min` : '',
  ].filter(Boolean).join(' ')
}

export function CalendarPopover({
  open,
  selectedDate,
  selectedDay,
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
  const { locale: appLocale, t, tList } = useLocale()
  const byDate = useMemo(
    () => new Map(days.map((day) => [day.date, day])),
    [days],
  )
  const cells = monthCalendarCells(year, month)
  const title = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    intlLocale(appLocale),
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  )
  const prev = shiftMonth(year, month, -1)
  const next = shiftMonth(year, month, 1)
  const [pos, setPos] = useState<PopoverPos | null>(null)

  const readoutDay = byDate.get(selectedDate) ?? selectedDay

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const dock = placement === 'above' ? anchorRef.current?.closest('.moon-timeline-dock') : null
    const update = () => {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPos(
        placement === 'below'
          ? placeByMapDate(rect, el.closest('.map-card')?.getBoundingClientRect() ?? rect)
          : placeAboveAnchor(rect, dock?.getBoundingClientRect().top ?? rect.top),
      )
    }
    update()
    const observer = new ResizeObserver(update)
    if (dock) observer.observe(dock)
    if (anchorRef.current) observer.observe(anchorRef.current)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer.disconnect()
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
    width: pos.width,
    maxHeight: pos.maxHeight,
    ...(pos.bottom != null
      ? { bottom: pos.bottom, top: 'auto', maxHeight: Math.max(0, window.innerHeight - pos.bottom - 12) }
      : { top: pos.top }),
  }

  const weekdays = tList('common.weekdaysShort')

  return createPortal(
    <div
      className="moon-calendar-popover"
      role="dialog"
      aria-label={t('common.calendar')}
      style={style}
    >
      <div className="moon-calendar-popover__header">
        <p className="moon-calendar-popover__title">{t('timeline.cal.title')}</p>
        <div className="moon-calendar-popover__header-actions">
          <button
            type="button"
            className="moon-calendar-popover__now"
            aria-label={t('timeline.cal.now')}
            onClick={onNow}
          >
            {t('timeline.cal.now')}
          </button>
          <button
            type="button"
            className="moon-calendar-popover__close"
            aria-label={t('timeline.cal.close')}
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
            aria-label={t('common.prevMonth')}
            onClick={() => onMonthChange(prev.year, prev.month)}
          >
            ‹
          </button>
          <p className="moon-cal__title">{title}</p>
          <button
            type="button"
            className="moon-cal__nav-btn"
            aria-label={t('common.nextMonth')}
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
        <div className="moon-cal__grid" role="grid" aria-label={t('timeline.cal.gridAria')}>
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
            return (
              <button
                key={cellDate}
                type="button"
                role="gridcell"
                aria-selected={selected}
                title={day?.phaseLabel}
                className={
                  selected
                    ? 'moon-cal__cell moon-cal__cell--selected'
                    : 'moon-cal__cell'
                }
                onClick={() => onSelectDate(cellDate)}
              >
                <span className="moon-cal__daynum">{dayNum}</span>
                {day && <MoonPhaseDisc illuminationFraction={illum / 100} waxing={day.waxing} label={day.phaseLabel} size={15} />}
              </button>
            )
          })}
        </div>

        <p className="moon-cal__readout" aria-live="polite">
          <span className="moon-cal__readout-illum">
            {readoutDay.phaseLabel} · {readoutDay.illuminationPercent} %
          </span>
          <span>
            {readoutDay.moonInNightMinutes > 0
              ? t('timeline.cal.aboveHorizon', {
                  duration: nightDuration(readoutDay.moonInNightMinutes),
                })
              : t('timeline.cal.belowAllNight')}
          </span>
        </p>
      </div>
    </div>,
    document.body,
  )
}
