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
  TimelapseIcon,
} from './psIcons'
import type { CelestialObject } from './celestialObjects'
import { useT } from './i18n'
import type { TimelapsePlan } from './timelapse'
import { ViewfinderCameraPanel } from './ViewfinderCameraPanel'
import { ViewfinderPanoramaPanel } from './ViewfinderPanoramaPanel'
import { ViewfinderTimelapsePanel } from './ViewfinderTimelapsePanel'
import { EXPAND_CAPTURE_BAR_EVENT } from './onboarding/immersiveTourUi'

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
  /** Framing centre for panorama start/end head angles. */
  framingYawDeg?: number
  framingPitchDeg?: number
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
  /** Phone top bar: LED + focal pill; click expands the full desktop-like bar. */
  compact?: boolean
}

/**
 * Horizontal capture capsule (validated « Icônes + texte » layout):
 * LED · camera summary · Libre/Photo/Pano · Timelapse.
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
  framingYawDeg,
  framingPitchDeg,
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
  compact = false,
}: ViewfinderCaptureCapsuleProps) {
  const t = useT()
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>(null)
  /** Phone: collapsed LED+focal pill → expanded desktop-like capture bar. */
  const [barExpanded, setBarExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const frameModeRef = useRef(frameMode)
  frameModeRef.current = frameMode
  const showFullBar = !compact || barExpanded

  useEffect(() => {
    const onExpand = () => {
      if (compact) setBarExpanded(true)
    }
    window.addEventListener(EXPAND_CAPTURE_BAR_EVENT, onExpand)
    return () => window.removeEventListener(EXPAND_CAPTURE_BAR_EVENT, onExpand)
  }, [compact])

  const collapseChrome = () => {
    setSettingsPanel(null)
    setBarExpanded(false)
  }

  const openPanel = (panel: Exclude<SettingsPanel, null>) => {
    if (compact) setBarExpanded(true)
    setSettingsPanel(panel)
  }

  useEffect(() => {
    if (!compact) setBarExpanded(false)
  }, [compact])

  useEffect(() => {
    // Only notify on open — sticky Timelapse save kind lives in ImmersiveView.
    if (settingsPanel === 'timelapse') {
      onTimelapseSettingsOpenChange?.(true)
    }
  }, [settingsPanel, onTimelapseSettingsOpenChange])

  useEffect(() => {
    if (!settingsPanel && !(compact && barExpanded)) return
    // Pano + Timelapse stay open while framing the view (live az/alt, preview).
    // Dismiss via X, Escape, or mode switch — not by dragging the stage.
    if (settingsPanel === 'timelapse' || settingsPanel === 'pano') return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (rootRef.current?.contains(target)) return
      collapseChrome()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      collapseChrome()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [settingsPanel, compact, barExpanded])

  useEffect(() => {
    if (frameMode !== 'pano' && settingsPanel === 'pano') {
      setSettingsPanel(null)
    }
  }, [frameMode, settingsPanel])

  useEffect(() => {
    const openFromHud = () => {
      // Timelapse always frames a single photo shot — leave Libre / Pano.
      if (frameModeRef.current !== 'dslr') onFrameModeChange('dslr')
      openPanel('timelapse')
    }
    window.addEventListener(OPEN_TIMELAPSE_SETTINGS_EVENT, openFromHud)
    return () =>
      window.removeEventListener(OPEN_TIMELAPSE_SETTINGS_EVENT, openFromHud)
  }, [onFrameModeChange, compact])

  const summary = `${Math.round(focalMm)} mm · ${SENSOR_FORMAT_SHORT[sensorFormat]} · ${
    orientation === 'landscape' ? t('common.landscape') : t('common.portrait')
  }`

  const toggleSettings = (panel: Exclude<SettingsPanel, null>) => {
    if (settingsPanel === panel) {
      setSettingsPanel(null)
      return
    }
    openPanel(panel)
  }

  /** Collapsed pill → full bar only. Expanded gear → toggle camera card. */
  const openCameraFromPill = () => {
    if (compact && !barExpanded) {
      setBarExpanded(true)
      setSettingsPanel(null)
      return
    }
    if (compact && barExpanded) {
      if (settingsPanel === 'camera') {
        setSettingsPanel(null)
        return
      }
      openPanel('camera')
      return
    }
    toggleSettings('camera')
  }

  const applyFrameMode = (mode: ViewfinderFrameMode) => {
    onFrameModeChange(mode)
    if (mode === 'pano') {
      // Pano → carte réglages panorama.
      openPanel('pano')
      return
    }
    // Free / Photo: barre ouverte, ne force pas une carte.
    if (compact) setBarExpanded(true)
  }

  const openTimelapse = () => {
    // Timelapse always frames a single photo shot — leave Libre / Pano.
    if (frameMode !== 'dslr') onFrameModeChange('dslr')
    openPanel('timelapse')
  }

  const onPanelOpenChange =
    (panel: Exclude<SettingsPanel, null>) => (open: boolean) => {
      if (open) {
        openPanel(panel)
        return
      }
      // X ferme la carte mais garde la barre Free/Photo/Pano.
      setSettingsPanel(null)
      if (compact) setBarExpanded(true)
    }

  return (
    <div
      ref={rootRef}
      data-tour-anchor="vf-capsule"
      className={
        compact
          ? [
              'vf-capture-capsule',
              'is-compact',
              barExpanded ? 'is-expanded' : '',
              settingsPanel ? 'is-panel-open' : '',
            ]
              .filter(Boolean)
              .join(' ')
          : 'vf-capture-capsule'
      }
    >
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
          aria-expanded={
            compact ? barExpanded || settingsPanel === 'camera' : settingsPanel === 'camera'
          }
          aria-haspopup="dialog"
          title={t('viewfinder.capture.cameraSettings', { summary })}
          onClick={openCameraFromPill}
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
            <span
              className="vf-capture-capsule__dot vf-capture-capsule__orient"
              aria-hidden="true"
            >
              ·
            </span>
            <span className="vf-capture-capsule__detail vf-capture-capsule__orient">
              {orientation === 'landscape'
                ? t('common.landscape')
                : t('common.portrait')}
            </span>
          </span>
        </button>

        {showFullBar ? (
          <div
            className="vf-capture-capsule__tour-modes"
            data-tour-anchor="vf-modes"
          >
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
        ) : null}
      </div>

      <ViewfinderCameraPanel
        hideToggle
        open={settingsPanel === 'camera'}
        onOpenChange={onPanelOpenChange('camera')}
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
        onOpenChange={onPanelOpenChange('pano')}
        plan={panorama}
        opticalHFovDeg={opticalHFovDeg}
        opticalVFovDeg={opticalVFovDeg}
        framingYawDeg={framingYawDeg}
        framingPitchDeg={framingPitchDeg}
        poseS={timelapse.poseS}
        intervalS={timelapse.intervalS}
        onCaptureTimingChange={({ poseS, intervalS }) =>
          onTimelapseChange({ ...timelapse, poseS, intervalS })
        }
        onChange={onPanoramaChange}
        focalMm={focalMm}
        orientation={orientation}
        onEditCamera={() => openPanel('camera')}
      />

      <ViewfinderTimelapsePanel
        hideToggle
        open={settingsPanel === 'timelapse'}
        onOpenChange={onPanelOpenChange('timelapse')}
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
