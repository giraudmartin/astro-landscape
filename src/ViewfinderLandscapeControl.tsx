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
          title="Réglages du paysage"
          onClick={() => setOpen(!open)}
        >
          <SettingsSlidersIcon size={16} />
          <span className="vf-proj-control__muted">Paysage</span>
        </button>
      ) : null}

      <ViewfinderFloatPanel
        open={open}
        onClose={() => setOpen(false)}
        title="Paysage"
        storageKey={FLOAT_POS_STORAGE_KEY}
        defaultPos={DEFAULT_FLOAT_POS}
        triggerRef={panelAnchor}
      >
        <section className="vf-sky-panel__section">
          <h3 className="vf-sky-panel__section-title">Sol nuit</h3>
          <div className="vf-sky-panel__section-body">
            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Luminosité</span>
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
                aria-label="Luminosité du sol après le coucher et la nuit"
                title="Multiplicateur crépuscule / nuit (1 = défaut, jour inchangé)"
                onChange={(event) =>
                  onBrightnessChange(
                    clampGroundNightBrightness(Number(event.target.value)),
                  )
                }
              />
            </label>

            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Contraste</span>
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
                aria-label="Contraste du sol après le coucher et la nuit"
                title="Contraste crépuscule / nuit (1 = défaut, jour inchangé)"
                onChange={(event) =>
                  onContrastChange(
                    clampGroundNightContrast(Number(event.target.value)),
                  )
                }
              />
            </label>

            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Température</span>
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
                aria-label="Température couleur du sol après le coucher et la nuit"
                title="Froid (−2) → neutre (0) → chaud (+2) ; jour inchangé"
                onChange={(event) =>
                  onTemperatureChange(
                    clampGroundNightTemperature(Number(event.target.value)),
                  )
                }
              />
            </label>

            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Teinte</span>
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
                aria-label="Teinte du sol après le coucher et la nuit"
                title="Vert (−2) → neutre (0) → violet (+2) ; jour inchangé"
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
