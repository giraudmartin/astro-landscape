import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { APP_ATTRIBUTIONS } from './attributions'

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
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
 * Map settings gear — attributions (Photo Sightline pattern).
 */
export function MapSettingsPanel() {
  const [open, setOpen] = useState(false)
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
    <>
      <button
        type="button"
        className={
          open
            ? 'map-quick-actions__button map-quick-actions__button--active'
            : 'map-quick-actions__button'
        }
        aria-label="Paramètres"
        title="Paramètres"
        aria-expanded={open}
        aria-controls="map-settings-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <SettingsIcon />
      </button>
      {dialog}
    </>
  )
}
