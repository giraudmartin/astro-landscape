/**
 * Intro slides (proposal 03 · Immersive).
 * Titles / copy live in i18n; swap image files under /public/onboarding freely.
 */

export type OnboardingSlideId = 'explore' | 'anticipate' | 'compose'

export type OnboardingSlideDef = {
  id: OnboardingSlideId
  /** Public URL of the slide image (easy to replace). */
  imageSrc: string
  /** CSS `object-position` for mobile/desktop crop without distortion. */
  imagePosition: string
}

export const ONBOARDING_SLIDES: readonly OnboardingSlideDef[] = [
  {
    id: 'explore',
    imageSrc: '/onboarding/onboarding1.jpg',
    imagePosition: 'center 58%',
  },
  {
    id: 'anticipate',
    imageSrc: '/onboarding/onboarding2.jpg',
    imagePosition: 'center 42%',
  },
  {
    id: 'compose',
    imageSrc: '/onboarding/onboarding3.jpg',
    imagePosition: 'center 40%',
  },
] as const

export const ONBOARDING_SLIDE_COUNT = ONBOARDING_SLIDES.length
