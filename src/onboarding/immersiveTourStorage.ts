const STORAGE_KEY = 'astro-landscape.onboarding-immersive-tour-seen-v2'

export function hasSeenImmersiveTour(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markImmersiveTourSeen(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* private mode */
  }
}
