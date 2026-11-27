import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  APP_ABOUT_LINKS,
  APP_ABOUT_PARAGRAPH_KEYS,
  APP_AUTHOR,
  APP_AUTHOR_TAGLINE_KEY,
} from './aboutMe'
import { APP_ATTRIBUTIONS } from './attributions'
import { APP_COPYRIGHT, APP_NAME, APP_VERSION } from './appMeta'
import { loadAppSettings, patchAppSettings } from './appSettings'
import { BugReportCard } from './BugReportCard'
import { LOCALES, useLocale } from './i18n'
import { openOnboardingIntro, openOnboardingTour } from './onboarding'
import { OPERATE_PHONE_MQ, useMatchMedia } from './useMatchMedia'

/** Open the map settings dialog (e.g. from the phone top drawer). */
export const OPEN_MAP_SETTINGS_EVENT = 'astro-planner:open-map-settings'
/** Open the bug-report card (e.g. from the phone top drawer). */
export const OPEN_BUG_REPORT_EVENT = 'astro-planner:open-bug-report'
import { APP_PRIVACY_POINTS } from './privacy'
import { getApproxTerrainDownloadMb } from './terrainDownloadEstimate'
import {
  emitTerrainQualityChange,
  TERRAIN_QUALITY_IDS,
  type TerrainQuality,
} from './terrainQuality'

type SettingsSection =
  | 'language'
  | 'quality'
  | 'about'
  | 'onboarding'
  | 'attributions'
  | 'privacy'

const SETTINGS_SECTIONS: readonly {
  id: SettingsSection
  /** i18n key of the nav label. */
  labelKey: string
}[] = [
  { id: 'about', labelKey: 'settings.section.about' },
  { id: 'onboarding', labelKey: 'settings.section.onboarding' },
  { id: 'quality', labelKey: 'settings.section.quality' },
  { id: 'attributions', labelKey: 'settings.section.attributions' },
  { id: 'privacy', labelKey: 'settings.section.privacy' },
  { id: 'language', labelKey: 'settings.section.language' },
]

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function BugIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20v-9" />
      <path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" />
      <path d="M14.12 3.88 16 2" />
      <path d="M21 21a4 4 0 0 0-3.81-4" />
      <path d="M21 5a4 4 0 0 1-3.55 3.97" />
      <path d="M22 13h-4" />
      <path d="M3 21a4 4 0 0 1 3.81-4" />
      <path d="M3 5a4 4 0 0 0 3.55 3.97" />
      <path d="M6 13H2" />
      <path d="m8 2 1.88 1.88" />
      <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

function CreditChevron() {
  return (
    <span
      className="ui-chevron settings-panel__credit-chevron"
      aria-hidden="true"
    >
      <svg viewBox="0 0 12 12">
        <path d="M3 4.5 6 7.5 9 4.5" />
      </svg>
    </span>
  )
}

/**
 * Map settings gear + bug report FAB — side nav, compact fixed card on desktop.
 */
/** Min gap (px) between right-rail stack bottom and settings FABs before hide. */
const SETTINGS_STACK_CLEARANCE_PX = 8

