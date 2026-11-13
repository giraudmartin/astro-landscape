import { useEffect, useId, useRef, useState } from 'react'
import {
  clampPanoramaCount,
  clampPanoramaOverlap,
  maxPanoramaCountForCoverage,
  panoramaCoverageDeg,
  panoramaShotCount,
  PANORAMA_COUNT_MIN,
  PANORAMA_OVERLAP_MAX,
  PANORAMA_OVERLAP_MIN,
  PANORAMA_PROJECTION_LABELS,
  PANORAMA_PROJECTION_MODES,
  PANORAMA_VERTICAL_COVERAGE_MAX_DEG,
  type PanoramaPlan,
  type PanoramaProjectionMode,
} from './panorama'
import type { ViewfinderOrientation } from './lensFov'
import {
  CameraBodyIcon,
  ChevronDownIcon,
  PanoramaGridIcon,
} from './psIcons'

type ViewfinderPanoramaPanelProps = {
  plan: PanoramaPlan
  opticalHFovDeg: number
  opticalVFovDeg: number
  onChange: (next: PanoramaPlan) => void
  /** Controlled open state (capsule / parent owns the trigger). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Hide the built-in summary toggle — parent provides the trigger. */
  hideToggle?: boolean
  /** Shown in the prototype pill next to the shot count. */
  focalMm?: number
  orientation?: ViewfinderOrientation
  /** Opens camera settings (prototype « Modifier l’appareil photo »). */
  onEditCamera?: () => void
}

/**
 * Panorama planner — capsule popup matches the validated prototype
 * (« Panorama »), dock toggle kept for non-capsule hosts.
 */
