import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  buildSearchIndex,
  celestialObjectDisplayName,
  loadCelestialCatalog,
  searchCelestialObjects,
  typeLabel,
  type CelestialObject,
  type SearchHit,
} from './celestialObjects'
import { useT } from './i18n'
import { OPERATE_PHONE_MQ, useMatchMedia } from './useMatchMedia'
import {
  phoneSheetPlacement,
  usePhoneSheetViewport,
} from './usePhoneSheetViewport'

const SHEET_DISMISS_FRAC = 0.28

type CelestialSearchPanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (object: CelestialObject) => void
  selectedId: string | null
}

export function CelestialSearchPanel({
  open,
  onOpenChange,
  onSelect,
  selectedId,
}: CelestialSearchPanelProps) {
  const t = useT()
  const isPhone = useMatchMedia(OPERATE_PHONE_MQ)
  const listId = useId()
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  )
  const [index, setIndex] = useState<ReturnType<typeof buildSearchIndex> | null>(
    null,
  )
  const [activeIndex, setActiveIndex] = useState(-1)

  const dragRef = useRef<{
    pointerId: number
    startY: number
    startOffset: number
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const sheetFrame = usePhoneSheetViewport(isPhone, isPhone && open)
  const [progress, setProgress] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [sheetMounted, setSheetMounted] = useState(false)

  useEffect(() => {
    if (!isPhone || dragging) return
    if (open) {
      setSheetMounted(true)
      const frame = window.requestAnimationFrame(() => setProgress(1))
      return () => window.cancelAnimationFrame(frame)
    }
    setProgress(0)
    const timer = window.setTimeout(() => setSheetMounted(false), 240)
    return () => window.clearTimeout(timer)
  }, [open, dragging, isPhone])

  useEffect(() => {
    if (!isPhone || !open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isPhone, open])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true }),
    )
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open || isPhone) return
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      if (!root) return
      if (event.target instanceof Node && root.contains(event.target)) return
      const toggle = (event.target as Element | null)?.closest?.(
        '[data-celestial-search-toggle]',
      )
      if (toggle) return
      onOpenChange(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onOpenChange, isPhone])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setActiveIndex(-1)
      return
    }
    if (index) {
      setStatus('ready')
      return
    }
    let cancelled = false
    setStatus('loading')
    void loadCelestialCatalog()
      .then((catalog) => {
        if (cancelled) return
        setIndex(buildSearchIndex(catalog))
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [open, index])

  const hits: SearchHit[] = useMemo(() => {
    if (!index || !query.trim()) return []
    return searchCelestialObjects(index, query, 12)
  }, [index, query])

  useEffect(() => {
    setActiveIndex(hits.length ? 0 : -1)
  }, [hits])

  const pick = (object: CelestialObject) => {
    onSelect(object)
    onOpenChange(false)
    setQuery('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!hits.length) return
      setActiveIndex((i) => (i + 1) % hits.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!hits.length) return
      setActiveIndex((i) => (i <= 0 ? hits.length - 1 : i - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[activeIndex] ?? hits[0]
      if (hit) pick(hit.object)
    }
  }

  const placement = phoneSheetPlacement(sheetFrame)
  const openHeight = placement.openHeight
  const offsetY = (1 - progress) * openHeight

  const endDrag = (clientY: number) => {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (!drag) return
    if (drag.moved) suppressClickRef.current = true
    const delta = clientY - drag.startY
    const next = Math.min(
      1,
      Math.max(0, drag.startOffset - delta / openHeight),
    )
    if (next < 1 - SHEET_DISMISS_FRAC) {
      setProgress(0)
      onOpenChange(false)
      return
    }
    setProgress(1)
  }

  const onHandlePointerDown = (
    event: ReactPointerEvent<HTMLElement>,
  ): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset: progress,
      moved: false,
    }
    setDragging(true)
  }

  const onHandlePointerMove = (
    event: ReactPointerEvent<HTMLElement>,
  ): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = event.clientY - drag.startY
    if (Math.abs(delta) > 4) drag.moved = true
    const next = Math.min(
      1,
      Math.max(0, drag.startOffset - delta / openHeight),
    )
    setProgress(next)
  }

  const onHandlePointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    endDrag(event.clientY)
  }

  const searchBody: ReactNode = (
    <>
      <form
        className="celestial-search__form"
        onSubmit={(event) => {
          event.preventDefault()
          const hit = hits[activeIndex] ?? hits[0]
          if (hit) pick(hit.object)
        }}
      >
        <input
          ref={inputRef}
          className="celestial-search__input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t('celestial.search.placeholder')}
          aria-label={t('celestial.search.aria')}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </form>

      {status === 'loading' ? (
        <p className="celestial-search__hint">{t('celestial.search.loading')}</p>
      ) : null}
      {status === 'error' ? (
        <p className="celestial-search__hint celestial-search__hint--error">
          {t('celestial.search.error')}
        </p>
      ) : null}
      {status === 'ready' && query.trim() && !hits.length ? (
        <p className="celestial-search__hint">{t('common.searchNoResultsDot')}</p>
      ) : null}

      {hits.length ? (
        <div className="celestial-search__results">
          <ul
            id={listId}
            className="celestial-search__list"
            role="listbox"
            aria-label={t('celestial.search.resultsAria')}
          >
            {hits.map((hit, i) => {
              const active = i === activeIndex
              const selected = hit.object.id === selectedId
              return (
                <li key={hit.object.id} role="presentation">
                  <button
                    type="button"
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={active}
                    className={
                      active || selected
                        ? 'celestial-search__option celestial-search__option--active'
                        : 'celestial-search__option'
                    }
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => pick(hit.object)}
                  >
                    <span className="celestial-search__option-main">
                      <span className="celestial-search__option-name">
                        {celestialObjectDisplayName(hit.object)}
                      </span>
                      <span className="celestial-search__option-type">
                        {typeLabel(hit.object.type)}
                      </span>
                    </span>
                    {hit.matchedOn &&
                    normalizeLoose(hit.matchedOn) !==
                      normalizeLoose(hit.object.name) &&
                    normalizeLoose(hit.matchedOn) !==
                      normalizeLoose(celestialObjectDisplayName(hit.object)) ? (
                      <span className="celestial-search__option-meta">
                        {hit.matchedOn}
                      </span>
                    ) : hit.object.mag != null ? (
                      <span className="celestial-search__option-meta">
                        {t('celestial.search.mag', {
                          mag: hit.object.mag.toFixed(1),
                        })}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </>
  )

  if (isPhone) {
    if (typeof document === 'undefined') return null
    if (!sheetMounted) return null

    return createPortal(
      <div
        className={`map-address-search-sheet${
          open || progress > 0.02 ? ' is-open' : ''
        }${placement.keyboardOpen ? ' is-keyboard' : ''}`}
        style={
          {
            '--mas-open-h': `${openHeight}px`,
            '--mas-offset': `${offsetY}px`,
            '--vv-top': `${placement.top}px`,
            '--vv-height': `${placement.height}px`,
          } as CSSProperties
        }
      >
        {progress > 0.02 ? (
          <button
            type="button"
            className="map-address-search-sheet__backdrop"
            aria-label={t('common.close')}
            style={{ opacity: Math.min(1, progress) * 0.45 }}
            onClick={() => {
              setProgress(0)
              onOpenChange(false)
            }}
          />
        ) : null}

        <div
          ref={rootRef}
          className={
            dragging
              ? 'map-address-search-sheet__panel is-dragging'
              : 'map-address-search-sheet__panel'
          }
          role="dialog"
          aria-modal={open}
          aria-labelledby={titleId}
          aria-hidden={progress < 0.05}
        >
          <button
            type="button"
            className="map-address-search-sheet__handle"
            aria-label={t('map.searchDismissHandle')}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false
                return
              }
              setProgress(0)
              onOpenChange(false)
            }}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
          >
            <span
              className="map-address-search-sheet__handle-bar"
              aria-hidden="true"
            />
          </button>
          <h2 id={titleId} className="u-sr-only">
            {t('immersive.searchCelestial')}
          </h2>
          <div className="celestial-search celestial-search--sheet">
            {searchBody}
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  if (!open) return null

  return (
    <div ref={rootRef} className="celestial-search" role="search">
      {searchBody}
    </div>
  )
}

function normalizeLoose(value: string): string {
  return value.trim().toLowerCase()
}
