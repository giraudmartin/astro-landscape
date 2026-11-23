import {
  useCallback,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  clampMapRailWidthPx,
  MAP_RAIL_WIDTH_MAX_PX,
  MAP_RAIL_WIDTH_MIN_PX,
} from './mapRailWidth'
import { useT } from './i18n'
import { OPERATE_PHONE_MQ, useMatchMedia } from './useMatchMedia'
import { useSwipeToDismiss } from './useSwipeToDismiss'

type MobileRailChromeProps = {
  onClose: () => void
  sheetClassName: string
  children: ReactNode
  /** Desktop: current rail width (drives CSS var from App). */
  desktopWidthPx?: number
  onDesktopWidthChange?: (widthPx: number) => void
}

/** Phone: backdrop + swipe handle. Desktop: sheet + optional left-edge resize. */
export function MobileRailChrome({
  onClose,
  sheetClassName,
  children,
  desktopWidthPx,
  onDesktopWidthChange,
}: MobileRailChromeProps) {
  const t = useT()
  const isPhone = useMatchMedia(OPERATE_PHONE_MQ)
  const swipe = useSwipeToDismiss(onClose, isPhone)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const canResize =
    !isPhone &&
    desktopWidthPx != null &&
    typeof onDesktopWidthChange === 'function'

  const endResize = useCallback(() => {
    dragRef.current = null
    document.documentElement.classList.remove('is-rail-resizing')
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
  }, [])

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!canResize || desktopWidthPx == null || !onDesktopWidthChange) return
      event.preventDefault()
      event.stopPropagation()
      dragRef.current = { startX: event.clientX, startW: desktopWidthPx }
      document.documentElement.classList.add('is-rail-resizing')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [canResize, desktopWidthPx, onDesktopWidthChange],
  )

  const onResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || !onDesktopWidthChange) return
      const next = clampMapRailWidthPx(drag.startW + (drag.startX - event.clientX))
      onDesktopWidthChange(next)
    },
    [onDesktopWidthChange],
  )

  const onResizePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      endResize()
    },
    [endResize],
  )

  const sheetStyle: CSSProperties | undefined = swipe.sheetStyle

  return (
    <>
      {isPhone ? (
        <button
          type="button"
          className="mobile-rail-backdrop"
          aria-label={t('common.close')}
          onClick={onClose}
        />
      ) : null}
      <div
        className={
          swipe.isDragging ? `${sheetClassName} is-dragging` : sheetClassName
        }
        style={sheetStyle}
      >
        {canResize ? (
          <div
            className="rail-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('map.rail.resize')}
            aria-valuenow={desktopWidthPx}
            aria-valuemin={MAP_RAIL_WIDTH_MIN_PX}
            aria-valuemax={MAP_RAIL_WIDTH_MAX_PX}
            title={t('map.rail.resizeTitle')}
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
            onPointerCancel={onResizePointerUp}
          />
        ) : null}
        {isPhone ? (
          <div
            className="mobile-rail-handle"
            onPointerDown={swipe.onHandlePointerDown}
            onPointerMove={swipe.onHandlePointerMove}
            onPointerUp={swipe.onHandlePointerUp}
            onPointerCancel={swipe.onHandlePointerCancel}
          >
            <span className="mobile-rail-handle__bar" aria-hidden="true" />
          </div>
        ) : null}
        {children}
      </div>
    </>
  )
}
