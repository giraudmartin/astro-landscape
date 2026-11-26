import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useT } from '../i18n'
import {
  IMMERSIVE_TOUR_STEPS,
  type ImmersiveTourAnchor,
  type ImmersiveTourStepDef,
  type ImmersiveTourStepId,
} from './immersiveTourSteps'
import { prepareImmersiveTourStep } from './immersiveTourUi'
import './tour.css'

export type OnboardingImmersiveTourProps = {
  open: boolean
  onClose: (reason: 'skip' | 'finish') => void
  /** Prepare UI for a step (open framings rail…). */
  onStepEnter: (stepId: ImmersiveTourStepId) => void
}

type HoleRect = {
  top: number
  left: number
  width: number
  height: number
  round: boolean
}

const PAD = 8
const MARGIN = 16
const GAP = 12
const SCRIM = 'rgba(2, 6, 7, 0.62)'

const ROUND_ANCHORS: ReadonlySet<ImmersiveTourAnchor> = new Set([
  'immersive-save',
  'vf-scene',
])

function queryAnchor(anchor: ImmersiveTourAnchor): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>(`[data-tour-anchor="${anchor}"]`)
}

function holesEqual(a: HoleRect | null, b: HoleRect | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5 &&
    a.round === b.round
  )
}

function holeListsEqual(a: HoleRect[], b: HoleRect[]): boolean {
  if (a.length !== b.length) return false
  return a.every((h, i) => holesEqual(h, b[i]!))
}

function measureAnchorHole(anchor: ImmersiveTourAnchor): HoleRect | null {
  const el = queryAnchor(anchor)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return null
  return {
    top: r.top - PAD,
    left: r.left - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
    round: ROUND_ANCHORS.has(anchor),
  }
}

function viewClearHole(): HoleRect {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const w = Math.min(vw * 0.58, 720)
  const h = Math.min(vh * 0.42, 380)
  return {
    top: vh * 0.32,
    left: (vw - w) / 2,
    width: w,
    height: h,
    round: false,
  }
}

