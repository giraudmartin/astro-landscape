import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { detectBrowserLocale } from './detect'
import { en } from './locales/en'
import { fr } from './locales/fr'
import type { Messages } from './locales/types'
import {
  getMessageList,
  translate,
  type TranslateParams,
} from './translate'
import { intlLocale, isLocale, type Locale } from './types'

type LocaleContextValue = {
  locale: Locale
  messages: Messages
  setLocale: (locale: Locale) => void
  t: (key: string, params?: TranslateParams) => string
  tList: (key: string) => readonly string[]
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

const CATALOG: Record<Locale, Messages> = { fr, en }

export function messagesFor(locale: Locale): Messages {
  return CATALOG[locale]
}

/** Module-level locale for non-React callers (markers, label maps, tips). */
let activeLocale: Locale = 'fr'
let activeMessages: Messages = fr
const listeners = new Set<() => void>()

export function getActiveLocale(): Locale {
  return activeLocale
}

export function getActiveMessages(): Messages {
  return activeMessages
}

export function t(key: string, params?: TranslateParams): string {
  return translate(activeMessages, key, params)
}

export function tList(key: string): readonly string[] {
  return getMessageList(activeMessages, key) ?? []
}

function applyDocumentLang(locale: Locale): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = intlLocale(locale)
}

function publishLocale(locale: Locale): void {
  activeLocale = locale
  activeMessages = CATALOG[locale]
  applyDocumentLang(locale)
  for (const listener of listeners) listener()
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export type LocaleProviderProps = {
  /** Initial locale (from settings / detection). */
  initialLocale: Locale
  /** Persist when the user changes language. */
  onLocaleChange?: (locale: Locale) => void
  children: ReactNode
}

export function LocaleProvider({
  initialLocale,
  onLocaleChange,
  children,
}: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initial = isLocale(initialLocale) ? initialLocale : detectBrowserLocale()
    // Silent sync so non-React t() is correct during the very first render
    // (children render before this provider's effect runs).
    activeLocale = initial
    activeMessages = CATALOG[initial]
    applyDocumentLang(initial)
    return initial
  })

  useEffect(() => {
    publishLocale(locale)
  }, [locale])

  const setLocale = useCallback(
    (next: Locale) => {
      // Publish first so non-React t() is already up to date when children re-render.
      publishLocale(next)
      setLocaleState(next)
      onLocaleChange?.(next)
    },
    [onLocaleChange],
  )

  const value = useMemo<LocaleContextValue>(() => {
    const messages = CATALOG[locale]
    return {
      locale,
      messages,
      setLocale,
      t: (key, params) => translate(messages, key, params),
      tList: (key) => getMessageList(messages, key) ?? [],
    }
  }, [locale, setLocale])

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  )
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) {
    throw new Error('useLocale must be used within LocaleProvider')
  }
  return ctx
}

/** Convenience: `const t = useT()` */
export function useT(): LocaleContextValue['t'] {
  return useLocale().t
}
