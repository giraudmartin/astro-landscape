import { useRef, useState, type RefObject } from 'react'
import { useT } from './i18n'
import { ViewfinderFloatPanel } from './ViewfinderFloatPanel'
import { getApproxTerrainDownloadMb } from './terrainDownloadEstimate'
import {
  TERRAIN_QUALITY_IDS,
  type TerrainQuality,
} from './terrainQuality'

type ViewfinderQualityControlProps = {
  quality: TerrainQuality
  onQualityChange: (quality: TerrainQuality) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  showTrigger?: boolean
  anchorRef?: RefObject<HTMLElement | null>
}

const FLOAT_POS_STORAGE_KEY = 'vf-quality-panel-float-pos'
const DEFAULT_FLOAT_POS = { x: 24, y: 72 }

/**
 * Immersive terrain download quality — floating panel (same chrome as Paysage).
 */
export function ViewfinderQualityControl({
  quality,
  onQualityChange,
  open: openProp,
  onOpenChange,
  showTrigger = true,
  anchorRef,
}: ViewfinderQualityControlProps) {
  const t = useT()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = openProp ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelAnchor = anchorRef ?? rootRef

  return (
    <div
      ref={rootRef}
      className={
        showTrigger
          ? open
            ? 'vf-proj-control is-open'
            : 'vf-proj-control'
          : undefined
      }
    >
      {showTrigger ? (
        <button
          type="button"
          className={
            open
              ? 'vf-proj-control__trigger is-active'
              : 'vf-proj-control__trigger'
          }
          aria-expanded={open}
          aria-haspopup="dialog"
          title={t('viewfinder.quality.settingsTitle')}
          onClick={() => setOpen(!open)}
        >
          <span className="vf-proj-control__muted">
            {t('viewfinder.quality.title')}
          </span>
        </button>
      ) : null}

      <ViewfinderFloatPanel
        open={open}
        onClose={() => setOpen(false)}
        title={t('viewfinder.quality.title')}
        storageKey={FLOAT_POS_STORAGE_KEY}
        defaultPos={DEFAULT_FLOAT_POS}
        triggerRef={panelAnchor}
      >
        <section className="vf-sky-panel__section">
          <h3 className="vf-sky-panel__section-title">
            {t('viewfinder.quality.section')}
          </h3>
          <div className="vf-sky-panel__section-body">
            <div
              className="vf-quality-menu__options"
              role="radiogroup"
              aria-label={t('viewfinder.quality.section')}
            >
              {TERRAIN_QUALITY_IDS.map((id) => {
                const active = id === quality
                const mb = getApproxTerrainDownloadMb(id)
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={
                      active
                        ? 'vf-quality-menu__option is-active'
                        : 'vf-quality-menu__option'
                    }
                    onClick={() => onQualityChange(id)}
                  >
                    <span className="vf-quality-menu__option-copy">
                      <b>{t(`terrainQuality.level.${id}`)}</b>
                      <small>{t(`terrainQuality.level.${id}Hint`)}</small>
                    </span>
                    <span className="vf-quality-menu__option-size">
                      {t('terrainQuality.approxMb', { mb: String(mb) })}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="vf-sky-panel__hint">{t('viewfinder.quality.hint')}</p>
          </div>
        </section>
      </ViewfinderFloatPanel>
    </div>
  )
}
