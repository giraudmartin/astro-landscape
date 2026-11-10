import { useEffect, useId, useRef, useState } from 'react'
import {
  clampFocalLengthMm,
  FOCAL_LENGTH_MAX_MM,
  FOCAL_LENGTH_MIN_MM,
  FOCAL_LENGTH_PRESETS_MM,
  isFocalLengthPreset,
  SENSOR_CROP_FACTOR,
  SENSOR_FORMAT_LABEL,
  SENSOR_FORMATS,
  type SensorFormat,
  type ViewfinderOrientation,
} from './lensFov'

type ViewfinderCameraPanelProps = {
  focalMm: number
  orientation: ViewfinderOrientation
  sensorFormat: SensorFormat
  onFocalMmChange: (mm: number) => void
  onOrientationChange: (orientation: ViewfinderOrientation) => void
  onSensorFormatChange: (format: SensorFormat) => void
}

/**
 * Collapsible camera framing panel — Photo Sightline focal dock +
 * orientation + sensor format.
 */
export function ViewfinderCameraPanel({
  focalMm,
  orientation,
  sensorFormat,
  onFocalMmChange,
  onOrientationChange,
  onSensorFormatChange,
}: ViewfinderCameraPanelProps) {
  const [open, setOpen] = useState(false)
  const [sensorMenuOpen, setSensorMenuOpen] = useState(false)
  const [focalDraft, setFocalDraft] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const sensorMenuRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()
  const sensorLabelId = useId()
  const cropFactor = SENSOR_CROP_FACTOR[sensorFormat]

  useEffect(() => {
    if (!open) {
      setSensorMenuOpen(false)
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (rootRef.current?.contains(target)) return
      setOpen(false)
      setSensorMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSensorMenuOpen(false)
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!sensorMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const root = sensorMenuRef.current
      if (!root || root.contains(event.target as Node)) return
      setSensorMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [sensorMenuOpen])

  const summary = `${Math.round(focalMm)} mm · ${SENSOR_FORMAT_LABEL[sensorFormat]}`

  return (
    <div
      ref={rootRef}
      className={
        open
          ? 'vf-camera-panel is-open'
          : 'vf-camera-panel'
      }
    >
      <button
        type="button"
        className="vf-camera-panel__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        title="Réglages cadrage"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="vf-camera-panel__toggle-main">{summary}</span>
        <span className="vf-camera-panel__toggle-meta">
          {orientation === 'landscape' ? 'Paysage' : 'Portrait'}
        </span>
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
          <section
            className="moon-preview-focal-dock"
            aria-label="Distance focale"
          >
            <div className="moon-preview-focal-dock__info">
              <div className="moon-preview-focal-dock__head">
                <span className="moon-preview-quick-label">Focale</span>
                <span className="moon-preview-focal-dock__note">mm</span>
              </div>
              <p className="moon-preview-focal-dock__value">
                <strong>
                  {Math.round(focalMm)}
                  <span> mm</span>
                </strong>
                <span className="moon-preview-focal-dock__hint">
                  {cropFactor > 1
                    ? `≈ ${Math.round(focalMm * cropFactor)} mm FF`
                    : 'Personnalisez le cadrage'}
                </span>
              </p>
            </div>
            <div
              className="moon-preview-focal-pills"
              role="group"
              aria-label="Focales prédéfinies"
            >
              {FOCAL_LENGTH_PRESETS_MM.map((mm) => (
                <button
                  key={mm}
                  type="button"
                  className={
                    mm === focalMm
                      ? 'moon-preview-focal-pill is-active'
                      : 'moon-preview-focal-pill'
                  }
                  aria-pressed={mm === focalMm}
                  onClick={() => {
                    setFocalDraft(null)
                    onFocalMmChange(mm)
                  }}
                >
                  {mm}
                </button>
              ))}
              <label className="moon-preview-focal-custom">
                <input
                  type="number"
                  inputMode="numeric"
                  min={FOCAL_LENGTH_MIN_MM}
                  max={FOCAL_LENGTH_MAX_MM}
                  step={1}
                  placeholder="mm"
                  title={`Focale libre ${FOCAL_LENGTH_MIN_MM}–${FOCAL_LENGTH_MAX_MM} mm`}
                  aria-label={`Focale libre, ${FOCAL_LENGTH_MIN_MM} à ${FOCAL_LENGTH_MAX_MM} mm`}
                  className={
                    !isFocalLengthPreset(focalMm)
                      ? 'moon-preview-focal-custom__input is-active'
                      : 'moon-preview-focal-custom__input'
                  }
                  value={
                    focalDraft ??
                    (isFocalLengthPreset(focalMm) ? '' : String(focalMm))
                  }
                  onChange={(event) => setFocalDraft(event.target.value)}
                  onBlur={() => {
                    if (focalDraft == null || focalDraft.trim() === '') {
                      setFocalDraft(null)
                      return
                    }
                    const parsed = Number(focalDraft)
                    if (!Number.isFinite(parsed)) {
                      setFocalDraft(null)
                      return
                    }
                    const next = clampFocalLengthMm(parsed)
                    onFocalMmChange(next)
                    setFocalDraft(
                      isFocalLengthPreset(next) ? null : String(next),
                    )
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.currentTarget.blur()
                  }}
                />
              </label>
            </div>
          </section>

          <div className="vf-camera-panel__row">
            <div className="moon-preview-quick-group moon-preview-quick-group--orient">
              <span className="moon-preview-quick-label">Orient.</span>
              <button
                type="button"
                className="moon-preview-orient-btn"
                title={
                  orientation === 'portrait'
                    ? 'Portrait actif. Passer en paysage'
                    : 'Paysage actif. Passer en portrait'
                }
                aria-label={
                  orientation === 'portrait'
                    ? 'Passer en paysage'
                    : 'Passer en portrait'
                }
                onClick={() =>
                  onOrientationChange(
                    orientation === 'portrait' ? 'landscape' : 'portrait',
                  )
                }
              >
                {orientation === 'portrait' ? (
                  <svg
                    width="12"
                    height="14"
                    viewBox="0 0 12 14"
                    fill="none"
                    aria-hidden="true"
                  >
                    <rect
                      x="2.25"
                      y="0.75"
                      width="7.5"
                      height="12.5"
                      rx="1.2"
                      stroke="currentColor"
                      strokeWidth="1.4"
                    />
                  </svg>
                ) : (
                  <svg
                    width="14"
                    height="12"
                    viewBox="0 0 14 12"
                    fill="none"
                    aria-hidden="true"
                  >
                    <rect
                      x="0.75"
                      y="2.25"
                      width="12.5"
                      height="7.5"
                      rx="1.2"
                      stroke="currentColor"
                      strokeWidth="1.4"
                    />
                  </svg>
                )}
                {orientation === 'portrait' ? 'Portrait' : 'Paysage'}
              </button>
            </div>

            <div className="moon-preview-quick-group moon-preview-quick-group--sensor">
              <span
                className="moon-preview-quick-label"
                id={sensorLabelId}
              >
                Capteur
              </span>
              <div className="moon-preview-select-wrap" ref={sensorMenuRef}>
                <button
                  type="button"
                  className="moon-preview-select-trigger"
                  aria-labelledby={sensorLabelId}
                  aria-label="Format de capteur"
                  aria-haspopup="listbox"
                  aria-expanded={sensorMenuOpen}
                  onClick={() => setSensorMenuOpen((value) => !value)}
                >
                  <span>{SENSOR_FORMAT_LABEL[sensorFormat]}</span>
                  <svg
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
                {sensorMenuOpen ? (
                  <ul
                    className="moon-preview-select-menu moon-preview-select-menu--down"
                    role="listbox"
                    aria-labelledby={sensorLabelId}
                  >
                    {SENSOR_FORMATS.map((format) => {
                      const active = format === sensorFormat
                      return (
                        <li key={format} role="none">
                          <button
                            type="button"
                            role="option"
                            aria-selected={active}
                            className={
                              active
                                ? 'moon-preview-select-option moon-preview-select-option--active'
                                : 'moon-preview-select-option'
                            }
                            onClick={() => {
                              onSensorFormatChange(format)
                              setSensorMenuOpen(false)
                            }}
                          >
                            {SENSOR_FORMAT_LABEL[format]}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
