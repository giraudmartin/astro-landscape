import { useEffect, useId, useRef, useState } from 'react'
import {
  clampGroundNightBrightness,
  clampGroundNightContrast,
  clampGroundNightTemperature,
  GROUND_NIGHT_BRIGHTNESS_MAX,
  GROUND_NIGHT_BRIGHTNESS_MIN,
  GROUND_NIGHT_CONTRAST_MAX,
  GROUND_NIGHT_CONTRAST_MIN,
  GROUND_NIGHT_TEMPERATURE_MAX,
  GROUND_NIGHT_TEMPERATURE_MIN,
} from './skyLighting'
import { ChevronDownIcon, SettingsSlidersIcon } from './psIcons'

type ViewfinderLandscapeControlProps = {
  brightness: number
  contrast: number
  temperature: number
  onBrightnessChange: (value: number) => void
  onContrastChange: (value: number) => void
  onTemperatureChange: (value: number) => void
}

/**
 * Compact top-right landscape night settings — left of the projection control.
 */
export function ViewfinderLandscapeControl({
  brightness,
  contrast,
  temperature,
  onBrightnessChange,
  onContrastChange,
  onTemperatureChange,
}: ViewfinderLandscapeControlProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (rootRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const temperatureLabel =
    temperature > 0 ? `+${temperature.toFixed(2)}` : temperature.toFixed(2)

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
      className={open ? 'vf-proj-control is-open' : 'vf-proj-control'}
    >
      <button
        type="button"
        className={
          open
            ? 'vf-proj-control__trigger is-active'
            : 'vf-proj-control__trigger'
        }
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="dialog"
        title="Réglages du paysage"
        onClick={() => setOpen((value) => !value)}
      >
        <SettingsSlidersIcon size={16} />
        <span className="vf-proj-control__muted">Paysage</span>
        <ChevronDownIcon className="vf-proj-control__chevron" size={12} />
      </button>

      {open ? (
        <div
          id={menuId}
          className="vf-landscape-menu"
          role="dialog"
          aria-label="Réglages du paysage"
        >
          <label className="vf-landscape-menu__field">
            <span className="vf-landscape-menu__label">
              <span>Sol nuit</span>
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
              <span>Contraste nuit</span>
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
              <span>Température nuit</span>
              <span className="vf-landscape-menu__value">
                {temperatureLabel}
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
              title="Froid (−1) → neutre (0) → chaud (+1) ; jour inchangé"
              onChange={(event) =>
                onTemperatureChange(
                  clampGroundNightTemperature(Number(event.target.value)),
                )
              }
            />
          </label>
        </div>
      ) : null}
    </div>
  )
}