function measureTourPanelHole(panel: 'framings-rail'): HoleRect | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector<HTMLElement>(`[data-tour-panel="${panel}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 8 || r.height < 8) return null
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
    round: false,
  }
}

function collectHoles(step: ImmersiveTourStepDef): HoleRect[] {
  const holes: HoleRect[] = []
  if (step.anchor) {
    // Float panels may still be mounting — fall back to the Réglages trigger.
    const primary =
      measureAnchorHole(step.anchor) ??
      (step.anchor.startsWith('vf-float-')
        ? measureAnchorHole('vf-scene')
        : null)
    if (primary) holes.push(primary)
  }
  // Save step: undim the whole Cadrages rail (button hole alone leaves it greyed).
  if (step.id === 'save') {
    const panel = measureTourPanelHole('framings-rail')
    if (panel) holes.push(panel)
  }
  if (step.clearView) holes.push(viewClearHole())
  return holes
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

function cardStyleFor(
  hole: HoleRect | null,
  step: ImmersiveTourStepDef,
  cardW: number,
  cardH: number,
): CSSProperties {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const width = Math.min(cardW, vw - MARGIN * 2)
  const height = Math.max(cardH, 120)

  if (!hole) {
    return {
      left: Math.max(MARGIN, (vw - width) / 2),
      top: Math.max(24, vh * 0.18),
    }
  }

  // Top-bar anchors: place the card below.
  if (
    step.anchor === 'vf-capsule' ||
    step.anchor === 'vf-modes' ||
    step.anchor === 'vf-scene'
  ) {
    let top = hole.top + hole.height + GAP
    if (top + height > vh - MARGIN) {
      top = Math.max(MARGIN, hole.top - height - GAP)
    }
    return {
      left: clamp(
        hole.left + hole.width / 2 - width / 2,
        MARGIN,
        vw - width - MARGIN,
      ),
      top: clamp(top, MARGIN, vh - height - MARGIN),
    }
  }

  // Tall float panels (qualité / ciel / météo): dock the card bottom-left
  // so it never stacks on top of the settings sheet.
  if (
    step.anchor === 'vf-float-quality' ||
    step.anchor === 'vf-float-sky' ||
    step.anchor === 'vf-float-weather'
  ) {
    return {
      left: MARGIN,
      top: clamp(vh - height - MARGIN - 12, MARGIN, vh - height - MARGIN),
    }
  }

  // Save: sit left of the Cadrages rail (not over it), near the Enregistrer control.
  if (step.id === 'save') {
    const panel = measureTourPanelHole('framings-rail')
    const railLeft = panel?.left ?? hole.left
    const left = clamp(railLeft - width - GAP, MARGIN, vw - width - MARGIN)
    const top = clamp(
      hole.top + hole.height / 2 - height / 2,
      MARGIN,
      vh - height - MARGIN,
    )
    return { left, top }
  }

  // Other: prefer left of the hole, else right.
  const spaceLeft = hole.left - MARGIN
  const left =
    spaceLeft >= width + GAP
      ? hole.left - width - GAP
      : hole.left + hole.width + GAP
  const top = hole.top + hole.height / 2 - height / 2

  return {
    left: clamp(left, MARGIN, vw - width - MARGIN),
    top: clamp(top, MARGIN, vh - height - MARGIN),
  }
}

export function OnboardingImmersiveTour({
  open,
  onClose,
  onStepEnter,
}: OnboardingImmersiveTourProps) {
  const t = useT()
  const [index, setIndex] = useState(0)
  const [holes, setHoles] = useState<HoleRect[]>([])
  const [cardBox, setCardBox] = useState({ w: 360, h: 200 })
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1200,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }))
  const cardRef = useRef<HTMLDivElement>(null)

  const step = IMMERSIVE_TOUR_STEPS[index] ?? IMMERSIVE_TOUR_STEPS[0]
  const total = IMMERSIVE_TOUR_STEPS.length
  const primaryHole = holes[0] ?? null
  // Soft view clear / rail undim: ring only the primary control (save button).
  const displayRings =
    step.clearView || step.id === 'save' ? holes.slice(0, 1) : holes

  const refreshHoles = useCallback(() => {
    setHoles((prev) => {
      const next = collectHoles(step)
      return holeListsEqual(prev, next) ? prev : next
    })
  }, [step])

  const refreshCardBox = useCallback(() => {
    const el = cardRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setCardBox((prev) =>
      Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
        ? prev
        : { w: r.width, h: r.height },
    )
  }, [])

  useEffect(() => {
    if (!open) return
    setIndex(0)
  }, [open])

  useEffect(() => {
    if (!open) return
    prepareImmersiveTourStep(step.id)
    onStepEnter(step.id)
  }, [open, step.id, onStepEnter])

  useLayoutEffect(() => {
    if (!open) return
    refreshHoles()
    refreshCardBox()
  }, [open, step, refreshHoles, refreshCardBox])

  useEffect(() => {
    if (!open) return
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight })
      refreshHoles()
      refreshCardBox()
    }
    window.addEventListener('resize', onResize)
    const id = window.setInterval(() => {
      refreshHoles()
      refreshCardBox()
    }, 400)
    return () => {
      window.removeEventListener('resize', onResize)
      window.clearInterval(id)
    }
  }, [open, refreshHoles, refreshCardBox])

  // Panels / rails may mount after the step opens — retry hole measure.
  useEffect(() => {
    if (!open) return
    if (
      step.id !== 'save' &&
      step.id !== 'quality' &&
      step.id !== 'sky' &&
      step.id !== 'weather' &&
      step.id !== 'modes'
    ) {
      return
    }
    let tries = 0
    const id = window.setInterval(() => {
      tries += 1
      refreshHoles()
      if (tries >= 16) window.clearInterval(id)
    }, 120)
    return () => window.clearInterval(id)
  }, [open, step.id, refreshHoles])

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(i + 1, total - 1))
  }, [total])

  const onPrimary = useCallback(() => {
    if (step.cta === 'finish') {
      onClose('finish')
      return
    }
    goNext()
  }, [step.cta, onClose, goNext])

  if (!open) return null

  const title = t(`onboarding.immersiveTour.steps.${step.id}.title`)
  const body = t(`onboarding.immersiveTour.steps.${step.id}.body`)
  const bodyFollow =
    step.id === 'done'
      ? t('onboarding.immersiveTour.steps.done.body2')
      : null
  const ctaLabel =
    step.cta === 'finish'
      ? t('onboarding.immersiveTour.cta.finish')
      : t('onboarding.immersiveTour.cta.next')

  const cardStyle = cardStyleFor(primaryHole, step, cardBox.w, cardBox.h)
  const maskId = 'onboarding-immersive-tour-mask'

  return (
    <div
      className="onboarding-tour-root onboarding-tour-root--immersive"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-immersive-tour-title"
    >
      <svg
        className="onboarding-tour__mask"
        width={viewport.w}
        height={viewport.h}
        aria-hidden="true"
      >
        <defs>
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x={0}
            y={0}
            width={viewport.w}
            height={viewport.h}
          >
            <rect
              x={0}
              y={0}
              width={viewport.w}
              height={viewport.h}
              fill="#fff"
            />
            {holes.map((h, i) =>
              h.round ? (
                <ellipse
                  key={i}
                  cx={h.left + h.width / 2}
                  cy={h.top + h.height / 2}
                  rx={h.width / 2}
                  ry={h.height / 2}
                  fill="#000"
                />
              ) : (
                <rect
                  key={i}
                  x={h.left}
                  y={h.top}
                  width={h.width}
                  height={h.height}
                  rx={14}
                  ry={14}
                  fill="#000"
                />
              ),
            )}
          </mask>
        </defs>
        <rect
          x={0}
          y={0}
          width={viewport.w}
          height={viewport.h}
          fill={SCRIM}
          mask={`url(#${maskId})`}
        />
      </svg>

      <div className="onboarding-tour__scrim-hit" aria-hidden="true" />

      {displayRings.map((h, i) => (
        <div
          key={i}
          className={
            h.round ? 'onboarding-tour__ring is-round' : 'onboarding-tour__ring'
          }
          style={{
            top: h.top,
            left: h.left,
            width: h.width,
            height: h.height,
          }}
          aria-hidden="true"
        />
      ))}

      <div ref={cardRef} className="onboarding-tour__card" style={cardStyle}>
        <p className="onboarding-tour__step">
          {t('onboarding.immersiveTour.progress', {
            current: String(index + 1),
            total: String(total),
          })}
        </p>
        <h2
          id="onboarding-immersive-tour-title"
          className="onboarding-tour__title"
        >
          {title}
        </h2>
        <p className="onboarding-tour__body">{body}</p>
        {bodyFollow ? (
          <p className="onboarding-tour__body onboarding-tour__body--follow">
            {bodyFollow}
          </p>
        ) : null}
        <div className="onboarding-tour__actions">
          <button
            type="button"
            className="onboarding-tour__skip"
            onClick={() => onClose('skip')}
          >
            {t('onboarding.immersiveTour.skip')}
          </button>
          <button
            type="button"
            className="onboarding-tour__next"
            onClick={onPrimary}
          >
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
