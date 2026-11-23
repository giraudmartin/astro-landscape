import { useRef, useState, type RefObject } from 'react'
import {
  clampGroundNightBrightness,
  clampGroundNightContrast,
  clampGroundNightTemperature,
  clampGroundNightTint,
  GROUND_NIGHT_BRIGHTNESS_MAX,
  GROUND_NIGHT_BRIGHTNESS_MIN,
  GROUND_NIGHT_CONTRAST_MAX,
  GROUND_NIGHT_CONTRAST_MIN,
  GROUND_NIGHT_TEMPERATURE_MAX,
  GROUND_NIGHT_TEMPERATURE_MIN,
  GROUND_NIGHT_TINT_MAX,
  GROUND_NIGHT_TINT_MIN,
} from './skyLighting'
import { useT } from './i18n'
import { SettingsSlidersIcon } from './psIcons'
import { ViewfinderFloatPanel } from './ViewfinderFloatPanel'

type ViewfinderLandscapeControlProps = {
  brightness: number
  contrast: number
  temperature: number
  tint: number
  onBrightnessChange: (value: number) => void
  onContrastChange: (value: number) => void
  onTemperatureChange: (value: number) => void
  onTintChange: (value: number) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  showTrigger?: boolean
  anchorRef?: RefObject<HTMLElement | null>
}

const FLOAT_POS_STORAGE_KEY = 'vf-landscape-panel-float-pos'
const DEFAULT_FLOAT_POS = { x: 24, y: 72 }

/**
 * Landscape night settings — floating window (same chrome as Ciel).
 */
export function ViewfinderLandscapeControl({
  brightness,
  contrast,
  temperature,
  tint,
  onBrightnessChange,
  onContrastChange,
  onTemperatureChange,
  onTintChange,
  open: openProp,
  onOpenChange,
  showTrigger = true,
  anchorRef,
}: ViewfinderLandscapeControlProps) {
  const t = useT()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = openProp ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelAnchor = anchorRef ?? rootRef

  const signedLabel = (value: number) =>
    value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2)

  const rangeProgressStyle = (value: number, min: number, max: number) => {
    const span = max - min
    const pct = span <= 0 ? 0 : ((value - min) / span) * 100
    return {
      ['--range-progress' as string]: `${Math.min(100, Math.max(0, pct))}%`,
    }
  }

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
          title={t('viewfinder.landscape.settingsTitle')}
          onClick={() => setOpen(!open)}
        >
          <SettingsSlidersIcon size={16} />
          <span className="vf-proj-control__muted">
            {t('viewfinder.landscape.title')}
          </span>
        </button>
      ) : null}

      <ViewfinderFloatPanel
        open={open}
        onClose={() => setOpen(false)}
        title={t('viewfinder.landscape.title')}
        storageKey={FLOAT_POS_STORAGE_KEY}
        defaultPos={DEFAULT_FLOAT_POS}
        triggerRef={panelAnchor}
      >
        <section className="vf-sky-panel__section">
          <h3 className="vf-sky-panel__section-title">
            {t('viewfinder.landscape.nightSoil')}
          </h3>
          <div className="vf-sky-panel__section-body">
            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>{t('viewfinder.landscape.brightness')}</span>
                <span className="vf-landscape-menu__value">
                  {brightness.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={GROUND_NIGHT_BRIGHTNESS_MIN}
                max={GROUND_NIGHT_BRIGHTNESS_MAX}
                step={0.05}
                value={brightness}
                style={rangeProgressStyle(
                  brightness,
                  GROUND_NIGHT_BRIGHTNESS_MIN,
                  GROUND_NIGHT_BRIGHTNESS_MAX,
                )}
                aria-label={t('viewfinder.landscape.brightnessAria')}
                title={t('viewfinder.landscape.brightnessTip')}
                onChange={(event) =>
                  onBrightnessChange(
                    clampGroundNightBrightness(Number(event.target.value)),
                  )
                }
              />
            </label>

            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>{t('viewfinder.landscape.contrast')}</span>
                <span className="vf-landscape-menu__value">
                  {contrast.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={GROUND_NIGHT_CONTRAST_MIN}
                max={GROUND_NIGHT_CONTRAST_MAX}
                step={0.05}
                value={contrast}
                style={rangeProgressStyle(
                  contrast,
                  GROUND_NIGHT_CONTRAST_MIN,
                  GROUND_NIGHT_CONTRAST_MAX,
                )}
                aria-label={t('viewfinder.landscape.contrastAria')}
                title={t('viewfinder.landscape.contrastTip')}
                onChange={(event) =>
                  onContrastChange(
                    clampGroundNightContrast(Number(event.target.value)),
                  )
                }
              />
            </label>

            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>{t('viewfinder.landscape.temperature')}</span>
                <span className="vf-landscape-menu__value">
                  {signedLabel(temperature)}
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={GROUND_NIGHT_TEMPERATURE_MIN}
                max={GROUND_NIGHT_TEMPERATURE_MAX}
                step={0.05}
                value={temperature}
                style={rangeProgressStyle(
                  temperature,
                  GROUND_NIGHT_TEMPERATURE_MIN,
                  GROUND_NIGHT_TEMPERATURE_MAX,
                )}
                aria-label={t('viewfinder.landscape.temperatureAria')}
                title={t('viewfinder.landscape.temperatureTip')}
                onChange={(event) =>
                  onTemperatureChange(
                    clampGroundNightTemperature(Number(event.target.value)),
                  )
                }
              />
            </label>

            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>{t('viewfinder.landscape.tint')}</span>
                <span className="vf-landscape-menu__value">
                  {signedLabel(tint)}
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={GROUND_NIGHT_TINT_MIN}
                max={GROUND_NIGHT_TINT_MAX}
                step={0.05}
                value={tint}
                style={rangeProgressStyle(
                  tint,
                  GROUND_NIGHT_TINT_MIN,
                  GROUND_NIGHT_TINT_MAX,
                )}
                aria-label={t('viewfinder.landscape.tintAria')}
                title={t('viewfinder.landscape.tintTip')}
                onChange={(event) =>
                  onTintChange(clampGroundNightTint(Number(event.target.value)))
                }
              />
            </label>
          </div>
        </section>
      </ViewfinderFloatPanel>
    </div>
  )
}
