const STORAGE_KEY = 'astro-landscape.onboarding-intro-seen-v1'

export function hasSeenOnboardingIntro(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboardingIntroSeen(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* private mode — ignore */
  }
}
