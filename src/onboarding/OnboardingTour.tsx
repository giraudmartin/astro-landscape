import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { createSpotActionMarkerElement } from '../spotActionMarker'
import {
  OPERATE_PHONE_MQ,
  OPERATE_TOUR_COMPACT_MQ,
  useMatchMedia,
} from '../useMatchMedia'
import { requestTourFlyToDemo } from './tourEvents'
import {
  TOUR_STEPS,
  type TourAnchor,
  type TourStepDef,
  type TourStepId,
} from './tourSteps'
import './tour.css'

const MARKER_ACTION_IDS = ['street', 'immersive', 'skyFlat'] as const

type MarkerActionId = (typeof MARKER_ACTION_IDS)[number]

function svgIcon(paths: ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths}
    </svg>
  )
}

function TourActionIcon({ name }: { name: MarkerActionId }) {
  if (name === 'street') {
    return svgIcon(
      <>
        <circle cx="12" cy="5" r="1" />
        <path d="m9 20 3-6 3 6M6 8l6 2 6-2M12 10v4" />
      </>,
    )
  }
  if (name === 'immersive') {
    return svgIcon(<path d="m8 3 4 8 5-5 5 15H2L8 3z" />)
  }
  return svgIcon(
    <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />,
  )
}

const TOUR_MARKER_NOOP = {
  onStreetView: () => undefined,
  onImmersive: () => undefined,
  onSkyFlat: () => undefined,
  onAdd: () => false,
  onEdit: () => undefined,
  shouldBlockOpen: () => true,
}

/** Live map marker element, forced open + saved (edit spoke). Illustration only. */
function TourMarkerPanelDemo() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const marker = createSpotActionMarkerElement(true, TOUR_MARKER_NOOP)
    marker.element.classList.add(
      'onboarding-tour__marker-demo-pin',
      'spot-action-marker--open',
    )
    marker.element.removeAttribute('data-tour-anchor')
    marker.setSaved(true)
    marker.setLabel(null)
    // Don't call marker.open() — that would steal the map's global open menu.
    const center = marker.element.querySelector('.spot-action-marker__center')
    center?.setAttribute('aria-expanded', 'true')
    host.replaceChildren(marker.element)
    return () => {
      marker.destroy()
      host.replaceChildren()
    }
  }, [])

  return (
    <div
      ref={hostRef}
      className="onboarding-tour__marker-demo"
      aria-hidden="true"
    />
  )
}

export type OnboardingTourProps = {
  open: boolean
  onClose: (reason: 'skip' | 'finish') => void
  /** Place (or select) the demo Mirador spot and select it. */
  onPlaceDemoSpot: () => void
  /** Add a sample framing on the tour Mirador spot. */
  onAddExampleFraming: () => void
  /** Finish tour and open the immersive / tripod view. */
  onOpenImmersive: () => void
  /** Prepare UI for a step (open rails, enable PL, open marker menu…). */
  onStepEnter: (stepId: TourStepId) => void
  /** Phone spots beat: open the Mes spots sheet after the icon is ringed. */
  onPhoneOpenSpots: () => void
  /** Phone framings beat: open the cadrages sheet after the icon is ringed. */
  onPhoneOpenFramings: () => void
}

/** Phone rail steps: point at icon → open sheet → show card. */
type PhoneRailBeat = 'off' | 'point' | 'open' | 'card'

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
/** Keep the map timeline / bottom chrome clear when parking a card. */
const BOTTOM_CLEAR = 108
/** Right map control stack — leave room when docking bottom-right. */
const RIGHT_RAIL_CLEAR = 72
const SCRIM = 'rgba(2, 6, 7, 0.28)'

/** Layout truth: overview column is LEFT; map control stack is RIGHT. */
type Side = 'left' | 'right'

function preferredSide(anchor: TourAnchor | undefined): Side | null {
  if (!anchor) return null
  if (anchor === 'ov-anchor') return 'left'
  if (
    anchor === 'pl-control' ||
    anchor === 'my-spots' ||
    anchor === 'framings'
  ) {
    return 'right'
  }
  return null
}

