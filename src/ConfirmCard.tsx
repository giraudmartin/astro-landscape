import { useT } from './i18n'

type ConfirmCardProps = {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmCard({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmCardProps) {
  const t = useT()
  return (
    <div
      className="spot-save-card-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="spot-save-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-card-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <div className="map-card map-card--spot-save">
          <header className="map-card__header">
            <h2 className="map-card__title" id="confirm-card-title">
              {title}
            </h2>
            <button
              type="button"
              className="spot-save-card__close"
              aria-label={t('common.close')}
              onClick={onClose}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </header>
          <div className="map-card__body">
            <p className="spot-save-card__intro">{message}</p>
            <div className="spot-save-card__actions spot-save-card__actions--edit">
              <button
                type="button"
                className="spot-save-card__cancel"
                onClick={onClose}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="spot-save-card__delete spot-save-card__delete--solid"
                autoFocus
                onClick={onConfirm}
              >
                {confirmLabel ?? t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
