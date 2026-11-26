export type ImmersiveTourStepId =
  | 'viewfinder'
  | 'modes'
  | 'quality'
  | 'sky'
  | 'weather'
  | 'save'
  | 'done'

export type ImmersiveTourAnchor =
  | 'vf-capsule'
  | 'vf-modes'
  | 'vf-scene'
  | 'vf-float-quality'
  | 'vf-float-sky'
  | 'vf-float-weather'
  | 'immersive-save'

export type ImmersiveTourStepDef = {
  id: ImmersiveTourStepId
  anchor?: ImmersiveTourAnchor
  /** Soft clear of the 3D view (e.g. weather demo) without unlocking chrome. */
  clearView?: boolean
  cta: 'next' | 'finish'
}

export const IMMERSIVE_TOUR_STEPS: readonly ImmersiveTourStepDef[] = [
  { id: 'viewfinder', anchor: 'vf-capsule', cta: 'next' },
  { id: 'modes', anchor: 'vf-modes', cta: 'next' },
  // Anchor falls back to vf-scene until the Qualité panel mounts (delayed open).
  { id: 'quality', anchor: 'vf-float-quality', cta: 'next' },
  { id: 'sky', anchor: 'vf-float-sky', cta: 'next' },
  { id: 'weather', anchor: 'vf-float-weather', cta: 'next' },
  { id: 'save', anchor: 'immersive-save', cta: 'next' },
  { id: 'done', cta: 'finish' },
] as const
