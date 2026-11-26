/** Open the intro slides (settings, map help, future guided tour entry). */
export const OPEN_ONBOARDING_INTRO_EVENT = 'astro-planner:open-onboarding-intro'

export type OnboardingCompleteReason = 'skip' | 'finish'

/** Fired when intro slides close — App starts the interactive tour if unseen. */
export const ONBOARDING_INTRO_COMPLETE_EVENT =
  'astro-planner:onboarding-intro-complete'

export function openOnboardingIntro(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(OPEN_ONBOARDING_INTRO_EVENT))
}

export function emitOnboardingIntroComplete(
  reason: OnboardingCompleteReason,
): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(ONBOARDING_INTRO_COMPLETE_EVENT, { detail: { reason } }),
  )
}
