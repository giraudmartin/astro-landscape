import { useT } from './i18n'

type FolderSaveCardProps = {
  mode: 'create' | 'edit'
  name: string
  onNameChange: (name: string) => void
  onClose: () => void
  onSubmit: () => void
  onDelete?: () => void
}

export function FolderSaveCard({
  mode,
  name,
  onNameChange,
  onClose,
  onSubmit,
  onDelete,
}: FolderSaveCardProps) {
  const t = useT()
  const title =
    mode === 'create'
      ? t('spots.folder.createTitle')
      : t('spots.folder.editTitle')
  const intro =
    mode === 'create'
      ? t('spots.folder.introCreate')
      : t('spots.folder.introEdit')

  return (
    <div
      className="spot-save-card-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        className="spot-save-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-save-card-title"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <div className="map-card map-card--spot-save">
          <header className="map-card__header">
            <h2 className="map-card__title" id="folder-save-card-title">
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
            <p className="spot-save-card__intro">{intro}</p>
            <label className="spot-save-card__field">
              <span>{t('spots.folder.nameLabel')}</span>
              <input
                autoFocus
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder={t('spots.folder.placeholder')}
                maxLength={80}
              />
            </label>
            <div
              className={
                mode === 'edit'
                  ? 'spot-save-card__actions spot-save-card__actions--edit'
                  : 'spot-save-card__actions'
              }
            >
              {mode === 'edit' && onDelete ? (
                <button
                  type="button"
                  className="spot-save-card__delete"
                  onClick={onDelete}
                >
                  {t('common.delete')}
                </button>
              ) : null}
              <button type="submit" className="control-panel__primary">
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
