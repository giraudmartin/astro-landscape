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
import { useT } from './i18n'

type MobileTopDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

const OPEN_VH = 0.72
const DISMISS_FRAC = 0.28

export function MobileTopDrawer({
  open,
  onOpenChange,
  children,
}: MobileTopDrawerProps) {
  const t = useT()
  const titleId = useId()
  const dragRef = useRef<{
    pointerId: number
    startY: number
    startOffset: number
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const [viewportH, setViewportH] = useState(() =>
    typeof window === 'undefined' ? 800 : window.innerHeight,
  )
  /** 0 = closed (only tab), 1 = fully open. */
  const [progress, setProgress] = useState(open ? 1 : 0)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const onResize = (): void => setViewportH(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (dragging) return
    setProgress(open ? 1 : 0)
  }, [open, dragging])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('info-drawer-open', open)
    return () => root.classList.remove('info-drawer-open')
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  if (typeof document === 'undefined') return null

  const openHeight = Math.round(viewportH * OPEN_VH)
  const offsetY = -openHeight * (1 - progress)

  const endDrag = (clientY: number): void => {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (!drag) return
    const delta = clientY - drag.startY
    if (drag.moved || Math.abs(delta) > 10) {
      suppressClickRef.current = true
    }
    const nextProgress = Math.min(
      1,
      Math.max(0, drag.startOffset + delta / openHeight),
    )
    if (!drag.moved && Math.abs(delta) <= 10) {
      setProgress(open ? 1 : 0)
      return
    }
    const openIt = nextProgress > 0.45 || (delta > 0 && nextProgress > 0.2)
    const keepOpen =
      open && nextProgress > 0.55 && delta > -openHeight * DISMISS_FRAC
    const next = open ? keepOpen : openIt
    setProgress(next ? 1 : 0)
    onOpenChange(next)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset: progress,
      moved: false,
    }
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = event.clientY - drag.startY
    if (Math.abs(delta) > 8) drag.moved = true
    const next = Math.min(1, Math.max(0, drag.startOffset + delta / openHeight))
    setProgress(next)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    endDrag(event.clientY)
  }

  return createPortal(
    <div
      className={
        open || progress > 0.02
          ? 'mobile-top-drawer is-open'
          : 'mobile-top-drawer'
      }
      style={
        {
          '--mtd-open-h': `${openHeight}px`,
          '--mtd-offset': `${offsetY}px`,
        } as CSSProperties
      }
    >
      {progress > 0.02 ? (
        <button
          type="button"
          className="mobile-top-drawer__backdrop"
          aria-label={t('common.close')}
          style={{ opacity: Math.min(1, progress) * 0.45 }}
          onClick={() => {
            setProgress(0)
            onOpenChange(false)
          }}
        />
      ) : null}

      <div
        className={
          dragging
            ? 'mobile-top-drawer__panel is-dragging'
            : 'mobile-top-drawer__panel'
        }
        role="dialog"
        aria-modal={open}
        aria-labelledby={titleId}
        aria-hidden={progress < 0.05}
      >
        <h2 id={titleId} className="u-sr-only">
          {t('map.drawer.title')}
        </h2>
        <div className="mobile-top-drawer__body">{children}</div>
      </div>

      <button
        type="button"
        className="mobile-top-drawer__tab"
        aria-expanded={open}
        aria-label={t('map.drawer.open')}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false
            return
          }
          const next = !open
          setProgress(next ? 1 : 0)
          onOpenChange(next)
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="mobile-top-drawer__tab-bar" aria-hidden="true" />
      </button>
    </div>,
    document.body,
  )
}
