export type TourStepId =
  | 'welcome'
  | 'place'
  | 'panels'
  | 'pl'
  | 'spots'
  | 'framings'
  | 'exampleFraming'
  | 'marker'
  | 'done'

export type TourAnchor =
  | 'ov-anchor'
  | 'pl-control'
  | 'my-spots'
  | 'framings'
  | 'spot-marker'

export type TourStepDef = {
  id: TourStepId
  /** i18n: onboarding.tour.steps.{id}.title / .body */
  anchor?: TourAnchor
  /** Primary CTA advances; some steps also wait for an action. */
  cta: 'next' | 'place' | 'addFraming' | 'immersive' | 'finish'
}

export const TOUR_STEPS: readonly TourStepDef[] = [
  { id: 'welcome', cta: 'next' },
  { id: 'place', cta: 'place' },
  { id: 'marker', anchor: 'spot-marker', cta: 'next' },
  { id: 'panels', anchor: 'ov-anchor', cta: 'next' },
  { id: 'spots', anchor: 'my-spots', cta: 'next' },
  { id: 'framings', anchor: 'framings', cta: 'next' },
  { id: 'exampleFraming', anchor: 'framings', cta: 'addFraming' },
  { id: 'pl', anchor: 'pl-control', cta: 'next' },
  { id: 'done', cta: 'immersive' },
] as const
