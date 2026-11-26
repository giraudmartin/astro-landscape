import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { intlLocale, useLocale, useT } from './i18n'
import { MobileRailChrome } from './MobileRailChrome'
import { FramingThumb } from './FramingThumb'
import { shiftIsoDate } from './celestial'
import {
  datetimeLocalFromPeakLocal,
  framingAngleSummary,
  framingNightLabel,
  framingTypeBadgeLabel,
  framingViewSummary,
  groupFramingsByNight,
  peakLocalFromDatetimeLocal,
  type FramingViewSnapshot,
  type PersonalFraming,
} from './personalFramings'
import { CalendarIcon, FramingsFocusIcon } from './psIcons'

export type FramingsPanelMode = 'map' | 'immersive'

export type FramingsEditorDraft = {
  id?: string
  name: string
  peakLocal: string
  view: FramingViewSnapshot
  spotId: string
  spotName: string
}

type SpotOption = { id: string; label: string }

type FramingsPanelProps = {
  open: boolean
  onClose: () => void
  mode: FramingsPanelMode
  framings: PersonalFraming[]
  spotOptions: SpotOption[]
  /** Locked spot in immersive; filter on map. */
  filterSpotId: string
  onFilterSpotIdChange: (id: string) => void
  currentSpotId: string | null
  currentSpotName: string | null
  display: 'list' | 'calendar'
  onDisplayChange: (display: 'list' | 'calendar') => void
  calendarDay: string
  onCalendarDayChange: (day: string) => void
  calendarMonth: string
  onCalendarMonthChange: (month: string) => void
  activeId: string | null
  canSaveCurrent: boolean
  onRequestSaveCurrent: () => void
  editor: FramingsEditorDraft | null
  onEditorChange: (draft: FramingsEditorDraft | null) => void
  onSubmitEditor: (draft: FramingsEditorDraft) => void
  onDeleteFraming: (id: string) => void
  onRestore: (framing: PersonalFraming) => void
  onEdit: (framing: PersonalFraming) => void
  railWidthPx?: number
  onRailWidthChange?: (widthPx: number) => void
}

function SquarePenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
    </svg>
  )
}

function SaveIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
      <path d="M7 3v4a1 1 0 0 0 1 1h7" />
    </svg>
  )
}

function SortOrderIcon({ newest }: { newest: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 3.5v9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d={newest ? 'M2.5 10.5 4.5 12.5 6.5 10.5' : 'M2.5 5.5 4.5 3.5 6.5 5.5'}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 4.5h4.5M9 8h3.2M9 11.5h2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity={newest ? 0.95 : 0.55}
      />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

/** Card clock — HH:MM, date lives in the night group header. */
function formatCardClock(peakLocal: string): string {
  const hm = peakLocal.slice(11, 16)
  return /^\d{2}:\d{2}$/.test(hm) ? hm : ''
}

/** Read-only timeline stamp for the save form (no native date picker). */
function formatFramingWhenLabel(peakLocal: string, french: boolean): string {
  const day = peakLocal.slice(0, 10)
  const hm = peakLocal.slice(11, 16)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return peakLocal
  const [y, m, d] = day.split('-')
  const clock = french ? hm.replace(':', ' h ') : hm
  return hm ? `${d}/${m}/${y} · ${clock}` : `${d}/${m}/${y}`
}

function monthLabel(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)))
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y!, (m ?? 1) - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function daysInMonth(month: string): { day: string; n: number }[] {
  const [y, m] = month.split('-').map(Number)
  const total = new Date(Date.UTC(y!, m!, 0)).getUTCDate()
  const out: { day: string; n: number }[] = []
  for (let i = 1; i <= total; i++) {
    const day = `${month}-${String(i).padStart(2, '0')}`
    out.push({ day, n: i })
  }
  return out
}

function monthStartOffset(month: string): number {
  const [y, m] = month.split('-').map(Number)
  const dow = new Date(Date.UTC(y!, (m ?? 1) - 1, 1)).getUTCDay()
  return (dow + 6) % 7
}

