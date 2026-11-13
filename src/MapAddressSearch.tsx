import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { searchAddresses, type AddressSearchResult } from './addressSearch'

const DEBOUNCE_MS = 420
const MIN_QUERY_LENGTH = 3

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
  const listId = useId()
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

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
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
  }, [open, onOpenChange])

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
  }, [open, query])

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
    } else if (event.key === 'Enter') {
      // form submit handles it
    }
  }

  if (!open) return null

  const center = getMapCenter()

  return (
    <div ref={rootRef} className="map-address-search">
      <form className="map-address-search__form" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          className="map-address-search__input"
          type="search"
          value={query}
          placeholder="Rechercher un lieu…"
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
      {center ? (
        <p className="map-address-search__near">
          Priorité près de {center.lat.toFixed(2)}°, {center.lon.toFixed(2)}°
        </p>
      ) : null}
      {status === 'loading' ? (
        <p className="map-address-search__hint">Recherche…</p>
      ) : null}
      {status === 'error' ? (
        <p className="map-address-search__hint">Erreur de recherche</p>
      ) : null}
      {status === 'ready' && results.length === 0 ? (
        <p className="map-address-search__hint">Aucun résultat</p>
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
    </div>
  )
}
