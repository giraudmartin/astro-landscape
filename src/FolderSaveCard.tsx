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
  const title = mode === 'create' ? 'Nouveau dossier' : 'Modifier le dossier'
  const intro =
    mode === 'create'
      ? 'Donne un nom à ce dossier pour y ranger tes spots.'
      : 'Renomme ce dossier ou supprime-le. Les spots seront conservés.'

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
              aria-label="Fermer"
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
              <span>Nom du dossier</span>
              <input
                autoFocus
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="Ex. Alpes"
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
                  Supprimer
                </button>
              ) : null}
              <button type="submit" className="control-panel__primary">
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