function queryAnchor(anchor: TourAnchor): HTMLElement | null {
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

/** Working pin is 1×1 with overflow — measure the center / open radial instead. */
function measureSpotMarkerHole(): HoleRect | null {
  const el = queryAnchor('spot-marker')
  if (!el) return null
  const center = el.querySelector<HTMLElement>('.spot-action-marker__center')
  const target = center ?? el
  const r = target.getBoundingClientRect()
  if (r.width < 1 && r.height < 1) return null
  // Same green ring whether the radial is open or just placed (tour spotlight).
  const size = 300
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  return {
    top: cy - size / 2,
    left: cx - size / 2,
    width: size,
    height: size,
    round: true,
  }
}

/** Intersect two axis-aligned rects; null if empty. */
function intersectRect(
  a: { top: number; left: number; width: number; height: number },
  b: { top: number; left: number; width: number; height: number },
): { top: number; left: number; width: number; height: number } | null {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)
  if (right - left < 8 || bottom - top < 8) return null
  return { left, top, width: right - left, height: bottom - top }
}

function measureAnchorHole(anchor: TourAnchor): HoleRect | null {
  if (anchor === 'spot-marker') return measureSpotMarkerHole()
  const el = queryAnchor(anchor)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return null
  let top = r.top - PAD
  let left = r.left - PAD
  let width = r.width + PAD * 2
  let height = r.height + PAD * 2

  // Overview column scrolls inside .map-ui and can be taller than the viewport.
  // Spotlight only the visible slice so desktop doesn't get a full-height green slab.
  if (anchor === 'ov-anchor') {
    const scrollPort =
      el.closest<HTMLElement>('.map-ui')?.getBoundingClientRect() ?? null
    const view = {
      top: 0,
      left: 0,
      width: typeof window !== 'undefined' ? window.innerWidth : 1200,
      height: typeof window !== 'undefined' ? window.innerHeight : 800,
    }
    const clip = scrollPort
      ? intersectRect(
          { top, left, width, height },
          {
            top: scrollPort.top,
            left: scrollPort.left,
            width: scrollPort.width,
            height: scrollPort.height,
          },
        )
      : intersectRect({ top, left, width, height }, view)
    if (!clip) return null
    top = clip.top
    left = clip.left
    width = clip.width
    height = clip.height
  }

  return {
    top,
    left,
    width,
    height,
    round:
      anchor === 'my-spots' ||
      anchor === 'framings' ||
      anchor === 'pl-control',
  }
}

