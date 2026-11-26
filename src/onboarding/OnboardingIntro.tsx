import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { APP_BRAND, APP_PRODUCT } from '../appMeta'
import { useT } from '../i18n'
import {
  emitOnboardingIntroComplete,
  OPEN_ONBOARDING_INTRO_EVENT,
  type OnboardingCompleteReason,
} from './events'
import { ONBOARDING_SLIDES } from './slides'
import {
  hasSeenOnboardingIntro,
  markOnboardingIntroSeen,
} from './storage'
import './onboarding.css'

function TitleLines({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((line) => (
        <span key={line} className="onboarding-intro__title-line">
          {line}
        </span>
      ))}
    </>
  )
}

type OnboardingIntroProps = {
  open: boolean
  onClose: (reason: OnboardingCompleteReason) => void
}

export function OnboardingIntro({ open, onClose }: OnboardingIntroProps) {
  const t = useT()
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const [step, setStep] = useState(0)
  const [animKey, setAnimKey] = useState(0)

  const lastIndex = ONBOARDING_SLIDES.length - 1
  const slide = ONBOARDING_SLIDES[step] ?? ONBOARDING_SLIDES[0]

  const go = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(lastIndex, index))
      setStep(next)
      setAnimKey((value) => value + 1)
    },
    [lastIndex],
  )

  const finish = useCallback(
    (reason: OnboardingCompleteReason) => {
      markOnboardingIntroSeen()
      onClose(reason)
      emitOnboardingIntroComplete(reason)
    },
    [onClose],
  )

  const next = useCallback(() => {
    if (step < lastIndex) go(step + 1)
    else finish('finish')
  }, [finish, go, lastIndex, step])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    nextRef.current?.focus()
  }, [open, step])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        finish('skip')
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        next()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        go(step - 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [finish, go, next, open, step])

  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!open || typeof document === 'undefined') return null

  const slideKey = `onboarding.slides.${slide.id}` as const

  return createPortal(
    <div className="onboarding-intro-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="onboarding-intro"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
      >
        <div className="onboarding-intro__top">
          <div className="onboarding-intro__brand">
            <span className="onboarding-intro__brand-name">{APP_PRODUCT}</span>
            <span className="onboarding-intro__brand-by">
              {t('common.brandBy', { brand: APP_BRAND })}
            </span>
          </div>
          <button
            type="button"
            className="onboarding-intro__skip"
            onClick={() => finish('skip')}
          >
            {t('onboarding.skip')}
          </button>
        </div>

        <div className="onboarding-intro__visual" key={`visual-${animKey}`}>
          <img
            className="onboarding-intro__scene"
            src={slide.imageSrc}
            alt={t(`${slideKey}.imageAlt`)}
            style={{ objectPosition: slide.imagePosition }}
            draggable={false}
          />
        </div>

        <div
          className="onboarding-intro__copy"
          aria-live="polite"
          key={`copy-${animKey}`}
        >
          <p className="onboarding-intro__eyebrow">
            {t(`${slideKey}.eyebrow`)}
          </p>
          <h1 id={titleId} className="onboarding-intro__title">
            <TitleLines text={t(`${slideKey}.title`)} />
          </h1>
          <p className="onboarding-intro__body">{t(`${slideKey}.body`)}</p>
        </div>

        <div className="onboarding-intro__footer">
          <div
            className="onboarding-intro__dots"
            role="tablist"
            aria-label={t('onboarding.dotsAria')}
          >
            {ONBOARDING_SLIDES.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                className={
                  index === step
                    ? 'onboarding-intro__dot is-on'
                    : 'onboarding-intro__dot'
                }
                aria-label={t('onboarding.slideN', { n: String(index + 1) })}
                aria-selected={index === step}
                onClick={() => go(index)}
              />
            ))}
          </div>
          <div className="onboarding-intro__actions">
            {step > 0 ? (
              <button
                type="button"
                className="onboarding-intro__back"
                onClick={() => go(step - 1)}
              >
                {t('onboarding.back')}
              </button>
            ) : null}
            <button
              ref={nextRef}
              type="button"
              className="onboarding-intro__next"
              onClick={next}
            >
              {step === lastIndex ? t('onboarding.start') : t('onboarding.continue')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Host: first visit + reopen via OPEN_ONBOARDING_INTRO_EVENT. */
export function OnboardingIntroHost() {
  const [open, setOpen] = useState(() => !hasSeenOnboardingIntro())
  /** Bumps on each reopen so the dialog remounts at slide 0 (no flash). */
  const [session, setSession] = useState(0)

  useEffect(() => {
    const onOpen = () => {
      setSession((value) => value + 1)
      setOpen(true)
    }
    window.addEventListener(OPEN_ONBOARDING_INTRO_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_ONBOARDING_INTRO_EVENT, onOpen)
  }, [])

  if (!open) return null

  return (
    <OnboardingIntro
      key={session}
      open
      onClose={() => {
        setOpen(false)
      }}
    />
  )
}
