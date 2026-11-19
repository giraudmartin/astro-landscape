import { useEffect, useMemo, useState } from 'react'
import { MobileRailChrome } from './MobileRailChrome'
import { FramingThumb } from './FramingThumb'
import { shiftIsoDate } from './celestial'
import {
  datetimeLocalFromPeakLocal,
  framingAngleSummary,
  framingNightGroupDay,
  framingNightLabel,
  framingViewSummary,
  groupFramingsByNight,
  peakLocalFromDatetimeLocal,
  type FramingViewSnapshot,
  type PersonalFraming,
} from './personalFramings'
import { CalendarIcon } from './psIcons'

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

function formatTime(peakLocal: string): string {
  const hm = peakLocal.slice(11, 16)
  return hm ? hm.replace(':', ' h ') : ''
}

function formatAfterMidnightPrefix(peakLocal: string): string {
  const cal = peakLocal.slice(0, 10)
  const group = framingNightGroupDay(peakLocal)
  if (cal === group) return ''
  const d = new Date(`${cal}T12:00:00Z`)
  const day = d.getUTCDate()
  const month = new Intl.DateTimeFormat('fr-FR', {
    month: 'short',
    timeZone: 'UTC',
  }).format(d)
  return `${day} ${month} · `
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  return new Intl.DateTimeFormat('fr-FR', {
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

/** Lucide focus — sized by `.my-events-control__toggle svg` like Mes spots. */
function FramingsMapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    </svg>
  )
}

export function FramingsToggle({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <div className="my-events-control framings-control">
      <button
        type="button"
        className={
          open
            ? 'my-events-control__toggle my-events-control__toggle--active'
            : 'my-events-control__toggle'
        }
        aria-expanded={open}
        aria-controls="framings-rail"
        aria-label="Mes cadrages"
        title="Mes cadrages"
        onClick={() => onOpenChange(!open)}
      >
        <FramingsMapIcon />
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
}: FramingsPanelProps) {
  const [draftName, setDraftName] = useState('')
  const [draftWhen, setDraftWhen] = useState('')

  useEffect(() => {
    if (!editor) return
    setDraftName(editor.name)
    setDraftWhen(datetimeLocalFromPeakLocal(editor.peakLocal))
  }, [editor])

  const visible = useMemo(() => {
    if (mode === 'immersive') {
      if (!currentSpotId) return []
      return framings.filter((row) => row.spotId === currentSpotId)
    }
    if (filterSpotId === 'all') return framings
    return framings.filter((row) => row.spotId === filterSpotId)
  }, [framings, mode, currentSpotId, filterSpotId])

  const groups = useMemo(() => groupFramingsByNight(visible), [visible])
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
      ? 'Modifier le cadrage'
      : 'Enregistrer le cadrage actuel'
    : mode === 'map'
      ? 'Mes cadrages'
      : 'Cadrages'

  const spotLine =
    editor?.spotName ||
    (mode === 'immersive' ? currentSpotName : null)

  const emptyMessage =
    mode === 'map'
      ? 'Les cadrages enregistrés depuis la vue trépied apparaîtront ici.'
      : 'Enregistre le cadrage actuel pour le retrouver à cette heure et à ce spot.'

  return (
    <aside
      id="framings-rail"
      className="my-events-rail framings-rail"
      role="complementary"
      aria-label={title}
    >
      <MobileRailChrome onClose={onClose} sheetClassName="my-events-rail__sheet">
        <header className="my-events-rail__header framings-rail__header">
          <div className="framings-rail__heading">
            {editor ? (
              <button
                type="button"
                className="framings-rail__back"
                aria-label="Retour aux cadrages"
                title="Retour aux cadrages"
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
            aria-label="Fermer"
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
                  name: draftName.trim() || editor.name || 'Cadrage',
                  peakLocal: peakLocalFromDatetimeLocal(draftWhen),
                })
              }}
            >
              <label className="framings-form__field">
                <span>Nom du cadrage</span>
                <input
                  autoFocus
                  required
                  maxLength={68}
                  value={draftName}
                  placeholder="Ex. Orion au-dessus des crêtes"
                  onChange={(e) => setDraftName(e.target.value)}
                />
              </label>
              <label className="framings-form__field">
                <span>Date et heure au spot</span>
                <input
                  type="datetime-local"
                  required
                  min="1900-01-02T00:00"
                  max="2099-12-31T23:59"
                  value={draftWhen}
                  onChange={(e) => setDraftWhen(e.target.value)}
                />
              </label>
              <div className="framings-form__summary">
                <FramingThumb thumbId={null} view={editor.view} />
                <div>
                  <strong>{framingViewSummary(editor.view)}</strong>
                  <small>{framingAngleSummary(editor.view)}</small>
                </div>
              </div>
              {!editor.id ? (
                <p className="framings-form__hint">
                  La date, l’heure et les réglages sont repris de ta vue
                  trépied.
                </p>
              ) : null}
              <div className="framings-form__actions">
                {editor.id ? (
                  <button
                    type="button"
                    className="spot-save-card__delete"
                    onClick={() => onDeleteFraming(editor.id!)}
                  >
                    Supprimer
                  </button>
                ) : null}
                <button
                  type="button"
                  className="framings-form__cancel"
                  onClick={() => onEditorChange(null)}
                >
                  Annuler
                </button>
                <button type="submit" className="control-panel__primary">
                  Enregistrer
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
                      disabled={!canSaveCurrent}
                      title={
                        canSaveCurrent
                          ? 'Enregistrer le cadrage actuel'
                          : 'Passe en Photo ou Pano et sélectionne un spot enregistré'
                      }
                      onClick={onRequestSaveCurrent}
                    >
                      + Enregistrer le cadrage actuel
                    </button>
                    {!canSaveCurrent ? (
                      <p className="framings-panel__hint">
                        Passe en Photo ou Pano pour enregistrer un cadrage.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <label className="framings-panel__filter">
                    <span>Spot</span>
                    <select
                      value={filterSpotId}
                      onChange={(e) => onFilterSpotIdChange(e.target.value)}
                    >
                      <option value="all">Tous les spots</option>
                      {spotOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <nav
                  className="framings-panel__display"
                  aria-label="Affichage des cadrages"
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
                    <ListIcon /> Liste
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
                    <CalendarIcon size={14} /> Calendrier
                  </button>
                </nav>
              </div>

              {display === 'calendar' ? (
                <section
                  className="framings-cal"
                  aria-label="Calendrier des cadrages"
                >
                  <div className="framings-cal__nav">
                    <button
                      type="button"
                      className="framings-cal__nav-btn"
                      aria-label="Mois précédent"
                      onClick={() =>
                        onCalendarMonthChange(shiftMonth(calendarMonth, -1))
                      }
                    >
                      ‹
                    </button>
                    <h3 aria-live="polite">{monthLabel(calendarMonth)}</h3>
                    <button
                      type="button"
                      className="framings-cal__nav-btn"
                      aria-label="Mois suivant"
                      onClick={() =>
                        onCalendarMonthChange(shiftMonth(calendarMonth, 1))
                      }
                    >
                      ›
                    </button>
                  </div>
                  <div className="framings-cal__weekdays" aria-hidden="true">
                    {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(
                      (d) => (
                        <span key={d}>{d}</span>
                      ),
                    )}
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
                    <strong>Aucun cadrage enregistré</strong>
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
                  <strong>Aucun cadrage à cette date</strong>
                  <p>
                    Choisis une autre date ou affiche la liste complète.
                  </p>
                </div>
              )}
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
  return (
    <section className="framings-night">
      <header className="framings-night__header">
        <h3>{framingNightLabel(day, items)}</h3>
        <small>
          {items.length} cadrage{items.length === 1 ? '' : 's'}
        </small>
      </header>
      <ul className="framings-list">
        {items.map((framing) => {
          const active = framing.id === activeId
          const prefix = formatAfterMidnightPrefix(framing.peakLocal)
          return (
            <li key={framing.id} className="framings-item">
              <button
                type="button"
                className={
                  active
                    ? 'framings-item__row is-active'
                    : 'framings-item__row'
                }
                aria-current={active ? 'true' : undefined}
                title="Rouvrir le cadrage"
                onClick={() => onRestore(framing)}
              >
                <FramingThumb
                  thumbId={framing.thumbId}
                  view={framing.view}
                />
                <span className="framings-item__info">
                  <strong>{framing.name}</strong>
                  <small>
                    {prefix}
                    {formatTime(framing.peakLocal)} ·{' '}
                    {Math.round(framing.view.focalMm)} mm ·{' '}
                    {framing.view.frameMode === 'pano' ? 'Pano' : 'Photo'}
                  </small>
                  {showSpot ? (
                    <small className="framings-item__spot">
                      {framing.spotName}
                    </small>
                  ) : null}
                </span>
              </button>
              <button
                type="button"
                className="framings-item__edit"
                aria-label={`Modifier ${framing.name}`}
                title="Modifier"
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
