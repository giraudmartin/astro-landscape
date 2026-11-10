import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  buildSearchIndex,
  loadCelestialCatalog,
  searchCelestialObjects,
  TYPE_LABEL_FR,
  type CelestialObject,
  type SearchHit,
} from './celestialObjects'

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
  const listId = useId()
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

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
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
  }, [open, onOpenChange])

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

  if (!open) return null

  return (
    <div ref={rootRef} className="celestial-search" role="search">
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
          placeholder="Étoile, constellation, M42…"
          aria-label="Rechercher un objet céleste"
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
        <p className="celestial-search__hint">Chargement des catalogues…</p>
      ) : null}
      {status === 'error' ? (
        <p className="celestial-search__hint celestial-search__hint--error">
          Impossible de charger les catalogues.
        </p>
      ) : null}
      {status === 'ready' && query.trim() && !hits.length ? (
        <p className="celestial-search__hint">Aucun résultat.</p>
      ) : null}

      {hits.length ? (
        <div className="celestial-search__results">
          <ul
            id={listId}
            className="celestial-search__list"
            role="listbox"
            aria-label="Résultats"
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
                        {hit.object.name}
                      </span>
                      <span className="celestial-search__option-type">
                        {TYPE_LABEL_FR[hit.object.type]}
                      </span>
                    </span>
                    {hit.matchedOn &&
                    normalizeLoose(hit.matchedOn) !==
                      normalizeLoose(hit.object.name) ? (
                      <span className="celestial-search__option-meta">
                        {hit.matchedOn}
                      </span>
                    ) : hit.object.mag != null ? (
                      <span className="celestial-search__option-meta">
                        mag {hit.object.mag.toFixed(1)}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function normalizeLoose(value: string): string {
  return value.trim().toLowerCase()
}
