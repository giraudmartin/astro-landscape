import { useRef, useState, type RefObject } from 'react'
import { useT } from './i18n'
import {
  clampMilkyWayNebBrightness,
  clampMilkyWayNebExposure,
  clampMilkyWayNebSaturation,
  DEFAULT_MILKY_WAY_NEB_LOOK,
  MILKY_WAY_NEB_BRIGHTNESS_MAX,
  MILKY_WAY_NEB_BRIGHTNESS_MIN,
  MILKY_WAY_NEB_EXPOSURE_MAX,
  MILKY_WAY_NEB_EXPOSURE_MIN,
  MILKY_WAY_NEB_SATURATION_MAX,
  MILKY_WAY_NEB_SATURATION_MIN,
  type MilkyWayNebLook,
} from './milkyWayNebLook'
import { ViewfinderFloatPanel } from './ViewfinderFloatPanel'

type ViewfinderMilkyWayNebControlProps = {
  look: MilkyWayNebLook
  onChange: (patch: Partial<MilkyWayNebLook>) => void
  onReset: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onBack?: () => void
  showTrigger?: boolean
  anchorRef?: RefObject<HTMLElement | null>
  floatStorageKey?: string
  floatDefaultPos?: { x: number; y: number }
  embed?: boolean
}

const FLOAT_POS_STORAGE_KEY = 'vf-milkyway-neb-panel-float-pos'
const DEFAULT_FLOAT_POS = { x: 24, y: 120 }

/**
 * Scene settings card for the shipping milky-way grade.
 */
export function ViewfinderMilkyWayNebControl({
  look,
  onChange,
  onReset,
  open: openProp,
  onOpenChange,
  onBack,
  showTrigger = true,
  anchorRef,
  floatStorageKey,
  floatDefaultPos,
  embed = false,
}: ViewfinderMilkyWayNebControlProps) {
  const t = useT()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = openProp ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelAnchor = anchorRef ?? rootRef

  const rangeProgressStyle = (value: number, min: number, max: number) => {
    const span = max - min
    const pct = span <= 0 ? 0 : ((value - min) / span) * 100
    return {
      ['--range-progress' as string]: `${Math.min(100, Math.max(0, pct))}%`,
    }
  }

  const body = (
    <section className="vf-sky-panel__section">
      <h3 className="vf-sky-panel__section-title">
        {t('viewfinder.milkyWayNeb.section')}
      </h3>
      <p className="vf-sky-panel__hint">{t('viewfinder.milkyWayNeb.hint')}</p>
      <div className="vf-sky-panel__section-body">
        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>{t('viewfinder.milkyWayNeb.exposure')}</span>
            <span className="vf-landscape-menu__value">
              {look.exposure.toFixed(2)}
            </span>
          </span>
          <input
            type="range"
            className="vf-landscape-menu__range"
            min={MILKY_WAY_NEB_EXPOSURE_MIN}
            max={MILKY_WAY_NEB_EXPOSURE_MAX}
            step={0.05}
            value={look.exposure}
            style={rangeProgressStyle(
              look.exposure,
              MILKY_WAY_NEB_EXPOSURE_MIN,
              MILKY_WAY_NEB_EXPOSURE_MAX,
            )}
            aria-label={t('viewfinder.milkyWayNeb.exposureAria')}
            title={t('viewfinder.milkyWayNeb.exposureTip')}
            onChange={(event) =>
              onChange({
                exposure: clampMilkyWayNebExposure(Number(event.target.value)),
              })
            }
          />
        </label>

        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>{t('viewfinder.milkyWayNeb.brightness')}</span>
            <span className="vf-landscape-menu__value">
              {look.brightness.toFixed(2)}
            </span>
          </span>
          <input
            type="range"
            className="vf-landscape-menu__range"
            min={MILKY_WAY_NEB_BRIGHTNESS_MIN}
            max={MILKY_WAY_NEB_BRIGHTNESS_MAX}
            step={0.05}
            value={look.brightness}
            style={rangeProgressStyle(
              look.brightness,
              MILKY_WAY_NEB_BRIGHTNESS_MIN,
              MILKY_WAY_NEB_BRIGHTNESS_MAX,
            )}
            aria-label={t('viewfinder.milkyWayNeb.brightnessAria')}
            title={t('viewfinder.milkyWayNeb.brightnessTip')}
            onChange={(event) =>
              onChange({
                brightness: clampMilkyWayNebBrightness(
                  Number(event.target.value),
                ),
              })
            }
          />
        </label>

        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>{t('viewfinder.milkyWayNeb.saturation')}</span>
            <span className="vf-landscape-menu__value">
              {look.saturation.toFixed(2)}
            </span>
          </span>
          <input
            type="range"
            className="vf-landscape-menu__range"
            min={MILKY_WAY_NEB_SATURATION_MIN}
            max={MILKY_WAY_NEB_SATURATION_MAX}
            step={0.05}
            value={look.saturation}
            style={rangeProgressStyle(
              look.saturation,
              MILKY_WAY_NEB_SATURATION_MIN,
              MILKY_WAY_NEB_SATURATION_MAX,
            )}
            aria-label={t('viewfinder.milkyWayNeb.saturationAria')}
            title={t('viewfinder.milkyWayNeb.saturationTip')}
            onChange={(event) =>
              onChange({
                saturation: clampMilkyWayNebSaturation(
                  Number(event.target.value),
                ),
              })
            }
          />
        </label>

        <button
          type="button"
          className="vf-sky-panel__reset"
          onClick={onReset}
        >
          {t('viewfinder.milkyWayNeb.reset')}
        </button>
        <p className="vf-sky-panel__hint">
          {t('viewfinder.milkyWayNeb.defaults', {
            exposure: DEFAULT_MILKY_WAY_NEB_LOOK.exposure.toFixed(2),
            brightness: DEFAULT_MILKY_WAY_NEB_LOOK.brightness.toFixed(2),
            saturation: DEFAULT_MILKY_WAY_NEB_LOOK.saturation.toFixed(2),
          })}
        </p>
      </div>
    </section>
  )

  if (embed) return open ? body : null

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
          title={t('viewfinder.milkyWayNeb.settingsTitle')}
          onClick={() => setOpen(!open)}
        >
          <span className="vf-proj-control__muted">
            {t('viewfinder.milkyWayNeb.title')}
          </span>
        </button>
      ) : null}

      <ViewfinderFloatPanel
        open={open}
        onClose={() => setOpen(false)}
        onBack={onBack}
        title={t('viewfinder.milkyWayNeb.title')}
        storageKey={floatStorageKey ?? FLOAT_POS_STORAGE_KEY}
        defaultPos={floatDefaultPos ?? DEFAULT_FLOAT_POS}
        triggerRef={panelAnchor}
      >
        {body}
      </ViewfinderFloatPanel>
    </div>
  )
}
