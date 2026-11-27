import type { OnboardingCompleteReason } from './events'

export const OPEN_ONBOARDING_TOUR_EVENT = 'astro-planner:open-onboarding-tour'

export const TOUR_FLY_TO_DEMO_EVENT = 'astro-planner:tour-fly-to-demo'

/** Reset map padding used to frame the pin above the phone coach card. */
export const TOUR_CLEAR_MAP_FRAME_EVENT = 'astro-planner:tour-clear-map-frame'

export function openOnboardingTour(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(OPEN_ONBOARDING_TOUR_EVENT))
}

export function requestTourFlyToDemo(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(TOUR_FLY_TO_DEMO_EVENT))
}

export function clearTourMapFrame(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(TOUR_CLEAR_MAP_FRAME_EVENT))
}

/** After intro slides — start the interactive tour on first completion. */
export function shouldStartTourAfterIntro(
  _reason: OnboardingCompleteReason,
  hasSeenTour: boolean,
): boolean {
  return !hasSeenTour
}
