import type { OnboardingCompleteReason } from './events'

export const OPEN_ONBOARDING_TOUR_EVENT = 'astro-planner:open-onboarding-tour'

export const TOUR_FLY_TO_DEMO_EVENT = 'astro-planner:tour-fly-to-demo'

export function openOnboardingTour(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(OPEN_ONBOARDING_TOUR_EVENT))
}

export function requestTourFlyToDemo(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(TOUR_FLY_TO_DEMO_EVENT))
}

/** After intro slides — start the interactive tour on first completion. */
export function shouldStartTourAfterIntro(
  _reason: OnboardingCompleteReason,
  hasSeenTour: boolean,
): boolean {
  return !hasSeenTour
}
