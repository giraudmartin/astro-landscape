import type { ReactNode } from 'react'
import { OPERATE_PHONE_MQ, useMatchMedia } from './useMatchMedia'
import { useSwipeToDismiss } from './useSwipeToDismiss'

type MobileRailChromeProps = {
  onClose: () => void
  sheetClassName: string
  children: ReactNode
}

/** Phone: backdrop + swipe handle. Desktop: passthrough sheet only. */
export function MobileRailChrome({
  onClose,
  sheetClassName,
  children,
}: MobileRailChromeProps) {
  const isPhone = useMatchMedia(OPERATE_PHONE_MQ)
  const swipe = useSwipeToDismiss(onClose, isPhone)

  return (
    <>
      {isPhone ? (
        <button
          type="button"
          className="mobile-rail-backdrop"
          aria-label="Fermer"
          onClick={onClose}
        />
      ) : null}
      <div
        className={
          swipe.isDragging ? `${sheetClassName} is-dragging` : sheetClassName
        }
        style={swipe.sheetStyle}
      >
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
