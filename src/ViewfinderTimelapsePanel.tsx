import { useEffect, useId, useRef, useState } from 'react'
import type { CelestialObject } from './celestialObjects'
import { PlaySequenceIcon } from './psIcons'
import {
  clampTimelapseDurationMin,
  clampTimelapseIntervalS,
  clampTimelapsePlaybackFps,
  clampTimelapsePoseS,
  formatTimelapseVideoSeconds,
  TIMELAPSE_DURATION_MAX_MIN,
  TIMELAPSE_DURATION_MIN_MIN,
  TIMELAPSE_EQ_ROTATION_LABELS,
  TIMELAPSE_EQ_ROTATIONS,
  TIMELAPSE_FPS_MAX,
  TIMELAPSE_FPS_MIN,
  TIMELAPSE_INTERVAL_MAX_S,
  TIMELAPSE_POSE_MAX_S,
  TIMELAPSE_POSE_MIN_S,
  TIMELAPSE_SUPPORT_LABELS,
  TIMELAPSE_SUPPORTS,
  timelapseRuleOf500PoseS,
  timelapseShotCount,
  timelapseStarTrailArcRad,
  timelapseVideoSeconds,
  type TimelapseEqRotation,
  type TimelapsePlan,
  type TimelapseSupport,
} from './timelapse'

type ViewfinderTimelapsePanelProps = {
  plan: TimelapsePlan
  onChange: (next: TimelapsePlan) => void
  /** Start sequence preview (owned by ImmersiveView / HUD). */
  onStartPreview: () => void
  previewPlaying?: boolean
  selectedCelestial: CelestialObject | null
  /** Focal length for the rule-of-500 trail hint. */
  focalMm?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideToggle?: boolean
}

/** − / editable value / + — commit on blur or Enter. */
function TimelapseNumberStepper({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onChange,
  ariaLabel,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  onChange: (next: number) => void
  ariaLabel: string
}) {
  const [draft, setDraft] = useState(() => String(value))
  const inputId = useId()

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    onChange(parsed)
  }

  return (
    <div className="vf-camera-pop__field">
      <label className="vf-camera-pop__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="moon-preview-stepper">
        <button
          type="button"
          aria-label={`Réduire : ${ariaLabel}`}
          disabled={disabled || value <= min}
          onClick={() => onChange(value - step)}
        >
          −
        </button>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          className="moon-preview-stepper__input"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={draft}
          aria-label={ariaLabel}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.currentTarget.blur()
          }}
        />
        <button
          type="button"
          aria-label={`Augmenter : ${ariaLabel}`}
          disabled={disabled || value >= max}
          onClick={() => onChange(value + step)}
        >
          +
        </button>
      </div>
    </div>
  )
}

/**
 * Timelapse planner — settings only. Playback runs in TimelapsePreviewHud.
 */