function measureTourPanelHole(
  panel: 'my-spots-rail' | 'framings-rail' | 'mobile-info-drawer',
): HoleRect | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector<HTMLElement>(`[data-tour-panel="${panel}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 8 || r.height < 8) return null
  // Closed / off-screen top drawer (translateY fully up).
  if (r.bottom < 24) return null
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
    round: false,
  }
}

/** Spotlight cutouts for the active step. */
function collectHoles(step: TourStepDef): HoleRect[] {
  const holes: HoleRect[] = []

  // Place + marker: always ring the live pin so the spot stays visible.
  if (step.id === 'place' || step.id === 'marker') {
    const pin = measureSpotMarkerHole()
    if (pin) holes.push(pin)
    return holes
  }

  // Phone panels: undim the open top drawer (no left overview column).
  if (step.id === 'panels') {
    const drawer = measureTourPanelHole('mobile-info-drawer')
    if (drawer) return [drawer]
  }

  if (!step.anchor) return []
  const primary = measureAnchorHole(step.anchor)
  if (primary) holes.push(primary)
  // Spots / cadrages: undim the open rail so the presented panel stays readable.
  // Interaction stays locked via the full-screen scrim-hit layer.
  if (step.id === 'spots') {
    const panel = measureTourPanelHole('my-spots-rail')
    if (panel) holes.push(panel)
  } else if (step.id === 'framings' || step.id === 'exampleFraming') {
    const panel = measureTourPanelHole('framings-rail')
    if (panel) holes.push(panel)
  }
  return holes
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

/**
 * Welcome / place / done: never cover map center.
 * Beside the pin when it exists; otherwise bottom-right corner.
 */
function parkClearOfMapCenterStyle(
  hole: HoleRect | null,
  cardW: number,
  cardH: number,
): CSSProperties {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const width = Math.min(cardW, vw - MARGIN * 2)
  const height = Math.max(cardH, 120)

  if (hole) {
    const spaceRight =
      vw - (hole.left + hole.width) - MARGIN - RIGHT_RAIL_CLEAR
    const spaceLeft = hole.left - MARGIN
    let left: number
    if (spaceRight >= width + GAP) {
      left = hole.left + hole.width + GAP
    } else if (spaceLeft >= width + GAP) {
      left = hole.left - width - GAP
    } else {
      left = vw - width - MARGIN - RIGHT_RAIL_CLEAR
    }
    return {
      left: clamp(left, MARGIN, vw - width - MARGIN),
      top: clamp(
        hole.top + hole.height / 2 - height / 2,
        MARGIN,
        vh - height - MARGIN,
      ),
    }
  }

  return {
    left: clamp(
      vw - width - MARGIN - RIGHT_RAIL_CLEAR,
      MARGIN,
      vw - width - MARGIN,
    ),
    top: clamp(vh - height - BOTTOM_CLEAR, MARGIN, vh - height - MARGIN),
  }
}

/** Last map step: center the card in the viewport. */
function parkCenterStyle(cardW: number, cardH: number): CSSProperties {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const width = Math.min(cardW, vw - MARGIN * 2)
  const height = Math.max(cardH, 120)
  return {
    left: Math.max(MARGIN, (vw - width) / 2),
    top: clamp((vh - height) / 2, MARGIN, vh - height - MARGIN),
  }
}

function cardStyleFor(
  hole: HoleRect | null,
  step: TourStepDef,
  cardW: number,
  cardH: number,
): CSSProperties {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const width = Math.min(cardW, vw - MARGIN * 2)
  const height = Math.max(cardH, 120)

  if (!hole) {
    return parkClearOfMapCenterStyle(null, width, height)
  }

  const side = preferredSide(step.anchor)
  const spaceLeft = hole.left - MARGIN
  const spaceRight = vw - (hole.left + hole.width) - MARGIN

  let left: number
  if (step.anchor === 'spot-marker') {
    return parkClearOfMapCenterStyle(hole, width, height)
  }

  if (side === 'left') {
    left =
      spaceRight >= width + GAP
        ? hole.left + hole.width + GAP
        : hole.left - width - GAP
  } else if (side === 'right') {
    left =
      spaceLeft >= width + GAP
        ? hole.left - width - GAP
        : hole.left + hole.width + GAP
  } else {
    left =
      spaceLeft >= spaceRight
        ? hole.left - width - GAP
        : hole.left + hole.width + GAP
  }

  const top =
    hole.height < 140
      ? hole.top + hole.height / 2 - height / 2
      : hole.top

  return {
    left: clamp(left, MARGIN, vw - width - MARGIN),
    top: clamp(top, MARGIN, vh - height - MARGIN),
  }
}

export function OnboardingTour({
  open,
  onClose,
  onPlaceDemoSpot,
  onAddExampleFraming,
  onOpenImmersive,
  onStepEnter,
  onPhoneOpenSpots,
  onPhoneOpenFramings,
}: OnboardingTourProps) {
  const t = useT()
  const isPhone = useMatchMedia(OPERATE_PHONE_MQ)
  /** Compact tour chrome — tablet + laptop Operate (721–1440). */
  const isCompact = useMatchMedia(OPERATE_TOUR_COMPACT_MQ)
  const [index, setIndex] = useState(0)
  const [holes, setHoles] = useState<HoleRect[]>([])
  const [cardBox, setCardBox] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia(OPERATE_TOUR_COMPACT_MQ).matches
      ? { w: 280, h: 160 }
      : { w: 360, h: 200 },
  )
  /** After place / add-framing CTAs, stay on the same card with Continuer. */
  const [placeDone, setPlaceDone] = useState(false)
  const [exampleFramingAdded, setExampleFramingAdded] = useState(false)
  /** Phone: hide card while pointing at Mes spots / Cadrages icon. */
  const [phoneRailBeat, setPhoneRailBeat] = useState<PhoneRailBeat>('off')
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1200,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }))
  const cardRef = useRef<HTMLDivElement>(null)

  const step = TOUR_STEPS[index] ?? TOUR_STEPS[0]
  const total = TOUR_STEPS.length
  const primaryHole = holes[0] ?? null
  const isMarkerStep = step.id === 'marker'

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
    if (r.width < 2 || r.height < 2) return
    setCardBox((prev) =>
      Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
        ? prev
        : { w: r.width, h: r.height },
    )
  }, [])

  useEffect(() => {
    if (!open) return
    setIndex(0)
    setPlaceDone(false)
    setExampleFramingAdded(false)
    setPhoneRailBeat('off')
  }, [open])

  /**
   * Phone spots / framings: close top drawer (via step enter) → hide card →
   * ring the stack icon → open the bottom sheet → show this step’s card.
   */
  useEffect(() => {
    if (!open || !isPhone) {
      setPhoneRailBeat('off')
      return
    }
    if (step.id !== 'spots' && step.id !== 'framings') {
      setPhoneRailBeat('off')
      return
    }
    setPhoneRailBeat('point')
    const openPanel = step.id === 'spots' ? onPhoneOpenSpots : onPhoneOpenFramings
    const tOpen = window.setTimeout(() => {
      openPanel()
      setPhoneRailBeat('open')
      refreshHoles()
    }, 1100)
    const tCard = window.setTimeout(() => {
      setPhoneRailBeat('card')
      refreshHoles()
      refreshCardBox()
    }, 1750)
    const tHoles = [
      window.setTimeout(refreshHoles, 60),
      window.setTimeout(refreshHoles, 320),
      window.setTimeout(refreshHoles, 700),
    ]
    return () => {
      window.clearTimeout(tOpen)
      window.clearTimeout(tCard)
      for (const id of tHoles) window.clearTimeout(id)
    }
  }, [
    open,
    isPhone,
    step.id,
    onPhoneOpenSpots,
    onPhoneOpenFramings,
    refreshHoles,
    refreshCardBox,
  ])

  const showTourCard =
    !isPhone ||
    phoneRailBeat === 'off' ||
    phoneRailBeat === 'card'

  /** Laptop panels: punch a scroll hole over .map-ui; clicks stay blocked. */
  const allowMapUiScroll = open && isCompact && step.id === 'panels'
  /** Phone panels: same idea over the open top info drawer. */
  const allowInfoDrawerScroll = open && isPhone && step.id === 'panels'
  const allowScrollHole = allowMapUiScroll || allowInfoDrawerScroll

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('is-tour-scroll-map-ui', allowMapUiScroll)
    root.classList.toggle('is-tour-scroll-info-drawer', allowInfoDrawerScroll)
    return () => {
      root.classList.remove('is-tour-scroll-map-ui')
      root.classList.remove('is-tour-scroll-info-drawer')
    }
  }, [allowMapUiScroll, allowInfoDrawerScroll])

  // Phone panels: scroll OK, clicks killed (pointer-events:none on * breaks iOS scroll).
  useEffect(() => {
    if (!allowInfoDrawerScroll) return
    const panel = document.querySelector<HTMLElement>(
      '[data-tour-panel="mobile-info-drawer"]',
    )
    if (!panel) return
    const interactive =
      'button, a, input, select, textarea, label, summary, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"]'
    const blockActivate = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    const blockInteractivePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (!target.closest(interactive)) return
      event.preventDefault()
      event.stopPropagation()
    }
    panel.addEventListener('click', blockActivate, true)
    panel.addEventListener('auxclick', blockActivate, true)
    panel.addEventListener('keydown', blockActivate, true)
    panel.addEventListener('pointerdown', blockInteractivePointer, true)
    return () => {
      panel.removeEventListener('click', blockActivate, true)
      panel.removeEventListener('auxclick', blockActivate, true)
      panel.removeEventListener('keydown', blockActivate, true)
      panel.removeEventListener('pointerdown', blockInteractivePointer, true)
    }
  }, [allowInfoDrawerScroll, primaryHole])

  useEffect(() => {
    if (step.id !== 'place') setPlaceDone(false)
    if (step.id !== 'exampleFraming') setExampleFramingAdded(false)
  }, [step.id])

  useEffect(() => {
    if (!open) return
    onStepEnter(step.id)
    if (step.id === 'welcome' || step.id === 'place') {
      requestTourFlyToDemo()
    }
    // Phone marker: card height changes — reframe pin after the capped card lays out.
    const frameMarker =
      step.id === 'marker' && isPhone
        ? window.setTimeout(() => {
            requestAnimationFrame(() => requestTourFlyToDemo())
          }, 220)
        : 0
    const t1 = window.setTimeout(refreshHoles, 60)
    const t2 = window.setTimeout(refreshHoles, 320)
    const t3 = window.setTimeout(refreshHoles, 700)
    const t4 = window.setTimeout(refreshHoles, 1600)
    return () => {
      window.clearTimeout(frameMarker)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
      window.clearTimeout(t4)
    }
  }, [open, step.id, isPhone, onStepEnter, refreshHoles])

  useLayoutEffect(() => {
    if (!open) return
    refreshHoles()
    refreshCardBox()
  }, [open, index, refreshHoles, refreshCardBox])

  useLayoutEffect(() => {
    if (!open) return
    refreshCardBox()
  }, [open, index, primaryHole, refreshCardBox])

  useEffect(() => {
    if (!open) return
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight })
      refreshHoles()
      refreshCardBox()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, refreshHoles, refreshCardBox])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose('skip')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const goNext = useCallback(() => {
    if (index >= total - 1) {
      onClose('finish')
      return
    }
    setIndex((i) => i + 1)
  }, [index, total, onClose])

  const onPrimary = useCallback(() => {
    if (step.cta === 'place') {
      if (placeDone) {
        goNext()
        return
      }
      onPlaceDemoSpot()
      setPlaceDone(true)
      // Keep this card so the user sees the pin land; CTA becomes Continuer.
      window.setTimeout(() => {
        refreshHoles()
        refreshCardBox()
      }, 400)
      window.setTimeout(() => {
        refreshHoles()
        refreshCardBox()
      }, 1600)
      return
    }
    if (step.cta === 'addFraming') {
      if (exampleFramingAdded) {
        goNext()
        return
      }
      onAddExampleFraming()
      setExampleFramingAdded(true)
      // Keep this card so the user can see the new framing in the rail.
      window.setTimeout(() => {
        refreshHoles()
        refreshCardBox()
      }, 200)
      return
    }
    if (step.cta === 'immersive') {
      onClose('finish')
      onOpenImmersive()
      return
    }
    if (step.cta === 'finish') {
      onClose('finish')
      return
    }
    goNext()
  }, [
    step.cta,
    placeDone,
    exampleFramingAdded,
    onPlaceDemoSpot,
    onAddExampleFraming,
    onOpenImmersive,
    onClose,
    goNext,
    refreshHoles,
    refreshCardBox,
  ])

  if (!open) return null

  const title = t(`onboarding.tour.steps.${step.id}.title`)
  const body =
    step.id === 'place'
      ? t(
          isPhone
            ? 'onboarding.tour.steps.place.bodyMobile'
            : 'onboarding.tour.steps.place.bodyDesktop',
        )
      : step.id === 'panels' ||
          step.id === 'spots' ||
          step.id === 'framings' ||
          step.id === 'pl'
        ? t(
            isPhone
              ? `onboarding.tour.steps.${step.id}.bodyMobile`
              : `onboarding.tour.steps.${step.id}.body`,
          )
        : step.id === 'marker'
          ? // Radial is forced open on this step — never the “when you click” copy.
            t('onboarding.tour.steps.marker.bodyDesktop')
          : t(`onboarding.tour.steps.${step.id}.body`)
  const bodyFollow =
    step.id === 'welcome'
      ? t('onboarding.tour.steps.welcome.body2')
      : step.id === 'place'
        ? placeDone
          ? t('onboarding.tour.steps.place.bodyAfter')
          : t(
              isPhone
                ? 'onboarding.tour.steps.place.bodyMobile2'
                : 'onboarding.tour.steps.place.bodyDesktop2',
            )
        : step.id === 'done'
          ? t('onboarding.tour.steps.done.body2')
          : step.id === 'exampleFraming' && exampleFramingAdded
            ? t('onboarding.tour.steps.exampleFraming.bodyAfter')
            : null
  const ctaLabel =
    step.cta === 'place'
      ? placeDone
        ? t('onboarding.tour.cta.next')
        : t('onboarding.tour.cta.place')
      : step.cta === 'addFraming'
        ? exampleFramingAdded
          ? t('onboarding.tour.cta.next')
          : t('onboarding.tour.cta.addFraming')
        : step.cta === 'immersive'
          ? t('onboarding.tour.cta.immersive')
          : step.cta === 'finish'
            ? t('onboarding.tour.cta.finish')
            : t('onboarding.tour.cta.next')

  const isRailStep =
    step.id === 'spots' ||
    step.id === 'framings' ||
    step.id === 'exampleFraming'
  // Phone panels: undim the top drawer without a giant green frame.
  const isPhonePanelsDrawer = step.id === 'panels' && isPhone
  /** Phone: green ring only while pointing at the stack icon (before sheet covers it). */
  const phoneRailPointing =
    isPhone &&
    (step.id === 'spots' || step.id === 'framings') &&
    (phoneRailBeat === 'point' || phoneRailBeat === 'open')
  // Ring the toggle only — the open rail is undimmed without a giant frame.
  // Phone open-sheet steps: never ring the buried stack icon (clips at screen edge).
  const ringHoles = isPhonePanelsDrawer
    ? []
    : phoneRailPointing
      ? holes.slice(0, 1)
      : isPhone && isRailStep
        ? []
        : isRailStep
          ? holes.slice(0, 1)
          : holes
  // Laptop map-centric steps: corner park so the pin stays clear. Finale centered.
  const mapCornerStep =
    isCompact &&
    (step.id === 'welcome' || step.id === 'place' || step.id === 'marker')
  // Phone + laptop: live radial on the map; card is the action list only.
  const liveMarkerOnMap = isMarkerStep && (isPhone || isCompact)
  const styleCardW =
    liveMarkerOnMap
      ? Math.max(cardBox.w, Math.min(isPhone ? 328 : 300, viewport.w - 48))
      : isMarkerStep && !isCompact
        ? Math.max(cardBox.w, Math.min(328, viewport.w - 48))
        : isCompact && step.id === 'done'
          ? Math.max(cardBox.w, Math.min(300, viewport.w - 48))
          : cardBox.w
  // Phone rail sheets: card low so the list / example row stays readable above.
  const phoneRailCard =
    isPhone &&
    isRailStep &&
    (step.id === 'exampleFraming' || phoneRailBeat === 'card')
  const cardStyle = phoneRailCard
    ? (() => {
        const vw = viewport.w
        const vh = viewport.h
        const width = Math.min(styleCardW, vw - MARGIN * 2)
        const height = Math.max(cardBox.h, 120)
        const bottomPad = Math.max(MARGIN, 20)
        return {
          left: clamp((vw - width) / 2, MARGIN, vw - width - MARGIN),
          top: clamp(vh - height - bottomPad, MARGIN, vh - height - MARGIN),
        }
      })()
    : isCompact && step.id === 'done'
      ? parkCenterStyle(styleCardW, cardBox.h)
      : mapCornerStep
        ? parkClearOfMapCenterStyle(null, styleCardW, cardBox.h)
        : cardStyleFor(primaryHole, step, styleCardW, cardBox.h)
  const maskId = 'onboarding-tour-mask'
  const cardClass = [
    'onboarding-tour__card',
    isCompact ? 'onboarding-tour__card--laptop' : '',
    isMarkerStep && !liveMarkerOnMap ? 'onboarding-tour__card--wide' : '',
    liveMarkerOnMap ? 'onboarding-tour__card--marker-list' : '',
    step.id === 'done' ? 'onboarding-tour__card--finale' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className="onboarding-tour-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-tour-title"
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

      {/*
        Hit lock: full-screen by default. Panels step: leave a hole over the
        overview column (laptop) or top info drawer (phone) so it can scroll —
        controls stay inert via CSS.
      */}
      {allowScrollHole && primaryHole ? (
        <>
          <div
            className="onboarding-tour__scrim-hit onboarding-tour__scrim-hit--band"
            style={{
              top: 0,
              left: 0,
              right: 0,
              height: Math.max(0, primaryHole.top),
            }}
            aria-hidden="true"
          />
          <div
            className="onboarding-tour__scrim-hit onboarding-tour__scrim-hit--band"
            style={{
              top: primaryHole.top + primaryHole.height,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            aria-hidden="true"
          />
          <div
            className="onboarding-tour__scrim-hit onboarding-tour__scrim-hit--band"
            style={{
              top: primaryHole.top,
              left: 0,
              width: Math.max(0, primaryHole.left),
              height: primaryHole.height,
            }}
            aria-hidden="true"
          />
          <div
            className="onboarding-tour__scrim-hit onboarding-tour__scrim-hit--band"
            style={{
              top: primaryHole.top,
              left: primaryHole.left + primaryHole.width,
              right: 0,
              height: primaryHole.height,
            }}
            aria-hidden="true"
          />
        </>
      ) : (
        <div
          className="onboarding-tour__scrim-hit onboarding-tour__scrim-hit--full"
          aria-hidden="true"
        />
      )}

      {ringHoles.map((h, i) => (
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

      {showTourCard
        ? createPortal(
            <div ref={cardRef} className={cardClass} style={cardStyle}>
              <p className="onboarding-tour__step">
                {t('onboarding.tour.progress', {
                  current: String(index + 1),
                  total: String(total),
                })}
              </p>
              <h2 id="onboarding-tour-title" className="onboarding-tour__title">
                {title}
              </h2>
              <p className="onboarding-tour__body">{body}</p>
              {bodyFollow ? (
                <p className="onboarding-tour__body onboarding-tour__body--follow">
                  {bodyFollow}
                </p>
              ) : null}
              {isMarkerStep ? (
                <div
                  className={
                    liveMarkerOnMap
                      ? 'onboarding-tour__marker-layout onboarding-tour__marker-layout--list'
                      : 'onboarding-tour__marker-layout'
                  }
                >
                  {!liveMarkerOnMap ? <TourMarkerPanelDemo /> : null}
                  <ul className="onboarding-tour__action-list">
                    {MARKER_ACTION_IDS.map((id) => (
                      <li key={id} className="onboarding-tour__action-row">
                        <span
                          className="onboarding-tour__action-icon"
                          aria-hidden="true"
                        >
                          <TourActionIcon name={id} />
                        </span>
                        <span className="onboarding-tour__action-copy">
                          <span className="onboarding-tour__action-label">
                            {t(
                              `onboarding.tour.steps.marker.actions.${id}.label`,
                            )}
                          </span>
                          <span className="onboarding-tour__action-hint">
                            {t(
                              `onboarding.tour.steps.marker.actions.${id}.hint`,
                            )}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="onboarding-tour__actions">
                <button
                  type="button"
                  className="onboarding-tour__skip"
                  onClick={() => onClose('skip')}
                >
                  {t('onboarding.tour.skip')}
                </button>
                <button
                  type="button"
                  className="onboarding-tour__next"
                  onClick={onPrimary}
                >
                  {ctaLabel}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
