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

type ViewfinderPanoramaPanelProps = {
  plan: PanoramaPlan
  opticalHFovDeg: number
  opticalVFovDeg: number
  onChange: (next: PanoramaPlan) => void
}

/**
 * Collapsible panorama planner — columns × rows + overlap %, same chrome as
 * the camera panel.
 */
export function ViewfinderPanoramaPanel({
  plan,
  opticalHFovDeg,
  opticalVFovDeg,
  onChange,
}: ViewfinderPanoramaPanelProps) {
  const [open, setOpen] = useState(false)
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

  return (
    <div
      ref={rootRef}
      className={open ? 'vf-camera-panel is-open' : 'vf-camera-panel'}
    >
      <button
        type="button"
        className="vf-camera-panel__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        title="Panorama"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="vf-camera-panel__toggle-main">{summary}</span>
        <span className="vf-camera-panel__toggle-meta">Pano</span>
        <svg
          className="vf-camera-panel__chevron"
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

      {open ? (
        <div id={panelId} className="vf-camera-panel__body">
          <section className="moon-preview-focal-dock" aria-label="Panorama">
            <div className="moon-preview-focal-dock__info">
              <div className="moon-preview-focal-dock__head">
                <span className="moon-preview-quick-label">Panorama</span>
                <button
                  type="button"
                  className={
                    plan.enabled
                      ? 'vf-pano-switch is-active'
                      : 'vf-pano-switch'
                  }
                  aria-pressed={plan.enabled}
                  onClick={() => patch({ enabled: !plan.enabled })}
                >
                  {plan.enabled ? 'On' : 'Off'}
                </button>
              </div>
              <p className="moon-preview-focal-dock__value">
                <strong>
                  {shots}
                  <span> vues</span>
                </strong>
                <span className="moon-preview-focal-dock__hint">
                  ≈ {coverH.toFixed(0)}° × {coverV.toFixed(0)}° · overlap{' '}
                  {plan.overlapPercent}%
                </span>
              </p>
            </div>

            <div className="vf-pano-controls">
              <label className="vf-pano-field">
                <span className="moon-preview-quick-label">Colonnes</span>
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
              </label>

              <label className="vf-pano-field">
                <span className="moon-preview-quick-label">Lignes</span>
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
              </label>

              <label className="vf-pano-field vf-pano-field--overlap">
                <span className="moon-preview-quick-label">
                  Overlap {plan.overlapPercent}%
                </span>
                <input
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
              </label>

              <label className="vf-pano-field vf-pano-field--overlap">
                <span className="moon-preview-quick-label">Projection</span>
                <select
                  className="vf-pano-select"
                  aria-label="Mode de projection panorama"
                  value={plan.projectionMode}
                  onChange={(event) =>
                    patch({
                      projectionMode: event.target
                        .value as PanoramaProjectionMode,
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
              </label>
            </div>

            {plan.enabled ? (
              <div className="vf-pano-viz" aria-label="Affichage panorama">
                <button
                  type="button"
                  className={
                    plan.showFrames
                      ? 'vf-pano-switch is-active'
                      : 'vf-pano-switch'
                  }
                  aria-pressed={plan.showFrames}
                  onClick={() => patch({ showFrames: !plan.showFrames })}
                >
                  Cadrage
                </button>
                <button
                  type="button"
                  className={
                    plan.showOverlap
                      ? 'vf-pano-switch is-active'
                      : 'vf-pano-switch'
                  }
                  aria-pressed={plan.showOverlap}
                  onClick={() => patch({ showOverlap: !plan.showOverlap })}
                >
                  Overlap
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  )
}
