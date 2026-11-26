import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { searchAddresses, type AddressSearchResult } from './addressSearch'
import { useT } from './i18n'
import { OPERATE_PHONE_MQ, useMatchMedia } from './useMatchMedia'
import {
  phoneSheetPlacement,
  usePhoneSheetViewport,
} from './usePhoneSheetViewport'

const DEBOUNCE_MS = 420
const MIN_QUERY_LENGTH = 3
const SHEET_DISMISS_FRAC = 0.28

type MapCenter = { lat: number; lon: number }

type MapAddressSearchProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (result: AddressSearchResult) => void
  getMapCenter: () => MapCenter | null
  getViewbox?: () => [number, number, number, number] | null
}

export function MapAddressSearch({
  open,
  onOpenChange,
  onSelect,
  getMapCenter,
  getViewbox,
}: MapAddressSearchProps) {
  const t = useT()
  const isPhone = useMatchMedia(OPERATE_PHONE_MQ)
  const listId = useId()
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const getViewboxRef = useRef(getViewbox)
  getViewboxRef.current = getViewbox

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AddressSearchResult[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  )

  const dragRef = useRef<{
    pointerId: number
    startY: number
    startOffset: number
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const sheetFrame = usePhoneSheetViewport(isPhone, isPhone && open)
  /** 0 = closed (off-screen), 1 = fully open. Phone sheet only. */
  const [progress, setProgress] = useState(0)
  const [dragging, setDragging] = useState(false)
  /** Keep the portal mounted through the close slide. */
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
    if (!isPhone) return
    const root = document.documentElement
    const active = open || sheetMounted
    root.classList.toggle('address-search-open', active)
    return () => root.classList.remove('address-search-open')
  }, [isPhone, open, sheetMounted])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open || isPhone) return
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      if (!root) return
      if (event.target instanceof Node && root.contains(event.target)) return
      const toggle = (event.target as Element | null)?.closest?.(
        '[data-map-address-search-toggle]',
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
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    if (!isPhone) return
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange, isPhone])

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort()
      abortRef.current = null
      setQuery('')
      setResults([])
      setActiveIndex(-1)
      setStatus('idle')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort()
      abortRef.current = null
      setResults([])
      setActiveIndex(-1)
      setStatus('idle')
      return
    }

    const timer = window.setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setStatus('loading')
      setActiveIndex(-1)
      const near = getMapCenter()
      void searchAddresses(trimmed, {
        limit: 5,
        signal: controller.signal,
        near,
        viewbox: getViewboxRef.current?.() ?? null,
      })
        .then((next) => {
          if (controller.signal.aborted) return
          setResults(next)
          setStatus('ready')
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          if (error instanceof DOMException && error.name === 'AbortError') {
            return
          }
          setResults([])
          setStatus('error')
        })
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [open, query]) // getMapCenter / viewbox read at request time

  const choose = (result: AddressSearchResult) => {
    onSelect(result)
    onOpenChange(false)
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (activeIndex >= 0 && results[activeIndex]) {
      choose(results[activeIndex])
      return
    }
    if (results[0]) choose(results[0])
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, -1))
    }
  }

  const placement = phoneSheetPlacement(sheetFrame)
  const openHeight = placement.openHeight
  const offsetY = openHeight * (1 - progress)

  const endDrag = (clientY: number): void => {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (!drag) return
    const delta = clientY - drag.startY
    if (drag.moved || Math.abs(delta) > 10) {
      suppressClickRef.current = true
    }
    const nextProgress = Math.min(
      1,
      Math.max(0, drag.startOffset - delta / openHeight),
    )
    if (!drag.moved && Math.abs(delta) <= 10) {
      setProgress(open ? 1 : 0)
      return
    }
    const keepOpen =
      open && nextProgress > 0.55 && delta < openHeight * SHEET_DISMISS_FRAC
    const openIt = nextProgress > 0.45 || (delta < 0 && nextProgress > 0.2)
    const next = open ? keepOpen : openIt
    setProgress(next ? 1 : 0)
    onOpenChange(next)
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
    if (Math.abs(delta) > 8) drag.moved = true
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
      <form className="map-address-search__form" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          className="map-address-search__input"
          type="search"
          value={query}
          placeholder={t('map.searchPlaceholder')}
          aria-label={t('map.searchPlace')}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
          }
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
        />
      </form>
      {status === 'loading' ? (
        <p className="map-address-search__hint">{t('map.searchLoading')}</p>
      ) : null}
      {status === 'error' ? (
        <p className="map-address-search__hint">{t('map.searchError')}</p>
      ) : null}
      {status === 'ready' && results.length === 0 ? (
        <p className="map-address-search__hint">
          {t('common.searchNoResults')}
        </p>
      ) : null}
      {results.length > 0 ? (
        <div className="map-address-search__results">
          <ul id={listId} className="map-address-search__list" role="listbox">
            {results.map((result, index) => (
              <li key={`${result.lat}-${result.lon}-${index}`}>
                <button
                  type="button"
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={
                    index === activeIndex
                      ? 'map-address-search__option map-address-search__option--active'
                      : 'map-address-search__option'
                  }
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(result)}
                >
                  {result.label}
                </button>
              </li>
            ))}
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
            {t('map.searchPlace')}
          </h2>
          <div className="map-address-search map-address-search--sheet">
            {searchBody}
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  if (!open) return null

  return (
    <div ref={rootRef} className="map-address-search">
      {searchBody}
    </div>
  )
}
