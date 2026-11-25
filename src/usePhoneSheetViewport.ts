import { useEffect, useState } from 'react'

/** Resting phone sheet, as a fraction of the layout viewport. */
export const PHONE_SHEET_OPEN_FRAC = 0.62
/** Gap left above a keyboard-fitted sheet so the backdrop stays tappable. */
export const PHONE_SHEET_TOP_GAP_PX = 12
/**
 * Layout-vs-visual overlap above this is a software keyboard.
 * Browser chrome (URL bar) stays under it, so a closed keyboard keeps the 62% sheet.
 */
export const PHONE_KEYBOARD_OVERLAP_PX = 150

export type PhoneSheetFrame = {
  layoutH: number
  visibleH: number
  offsetTop: number
}

export type PhoneSheetPlacement = {
  top: number
  height: number
  openHeight: number
  keyboardOpen: boolean
}

export function readPhoneSheetFrame(): PhoneSheetFrame {
  if (typeof window === 'undefined') {
    return { layoutH: 800, visibleH: 800, offsetTop: 0 }
  }
  const layoutH = Math.round(window.innerHeight)
  const vv = window.visualViewport
  if (!vv) return { layoutH, visibleH: layoutH, offsetTop: 0 }
  return {
    layoutH,
    visibleH: Math.round(vv.height),
    offsetTop: Math.round(vv.offsetTop),
  }
}

/** Pixels of the layout viewport hidden below the visual viewport (keyboard). */
export function phoneSheetKeyboardOverlap(frame: PhoneSheetFrame): number {
  return Math.max(0, frame.layoutH - frame.offsetTop - frame.visibleH)
}

/**
 * Place a bottom sheet inside the visual viewport.
 * iOS Safari keeps `position: fixed` on the layout viewport, so the sheet
 * stays under the keyboard unless we follow `visualViewport` ourselves.
 * When the keyboard is closed, placement matches the previous 62% sheet.
 */
export function phoneSheetPlacement(frame: PhoneSheetFrame): PhoneSheetPlacement {
  const keyboardOpen =
    phoneSheetKeyboardOverlap(frame) > PHONE_KEYBOARD_OVERLAP_PX
  const top = keyboardOpen ? frame.offsetTop : 0
  const height = keyboardOpen ? frame.visibleH : frame.layoutH
  const visibleH = keyboardOpen ? frame.visibleH : frame.layoutH
  const desired = Math.round(frame.layoutH * PHONE_SHEET_OPEN_FRAC)
  const cap = Math.max(0, Math.round(visibleH) - PHONE_SHEET_TOP_GAP_PX)
  return {
    top,
    height,
    openHeight: Math.min(desired, cap),
    keyboardOpen,
  }
}

export function usePhoneSheetViewport(
  active: boolean,
  lockPageScroll: boolean,
): PhoneSheetFrame {
  const [frame, setFrame] = useState(readPhoneSheetFrame)

  useEffect(() => {
    if (!active) return
    let raf = 0
    const sync = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const next = readPhoneSheetFrame()
        setFrame((prev) =>
          prev.layoutH === next.layoutH &&
          prev.visibleH === next.visibleH &&
          prev.offsetTop === next.offsetTop
            ? prev
            : next,
        )
      })
    }
    sync()
    const vv = window.visualViewport
    window.addEventListener('resize', sync)
    vv?.addEventListener('resize', sync)
    vv?.addEventListener('scroll', sync)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', sync)
      vv?.removeEventListener('resize', sync)
      vv?.removeEventListener('scroll', sync)
    }
  }, [active])

  useEffect(() => {
    if (!lockPageScroll) return
    const pin = (): void => {
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0)
    }
    pin()
    window.addEventListener('scroll', pin)
    return () => window.removeEventListener('scroll', pin)
  }, [lockPageScroll])

  return frame
}
