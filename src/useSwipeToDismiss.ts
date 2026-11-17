import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'

type SwipeDismiss = {
  onHandlePointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onHandlePointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onHandlePointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  onHandlePointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
  sheetStyle: CSSProperties
  isDragging: boolean
}

/** Swipe down on a handle to dismiss a mobile sheet/rail. */
export function useSwipeToDismiss(
  onClose: () => void,
  enabled: boolean,
): SwipeDismiss {
  const dragRef = useRef<{
    pointerId: number
    startY: number
  } | null>(null)
  const [offsetY, setOffsetY] = useState(0)
  const [dragging, setDragging] = useState(false)

  const reset = useCallback((): void => {
    dragRef.current = null
    setOffsetY(0)
    setDragging(false)
  }, [])

  const onHandlePointerDown = (
    event: ReactPointerEvent<HTMLElement>,
  ): void => {
    if (!enabled || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY }
    setDragging(true)
  }

  const onHandlePointerMove = (
    event: ReactPointerEvent<HTMLElement>,
  ): void => {
    const drag = dragRef.current
    if (!enabled || !drag || drag.pointerId !== event.pointerId) return
    const delta = Math.max(0, event.clientY - drag.startY)
    setOffsetY(delta)
  }

  const endDrag = (clientY: number): void => {
    const drag = dragRef.current
    if (!drag) {
      reset()
      return
    }
    const delta = clientY - drag.startY
    const dismiss =
      delta >
      Math.min(
        140,
        typeof window !== 'undefined' ? window.innerHeight * 0.18 : 140,
      )
    reset()
    if (dismiss) onClose()
  }

  const onHandlePointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    endDrag(event.clientY)
  }

  return {
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
    onHandlePointerCancel: onHandlePointerUp,
    sheetStyle:
      enabled && offsetY > 0
        ? {
            transform: `translateY(${offsetY}px)`,
            transition: dragging ? 'none' : undefined,
          }
        : enabled
          ? { transition: 'transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)' }
          : {},
    isDragging: dragging,
  }
}
