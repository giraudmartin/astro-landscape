import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { APP_ATTRIBUTIONS } from './attributions'
import { BugReportCard } from './BugReportCard'

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

/**
 * Map settings gear + bug report FAB — attributions (Photo Sightline pattern).
 */
export function MapSettingsPanel() {
  const [open, setOpen] = useState(false)
  const [bugReportOpen, setBugReportOpen] = useState(false)
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
  }, [open])

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
                  Paramètres
                </h2>
                <button
                  ref={closeRef}
                  type="button"
                  className="settings-panel__close"
                  aria-label="Fermer"
                  onClick={() => setOpen(false)}
                >
                  <CloseIcon />
                </button>
              </header>

              <div className="settings-panel__body">
                <section
                  className="settings-panel__section"
                  aria-labelledby="settings-attr"
                >
                  <h3
                    id="settings-attr"
                    className="settings-panel__section-title"
                  >
                    Crédits & licences
                  </h3>
                  <p className="settings-panel__hint">
                    Sources de données et contenus tiers utilisés par l’app.
                  </p>
                  <div className="settings-panel__credits">
                    {APP_ATTRIBUTIONS.map((entry) => (
                      <details
                        key={entry.id}
                        className="settings-panel__credit"
                      >
                        <summary className="settings-panel__credit-summary">
                          <span className="settings-panel__credit-name">
                            {entry.name}
                          </span>
                          <span
                            className="ui-chevron settings-panel__credit-chevron"
                            aria-hidden="true"
                          >
                            <svg viewBox="0 0 12 12">
                              <path d="M3 4.5 6 7.5 9 4.5" />
                            </svg>
                          </span>
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
                </section>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div className="settings-anchor">
      <button
        type="button"
        className={
          bugReportOpen
            ? 'settings-anchor__toggle settings-anchor__toggle--active'
            : 'settings-anchor__toggle'
        }
        aria-label="Signaler un bug"
        title="Signaler un bug"
        aria-expanded={bugReportOpen}
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
        aria-label="Paramètres"
        title="Paramètres"
        aria-expanded={open}
        aria-controls="map-settings-panel"
        onClick={() => {
          setBugReportOpen(false)
          setOpen((value) => !value)
        }}
      >
        <SettingsIcon />
      </button>
      {dialog}
      <BugReportCard
        open={bugReportOpen}
        onClose={() => setBugReportOpen(false)}
      />
    </div>
  )
}
