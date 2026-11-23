import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  SENSOR_FORMAT_SHORT,
  viewfinderFrameModeLabel,
  viewfinderFrameModeTitle,
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
import type { CelestialObject } from './celestialObjects'
import { useT } from './i18n'
import type { TimelapsePlan } from './timelapse'
import { ViewfinderCameraPanel } from './ViewfinderCameraPanel'
import { ViewfinderPanoramaPanel } from './ViewfinderPanoramaPanel'
import { ViewfinderTimelapsePanel } from './ViewfinderTimelapsePanel'

/** Opens / expands the existing TimelineDock (kept for other chrome). */
export const EXPAND_TIMELINE_EVENT = 'astro-planner:expand-timeline'

/** Re-open the timelapse settings panel (e.g. from the playback HUD). */
export const OPEN_TIMELAPSE_SETTINGS_EVENT = 'astro-planner:open-timelapse-settings'

type SettingsPanel = 'camera' | 'pano' | 'timelapse' | null

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
  frameRollDeg: number
  sensorFormat: SensorFormat
  frameMode: ViewfinderFrameMode
  panorama: PanoramaPlan
  timelapse: TimelapsePlan
  opticalHFovDeg: number
  opticalVFovDeg: number
  onFocalMmChange: (mm: number) => void
  onOrientationChange: (orientation: ViewfinderOrientation) => void
  onFrameRollChange: (deg: number) => void
  onSensorFormatChange: (format: SensorFormat) => void
  onFrameModeChange: (mode: ViewfinderFrameMode) => void
  onPanoramaChange: (next: PanoramaPlan) => void
  onTimelapseChange: (next: TimelapsePlan) => void
  onStartTimelapsePreview: () => void
  timelapsePreviewPlaying?: boolean
  /** True while the Timelapse settings sheet is open (cadrage save intent). */
  onTimelapseSettingsOpenChange?: (open: boolean) => void
  selectedCelestial: CelestialObject | null
}

/**
 * Horizontal capture capsule (validated « Icônes + texte » layout):
 * LED · camera summary · Libre/Photo/Pano · pano settings · Timelapse.
 */
