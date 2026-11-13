import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  SENSOR_FORMAT_SHORT,
  VIEWFINDER_FRAME_MODE_LABEL,
  VIEWFINDER_FRAME_MODE_TITLE,
  VIEWFINDER_FRAME_MODES,
  type SensorFormat,
  type ViewfinderFrameMode,
  type ViewfinderOrientation,
} from './lensFov'
import { type PanoramaPlan } from './panorama'
import {
  CameraBodyIcon,
  FrameModeLibreIcon,
  FrameModePanoIcon,
  FrameModePhotoIcon,
  SettingsSlidersIcon,
  TimelapseIcon,
} from './psIcons'
import { ViewfinderCameraPanel } from './ViewfinderCameraPanel'
import { ViewfinderPanoramaPanel } from './ViewfinderPanoramaPanel'

/** Opens / expands the existing TimelineDock (no prototype timelapse player). */
export const EXPAND_TIMELINE_EVENT = 'astro-planner:expand-timeline'

type SettingsPanel = 'camera' | 'pano' | null

const FRAME_MODE_ICONS = {
  off: FrameModeLibreIcon,
  dslr: FrameModePhotoIcon,
  pano: FrameModePanoIcon,
} as const satisfies Record<
  ViewfinderFrameMode,
  (props: { size?: number; className?: string }) => ReactElement
>

type ViewfinderCaptureCapsuleProps = {
  focalMm: number
  orientation: ViewfinderOrientation
  sensorFormat: SensorFormat
  frameMode: ViewfinderFrameMode
  panorama: PanoramaPlan
  opticalHFovDeg: number
  opticalVFovDeg: number
  onFocalMmChange: (mm: number) => void
  onOrientationChange: (orientation: ViewfinderOrientation) => void
  onSensorFormatChange: (format: SensorFormat) => void
  onFrameModeChange: (mode: ViewfinderFrameMode) => void
  onPanoramaChange: (next: PanoramaPlan) => void
}

/**
 * Horizontal capture capsule (validated « Icônes + texte » layout):
 * LED · camera summary · Libre/Photo/Pano · pano settings · Timelapse.
 */
export function ViewfinderCaptureCapsule({
  focalMm,
  orientation,
  sensorFormat,
  frameMode,
  panorama,
  opticalHFovDeg,
  opticalVFovDeg,
  onFocalMmChange,
  onOrientationChange,
  onSensorFormatChange,
  onFrameModeChange,
  onPanoramaChange,
}: ViewfinderCaptureCapsuleProps) {
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!settingsPanel) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (rootRef.current?.contains(target)) return
      setSettingsPanel(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [settingsPanel])

  useEffect(() => {
    if (frameMode !== 'pano' && settingsPanel === 'pano') {
      setSettingsPanel(null)
    }
  }, [frameMode, settingsPanel])

  const summary = `${Math.round(focalMm)} mm · ${SENSOR_FORMAT_SHORT[sensorFormat]} · ${
    orientation === 'landscape' ? 'Paysage' : 'Portrait'
  }`

  const toggleSettings = (panel: Exclude<SettingsPanel, null>) => {
    setSettingsPanel((current) => (current === panel ? null : panel))
  }

  const applyFrameMode = (mode: ViewfinderFrameMode) => {
    onFrameModeChange(mode)
    setSettingsPanel(mode === 'pano' ? 'pano' : null)
  }

  const openTimeline = () => {
    setSettingsPanel(null)
    window.dispatchEvent(new CustomEvent(EXPAND_TIMELINE_EVENT))
  }

  return (
    <div ref={rootRef} className="vf-capture-capsule">
      <div
        className="vf-capture-capsule__bar"
        role="toolbar"
        aria-label="Prise de vue"
      >
        <span
          className="moon-preview-dock__rec"
          title="Viseur"
          aria-label="Viseur"
        />

        <button
          type="button"
          className={
            settingsPanel === 'camera'
              ? 'vf-capture-capsule__gear is-active'
              : 'vf-capture-capsule__gear'
          }
          aria-expanded={settingsPanel === 'camera'}
          aria-haspopup="dialog"
          title={`Réglages de l’appareil : ${summary}`}
          onClick={() => toggleSettings('camera')}
        >
          <CameraBodyIcon size={16} />
          <span className="vf-capture-capsule__lens">
            <b>{Math.round(focalMm)} mm</b>
            <span className="vf-capture-capsule__dot" aria-hidden="true">
              ·
            </span>
            <span className="vf-capture-capsule__detail">
              {SENSOR_FORMAT_SHORT[sensorFormat]}
            </span>
            <span className="vf-capture-capsule__dot" aria-hidden="true">
              ·
            </span>
            <span className="vf-capture-capsule__detail">
              {orientation === 'landscape' ? 'Paysage' : 'Portrait'}
            </span>
          </span>
        </button>

        <div className="vf-capture-capsule__divider" aria-hidden="true" />

        <div className="vf-capture-capsule__finder">
          <div
            className="vf-capture-capsule__modes"
            role="radiogroup"
            aria-label="Cadre affiché"
          >
            {VIEWFINDER_FRAME_MODES.map((mode) => {
              const selected = frameMode === mode
              const Icon = FRAME_MODE_ICONS[mode]
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={VIEWFINDER_FRAME_MODE_TITLE[mode]}
                  title={VIEWFINDER_FRAME_MODE_TITLE[mode]}
                  className={
                    selected
                      ? 'vf-capture-capsule__mode is-active'
                      : 'vf-capture-capsule__mode'
                  }
                  onClick={() => applyFrameMode(mode)}
                >
                  <Icon size={16} />
                  <span>{VIEWFINDER_FRAME_MODE_LABEL[mode]}</span>
                </button>
              )
            })}
          </div>

          {frameMode === 'pano' ? (
            <button
              type="button"
              className={
                settingsPanel === 'pano'
                  ? 'vf-capture-capsule__icon-btn is-active'
                  : 'vf-capture-capsule__icon-btn'
              }
              aria-expanded={settingsPanel === 'pano'}
              aria-haspopup="dialog"
              title="Réglages panorama"
              aria-label="Réglages panorama"
              onClick={() => toggleSettings('pano')}
            >
              <SettingsSlidersIcon size={16} />
            </button>
          ) : null}
        </div>

        <div className="vf-capture-capsule__divider" aria-hidden="true" />

        <button
          type="button"
          className="vf-capture-capsule__timelapse"
          title="Ouvrir la timeline"
          aria-label="Ouvrir la timeline"
          onClick={openTimeline}
        >
          <TimelapseIcon size={16} />
          <span>Timelapse</span>
        </button>
      </div>

      <ViewfinderCameraPanel
        hideToggle
        open={settingsPanel === 'camera'}
        onOpenChange={(open) => setSettingsPanel(open ? 'camera' : null)}
        focalMm={focalMm}
        orientation={orientation}
        sensorFormat={sensorFormat}
        onFocalMmChange={onFocalMmChange}
        onOrientationChange={onOrientationChange}
        onSensorFormatChange={onSensorFormatChange}
      />

      <ViewfinderPanoramaPanel
        hideToggle
        open={settingsPanel === 'pano'}
        onOpenChange={(open) => setSettingsPanel(open ? 'pano' : null)}
        plan={panorama}
        opticalHFovDeg={opticalHFovDeg}
        opticalVFovDeg={opticalVFovDeg}
        onChange={onPanoramaChange}
        focalMm={focalMm}
        orientation={orientation}
        onEditCamera={() => setSettingsPanel('camera')}
      />
    </div>
  )
}
