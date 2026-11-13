import { useEffect, useId, useRef, useState } from 'react'
import {
  clampFocalLengthMm,
  clampFrameRollDeg,
  FOCAL_LENGTH_MAX_MM,
  FOCAL_LENGTH_MIN_MM,
  FOCAL_LENGTH_PRESETS_MM,
  FRAME_ROLL_MAX_DEG,
  FRAME_ROLL_MIN_DEG,
  isFocalLengthPreset,
  SENSOR_FORMAT_LABEL,
  SENSOR_FORMATS,
  type SensorFormat,
  type ViewfinderOrientation,
} from './lensFov'
import { CameraLensIcon, ChevronDownIcon } from './psIcons'

type ViewfinderCameraPanelProps = {
  focalMm: number
  orientation: ViewfinderOrientation
  frameRollDeg: number
  sensorFormat: SensorFormat
  onFocalMmChange: (mm: number) => void
  onOrientationChange: (orientation: ViewfinderOrientation) => void
  onFrameRollChange: (deg: number) => void
  onSensorFormatChange: (format: SensorFormat) => void
  /** Controlled open state (capsule / parent owns the trigger). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Hide the built-in summary toggle — parent provides the trigger. */
  hideToggle?: boolean
}

/**
 * Camera framing settings — capsule popup matches the validated prototype
 * (« Appareil photo »), dock toggle kept for non-capsule hosts.
 */
export function ViewfinderCameraPanel({
  focalMm,
  orientation,
  frameRollDeg,
  sensorFormat,
  onFocalMmChange,
  onOrientationChange,
  onFrameRollChange,
  onSensorFormatChange,
  open: openProp,
  onOpenChange,
  hideToggle = false,
}: ViewfinderCameraPanelProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = openProp ?? uncontrolledOpen
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next
    onOpenChange?.(value)
    if (openProp === undefined) setUncontrolledOpen(value)
  }
  const [sensorMenuOpen, setSensorMenuOpen] = useState(false)
  const [focalDraft, setFocalDraft] = useState(
    () => String(Math.round(focalMm)),
  )
  const rootRef = useRef<HTMLDivElement | null>(null)
  const sensorMenuRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()
  const sensorLabelId = useId()
  const customFocalId = useId()
  const roll = clampFrameRollDeg(frameRollDeg)

  useEffect(() => {
    setFocalDraft(String(Math.round(focalMm)))
  }, [focalMm])

  useEffect(() => {
    if (!open) {
      setSensorMenuOpen(false)
      return
    }
    // Capsule owns outside-click when hideToggle — avoid fighting the trigger.
    const onPointerDown = hideToggle
      ? null
      : (event: PointerEvent) => {
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

  const commitFocalDraft = () => {
    const parsed = Number(focalDraft)
    if (!Number.isFinite(parsed)) {
      setFocalDraft(String(Math.round(focalMm)))
      return
    }
    const next = clampFocalLengthMm(parsed)
    onFocalMmChange(next)
    setFocalDraft(String(next))
  }

  const summary = `${Math.round(focalMm)} mm · ${SENSOR_FORMAT_LABEL[sensorFormat]}`

  if (hideToggle && !open) return null

  const sensorBlock = (
    <div className="vf-camera-pop__field">
      <span className="vf-camera-pop__label" id={sensorLabelId}>
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
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
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
  )

  const orientationBlock = (
    <div className="vf-camera-pop__field">
      <span className="vf-camera-pop__label">Format</span>
      <button
        type="button"
        className="moon-preview-orient-btn vf-camera-pop__orient"
        title={
          orientation === 'portrait'
            ? 'Portrait actif. Passer en paysage'
            : 'Paysage actif. Passer en portrait'
        }
        aria-label={
          orientation === 'portrait' ? 'Passer en paysage' : 'Passer en portrait'
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
  )

  const rotationBlock = (
    <div className="vf-camera-pop__field">
      <div className="vf-camera-pop__roll-head">
        <span className="vf-camera-pop__label">Rotation</span>
        {roll !== 0 ? (
          <button
            type="button"
            className="vf-camera-pop__roll-reset"
            onClick={() => onFrameRollChange(0)}
          >
            Remettre à 0
          </button>
        ) : null}
      </div>
      <div className="moon-preview-stepper">
        <button
          type="button"
          aria-label="Diminuer la rotation"
          disabled={roll <= FRAME_ROLL_MIN_DEG}
          onClick={() => onFrameRollChange(clampFrameRollDeg(roll - 5))}
        >
          −
        </button>
        <output aria-live="polite">{roll}°</output>
        <button
          type="button"
          aria-label="Augmenter la rotation"
          disabled={roll >= FRAME_ROLL_MAX_DEG}
          onClick={() => onFrameRollChange(clampFrameRollDeg(roll + 5))}
        >
          +
        </button>
      </div>
      <p className="vf-camera-pop__hint">
        Incline le cadre photo (antihoraire).
      </p>
    </div>
  )

  const popupBody = (
    <div
      id={panelId}
      className="vf-camera-pop"
      role="dialog"
      aria-label="Appareil photo"
    >
      <header className="vf-camera-pop__head">
        <h2 className="vf-camera-pop__title">Appareil photo</h2>
        <button
          type="button"
          className="vf-camera-pop__close"
          aria-label="Fermer les réglages"
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </header>

      <div className="vf-camera-pop__focal-row">
        <span className="vf-camera-pop__label">Distance focale</span>
        <span className="vf-camera-pop__big">
          {Math.round(focalMm)}
          <span className="vf-camera-pop__unit"> mm</span>
        </span>
      </div>

      <div
        className="moon-preview-focal-pills vf-camera-pop__presets"
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
            onClick={() => onFocalMmChange(mm)}
          >
            {mm}
          </button>
        ))}
      </div>

      <div className="vf-camera-pop__field vf-camera-pop__custom">
        <label className="vf-camera-pop__label" htmlFor={customFocalId}>
          Focale personnalisée · mm
        </label>
        <input
          id={customFocalId}
          type="number"
          inputMode="numeric"
          min={FOCAL_LENGTH_MIN_MM}
          max={FOCAL_LENGTH_MAX_MM}
          step={1}
          className={
            !isFocalLengthPreset(focalMm)
              ? 'vf-camera-pop__number is-active'
              : 'vf-camera-pop__number'
          }
          value={focalDraft}
          onChange={(event) => setFocalDraft(event.target.value)}
          onBlur={commitFocalDraft}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.currentTarget.blur()
          }}
        />
      </div>

      <div className="vf-camera-pop__twocol">
        {sensorBlock}
        {orientationBlock}
      </div>

      {rotationBlock}

      <p className="vf-camera-pop__hint">
        Réglages communs au cadre photo et aux tuiles du panorama.
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
          title="Réglages cadrage"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="immersive-dock__row-icon" aria-hidden="true">
            <CameraLensIcon size={14} />
          </span>
          <span className="vf-camera-panel__toggle-main">{summary}</span>
          <span className="vf-camera-panel__toggle-meta">
            {orientation === 'landscape' ? 'Paysage' : 'Portrait'}
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
