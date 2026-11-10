import { useState } from 'react'
import type { PersonalSpot } from './personalSpots'

type MySpotsToggleProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type MySpotsRailProps = {
  open: boolean
  onClose: () => void
  spots: PersonalSpot[]
  selectedId: string | null
  picking: boolean
  onStartAdd: () => void
  onCancelAdd: () => void
  onSelect: (spot: PersonalSpot) => void
  onRename: (spot: PersonalSpot) => void
  onDelete: (spotId: string) => void
  onShowAll: () => void
}

function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
      <path d="M15 5.764v15" />
      <path d="M9 3.236v15" />
    </svg>
  )
}

function SquarePenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
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

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

export function MySpotsToggle({ open, onOpenChange }: MySpotsToggleProps) {
  return (
    <div className="my-spots-control">
      <button
        type="button"
        className={
          open
            ? 'my-spots-control__toggle my-spots-control__toggle--active'
            : 'my-spots-control__toggle'
        }
        aria-expanded={open}
        aria-controls="my-spots-rail"
        aria-label="Mes spots"
        title="Mes spots"
        onClick={() => onOpenChange(!open)}
      >
        <MapIcon />
      </button>
    </div>
  )
}

export function MySpotsRail({
  open,
  onClose,
  spots,
  selectedId,
  picking,
  onStartAdd,
  onCancelAdd,
  onSelect,
  onRename,
  onDelete,
  onShowAll,
}: MySpotsRailProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleSpots =
    normalizedQuery.length === 0
      ? spots
      : spots.filter((spot) =>
          spot.name.toLocaleLowerCase().includes(normalizedQuery),
        )

  if (!open) return null

  return (
    <aside
      id="my-spots-rail"
      className="my-spots-rail"
      role="complementary"
      aria-label="Mes spots"
    >
      <div className="my-spots-rail__sheet">
        <header className="my-spots-rail__header">
          <div>
            <h2 className="my-spots-rail__title">
              Mes spots
              <span
                className="my-spots-rail__count"
                aria-label={`${spots.length} spots`}
              >
                {spots.length}
              </span>
            </h2>
            <p className="my-spots-rail__sub">
              {picking
                ? 'Clique la carte pour poser un marker.'
                : 'Ajoute des markers et rouvre-les depuis la liste.'}
              {normalizedQuery.length > 0 && spots.length > 0 ? (
                <> · {visibleSpots.length} visible(s)</>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            className="my-spots-rail__close"
            aria-label="Fermer"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="my-spots-rail__body">
          <div className="my-spots-panel">
            <button
              type="button"
              className={
                picking
                  ? 'my-spots-panel__add my-spots-panel__add--active'
                  : 'my-spots-panel__add'
              }
              onClick={() => {
                if (picking) onCancelAdd()
                else onStartAdd()
              }}
            >
              {picking ? 'Annuler le pin…' : 'Ajouter un spot sur la carte'}
            </button>

            {spots.length > 1 ? (
              <button
                type="button"
                className="my-spots-panel__add"
                onClick={onShowAll}
              >
                Tout afficher sur la carte
              </button>
            ) : null}

            {spots.length > 0 ? (
              <label className="my-spots-panel__search">
                <span className="my-spots-panel__search-label">
                  Rechercher un spot
                </span>
                <input
                  type="search"
                  value={query}
                  placeholder="Rechercher…"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            ) : null}

            {spots.length === 0 ? (
              <p className="my-spots-rail__empty">Aucun spot enregistré.</p>
            ) : visibleSpots.length === 0 ? (
              <p className="my-spots-rail__empty">Aucun résultat.</p>
            ) : (
              <ul className="my-spots-list">
                {visibleSpots.map((spot) => {
                  const selected = spot.id === selectedId
                  return (
                    <li
                      key={spot.id}
                      className={
                        selected
                          ? 'my-spots-row my-spots-row--selected'
                          : 'my-spots-row'
                      }
                    >
                      <button
                        type="button"
                        className="my-spots-row__select"
                        onClick={() => onSelect(spot)}
                      >
                        <span className="my-spots-row__name">{spot.name}</span>
                        <span className="my-spots-row__meta">
                          {spot.lat.toFixed(4)}, {spot.lon.toFixed(4)}
                          {spot.heightM != null
                            ? ` · ${Math.round(spot.heightM)} m`
                            : ''}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="my-spots-row__edit"
                        aria-label={`Renommer ${spot.name}`}
                        title="Renommer"
                        onClick={() => onRename(spot)}
                      >
                        <SquarePenIcon />
                      </button>
                      <button
                        type="button"
                        className="my-spots-row__edit my-spots-row__edit--danger"
                        aria-label={`Supprimer ${spot.name}`}
                        title="Supprimer"
                        onClick={() => onDelete(spot.id)}
                      >
                        <TrashIcon />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