export function FramingsToggle({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  return (
    <div className="my-events-control framings-control">
      <button
        type="button"
        className={
          open
            ? 'my-events-control__toggle my-events-control__toggle--active'
            : 'my-events-control__toggle'
        }
        data-tour-anchor="framings"
        aria-expanded={open}
        aria-controls="framings-rail"
        aria-label={t('framings.toggle')}
        title={t('framings.toggle')}
        onClick={() => onOpenChange(!open)}
      >
        <FramingsFocusIcon />
      </button>
    </div>
  )
}

export function FramingsPanel({
  open,
  onClose,
  mode,
  framings,
  spotOptions,
  filterSpotId,
  onFilterSpotIdChange,
  currentSpotId,
  currentSpotName,
  display,
  onDisplayChange,
  calendarDay,
  onCalendarDayChange,
  calendarMonth,
  onCalendarMonthChange,
  activeId,
  canSaveCurrent,
  onRequestSaveCurrent,
  editor,
  onEditorChange,
  onSubmitEditor,
  onDeleteFraming,
  onRestore,
  onEdit,
  railWidthPx,
  onRailWidthChange,
}: FramingsPanelProps) {
  const { locale: appLocale, t, tList } = useLocale()
  const dateLocale = intlLocale(appLocale)
  const [draftName, setDraftName] = useState('')
  const [draftWhen, setDraftWhen] = useState('')
  const [spotMenuOpen, setSpotMenuOpen] = useState(false)
  const [listSort, setListSort] = useState<'oldest' | 'newest'>('newest')
  const spotMenuRef = useRef<HTMLDivElement | null>(null)
  const spotLabelId = useId()

  useEffect(() => {
    if (!editor) return
    setDraftName(editor.name)
    setDraftWhen(datetimeLocalFromPeakLocal(editor.peakLocal))
  }, [editor])

  useEffect(() => {
    if (!open) setSpotMenuOpen(false)
  }, [open])

  useEffect(() => {
    if (!spotMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const root = spotMenuRef.current
      if (!root || root.contains(event.target as Node)) return
      setSpotMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSpotMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [spotMenuOpen])

  const visible = useMemo(() => {
    if (mode === 'immersive') {
      if (!currentSpotId) return []
      return framings.filter((row) => row.spotId === currentSpotId)
    }
    if (filterSpotId === 'all') return framings
    return framings.filter((row) => row.spotId === filterSpotId)
  }, [framings, mode, currentSpotId, filterSpotId])

  const groups = useMemo(() => {
    const base = groupFramingsByNight(visible)
    if (listSort === 'oldest') return base
    return [...base]
      .reverse()
      .map((group) => ({ ...group, items: [...group.items].reverse() }))
  }, [visible, listSort])
  const markedDays = useMemo(() => {
    const set = new Set<string>()
    for (const g of groups) set.add(g.day)
    return set
  }, [groups])

  const calendarGroup = useMemo(
    () => groups.find((g) => g.day === calendarDay) ?? null,
    [groups, calendarDay],
  )

  if (!open) return null

  const title = editor
    ? editor.id
      ? t('framings.rename')
      : t('framings.new')
    : mode === 'map'
      ? t('framings.titleMap')
      : t('framings.titleImmersive')

  const spotLine =
    editor?.spotName ||
    (mode === 'immersive' ? currentSpotName : null)

  const emptyMessage =
    mode === 'map'
      ? t('framings.emptyMap')
      : t('framings.emptyImmersive')

  return (
    <aside
      id="framings-rail"
      className="my-events-rail framings-rail"
      data-tour-panel="framings-rail"
      role="complementary"
      aria-label={title}
    >
      <MobileRailChrome
        onClose={onClose}
        sheetClassName="my-events-rail__sheet"
        desktopWidthPx={railWidthPx}
        onDesktopWidthChange={onRailWidthChange}
      >
        <header className="my-events-rail__header framings-rail__header">
          <div className="framings-rail__heading">
            {editor ? (
              <button
                type="button"
                className="framings-rail__back"
                aria-label={t('framings.back')}
                title={t('framings.back')}
                onClick={() => onEditorChange(null)}
              >
                ‹
              </button>
            ) : null}
            <div>
              <h2 className="my-events-rail__title" id="framings-rail-title">
                {title}
                {!editor ? (
                  <span className="my-events-rail__count">
                    {visible.length}
                  </span>
                ) : null}
              </h2>
              {spotLine ? (
                <p className="framings-rail__spot">
                  <PinIcon />
                  {spotLine}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="my-events-rail__close"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="my-events-rail__body">
          {editor ? (
            <form
              className="framings-form"
              onSubmit={(event) => {
                event.preventDefault()
                onSubmitEditor({
                  ...editor,
                  name: draftName.trim() || editor.name || t('framings.defaultName'),
                  peakLocal: editor.id
                    ? editor.peakLocal
                    : peakLocalFromDatetimeLocal(draftWhen),
                })
              }}
            >
              <label className="framings-form__field">
                <span>{t('framings.name')}</span>
                <input
                  autoFocus
                  required
                  maxLength={68}
                  value={draftName}
                  placeholder={t('framings.placeholder')}
                  onChange={(e) => setDraftName(e.target.value)}
                />
              </label>
              {!editor.id ? (
                <p className="framings-form__meta">
                  {formatFramingWhenLabel(
                    draftWhen || editor.peakLocal,
                    appLocale === 'fr',
                  )}
                  {' · '}
                  {framingViewSummary(editor.view)}
                  {' · '}
                  {framingAngleSummary(editor.view)}
                </p>
              ) : null}
              <div
                className={
                  editor.id
                    ? 'spot-save-card__actions spot-save-card__actions--edit'
                    : 'spot-save-card__actions'
                }
              >
                {editor.id ? (
                  <button
                    type="button"
                    className="spot-save-card__delete"
                    onClick={() => onDeleteFraming(editor.id!)}
                  >
                    {t('common.delete')}
                  </button>
                ) : null}
                <button type="submit" className="control-panel__primary">
                  {t('common.save')}
                </button>
              </div>
            </form>
          ) : (
            <div className="my-events-panel framings-panel">
              <div className="framings-panel__tools">
                {mode === 'immersive' ? (
                  <>
                    <button
                      type="button"
                      className="my-events-panel__add framings-panel__save"
                      data-tour-anchor="immersive-save"
                      disabled={!canSaveCurrent}
                      title={
                        canSaveCurrent
                          ? t('framings.saveCurrent')
                          : t('framings.saveDisabledTitle')
                      }
                      onClick={onRequestSaveCurrent}
                    >
                      <SaveIcon /> {t('common.save')}
                    </button>
                    {!canSaveCurrent ? (
                      <p className="framings-panel__hint">
                        {t('framings.saveHint')}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div className="framings-panel__filter">
                    <span id={spotLabelId}>{t('common.spot')}</span>
                    <div className="moon-preview-select-wrap" ref={spotMenuRef}>
                      <button
                        type="button"
                        className="moon-preview-select-trigger"
                        aria-labelledby={spotLabelId}
                        aria-label={t('framings.filterSpot')}
                        aria-haspopup="listbox"
                        aria-expanded={spotMenuOpen}
                        onClick={() => setSpotMenuOpen((value) => !value)}
                      >
                        <span>
                          {filterSpotId === 'all'
                            ? t('framings.allSpots')
                            : (spotOptions.find((opt) => opt.id === filterSpotId)
                                ?.label ?? t('framings.allSpots'))}
                        </span>
                        <svg
                          viewBox="0 0 16 16"
                          width="12"
                          height="12"
                          aria-hidden="true"
                        >
                          <path
                            d="M4 6l4 4 4-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      {spotMenuOpen ? (
                        <ul
                          className="moon-preview-select-menu moon-preview-select-menu--down"
                          role="listbox"
                          aria-labelledby={spotLabelId}
                        >
                          <li role="none">
                            <button
                              type="button"
                              role="option"
                              aria-selected={filterSpotId === 'all'}
                              className={
                                filterSpotId === 'all'
                                  ? 'moon-preview-select-option moon-preview-select-option--active'
                                  : 'moon-preview-select-option'
                              }
                              onClick={() => {
                                onFilterSpotIdChange('all')
                                setSpotMenuOpen(false)
                              }}
                            >
                              {t('framings.allSpots')}
                            </button>
                          </li>
                          {spotOptions.map((opt) => {
                            const active = opt.id === filterSpotId
                            return (
                              <li key={opt.id} role="none">
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={active}
                                  className={
                                    active
                                      ? 'moon-preview-select-option moon-preview-select-option--active'
                                      : 'moon-preview-select-option'
                                  }
                                  onClick={() => {
                                    onFilterSpotIdChange(opt.id)
                                    setSpotMenuOpen(false)
                                  }}
                                >
                                  {opt.label}
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                )}

                <div className="framings-panel__display-row">
                  <nav
                    className="framings-panel__display"
                    aria-label={t('framings.displayAria')}
                  >
                    <button
                      type="button"
                      className={
                        display === 'list'
                          ? 'framings-panel__display-btn is-active'
                          : 'framings-panel__display-btn'
                      }
                      aria-pressed={display === 'list'}
                      onClick={() => onDisplayChange('list')}
                    >
                      <ListIcon /> {t('common.list')}
                    </button>
                    <button
                      type="button"
                      className={
                        display === 'calendar'
                          ? 'framings-panel__display-btn is-active'
                          : 'framings-panel__display-btn'
                      }
                      aria-pressed={display === 'calendar'}
                      onClick={() => onDisplayChange('calendar')}
                    >
                      <CalendarIcon size={14} /> {t('common.calendar')}
                    </button>
                  </nav>
                  <button
                    type="button"
                    className="framings-panel__sort"
                    title={
                      listSort === 'newest'
                        ? t('framings.sortNewestTitle')
                        : t('framings.sortOldestTitle')
                    }
                    aria-label={
                      listSort === 'newest'
                        ? t('framings.sortNewestAria')
                        : t('framings.sortOldestAria')
                    }
                    onClick={() =>
                      setListSort((value) =>
                        value === 'newest' ? 'oldest' : 'newest',
                      )
                    }
                  >
                    <SortOrderIcon newest={listSort === 'newest'} />
                  </button>
                </div>
              </div>

              <div className="framings-panel__scroll">
              {display === 'calendar' ? (
                <section
                  className="framings-cal"
                  aria-label={t('framings.calAria')}
                >
                  <div className="framings-cal__nav">
                    <button
                      type="button"
                      className="framings-cal__nav-btn"
                      aria-label={t('common.prevMonth')}
                      onClick={() =>
                        onCalendarMonthChange(shiftMonth(calendarMonth, -1))
                      }
                    >
                      ‹
                    </button>
                    <h3 aria-live="polite">{monthLabel(calendarMonth, dateLocale)}</h3>
                    <button
                      type="button"
                      className="framings-cal__nav-btn"
                      aria-label={t('common.nextMonth')}
                      onClick={() =>
                        onCalendarMonthChange(shiftMonth(calendarMonth, 1))
                      }
                    >
                      ›
                    </button>
                  </div>
                  <div className="framings-cal__weekdays" aria-hidden="true">
                    {tList('common.weekdaysMed').map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                  </div>
                  <div className="framings-cal__grid">
                    {Array.from({ length: monthStartOffset(calendarMonth) }).map(
                      (_, i) => (
                        <span key={`pad-${i}`} aria-hidden="true" />
                      ),
                    )}
                    {daysInMonth(calendarMonth).map(({ day, n }) => {
                      const marked = markedDays.has(day)
                      const selected = calendarDay === day
                      return (
                        <button
                          key={day}
                          type="button"
                          className={[
                            'framings-cal__day',
                            marked ? 'framings-cal__day--marked' : '',
                            selected ? 'framings-cal__day--selected' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          aria-pressed={selected}
                          aria-label={
                            marked
                              ? framingNightLabel(
                                  day,
                                  groups.find((g) => g.day === day)?.items ??
                                    [],
                                )
                              : day
                          }
                          onClick={() => onCalendarDayChange(day)}
                        >
                          {n}
                          {marked ? (
                            <span
                              className="framings-cal__dot"
                              aria-hidden="true"
                            />
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </section>
              ) : null}

              {display === 'list' ? (
                visible.length === 0 ? (
                  <div className="framings-empty">
                    <strong>{t('framings.emptyTitle')}</strong>
                    <p>{emptyMessage}</p>
                  </div>
                ) : (
                  groups.map((group) => (
                    <NightSection
                      key={group.day}
                      day={group.day}
                      items={group.items}
                      activeId={activeId}
                      showSpot={mode === 'map'}
                      onRestore={onRestore}
                      onEdit={onEdit}
                    />
                  ))
                )
              ) : calendarGroup ? (
                <NightSection
                  day={calendarGroup.day}
                  items={calendarGroup.items}
                  activeId={activeId}
                  showSpot={mode === 'map'}
                  onRestore={onRestore}
                  onEdit={onEdit}
                />
              ) : (
                <div className="framings-empty">
                  <strong>{t('framings.emptyDayTitle')}</strong>
                  <p>{t('framings.emptyDayHint')}</p>
                </div>
              )}
              </div>
            </div>
          )}
        </div>
      </MobileRailChrome>
    </aside>
  )
}

function NightSection({
  day,
  items,
  activeId,
  showSpot,
  onRestore,
  onEdit,
}: {
  day: string
  items: PersonalFraming[]
  activeId: string | null
  showSpot: boolean
  onRestore: (framing: PersonalFraming) => void
  onEdit: (framing: PersonalFraming) => void
}) {
  const t = useT()
  return (
    <section className="framings-night">
      <header className="framings-night__header">
        <h3>{framingNightLabel(day, items)}</h3>
        <small>
          {items.length === 1
            ? t('framings.countOne', { n: items.length })
            : t('framings.countOther', { n: items.length })}
        </small>
      </header>
      <ul className="framings-list" aria-label={t('framings.listAria')}>
        {items.map((framing) => {
          const active = framing.id === activeId
          const clock = formatCardClock(framing.peakLocal)
          const typeLabel = framingTypeBadgeLabel(framing.view)
          return (
            <li
              key={framing.id}
              className={
                active ? 'framings-item is-active' : 'framings-item'
              }
            >
              <button
                type="button"
                className="framings-item__row"
                aria-pressed={active}
                aria-current={active ? 'true' : undefined}
                title={t('framings.reopen')}
                onClick={() => onRestore(framing)}
              >
                <FramingThumb
                  thumbId={framing.thumbId}
                  view={framing.view}
                />
                <span className="framings-item__details">
                  <strong className="framings-item__name">
                    {framing.name}
                  </strong>
                  <span className="framings-item__meta">
                    <span className="framings-item__type">{typeLabel}</span>
                    <span className="framings-item__focal">
                      {Math.round(framing.view.focalMm)} mm
                    </span>
                  </span>
                  {showSpot ? (
                    <small className="framings-item__spot">
                      {framing.spotName}
                    </small>
                  ) : null}
                </span>
                {clock ? (
                  <time className="framings-item__clock" dateTime={clock}>
                    {clock}
                  </time>
                ) : null}
              </button>
              <button
                type="button"
                className="framings-item__edit"
                aria-label={
                  clock
                    ? t('framings.renameItem', {
                        type: typeLabel,
                        name: framing.name,
                        clock,
                      })
                    : t('framings.editItem', { name: framing.name })
                }
                title={t('common.edit')}
                onClick={() => onEdit(framing)}
              >
                <SquarePenIcon />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Ensure calendarDay stays in sync when month has frames. */
export function preferFramingCalendarDay(
  month: string,
  groups: { day: string }[],
  current: string,
): string {
  if (current.startsWith(month)) return current
  const inMonth = groups.find((g) => g.day.startsWith(month))
  if (inMonth) return inMonth.day
  return `${month}-01`
}

export function framingMonthFromDay(day: string): string {
  return day.slice(0, 7)
}

export function shiftFramingCalendarDay(day: string, delta: number): string {
  return shiftIsoDate(day, delta) ?? day
}