export function MapSettingsPanel() {
  const { locale, setLocale, t } = useLocale()
  const isPhone = useMatchMedia(OPERATE_PHONE_MQ)
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<SettingsSection>('about')
  const [bugReportOpen, setBugReportOpen] = useState(false)
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false)
  const [railObscured, setRailObscured] = useState(false)
  const [terrainQuality, setTerrainQuality] = useState<TerrainQuality>(
    () => loadAppSettings().immersive.terrainQuality,
  )
  const titleId = useId()
  const langLabelId = useId()
  const qualityLabelId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const langMenuRef = useRef<HTMLDivElement>(null)
  const qualityMenuRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onOpenSettings = () => {
      setBugReportOpen(false)
      setOpen(true)
    }
    const onOpenBug = () => {
      setOpen(false)
      setBugReportOpen(true)
    }
    window.addEventListener(OPEN_MAP_SETTINGS_EVENT, onOpenSettings)
    window.addEventListener(OPEN_BUG_REPORT_EVENT, onOpenBug)
    return () => {
      window.removeEventListener(OPEN_MAP_SETTINGS_EVENT, onOpenSettings)
      window.removeEventListener(OPEN_BUG_REPORT_EVENT, onOpenBug)
    }
  }, [])

  /* Hide bug/settings FABs on any non-phone width while the right stack
     actually covers them (PL expand). Phone FABs live in the drawer. */
  useEffect(() => {
    if (isPhone) {
      setRailObscured(false)
      return
    }

    let rafId = 0
    let animRafId = 0
    let animUntil = 0

    const measure = () => {
      const anchor = anchorRef.current
      const stack = document.querySelector('.map-controls-stack')
      if (!anchor || !stack) {
        setRailObscured(false)
        return
      }
      const stackRect = stack.getBoundingClientRect()
      const anchorRect = anchor.getBoundingClientRect()
      if (anchorRect.height < 1 || stackRect.height < 1) {
        setRailObscured(false)
        return
      }
      const overlaps =
        stackRect.bottom + SETTINGS_STACK_CLEARANCE_PX > anchorRect.top &&
        stackRect.right > anchorRect.left &&
        stackRect.left < anchorRect.right
      setRailObscured(overlaps)
    }

    const scheduleMeasure = () => {
      if (rafId) return
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        measure()
      })
    }

    const pumpDuringAnim = () => {
      measure()
      if (performance.now() < animUntil) {
        animRafId = window.requestAnimationFrame(pumpDuringAnim)
      } else {
        animRafId = 0
      }
    }

    const onPlClass = () => {
      /* PL slider expand/collapse ~240ms — keep measuring through the tween. */
      animUntil = performance.now() + 320
      if (!animRafId) animRafId = window.requestAnimationFrame(pumpDuringAnim)
    }

    measure()

    const stack = document.querySelector('.map-controls-stack')
    const pl = document.querySelector('.pl-heatmap-control')
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMeasure) : null
    if (anchorRef.current) ro?.observe(anchorRef.current)
    if (stack) ro?.observe(stack)
    if (pl) ro?.observe(pl)

    const mo =
      typeof MutationObserver !== 'undefined' && pl
        ? new MutationObserver(onPlClass)
        : null
    if (pl) mo?.observe(pl, { attributes: true, attributeFilter: ['class'] })

    window.addEventListener('resize', scheduleMeasure)
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId)
      if (animRafId) window.cancelAnimationFrame(animRafId)
      ro?.disconnect()
      mo?.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [isPhone])

  useEffect(() => {
    if (!open) {
      setLangMenuOpen(false)
      setQualityMenuOpen(false)
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (langMenuOpen) {
        setLangMenuOpen(false)
        return
      }
      if (qualityMenuOpen) {
        setQualityMenuOpen(false)
        return
      }
      setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, langMenuOpen, qualityMenuOpen])

  useEffect(() => {
    if (!langMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const root = langMenuRef.current
      if (!root || root.contains(event.target as Node)) return
      setLangMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [langMenuOpen])

  useEffect(() => {
    if (!qualityMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const root = qualityMenuRef.current
      if (!root || root.contains(event.target as Node)) return
      setQualityMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [qualityMenuOpen])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    setLangMenuOpen(false)
    setQualityMenuOpen(false)
    setTerrainQuality(loadAppSettings().immersive.terrainQuality)
    contentRef.current?.scrollTo({ top: 0 })
  }, [open, section])

  const activeLabelKey = SETTINGS_SECTIONS.find(
    (item) => item.id === section,
  )?.labelKey
  const activeLabel = activeLabelKey ? t(activeLabelKey) : ''

  const dialog =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="settings-overlay"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false)
            }}
          >
            <div
              ref={dialogRef}
              id="map-settings-panel"
              className="settings-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <header className="settings-panel__header">
                <h2 id={titleId} className="settings-panel__title">
                  {t('settings.title')}
                </h2>
                <button
                  ref={closeRef}
                  type="button"
                  className="settings-panel__close"
                  aria-label={t('common.close')}
                  onClick={() => setOpen(false)}
                >
                  <CloseIcon />
                </button>
              </header>

              <div className="settings-panel__shell">
                <nav
                  className="settings-panel__nav"
                  aria-label={t('settings.navAria')}
                >
                  {SETTINGS_SECTIONS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      id={`settings-tab-${item.id}`}
                      aria-selected={section === item.id}
                      aria-controls={`settings-panel-${item.id}`}
                      className={
                        section === item.id
                          ? 'settings-panel__nav-btn is-active'
                          : 'settings-panel__nav-btn'
                      }
                      onClick={() => setSection(item.id)}
                    >
                      {t(item.labelKey)}
                    </button>
                  ))}
                </nav>

                <div
                  ref={contentRef}
                  className="settings-panel__content"
                  role="tabpanel"
                  id={`settings-panel-${section}`}
                  aria-labelledby={`settings-tab-${section}`}
                >
                  <h3 className="settings-panel__content-title">
                    {activeLabel}
                  </h3>

                  {section === 'about' ? (
                    <div className="settings-panel__section">
                      <div className="settings-panel__about-card">
                        <p className="settings-panel__about-name">
                          {APP_AUTHOR}
                        </p>
                        <p className="settings-panel__about-tagline">
                          {t(APP_AUTHOR_TAGLINE_KEY)}
                        </p>
                        {APP_ABOUT_PARAGRAPH_KEYS.map((key) => (
                          <p key={key} className="settings-panel__about">
                            {t(key)}
                          </p>
                        ))}
                        {APP_ABOUT_LINKS.length > 0 ? (
                          <ul className="settings-panel__about-links">
                            {APP_ABOUT_LINKS.map((link) => {
                              const external = /^https?:/i.test(link.url)
                              return (
                                <li key={link.id}>
                                  <a
                                    href={link.url}
                                    {...(external
                                      ? {
                                          target: '_blank',
                                          rel: 'noreferrer noopener',
                                        }
                                      : {})}
                                  >
                                    {link.label}
                                  </a>
                                </li>
                              )
                            })}
                          </ul>
                        ) : null}
                        <p className="settings-panel__about-meta">
                          {APP_NAME} · v{APP_VERSION}
                          <br />
                          {APP_COPYRIGHT}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {section === 'onboarding' ? (
                    <div className="settings-panel__section">
                      <p className="settings-panel__hint">
                        {t('settings.onboarding.hint')}
                      </p>
                      <button
                        type="button"
                        className="settings-panel__intro-action"
                        onClick={() => {
                          setOpen(false)
                          openOnboardingIntro()
                        }}
                      >
                        {t('settings.onboarding.replayIntro')}
                      </button>
                      <p className="settings-panel__intro-hint">
                        {t('settings.onboarding.replayIntroHint')}
                      </p>
                      <button
                        type="button"
                        className="settings-panel__intro-action"
                        onClick={() => {
                          setOpen(false)
                          openOnboardingTour()
                        }}
                      >
                        {t('settings.onboarding.replayTour')}
                      </button>
                      <p className="settings-panel__intro-hint">
                        {t('settings.onboarding.replayTourHint')}
                      </p>
                    </div>
                  ) : null}

                  {section === 'attributions' ? (
                    <div className="settings-panel__section">
                      <p className="settings-panel__hint">
                        {t('settings.attributions.hint')}
                      </p>
                      <div className="settings-panel__credits">
                        {APP_ATTRIBUTIONS.map((entry) => (
                          <details
                            key={entry.id}
                            className="settings-panel__credit"
                          >
                            <summary className="settings-panel__credit-summary">
                              <span className="settings-panel__credit-name">
                                {t(entry.nameKey)}
                              </span>
                              <CreditChevron />
                            </summary>
                            <div className="settings-panel__credit-body">
                              <span>{entry.credit}</span>
                              {entry.url ? (
                                <a
                                  href={entry.url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                >
                                  {entry.url.replace(/^https?:\/\//, '')}
                                </a>
                              ) : null}
                            </div>
                          </details>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {section === 'privacy' ? (
                    <div className="settings-panel__section">
                      <p className="settings-panel__hint">
                        {t('settings.privacy.hint')}
                      </p>
                      <div className="settings-panel__credits">
                        {APP_PRIVACY_POINTS.map((point) => (
                          <details
                            key={point.id}
                            className="settings-panel__credit"
                          >
                            <summary className="settings-panel__credit-summary">
                              <span className="settings-panel__credit-name">
                                {t(`settings.privacy.${point.textKey}.title`)}
                              </span>
                              <CreditChevron />
                            </summary>
                            <div className="settings-panel__credit-body">
                              <span>
                                {t(`settings.privacy.${point.textKey}.body`)}
                              </span>
                            </div>
                          </details>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {section === 'quality' ? (
                    <div className="settings-panel__section">
                      <span
                        className="settings-panel__lang-label"
                        id={qualityLabelId}
                      >
                        {t('settings.quality.label')}
                      </span>
                      <div
                        className="moon-preview-select-wrap settings-panel__lang-wrap"
                        ref={qualityMenuRef}
                      >
                        <button
                          type="button"
                          className="moon-preview-select-trigger"
                          aria-labelledby={qualityLabelId}
                          aria-haspopup="listbox"
                          aria-expanded={qualityMenuOpen}
                          onClick={() =>
                            setQualityMenuOpen((value) => !value)
                          }
                        >
                          <span>
                            {t(`terrainQuality.level.${terrainQuality}`)}
                          </span>
                          <svg
                            viewBox="0 0 16 16"
                            width="12"
                            height="12"
                            aria-hidden="true"
                          >
                            <path
                              d="M4 6l4 4 4-4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                        {qualityMenuOpen ? (
                          <ul
                            className="moon-preview-select-menu moon-preview-select-menu--down"
                            role="listbox"
                            aria-labelledby={qualityLabelId}
                          >
                            {TERRAIN_QUALITY_IDS.map((id) => {
                              const active = id === terrainQuality
                              const mb = getApproxTerrainDownloadMb(id)
                              return (
                                <li key={id} role="none">
                                  <button
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    className={
                                      active
                                        ? 'moon-preview-select-option moon-preview-select-option--active'
                                        : 'moon-preview-select-option'
                                    }
                                    onClick={() => {
                                      setTerrainQuality(id)
                                      patchAppSettings({
                                        immersive: {
                                          terrainQuality: id,
                                          terrainQualityChosen: true,
                                        },
                                      })
                                      emitTerrainQualityChange(id)
                                      setQualityMenuOpen(false)
                                    }}
                                  >
                                    {t(`terrainQuality.level.${id}`)}
                                    {' · '}
                                    {t('terrainQuality.approxMb', {
                                      mb: String(mb),
                                    })}
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        ) : null}
                      </div>
                      <p className="settings-panel__hint">
                        {t('settings.quality.hint', {
                          mb: String(
                            getApproxTerrainDownloadMb(terrainQuality),
                          ),
                        })}
                      </p>
                    </div>
                  ) : null}

                  {section === 'language' ? (
                    <div className="settings-panel__section">
                      <span
                        className="settings-panel__lang-label"
                        id={langLabelId}
                      >
                        {t('settings.language.label')}
                      </span>
                      <div
                        className="moon-preview-select-wrap settings-panel__lang-wrap"
                        ref={langMenuRef}
                      >
                        <button
                          type="button"
                          className="moon-preview-select-trigger"
                          aria-labelledby={langLabelId}
                          aria-haspopup="listbox"
                          aria-expanded={langMenuOpen}
                          onClick={() =>
                            setLangMenuOpen((value) => !value)
                          }
                        >
                          <span>{t(`settings.language.${locale}`)}</span>
                          <svg
                            viewBox="0 0 16 16"
                            width="12"
                            height="12"
                            aria-hidden="true"
                          >
                            <path
                              d="M4 6l4 4 4-4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                        {langMenuOpen ? (
                          <ul
                            className="moon-preview-select-menu moon-preview-select-menu--down"
                            role="listbox"
                            aria-labelledby={langLabelId}
                          >
                            {LOCALES.map((id) => {
                              const active = id === locale
                              return (
                                <li key={id} role="none">
                                  <button
                                    type="button"
                                    role="option"
                                    lang={id}
                                    aria-selected={active}
                                    className={
                                      active
                                        ? 'moon-preview-select-option moon-preview-select-option--active'
                                        : 'moon-preview-select-option'
                                    }
                                    onClick={() => {
                                      setLocale(id)
                                      setLangMenuOpen(false)
                                    }}
                                  >
                                    {t(`settings.language.${id}`)}
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        ) : null}
                      </div>
                      <p className="settings-panel__hint">
                        {t('settings.language.hint')}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  const anchorClass = [
    'settings-anchor',
    isPhone ? 'settings-anchor--phone-drawer' : '',
    !isPhone && railObscured ? 'settings-anchor--obscured' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={anchorRef}
      className={anchorClass}
      aria-hidden={!isPhone && railObscured ? true : undefined}
    >
      {!isPhone ? (
        <>
          <button
            type="button"
            className={
              bugReportOpen
                ? 'settings-anchor__toggle settings-anchor__toggle--active'
                : 'settings-anchor__toggle'
            }
            aria-label={t('settings.bugReport')}
            title={t('settings.bugReport')}
            aria-expanded={bugReportOpen}
            tabIndex={railObscured ? -1 : undefined}
            onClick={() => {
              setOpen(false)
              setBugReportOpen(true)
            }}
          >
            <BugIcon />
          </button>
          <button
            type="button"
            className={
              open
                ? 'settings-anchor__toggle settings-anchor__toggle--active'
                : 'settings-anchor__toggle'
            }
            aria-label={t('settings.title')}
            title={t('settings.title')}
            aria-expanded={open}
            aria-controls="map-settings-panel"
            tabIndex={railObscured ? -1 : undefined}
            onClick={() => {
              setBugReportOpen(false)
              setOpen((value) => !value)
            }}
          >
            <SettingsIcon />
          </button>
        </>
      ) : null}
      {dialog}
      <BugReportCard
        open={bugReportOpen}
        onClose={() => setBugReportOpen(false)}
      />
    </div>
  )
}
