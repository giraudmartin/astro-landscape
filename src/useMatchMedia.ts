import { useEffect, useState } from 'react'

/** Subscribe to a CSS media query; SSR-safe (starts false, syncs on mount). */
export function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const media = window.matchMedia(query)
    const onChange = (): void => {
      setMatches(media.matches)
    }
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** Phone band — keep in sync with App.css `@media (max-width: 720px)`. */
export const OPERATE_PHONE_MQ = '(max-width: 720px)'
