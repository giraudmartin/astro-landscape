/**
 * First-party Umami loader + thin track() helper.
 * No-ops unless VITE_UMAMI_WEBSITE_ID is set (prod .env.production on the VPS).
 */

export type AnalyticsEvent =
  | 'immersive_enter'
  | 'spot_save'
  | 'bug_report'
  | 'onboarding_tour_done'

type UmamiClient = {
  track: (
    event: string,
    data?: Record<string, string | number | boolean>,
  ) => void
}

declare global {
  interface Window {
    umami?: UmamiClient
  }
}

const DEFAULT_SCRIPT_URL = 'https://analytics.sadr3d.com/script.js'

let installed = false

function websiteId(): string | undefined {
  const id = import.meta.env.VITE_UMAMI_WEBSITE_ID?.trim()
  return id || undefined
}

function scriptUrl(): string {
  const url = import.meta.env.VITE_UMAMI_SCRIPT_URL?.trim()
  return url || DEFAULT_SCRIPT_URL
}

/** Inject the Umami script once (call from main). */
export function initAnalytics(): void {
  if (installed || typeof document === 'undefined') return
  const id = websiteId()
  if (!id) return

  installed = true
  const el = document.createElement('script')
  el.defer = true
  el.src = scriptUrl()
  el.setAttribute('data-website-id', id)
  el.setAttribute('data-domains', 'sphere.sadr3d.com')
  document.head.appendChild(el)
}

/** Fire a custom event when the tracker is ready; otherwise drop. */
export function track(
  event: AnalyticsEvent,
  data?: Record<string, string | number | boolean>,
): void {
  if (!websiteId()) return
  try {
    window.umami?.track(event, data)
  } catch {
    // Tracker optional — never break the app.
  }
}
