import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import {
  ChevronDownIcon,
  ProjectionEquirectIcon,
  ProjectionOrthoIcon,
  ProjectionRectilinearIcon,
  ProjectionStereoIcon,
} from './psIcons'
import {
  STAGE_PROJECTIONS,
  type StageProjection,
} from './stelProjector'

const PROJECTION_ICONS = {
  stereographic: ProjectionStereoIcon,
  equirectangular: ProjectionEquirectIcon,
  rectilinear: ProjectionRectilinearIcon,
  orthographic: ProjectionOrthoIcon,
} as const satisfies Record<
  StageProjection,
  (props: { size?: number; className?: string }) => ReactElement
>

type ViewfinderProjectionControlProps = {
  projection: StageProjection
  onProjectionChange: (projection: StageProjection) => void
}

/**
 * Compact top-right projection selector — trigger + menu, wired to existing
 * stage projections (prototype « sélecteur compact »).
 */
export function ViewfinderProjectionControl({
  projection,
  onProjectionChange,
}: ViewfinderProjectionControlProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()
  const current =
    STAGE_PROJECTIONS.find((mode) => mode.id === projection) ??
    STAGE_PROJECTIONS[0]!
  const CurrentIcon = PROJECTION_ICONS[current.id]

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (rootRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div
      ref={rootRef}
      className={
        open
          ? 'vf-proj-control is-open'
          : 'vf-proj-control'
      }
    >
      <button
        type="button"
        className={
          open ? 'vf-proj-control__trigger is-active' : 'vf-proj-control__trigger'
        }
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="listbox"
        title="Changer la projection"
        onClick={() => setOpen((value) => !value)}
      >
        <CurrentIcon size={16} />
        <span className="vf-proj-control__muted">Projection</span>
        <b className="vf-proj-control__value">{current.shortLabel}</b>
        <ChevronDownIcon
          className="vf-proj-control__chevron"
          size={12}
        />
      </button>

      {open ? (
        <div
          id={menuId}
          className="vf-proj-control__menu"
          role="listbox"
          aria-label="Choisir la projection"
        >
          {STAGE_PROJECTIONS.map((mode) => {
            const selected = projection === mode.id
            const Icon = PROJECTION_ICONS[mode.id]
            return (
              <button
                key={mode.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={
                  selected
                    ? 'vf-proj-control__option is-active'
                    : 'vf-proj-control__option'
                }
                title={mode.title}
                onClick={() => {
                  onProjectionChange(mode.id)
                  setOpen(false)
                }}
              >
                <Icon size={16} />
                <span className="vf-proj-control__option-copy">
                  <b>{mode.label}</b>
                  <small>{mode.title}</small>
                </span>
                <em aria-hidden="true">{selected ? '✓' : ''}</em>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
