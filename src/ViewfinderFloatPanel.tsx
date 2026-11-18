import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { CompactCloseIcon } from './psIcons'

type FloatPos = { x: number; y: number }

type ViewfinderFloatPanelProps = {
  open: boolean
  onClose: () => void
  title: string
  storageKey: string
  defaultPos?: FloatPos
  children: ReactNode
  /** Portal host — usually `.immersive`. Resolved from trigger if omitted. */
  hostSelector?: string
  triggerRef?: React.RefObject<HTMLElement | null>
}

const PANEL_WIDTH = 288
const PANEL_MIN_VISIBLE = 48
const DEFAULT_POS: FloatPos = { x: 24, y: 72 }

function readFloatPos(storageKey: string, fallback: FloatPos): FloatPos {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<FloatPos>
    if (
      typeof parsed.x === 'number' &&
      Number.isFinite(parsed.x) &&
      typeof parsed.y === 'number' &&
      Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y }
    }
  } catch {
    /* ignore */
  }
  return fallback
}

function writeFloatPos(storageKey: string, pos: FloatPos) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(pos))
  } catch {
    /* ignore */
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

/**
 * Shared floating semi-transparent settings window for immersive chrome.
 */
export function ViewfinderFloatPanel({
  open,
  onClose,
  title,
  storageKey,
  defaultPos = DEFAULT_POS,
  children,
  hostSelector = '.immersive',
  triggerRef,
}: ViewfinderFloatPanelProps) {
  const [floatPos, setFloatPos] = useState<FloatPos>(() =>
    readFloatPos(storageKey, defaultPos),
  )
  const panelRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const titleId = useId()

  useEffect(() => {
    hostRef.current = resolveHost(triggerRef, hostSelector)
  }, [open, triggerRef, hostSelector])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const host = hostRef.current ?? resolveHost(triggerRef, hostSelector)
    const panel = panelRef.current
    setFloatPos((prev) => {
      const next = clampFloatPos(prev, host, panel)
      if (next.x === prev.x && next.y === prev.y) return prev
      writeFloatPos(storageKey, next)
      return next
    })
  }, [open, storageKey, triggerRef, hostSelector])

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
        <h2 id={titleId} className="vf-sky-panel__title">
          {title}
        </h2>
        <button
          type="button"
          className="vf-sky-panel__close"
          aria-label={`Fermer ${title}`}
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
