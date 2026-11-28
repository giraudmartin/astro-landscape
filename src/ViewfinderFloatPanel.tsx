import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useT } from './i18n'
import { ChevronLeftIcon, CompactCloseIcon } from './psIcons'

type FloatPos = { x: number; y: number }

type ViewfinderFloatPanelProps = {
  open: boolean
  onClose: () => void
  /** Return to the category menu (scene settings). Omit when standalone. */
  onBack?: () => void
  title: string
  storageKey: string
  defaultPos?: FloatPos
  children: ReactNode
  /** Portal host — usually `.immersive`. Resolved from trigger if omitted. */
  hostSelector?: string
  triggerRef?: React.RefObject<HTMLElement | null>
  /** Immersive onboarding coach-mark target. */
  tourAnchor?: string
  /** Extra data-* attributes on the panel root (outside-click, etc.). */
  panelDataAttrs?: Record<string, string>
}

const PANEL_WIDTH = 288
const PANEL_MIN_VISIBLE = 48
const DEFAULT_POS: FloatPos = { x: 24, y: 72 }

/** Shared by all Réglages scène category panels — one place, like the prototype. */
export const SCENE_SETTINGS_FLOAT_STORAGE_KEY = 'vf-scene-settings-panel-float-pos'
export const SCENE_SETTINGS_FLOAT_DEFAULT_POS: FloatPos = { x: 24, y: 72 }

/** In-memory cache so open never paints at a stale default before effects run. */
const posCache = new Map<string, FloatPos>()

function readFloatPos(storageKey: string): FloatPos | null {
  const cached = posCache.get(storageKey)
  if (cached) return cached
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FloatPos>
    if (
      typeof parsed.x === 'number' &&
      Number.isFinite(parsed.x) &&
      typeof parsed.y === 'number' &&
      Number.isFinite(parsed.y)
    ) {
      const pos = { x: parsed.x, y: parsed.y }
      posCache.set(storageKey, pos)
      return pos
    }
  } catch {
    /* ignore */
  }
  return null
}

function writeFloatPos(storageKey: string, pos: FloatPos) {
  posCache.set(storageKey, pos)
  try {
    localStorage.setItem(storageKey, JSON.stringify(pos))
  } catch {
    /* ignore */
  }
}

/** Drop saved spot so the next open returns to the initial place (near trigger). */
export function clearFloatPos(storageKey: string) {
  posCache.delete(storageKey)
  try {
    localStorage.removeItem(storageKey)
  } catch {
    /* ignore */
  }
}

function placeNearTrigger(
  triggerRef: React.RefObject<HTMLElement | null> | undefined,
  host: HTMLElement | null,
  fallback: FloatPos,
): FloatPos {
  const trigger = triggerRef?.current
  if (!trigger || !host) return fallback
  const hostRect = host.getBoundingClientRect()
  const triggerRect = trigger.getBoundingClientRect()
  return {
    x: triggerRect.right - hostRect.left - PANEL_WIDTH,
    y: triggerRect.bottom - hostRect.top + 8,
  }
}

function clampFloatPos(
  pos: FloatPos,
  host: HTMLElement | null,
  panel: HTMLElement | null,
): FloatPos {
  const hostW = host?.clientWidth ?? window.innerWidth
  const hostH = host?.clientHeight ?? window.innerHeight
  const panelW = panel?.offsetWidth ?? PANEL_WIDTH
  const panelH = panel?.offsetHeight ?? 320
  const maxX = Math.max(0, hostW - PANEL_MIN_VISIBLE)
  const maxY = Math.max(0, hostH - PANEL_MIN_VISIBLE)
  const minX = Math.min(0, hostW - panelW)
  const minY = Math.min(0, hostH - panelH)
  return {
    x: Math.min(maxX, Math.max(minX, pos.x)),
    y: Math.min(maxY, Math.max(minY, pos.y)),
  }
}

function resolveHost(
  triggerRef: React.RefObject<HTMLElement | null> | undefined,
  hostSelector: string,
): HTMLElement | null {
  const fromTrigger = triggerRef?.current?.closest(
    '.immersive',
  ) as HTMLElement | null
  if (fromTrigger) return fromTrigger
  if (typeof document === 'undefined') return null
  return document.querySelector(hostSelector) as HTMLElement | null
}

