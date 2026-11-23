import { describe, expect, it } from 'vitest'
import { detectBrowserLocale } from './detect'

describe('detectBrowserLocale', () => {
  it('returns fr when primary language is French', () => {
    expect(detectBrowserLocale(['fr'])).toBe('fr')
    expect(detectBrowserLocale(['fr-FR'])).toBe('fr')
    expect(detectBrowserLocale(['fr-CA', 'en-US'])).toBe('fr')
  })

  it('returns en for non-French languages', () => {
    expect(detectBrowserLocale(['en'])).toBe('en')
    expect(detectBrowserLocale(['en-US'])).toBe('en')
    expect(detectBrowserLocale(['de-DE', 'en'])).toBe('en')
  })

  it('prefers the first French tag in the list', () => {
    expect(detectBrowserLocale(['en-US', 'fr-FR'])).toBe('fr')
  })

  it('defaults to en when the list is empty', () => {
    expect(detectBrowserLocale([])).toBe('en')
  })
})
