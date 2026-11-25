import { describe, expect, it } from 'vitest'
import {
  phoneSheetKeyboardOverlap,
  phoneSheetPlacement,
  type PhoneSheetFrame,
} from '../usePhoneSheetViewport'

const frame = (
  layoutH: number,
  visibleH: number,
  offsetTop = 0,
): PhoneSheetFrame => ({ layoutH, visibleH, offsetTop })

describe('phoneSheetPlacement', () => {
  it('keeps the 62% bottom sheet when the keyboard is closed', () => {
    const placed = phoneSheetPlacement(frame(844, 844))
    expect(placed.keyboardOpen).toBe(false)
    expect(placed.top).toBe(0)
    expect(placed.height).toBe(844)
    expect(placed.openHeight).toBe(Math.round(844 * 0.62))
  })

  it('ignores browser chrome that is smaller than a keyboard', () => {
    const placed = phoneSheetPlacement(frame(844, 750))
    expect(placed.keyboardOpen).toBe(false)
    expect(placed.openHeight).toBe(Math.round(844 * 0.62))
  })

  it('fits the sheet in the visible band above the keyboard', () => {
    // iPhone-like: layout viewport stays full, visual viewport stops at the keyboard.
    const placed = phoneSheetPlacement(frame(844, 430))
    expect(placed.keyboardOpen).toBe(true)
    expect(placed.top).toBe(0)
    expect(placed.height).toBe(430)
    expect(placed.openHeight).toBe(430 - 12)
    expect(placed.openHeight).toBeLessThan(Math.round(844 * 0.62))
  })

  it('follows a visual viewport that Safari has scrolled', () => {
    const scrolled = frame(844, 390, 48)
    expect(phoneSheetKeyboardOverlap(scrolled)).toBe(844 - 48 - 390)
    const placed = phoneSheetPlacement(scrolled)
    expect(placed.keyboardOpen).toBe(true)
    expect(placed.top).toBe(48)
    expect(placed.height).toBe(390)
    expect(placed.openHeight).toBe(390 - 12)
  })
})