export function ViewfinderCaptureCapsule({
  focalMm,
  orientation,
  frameRollDeg,
  sensorFormat,
  frameMode,
  panorama,
  timelapse,
  opticalHFovDeg,
  opticalVFovDeg,
  onFocalMmChange,
  onOrientationChange,
  onFrameRollChange,
  onSensorFormatChange,
  onFrameModeChange,
  onPanoramaChange,
  onTimelapseChange,
  onStartTimelapsePreview,
  timelapsePreviewPlaying = false,
  onTimelapseSettingsOpenChange,
  selectedCelestial,
}: ViewfinderCaptureCapsuleProps) {
  const t = useT()
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const frameModeRef = useRef(frameMode)
  frameModeRef.current = frameMode

  useEffect(() => {
    // Only notify on open — sticky Timelapse save kind lives in ImmersiveView.
    if (settingsPanel === 'timelapse') {
      onTimelapseSettingsOpenChange?.(true)
    }
  }, [settingsPanel, onTimelapseSettingsOpenChange])

  useEffect(() => {
    if (!settingsPanel) return
    // Timelapse stays open while framing — dismiss via X, Escape, or mode switch.
    if (settingsPanel === 'timelapse') return
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

  useEffect(() => {
    const openFromHud = () => {
      // Timelapse always frames a single photo shot — leave Libre / Pano.
      if (frameModeRef.current !== 'dslr') onFrameModeChange('dslr')
      setSettingsPanel('timelapse')
    }
    window.addEventListener(OPEN_TIMELAPSE_SETTINGS_EVENT, openFromHud)
    return () =>
      window.removeEventListener(OPEN_TIMELAPSE_SETTINGS_EVENT, openFromHud)
  }, [onFrameModeChange])

  const summary = `${Math.round(focalMm)} mm · ${SENSOR_FORMAT_SHORT[sensorFormat]} · ${
    orientation === 'landscape' ? t('common.landscape') : t('common.portrait')
  }`

  const toggleSettings = (panel: Exclude<SettingsPanel, null>) => {
    setSettingsPanel((current) => (current === panel ? null : panel))
  }

  const applyFrameMode = (mode: ViewfinderFrameMode) => {
    onFrameModeChange(mode)
    setSettingsPanel(mode === 'pano' ? 'pano' : null)
  }

  const openTimelapse = () => {
    // Timelapse always frames a single photo shot — leave Libre / Pano.
    if (frameMode !== 'dslr') onFrameModeChange('dslr')
    toggleSettings('timelapse')
  }

  return (
    <div ref={rootRef} className="vf-capture-capsule">
      <div
        className="vf-capture-capsule__bar"
        role="toolbar"
        aria-label={t('viewfinder.capture.aria')}
      >
        <span
          className="moon-preview-dock__rec"
          title={t('viewfinder.capture.finder')}
          aria-label={t('viewfinder.capture.finder')}
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
          title={t('viewfinder.capture.cameraSettings', { summary })}
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
              {orientation === 'landscape'
                ? t('common.landscape')
                : t('common.portrait')}
            </span>
          </span>
        </button>

        <div className="vf-capture-capsule__divider" aria-hidden="true" />

        <div className="vf-capture-capsule__finder">
          <div
            className="vf-capture-capsule__modes"
            role="radiogroup"
            aria-label={t('viewfinder.capture.frameAria')}
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
                  aria-label={viewfinderFrameModeTitle(mode)}
                  title={viewfinderFrameModeTitle(mode)}
                  className={
                    selected
                      ? 'vf-capture-capsule__mode is-active'
                      : 'vf-capture-capsule__mode'
                  }
                  onClick={() => applyFrameMode(mode)}
                >
                  <Icon size={16} />
                  <span>{viewfinderFrameModeLabel(mode)}</span>
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
              title={t('viewfinder.capture.panoSettings')}
              aria-label={t('viewfinder.capture.panoSettings')}
              onClick={() => toggleSettings('pano')}
            >
              <SettingsSlidersIcon size={16} />
            </button>
          ) : null}
        </div>

        <div className="vf-capture-capsule__divider" aria-hidden="true" />

        <button
          type="button"
          className={
            settingsPanel === 'timelapse'
              ? 'vf-capture-capsule__timelapse is-active'
              : 'vf-capture-capsule__timelapse'
          }
          aria-expanded={settingsPanel === 'timelapse'}
          aria-haspopup="dialog"
          title={t('viewfinder.capture.tlapseSettings')}
          aria-label={t('viewfinder.capture.tlapseSettings')}
          onClick={openTimelapse}
        >
          <TimelapseIcon size={16} />
          <span>{t('viewfinder.capture.timelapse')}</span>
        </button>
      </div>

      <ViewfinderCameraPanel
        hideToggle
        open={settingsPanel === 'camera'}
        onOpenChange={(open) => setSettingsPanel(open ? 'camera' : null)}
        focalMm={focalMm}
        orientation={orientation}
        frameRollDeg={frameRollDeg}
        sensorFormat={sensorFormat}
        onFocalMmChange={onFocalMmChange}
        onOrientationChange={onOrientationChange}
        onFrameRollChange={onFrameRollChange}
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

      <ViewfinderTimelapsePanel
        hideToggle
        open={settingsPanel === 'timelapse'}
        onOpenChange={(open) => setSettingsPanel(open ? 'timelapse' : null)}
        plan={timelapse}
        onChange={onTimelapseChange}
        onStartPreview={onStartTimelapsePreview}
        previewPlaying={timelapsePreviewPlaying}
        selectedCelestial={selectedCelestial}
        focalMm={focalMm}
      />
    </div>
  )
}
