type SpotSaveCardProps = {
  mode: 'save' | 'edit'
  name: string
  lat: number
  lon: number
  onNameChange: (name: string) => void
  onClose: () => void
  onSubmit: () => void
  onDelete?: () => void
}

export function SpotSaveCard({
  mode,
  name,
  lat,
  lon,
  onNameChange,
  onClose,
  onSubmit,
  onDelete,
}: SpotSaveCardProps) {
  const title = mode === 'save' ? 'Enregistrer le spot' : 'Modifier le spot'
  const intro =
    mode === 'save'
      ? 'Donne un nom à ce marker pour le retrouver dans Mes spots.'
      : 'Renomme ce spot ou supprime-le.'

  return (
    <div
      className={
        mode === 'edit'
          ? 'spot-save-card-backdrop spot-save-card-backdrop--map-pass'
          : 'spot-save-card-backdrop'
      }
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        className="spot-save-card"
        role="dialog"
        aria-modal={mode === 'save'}
        aria-labelledby="spot-save-card-title"
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
            <h2 className="map-card__title" id="spot-save-card-title">
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
              <span>Nom du spot</span>
              <input
                autoFocus
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="Ex. Crête nord"
                maxLength={80}
              />
            </label>
            <p className="spot-save-card__coordinates">
              {Math.abs(lat).toFixed(5)}°{lat >= 0 ? 'N' : 'S'} ·{' '}
              {Math.abs(lon).toFixed(5)}°{lon >= 0 ? 'E' : 'W'}
            </p>
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
