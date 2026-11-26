/** Queue the immersive tour until terrain is ready (after map CTA or settings). */
export const PENDING_IMMERSIVE_TOUR_EVENT =
  'astro-planner:pending-immersive-tour'

/** Force-open the immersive tour now if immersive is ready; else queue + enter. */
export const START_IMMERSIVE_TOUR_EVENT =
  'astro-planner:start-immersive-tour'

export function requestImmersiveTour(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PENDING_IMMERSIVE_TOUR_EVENT))
}

/** From Settings: enter immersive if needed, then show the mini-tour. */
export function startImmersiveTour(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(START_IMMERSIVE_TOUR_EVENT))
}