export function ViewfinderTimelapsePanel({
  plan,
  onChange,
  onStartPreview,
  previewPlaying = false,
  selectedCelestial,
  focalMm = 24,
  open: openProp,
  onOpenChange,
  hideToggle = false,
}: ViewfinderTimelapsePanelProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = openProp ?? uncontrolledOpen
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next
    onOpenChange?.(value)
    if (openProp === undefined) setUncontrolledOpen(value)
  }
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()

  const poseS = clampTimelapsePoseS(plan.poseS)
  const intervalS = clampTimelapseIntervalS(plan.intervalS, poseS)
  const durationMin = clampTimelapseDurationMin(plan.durationMin)
  const playbackFps = clampTimelapsePlaybackFps(plan.playbackFps)
  const shots = timelapseShotCount(durationMin, intervalS)
  const videoS = timelapseVideoSeconds(shots, playbackFps)
  const busy = previewPlaying

  useEffect(() => {
    if (!open) return
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

  const patch = (partial: Partial<TimelapsePlan>) => {
    const nextPose = clampTimelapsePoseS(partial.poseS ?? plan.poseS)
    onChange({
      poseS: nextPose,
      intervalS: clampTimelapseIntervalS(
        partial.intervalS ?? plan.intervalS,
        nextPose,
      ),
      durationMin: clampTimelapseDurationMin(
        partial.durationMin ?? plan.durationMin,
      ),
      playbackFps: clampTimelapsePlaybackFps(
        partial.playbackFps ?? plan.playbackFps,
      ),
      support: partial.support ?? plan.support,
      eqRotation: partial.eqRotation ?? plan.eqRotation,
    })
  }

  if (hideToggle && !open) return null

  const rule500 = timelapseRuleOf500PoseS(focalMm)
  const trailOn =
    plan.support === 'fixed' && timelapseStarTrailArcRad(poseS, 'fixed') > 0
  const trailHint =
    plan.support === 'fixed'
      ? poseS > rule500
        ? `Filé d’étoiles actif (pose ${poseS} s > règle des 500 ≈ ${rule500} s @ ${Math.round(focalMm)} mm).`
        : `Au-delà de ≈ ${rule500} s (@ ${Math.round(focalMm)} mm), le filé devient visible.`
      : 'Monture EQ : pas de filé (suivi du ciel).'

  const eqHint =
    plan.support === 'equatorial'
      ? selectedCelestial
        ? `Suit ${selectedCelestial.name} + rotation de champ.`
        : 'Suit le centre du viseur + rotation de champ.'
      : 'Paysage fixe — le ciel dérive.'

  const popupBody = (
    <div
      id={panelId}
      className="vf-camera-pop vf-tlapse-pop"
      role="dialog"
      aria-label="Timelapse"
    >
      <header className="vf-camera-pop__head">
        <h2 className="vf-camera-pop__title">Timelapse</h2>
        <button
          type="button"
          className="vf-camera-pop__close"
          aria-label="Fermer les réglages"
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </header>

      <div className="vf-camera-pop__twocol">
        <TimelapseNumberStepper
          label="Pose — s"
          ariaLabel="Pose en secondes"
          value={poseS}
          min={TIMELAPSE_POSE_MIN_S}
          max={TIMELAPSE_POSE_MAX_S}
          step={1}
          disabled={busy}
          onChange={(next) => patch({ poseS: next })}
        />
        <TimelapseNumberStepper
          label="Intervalle — s"
          ariaLabel="Intervalle en secondes"
          value={intervalS}
          min={poseS}
          max={TIMELAPSE_INTERVAL_MAX_S}
          step={1}
          disabled={busy}
          onChange={(next) => patch({ intervalS: next })}
        />
        <TimelapseNumberStepper
          label="Durée — min"
          ariaLabel="Durée en minutes"
          value={durationMin}
          min={TIMELAPSE_DURATION_MIN_MIN}
          max={TIMELAPSE_DURATION_MAX_MIN}
          step={5}
          disabled={busy}
          onChange={(next) => patch({ durationMin: next })}
        />
        <TimelapseNumberStepper
          label="Lecture — i/s"
          ariaLabel="Cadence de lecture en images par seconde"
          value={playbackFps}
          min={TIMELAPSE_FPS_MIN}
          max={TIMELAPSE_FPS_MAX}
          step={1}
          disabled={busy}
          onChange={(next) => patch({ playbackFps: next })}
        />
      </div>

      <p className="vf-camera-pop__hint vf-tlapse-pop__interval-hint">
        Intervalle mesuré entre deux débuts de pose.
      </p>

      <div className="vf-camera-pop__field">
        <label className="vf-camera-pop__label" htmlFor={`${panelId}-support`}>
          Support
        </label>
        <select
          id={`${panelId}-support`}
          className="vf-pano-select"
          aria-label="Type de support"
          disabled={busy}
          value={plan.support}
          onChange={(event) =>
            patch({ support: event.target.value as TimelapseSupport })
          }
        >
          {TIMELAPSE_SUPPORTS.map((mode) => (
            <option key={mode} value={mode}>
              {TIMELAPSE_SUPPORT_LABELS[mode]}
            </option>
          ))}
        </select>
        <p className="vf-camera-pop__hint">{eqHint}</p>
        <p
          className={
            trailOn && poseS > rule500
              ? 'vf-camera-pop__hint vf-tlapse-pop__trail is-hot'
              : 'vf-camera-pop__hint vf-tlapse-pop__trail'
          }
        >
          {trailHint}
        </p>
      </div>

      {plan.support === 'equatorial' ? (
        <div className="vf-camera-pop__field">
          <label
            className="vf-camera-pop__label"
            htmlFor={`${panelId}-eq-rot`}
          >
            Rotation de champ
          </label>
          <select
            id={`${panelId}-eq-rot`}
            className="vf-pano-select"
            aria-label="Affichage de la rotation de champ"
            disabled={busy}
            value={plan.eqRotation}
            onChange={(event) =>
              patch({
                eqRotation: event.target.value as TimelapseEqRotation,
              })
            }
          >
            {TIMELAPSE_EQ_ROTATIONS.map((mode) => (
              <option key={mode} value={mode}>
                {TIMELAPSE_EQ_ROTATION_LABELS[mode]}
              </option>
            ))}
          </select>
          <p className="vf-camera-pop__hint">
            {plan.eqRotation === 'scene'
              ? 'La caméra roule : le sol bascule, les étoiles restent fixes dans le cadre.'
              : 'Horizon niveau : seul le cadre photo tourne (lecture illustrative).'}
          </p>
        </div>
      ) : null}

      <div className="vf-pano-pop__summary">
        <span className="vf-camera-pop__big vf-tlapse-pop__count">
          {shots}
          <span className="vf-camera-pop__unit"> images</span>
        </span>
        <span className="vf-pano-pop__pill">
          {formatTimelapseVideoSeconds(videoS)} de vidéo
        </span>
      </div>

      <button
        type="button"
        className="vf-tlapse-pop__preview"
        disabled={busy}
        onClick={() => {
          onStartPreview()
          setOpen(false)
        }}
      >
        <PlaySequenceIcon size={16} />
        {busy ? 'Aperçu en cours…' : 'Aperçu de la séquence'}
      </button>

      <p className="vf-camera-pop__hint vf-tlapse-pop__foot">
        La lecture s’affiche en bas de l’écran (hors panneau). Pas d’export
        vidéo.
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
