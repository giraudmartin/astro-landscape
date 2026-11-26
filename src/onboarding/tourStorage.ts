const STORAGE_KEY = 'astro-landscape.onboarding-tour-seen-v1'

export function hasSeenOnboardingTour(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboardingTourSeen(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* private mode */
  }
}
