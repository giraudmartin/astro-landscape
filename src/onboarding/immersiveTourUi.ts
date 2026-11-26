import type { ImmersiveTourStepId } from './immersiveTourSteps'
import { TOUR_DEMO_AIRGLOW } from './tourDemoSpot'

export type ImmersiveScenePanelId = 'quality' | 'sky' | 'weather'

export const OPEN_SCENE_PANEL_EVENT = 'astro-planner:open-scene-panel'
export const EXPAND_CAPTURE_BAR_EVENT = 'astro-planner:expand-capture-bar'
export const TOUR_DEMO_WEATHER_EVENT = 'astro-planner:tour-demo-weather'
/** Apply tour airglow (green + structured waves) in ImmersiveView. */
export const TOUR_DEMO_SKY_EVENT = 'astro-planner:tour-demo-sky'

const QUALITY_OPEN_DELAY_MS = 1800

let prepareTimer: number | undefined

export function openImmersiveScenePanel(
  panel: ImmersiveScenePanelId | null,
): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(OPEN_SCENE_PANEL_EVENT, { detail: { panel } }),
  )
}

export function expandImmersiveCaptureBar(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(EXPAND_CAPTURE_BAR_EVENT))
}

/** Enable weather with low clouds only (tour demo). */
export function applyImmersiveTourDemoWeather(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(TOUR_DEMO_WEATHER_EVENT))
}

/** Enable green structured airglow for the tour night scene. */
export function applyImmersiveTourDemoSky(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(TOUR_DEMO_SKY_EVENT, {
      detail: { ...TOUR_DEMO_AIRGLOW },
    }),
  )
}

function clearPrepareTimer(): void {
  if (prepareTimer == null) return
  window.clearTimeout(prepareTimer)
  prepareTimer = undefined
}

/** Drive immersive chrome for the active tour step. */
export function prepareImmersiveTourStep(stepId: ImmersiveTourStepId): void {
  clearPrepareTimer()
  switch (stepId) {
    case 'modes':
      expandImmersiveCaptureBar()
      openImmersiveScenePanel(null)
      return
    case 'quality':
      // Beat 1: spotlight the Réglages control alone.
      openImmersiveScenePanel(null)
      // Beat 2: then open Qualité so the click target is readable first.
      prepareTimer = window.setTimeout(() => {
        prepareTimer = undefined
        openImmersiveScenePanel('quality')
      }, QUALITY_OPEN_DELAY_MS)
      return
    case 'sky':
      openImmersiveScenePanel('sky')
      return
    case 'weather':
      openImmersiveScenePanel('weather')
      applyImmersiveTourDemoWeather()
      return
    case 'save':
      openImmersiveScenePanel(null)
      return
    case 'viewfinder':
    case 'done':
    default:
      openImmersiveScenePanel(null)
  }
}