export function ViewfinderPanoramaPanel({
  plan,
  opticalHFovDeg,
  opticalVFovDeg,
  onChange,
  open: openProp,
  onOpenChange,
  hideToggle = false,
  focalMm,
  orientation = 'landscape',
  onEditCamera,
}: ViewfinderPanoramaPanelProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = openProp ?? uncontrolledOpen
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next
    onOpenChange?.(value)
    if (openProp === undefined) setUncontrolledOpen(value)
  }
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()

  const maxColumns = maxPanoramaCountForCoverage(
    opticalHFovDeg,
    plan.overlapPercent,
  )
  const maxRows = maxPanoramaCountForCoverage(
    opticalVFovDeg,
    plan.overlapPercent,
    PANORAMA_VERTICAL_COVERAGE_MAX_DEG,
  )
  const columns = clampPanoramaCount(plan.columns, maxColumns)
  const rows = clampPanoramaCount(plan.rows, maxRows)

  // Keep plan inside the 360° envelope when FOV / overlap changes.
  useEffect(() => {
    if (columns === plan.columns && rows === plan.rows) return
    onChange({ ...plan, columns, rows })
    // Intentionally omit `plan` / `onChange` to avoid feedback loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clamp sync only
  }, [columns, rows, plan.columns, plan.rows])

  const shots = panoramaShotCount(columns, rows)
  const coverH = panoramaCoverageDeg(
    opticalHFovDeg,
    columns,
    plan.overlapPercent,
  )
  const coverV = panoramaCoverageDeg(opticalVFovDeg, rows, plan.overlapPercent)

  useEffect(() => {
    if (!open) return
    // Capsule owns outside-click when hideToggle — avoid fighting the trigger.
    const onPointerDown = hideToggle
      ? null
      : (event: PointerEvent) => {
          const target = event.target as Node | null
          if (!target) return
          if (rootRef.current?.contains(target)) return
          setOpen(false)
        }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    if (onPointerDown) {
      window.addEventListener('pointerdown', onPointerDown, true)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      if (onPointerDown) {
        window.removeEventListener('pointerdown', onPointerDown, true)
      }
      window.removeEventListener('keydown', onKey)
    }
  }, [open, hideToggle])

  const patch = (partial: Partial<PanoramaPlan>) => {
    const next = { ...plan, ...partial }
    const nextOverlap = clampPanoramaOverlap(next.overlapPercent)
    const nextMaxCols = maxPanoramaCountForCoverage(
      opticalHFovDeg,
      nextOverlap,
    )
    const nextMaxRows = maxPanoramaCountForCoverage(
      opticalVFovDeg,
      nextOverlap,
      PANORAMA_VERTICAL_COVERAGE_MAX_DEG,
    )
    onChange({
      ...next,
      overlapPercent: nextOverlap,
      columns: clampPanoramaCount(next.columns, nextMaxCols),
      rows: clampPanoramaCount(next.rows, nextMaxRows),
    })
  }

  const summary = plan.enabled
    ? `${columns}×${rows} · ${plan.overlapPercent}%`
    : 'Panorama off'

  if (hideToggle && !open) return null

  const cameraPill =
    focalMm != null
      ? `${Math.round(focalMm)} mm · ${
          orientation === 'landscape' ? 'Paysage' : 'Portrait'
        }`
      : null

  const popupBody = (
    <div
      id={panelId}
      className="vf-camera-pop vf-pano-pop"
      role="dialog"
      aria-label="Panorama"
    >
      <header className="vf-camera-pop__head">
        <h2 className="vf-camera-pop__title">Panorama</h2>
        <button
          type="button"
          className="vf-camera-pop__close"
          aria-label="Fermer les réglages"
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </header>

      <div className="vf-pano-pop__summary">
        <span className="vf-camera-pop__big">
          {shots}
          <span className="vf-camera-pop__unit"> vues</span>
        </span>
        {cameraPill ? (
          <span className="vf-pano-pop__pill">{cameraPill}</span>
        ) : (
          <span className="vf-camera-pop__hint vf-pano-pop__cover">
            ≈ {coverH.toFixed(0)}° × {coverV.toFixed(0)}° ·{' '}
            {plan.overlapPercent}%
          </span>
        )}
      </div>

      <div className="vf-camera-pop__twocol">
        <div className="vf-camera-pop__field">
          <span className="vf-camera-pop__label">Colonnes</span>
          <div className="moon-preview-stepper">
            <button
              type="button"
              aria-label="Moins de colonnes"
              disabled={columns <= PANORAMA_COUNT_MIN}
              onClick={() =>
                patch({
                  columns: columns - 1,
                  enabled: true,
                })
              }
            >
              −
            </button>
            <output>{columns}</output>
            <button
              type="button"
              aria-label="Plus de colonnes"
              disabled={columns >= maxColumns}
              title={
                columns >= maxColumns
                  ? 'Couverture horizontale limitée à 360°'
                  : undefined
              }
              onClick={() =>
                patch({
                  columns: columns + 1,
                  enabled: true,
                })
              }
            >
              +
            </button>
          </div>
        </div>

        <div className="vf-camera-pop__field">
          <span className="vf-camera-pop__label">Lignes</span>
          <div className="moon-preview-stepper">
            <button
              type="button"
              aria-label="Moins de lignes"
              disabled={rows <= PANORAMA_COUNT_MIN}
              onClick={() =>
                patch({
                  rows: rows - 1,
                  enabled: true,
                })
              }
            >
              −
            </button>
            <output>{rows}</output>
            <button
              type="button"
              aria-label="Plus de lignes"
              disabled={rows >= maxRows}
              title={
                rows >= maxRows
                  ? 'Couverture verticale limitée à 180°'
                  : undefined
              }
              onClick={() =>
                patch({
                  rows: rows + 1,
                  enabled: true,
                })
              }
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="vf-camera-pop__field">
        <div className="vf-pano-pop__overlap-head">
          <span className="vf-camera-pop__label">Recouvrement</span>
          <b className="vf-pano-pop__overlap-value">{plan.overlapPercent}%</b>
        </div>
        <input
          className="vf-pano-pop__range"
          type="range"
          min={PANORAMA_OVERLAP_MIN}
          max={PANORAMA_OVERLAP_MAX}
          step={1}
          value={plan.overlapPercent}
          aria-label="Recouvrement entre vues"
          onChange={(event) =>
            patch({
              overlapPercent: Number(event.target.value),
              enabled: true,
            })
          }
        />
      </div>

      <div className="vf-camera-pop__field">
        <label className="vf-camera-pop__label" htmlFor={`${panelId}-assemblage`}>
          Assemblage
        </label>
        <select
          id={`${panelId}-assemblage`}
          className="vf-pano-select"
          aria-label="Mode d’assemblage panorama"
          value={plan.projectionMode}
          onChange={(event) =>
            patch({
              projectionMode: event.target.value as PanoramaProjectionMode,
              enabled: true,
            })
          }
        >
          {PANORAMA_PROJECTION_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {PANORAMA_PROJECTION_LABELS[mode]}
            </option>
          ))}
        </select>
      </div>

      <div className="vf-camera-pop__field">
        <span className="vf-camera-pop__label">Affichage</span>
        <div className="vf-pano-viz">
          <button
            type="button"
            className={
              plan.showFrames ? 'vf-pano-switch is-active' : 'vf-pano-switch'
            }
            aria-pressed={plan.showFrames}
            title="Afficher ou masquer les cadres des tuiles"
            onClick={() => patch({ showFrames: !plan.showFrames })}
          >
            Cadres
          </button>
          <button
            type="button"
            className={
              plan.showOverlap ? 'vf-pano-switch is-active' : 'vf-pano-switch'
            }
            aria-pressed={plan.showOverlap}
            title="Afficher ou masquer les zones de recouvrement"
            onClick={() => patch({ showOverlap: !plan.showOverlap })}
          >
            Overlap
          </button>
        </div>
      </div>

      {onEditCamera ? (
        <button
          type="button"
          className="vf-pano-pop__camera"
          onClick={onEditCamera}
        >
          <CameraBodyIcon size={16} />
          Modifier l’appareil photo
        </button>
      ) : null}

      <p className="vf-camera-pop__hint">
        Cadres et overlap se contrôlent ici. Le mode Pano de la capsule active
        le plan sans interrupteur ON/OFF.
      </p>
    </div>
  )

  return (
    <div
      ref={rootRef}
      className={
        open
          ? hideToggle
            ? 'vf-camera-panel vf-camera-panel--pop is-open'
            : 'vf-camera-panel immersive-dock__item is-open'
          : hideToggle
            ? 'vf-camera-panel vf-camera-panel--pop'
            : 'vf-camera-panel immersive-dock__item'
      }
    >
      {hideToggle ? null : (
        <button
          type="button"
          className="vf-camera-panel__toggle immersive-dock__row"
          aria-expanded={open}
          aria-controls={panelId}
          title="Panorama"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="immersive-dock__row-icon" aria-hidden="true">
            <PanoramaGridIcon size={14} />
          </span>
          <span className="vf-camera-panel__toggle-main">{summary}</span>
          <span className="vf-camera-panel__toggle-meta">Pano</span>
          <ChevronDownIcon className="vf-camera-panel__chevron" size={12} />
        </button>
      )}

      {open ? (
        hideToggle ? (
          popupBody
        ) : (
          <div id={panelId} className="vf-camera-panel__body">
            {popupBody}
          </div>
        )
      ) : null}
    </div>
  )
}
