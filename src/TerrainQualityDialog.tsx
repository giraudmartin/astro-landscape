import { useId } from 'react'
import { useT } from './i18n'
import { getApproxTerrainDownloadMb } from './terrainDownloadEstimate'
import {
  TERRAIN_QUALITY_IDS,
  type TerrainQuality,
} from './terrainQuality'

type TerrainQualityDialogProps = {
  open: boolean
  onChoose: (quality: TerrainQuality) => void
  onCancel: () => void
}

export function TerrainQualityDialog({
  open,
  onChoose,
  onCancel,
}: TerrainQualityDialogProps) {
  const t = useT()
  const titleId = useId()
  if (!open) return null

  return (
    <div
      className="spot-save-card-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        className="spot-save-card terrain-quality-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      >
        <div className="map-card map-card--spot-save">
          <header className="map-card__header">
            <h2 className="map-card__title" id={titleId}>
              {t('terrainQuality.dialog.title')}
            </h2>
            <button
              type="button"
              className="spot-save-card__close"
              aria-label={t('common.close')}
              onClick={onCancel}
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
            <p className="spot-save-card__intro">
              {t('terrainQuality.dialog.body')}
            </p>
            <div className="terrain-quality-dialog__options" role="list">
              {TERRAIN_QUALITY_IDS.map((id) => {
                const mb = getApproxTerrainDownloadMb(id)
                return (
                  <button
                    key={id}
                    type="button"
                    role="listitem"
                    className={
                      id === 'standard'
                        ? 'terrain-quality-dialog__option terrain-quality-dialog__option--suggested'
                        : 'terrain-quality-dialog__option'
                    }
                    onClick={() => onChoose(id)}
                  >
                    <span className="terrain-quality-dialog__option-label">
                      {t(`terrainQuality.level.${id}`)}
                      {id === 'standard' ? (
                        <span className="terrain-quality-dialog__badge">
                          {t('terrainQuality.dialog.suggested')}
                        </span>
                      ) : null}
                    </span>
                    <span className="terrain-quality-dialog__option-hint">
                      {t(`terrainQuality.level.${id}Hint`)}
                    </span>
                    <span className="terrain-quality-dialog__option-size">
                      {t('terrainQuality.approxMb', { mb: String(mb) })}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="terrain-quality-dialog__footnote">
              {t('terrainQuality.dialog.footnote')}
            </p>
            <div className="spot-save-card__actions">
              <button
                type="button"
                className="spot-save-card__cancel"
                onClick={onCancel}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