function resolveOpenPos(
  storageKey: string,
  defaultPos: FloatPos,
  triggerRef: React.RefObject<HTMLElement | null> | undefined,
  hostSelector: string,
  panel: HTMLElement | null,
): FloatPos {
  const host = resolveHost(triggerRef, hostSelector)
  const stored = readFloatPos(storageKey)
  const base = stored ?? placeNearTrigger(triggerRef, host, defaultPos)
  return clampFloatPos(base, host, panel)
}

/**
 * Shared floating semi-transparent settings window for immersive chrome.
 */
export function ViewfinderFloatPanel({
  open,
  onClose,
  onBack,
  title,
  storageKey,
  defaultPos = DEFAULT_POS,
  children,
  hostSelector = '.immersive',
  triggerRef,
  tourAnchor,
  panelDataAttrs,
}: ViewfinderFloatPanelProps) {
  const t = useT()
  const [floatPos, setFloatPos] = useState<FloatPos>(defaultPos)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const backBtnRef = useRef<HTMLButtonElement | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)
  const hostRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const titleId = useId()
  const wasOpenRef = useRef(false)
  const prevOpenRef = useRef(false)

  // Adjust state during render when opening — first painted frame is already correct.
  if (open && !prevOpenRef.current) {
    const next = resolveOpenPos(
      storageKey,
      defaultPos,
      triggerRef,
      hostSelector,
      null,
    )
    writeFloatPos(storageKey, next)
    if (next.x !== floatPos.x || next.y !== floatPos.y) {
      setFloatPos(next)
    }
  }
  prevOpenRef.current = open

  useLayoutEffect(() => {
    hostRef.current = resolveHost(triggerRef, hostSelector)
    if (!open) {
      wasOpenRef.current = false
      return
    }
    // Clamp with real panel size after mount (may nudge slightly, never jumps left↔right).
    const next = resolveOpenPos(
      storageKey,
      defaultPos,
      triggerRef,
      hostSelector,
      panelRef.current,
    )
    writeFloatPos(storageKey, next)
    setFloatPos((prev) =>
      prev.x === next.x && prev.y === next.y ? prev : next,
    )
    if (!wasOpenRef.current) {
      const focusTarget = onBack ? backBtnRef.current : closeBtnRef.current
      focusTarget?.focus()
    }
    wasOpenRef.current = true
  }, [open, storageKey, defaultPos, triggerRef, hostSelector, onBack])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const onDragPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('button, input, label, a')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: floatPos.x,
      originY: floatPos.y,
    }
  }

  const onDragPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const next = clampFloatPos(
      {
        x: drag.originX + (event.clientX - drag.startX),
        y: drag.originY + (event.clientY - drag.startY),
      },
      hostRef.current,
      panelRef.current,
    )
    setFloatPos(next)
    writeFloatPos(storageKey, next)
  }

  const onDragPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    setFloatPos((prev) => {
      const next = clampFloatPos(prev, hostRef.current, panelRef.current)
      writeFloatPos(storageKey, next)
      return next
    })
  }

  if (!open) return null

  const host =
    hostRef.current ?? resolveHost(triggerRef, hostSelector)
  if (!host) return null

  return createPortal(
    <div
      ref={panelRef}
      className="vf-sky-panel vf-sky-panel--float"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-tour-anchor={tourAnchor || undefined}
      {...panelDataAttrs}
      style={
        {
          left: floatPos.x,
          top: floatPos.y,
        } as CSSProperties
      }
    >
      <header
        className="vf-sky-panel__header is-draggable"
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        onPointerCancel={onDragPointerUp}
      >
        {onBack ? (
          <button
            ref={backBtnRef}
            type="button"
            className="vf-sky-panel__nav"
            aria-label={t('viewfinder.float.back')}
            title={t('viewfinder.float.back')}
            onClick={onBack}
          >
            <ChevronLeftIcon size={16} />
          </button>
        ) : null}
        <h2 id={titleId} className="vf-sky-panel__title">
          {title}
        </h2>
        <button
          ref={closeBtnRef}
          type="button"
          className="vf-sky-panel__nav"
          aria-label={t('viewfinder.float.close', { title })}
          onClick={onClose}
        >
          <CompactCloseIcon size={16} />
        </button>
      </header>
      <div className="vf-sky-panel__body">{children}</div>
    </div>,
    host,
  )
}
