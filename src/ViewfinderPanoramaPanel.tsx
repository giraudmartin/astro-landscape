import { useEffect, useId, useRef, useState } from 'react'
import {
  clampPanoramaCount,
  clampPanoramaOverlap,
  maxPanoramaCountForCoverage,
  panoramaCoverageDeg,
  panoramaHeadRangeDeg,
  panoramaShotCount,
  PANORAMA_COUNT_MIN,
  PANORAMA_OVERLAP_MAX,
  PANORAMA_OVERLAP_MIN,
  panoramaProjectionLabel,
  PANORAMA_PROJECTION_MODES,
  PANORAMA_VERTICAL_COVERAGE_MAX_DEG,
  type PanoramaPlan,
  type PanoramaProjectionMode,
} from './panorama'
import { useT } from './i18n'
import type { ViewfinderOrientation } from './lensFov'
import {
  CameraBodyIcon,
  ChevronDownIcon,
  InfoIcon,
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
  /**
   * Framing centre (lock when frames are locked, else live look).
   * Used for absolute start/end head angles on the summary.
   */
  framingYawDeg?: number
  framingPitchDeg?: number
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
  framingYawDeg,
  framingPitchDeg,
}: ViewfinderPanoramaPanelProps) {
  const t = useT()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [assemblageInfoOpen, setAssemblageInfoOpen] = useState(false)
  const open = openProp ?? uncontrolledOpen
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next
    onOpenChange?.(value)
    if (openProp === undefined) setUncontrolledOpen(value)
  }
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()
  const assemblageInfoId = `${panelId}-assemblage-info`

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
  const headRange =
    framingYawDeg != null &&
    framingPitchDeg != null &&
    Number.isFinite(framingYawDeg) &&
    Number.isFinite(framingPitchDeg)
      ? panoramaHeadRangeDeg({
          centerYawDeg: framingYawDeg,
          centerPitchDeg: framingPitchDeg,
          opticalHFovDeg,
          opticalVFovDeg,
          columns,
          rows,
          overlapPercent: plan.overlapPercent,
        })
      : null

  const formatAz = (deg: number) => `${Math.round(deg)}°`
  const formatAlt = (deg: number) => {
    const n = Math.round(deg)
    if (n > 0) return `+${n}°`
    return `${n}°`
  }

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
    : t('viewfinder.pano.summaryOff')

  if (hideToggle && !open) return null

  const cameraPill =
    focalMm != null
      ? `${Math.round(focalMm)} mm · ${
          orientation === 'landscape'
            ? t('common.landscape')
            : t('common.portrait')
        }`
      : null

  const popupBody = (
    <div
      id={panelId}
      className="vf-camera-pop vf-pano-pop"
      role="dialog"
      aria-label={t('viewfinder.pano.title')}
    >
      <header className="vf-camera-pop__head">
        <h2 className="vf-camera-pop__title">
          {t('viewfinder.pano.title')}
        </h2>
        <button
          type="button"
          className="vf-camera-pop__close"
          aria-label={t('common.closeSettings')}
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </header>

      <div className="vf-pano-pop__summary">
        <div className="vf-pano-pop__summary-main">
          <span className="vf-camera-pop__big">
            {shots}
            <span className="vf-camera-pop__unit">
              {' '}
              {t('viewfinder.pano.viewsUnit')}
            </span>
          </span>
          <span
            className="vf-camera-pop__hint vf-pano-pop__cover"
            title={t('viewfinder.pano.coverTitle')}
          >
            ≈ {coverH.toFixed(0)}° × {coverV.toFixed(0)}°
          </span>
        </div>
        {cameraPill ? (
          <span className="vf-pano-pop__pill">{cameraPill}</span>
        ) : null}
      </div>

      {headRange ? (
        <div
          className="vf-pano-pop__extent"
          title={t('viewfinder.pano.rangeTitleTip')}
        >
          <div className="vf-pano-pop__extent-head">
            <span className="vf-camera-pop__label">
              {t('viewfinder.pano.rangeTitle')}
            </span>
          </div>
          <div
            className="vf-pano-pop__extent-grid"
            aria-label={t('viewfinder.pano.rangeTitleTip')}
          >
            <span className="vf-pano-pop__extent-axis">
              {t('viewfinder.pano.rangeAz')}
            </span>
            <span className="vf-pano-pop__extent-values">
              <b>{formatAz(headRange.yawStartDeg)}</b>
              <span className="vf-pano-pop__extent-arrow" aria-hidden="true">
                →
              </span>
              <b>{formatAz(headRange.yawEndDeg)}</b>
            </span>
            <span className="vf-pano-pop__extent-axis">
              {t('viewfinder.pano.rangeAlt')}
            </span>
            <span className="vf-pano-pop__extent-values">
              <b>{formatAlt(headRange.pitchStartDeg)}</b>
              <span className="vf-pano-pop__extent-arrow" aria-hidden="true">
                →
              </span>
              <b>{formatAlt(headRange.pitchEndDeg)}</b>
            </span>
          </div>
          <p className="vf-pano-pop__extent-hint">
            {t('viewfinder.pano.rangeHint')}
          </p>
        </div>
      ) : null}

      <div className="vf-camera-pop__twocol">
        <div className="vf-camera-pop__field">
          <span className="vf-camera-pop__label">
            {t('viewfinder.pano.columns')}
          </span>
          <div className="moon-preview-stepper">
            <button
              type="button"
              aria-label={t('viewfinder.pano.lessCols')}
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
              aria-label={t('viewfinder.pano.moreCols')}
              disabled={columns >= maxColumns}
              title={
                columns >= maxColumns
                  ? t('viewfinder.pano.maxH')
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
          <span className="vf-camera-pop__label">
            {t('viewfinder.pano.rows')}
          </span>
          <div className="moon-preview-stepper">
            <button
              type="button"
              aria-label={t('viewfinder.pano.lessRows')}
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
              aria-label={t('viewfinder.pano.moreRows')}
              disabled={rows >= maxRows}
              title={
                rows >= maxRows
                  ? t('viewfinder.pano.maxV')
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
          <span className="vf-camera-pop__label">
            {t('viewfinder.pano.overlap')}
          </span>
          <b className="vf-pano-pop__overlap-value">{plan.overlapPercent}%</b>
        </div>
        <input
          className="vf-pano-pop__range"
          type="range"
          min={PANORAMA_OVERLAP_MIN}
          max={PANORAMA_OVERLAP_MAX}
          step={1}
          value={plan.overlapPercent}
          aria-label={t('viewfinder.pano.overlapAria')}
          onChange={(event) =>
            patch({
              overlapPercent: Number(event.target.value),
              enabled: true,
            })
          }
        />
      </div>

      <div className="vf-camera-pop__field">
        <div className="vf-pano-pop__assemblage-head">
          <label
            className="vf-camera-pop__label"
            htmlFor={`${panelId}-assemblage`}
          >
            {t('viewfinder.pano.assemblage')}
          </label>
          <button
            type="button"
            className={
              assemblageInfoOpen
                ? 'vf-pano-pop__info is-open'
                : 'vf-pano-pop__info'
            }
            aria-expanded={assemblageInfoOpen}
            aria-controls={assemblageInfoId}
            title={t('viewfinder.pano.assemblageDiff')}
            aria-label={t('viewfinder.pano.assemblageExplain')}
            onClick={() => setAssemblageInfoOpen((value) => !value)}
          >
            <InfoIcon size={14} />
          </button>
        </div>
        <select
          id={`${panelId}-assemblage`}
          className="vf-pano-select"
          aria-label={t('viewfinder.pano.assemblageModeAria')}
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
              {panoramaProjectionLabel(mode)}
            </option>
          ))}
        </select>
        {assemblageInfoOpen ? (
          <div id={assemblageInfoId} className="vf-pano-pop__assemblage-info">
            <p>
              <strong>{t('viewfinder.pano.infoOpticalLabel')}</strong>{' '}
              {t('viewfinder.pano.infoOptical')}
            </p>
            <p>
              <strong>{t('viewfinder.pano.infoSphericalLabel')}</strong>{' '}
              {t('viewfinder.pano.infoSpherical')}
            </p>
            <p className="vf-pano-pop__assemblage-tip">
              {t('viewfinder.pano.infoTip')}
            </p>
          </div>
        ) : null}
      </div>

      <div className="vf-camera-pop__field">
        <span className="vf-camera-pop__label">
          {t('viewfinder.pano.display')}
        </span>
        <div className="vf-pano-viz">
          <button
            type="button"
            className={
              plan.showFrames ? 'vf-pano-switch is-active' : 'vf-pano-switch'
            }
            aria-pressed={plan.showFrames}
            title={t('viewfinder.pano.framesTitle')}
            onClick={() => patch({ showFrames: !plan.showFrames })}
          >
            {t('viewfinder.pano.frames')}
          </button>
          <button
            type="button"
            className={
              plan.showOverlap ? 'vf-pano-switch is-active' : 'vf-pano-switch'
            }
            aria-pressed={plan.showOverlap}
            title={t('viewfinder.pano.overlapTitle')}
            onClick={() => patch({ showOverlap: !plan.showOverlap })}
          >
            {t('viewfinder.pano.overlapToggle')}
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
          {t('viewfinder.pano.editCamera')}
        </button>
      ) : null}

      <p className="vf-camera-pop__hint">
        {t('viewfinder.pano.hint')}
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
          title={t('viewfinder.pano.title')}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="immersive-dock__row-icon" aria-hidden="true">
            <PanoramaGridIcon size={14} />
          </span>
          <span className="vf-camera-panel__toggle-main">{summary}</span>
          <span className="vf-camera-panel__toggle-meta">
            {t('viewfinder.mode.pano')}
          </span>
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
