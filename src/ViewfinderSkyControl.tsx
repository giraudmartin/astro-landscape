import { useEffect, useId, useRef, useState } from 'react'
import {
  clampStarBrightness,
  clampStarGlow,
  clampStarMagDepth,
  clampStarZoomSpan,
  STAR_BRIGHTNESS_MAX,
  STAR_BRIGHTNESS_MIN,
  STAR_GLOW_MAX,
  STAR_GLOW_MIN,
  STAR_MAG_DEPTH_MAX,
  STAR_MAG_DEPTH_MIN,
  STAR_ZOOM_SPAN_MAX,
  STAR_ZOOM_SPAN_MIN,
} from './starRevealSettings'
import {
  AIRGLOW_AMOUNT_MAX,
  AIRGLOW_AMOUNT_MIN,
  AIRGLOW_HUE_MAX,
  AIRGLOW_HUE_MIN,
  AIRGLOW_WAVES_MAX,
  AIRGLOW_WAVES_MIN,
  ATMOSPHERE_AMOUNT_MAX,
  ATMOSPHERE_AMOUNT_MIN,
  ZODIACAL_AMOUNT_MAX,
  ZODIACAL_AMOUNT_MIN,
  clampAirglowAmount,
  clampAirglowHue,
  clampAirglowWaves,
  clampAtmosphereAmount,
  clampZodiacalAmount,
} from './skyLighting'
import { ChevronDownIcon, SettingsSlidersIcon } from './psIcons'

type ViewfinderSkyControlProps = {
  atmosphereAmount: number
  airglowAmount: number
  airglowHue: number
  airglowWaves: number
  zodiacalAmount: number
  starMagDepth: number
  starZoomSpan: number
  starBrightness: number
  starGlow: number
  onAtmosphereAmountChange: (value: number) => void
  onAirglowAmountChange: (value: number) => void
  onAirglowHueChange: (value: number) => void
  onAirglowWavesChange: (value: number) => void
  onZodiacalAmountChange: (value: number) => void
  onStarMagDepthChange: (value: number) => void
  onStarZoomSpanChange: (value: number) => void
  onStarBrightnessChange: (value: number) => void
  onStarGlowChange: (value: number) => void
}

/**
 * Compact top-right sky settings — atmosphere, airglow, zodiacal, stars.
 */
export function ViewfinderSkyControl({
  atmosphereAmount,
  airglowAmount,
  airglowHue,
  airglowWaves,
  zodiacalAmount,
  starMagDepth,
  starZoomSpan,
  starBrightness,
  starGlow,
  onAtmosphereAmountChange,
  onAirglowAmountChange,
  onAirglowHueChange,
  onAirglowWavesChange,
  onZodiacalAmountChange,
  onStarMagDepthChange,
  onStarZoomSpanChange,
  onStarBrightnessChange,
  onStarGlowChange,
}: ViewfinderSkyControlProps) {
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
        title="Réglages du ciel"
        onClick={() => setOpen((value) => !value)}
      >
        <SettingsSlidersIcon size={16} />
        <span className="vf-proj-control__muted">Ciel</span>
        <ChevronDownIcon className="vf-proj-control__chevron" size={12} />
      </button>

      {open ? (
        <div
          id={menuId}
          className="vf-landscape-menu"
          role="dialog"
          aria-label="Réglages du ciel"
        >
          <div className="vf-landscape-menu__group">
            <div className="vf-landscape-menu__group-title">Atmosphère</div>
            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Quantité</span>
                <span className="vf-landscape-menu__value">
                  {atmosphereAmount.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={ATMOSPHERE_AMOUNT_MIN}
                max={ATMOSPHERE_AMOUNT_MAX}
                step={0.05}
                value={atmosphereAmount}
                style={rangeProgressStyle(
                  atmosphereAmount,
                  ATMOSPHERE_AMOUNT_MIN,
                  ATMOSPHERE_AMOUNT_MAX,
                )}
                aria-label="Quantité d’atmosphère"
                title="0 = espace / étoiles seules ; 1 = ciel Rayleigh complet"
                onChange={(event) =>
                  onAtmosphereAmountChange(
                    clampAtmosphereAmount(Number(event.target.value)),
                  )
                }
              />
            </label>
          </div>

          <div className="vf-landscape-menu__group">
            <div className="vf-landscape-menu__group-title">Airglow</div>
            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Quantité</span>
                <span className="vf-landscape-menu__value">
                  {airglowAmount.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={AIRGLOW_AMOUNT_MIN}
                max={AIRGLOW_AMOUNT_MAX}
                step={0.05}
                value={airglowAmount}
                style={rangeProgressStyle(
                  airglowAmount,
                  AIRGLOW_AMOUNT_MIN,
                  AIRGLOW_AMOUNT_MAX,
                )}
                aria-label="Quantité d’airglow"
                title="Lueur OI nocturne (en plus de l’atmosphère). Visible la nuit."
                onChange={(event) =>
                  onAirglowAmountChange(
                    clampAirglowAmount(Number(event.target.value)),
                  )
                }
              />
            </label>

            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Teinte</span>
                <span className="vf-landscape-menu__value">
                  {airglowHue < 0.28
                    ? 'Vert'
                    : airglowHue > 0.82
                      ? 'Rouge'
                      : 'Vert + Rouge'}
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range vf-landscape-menu__range--airglow-hue"
                min={AIRGLOW_HUE_MIN}
                max={AIRGLOW_HUE_MAX}
                step={0.05}
                value={airglowHue}
                style={rangeProgressStyle(
                  airglowHue,
                  AIRGLOW_HUE_MIN,
                  AIRGLOW_HUE_MAX,
                )}
                aria-label="Teinte airglow vert, les deux, ou rouge"
                title="Gauche = vert ; milieu = vert et rouge visibles ; droite = rouge"
                onChange={(event) =>
                  onAirglowHueChange(
                    clampAirglowHue(Number(event.target.value)),
                  )
                }
              />
            </label>

            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Structure</span>
                <span className="vf-landscape-menu__value">
                  {airglowWaves < 0.35
                    ? 'Dégradé'
                    : airglowWaves > 0.7
                      ? 'Vagues'
                      : 'Mix'}
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={AIRGLOW_WAVES_MIN}
                max={AIRGLOW_WAVES_MAX}
                step={0.05}
                value={airglowWaves}
                style={rangeProgressStyle(
                  airglowWaves,
                  AIRGLOW_WAVES_MIN,
                  AIRGLOW_WAVES_MAX,
                )}
                aria-label="Structure airglow dégradé à vagues"
                title="0 = dégradé van Rhijn (nuit calme) ; 1 = bandes de vagues de gravité"
                onChange={(event) =>
                  onAirglowWavesChange(
                    clampAirglowWaves(Number(event.target.value)),
                  )
                }
              />
            </label>
          </div>

          <div className="vf-landscape-menu__group">
            <div className="vf-landscape-menu__group-title">
              Lumière zodiacale
            </div>
            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Intensité</span>
                <span className="vf-landscape-menu__value">
                  {zodiacalAmount.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={ZODIACAL_AMOUNT_MIN}
                max={ZODIACAL_AMOUNT_MAX}
                step={0.05}
                value={zodiacalAmount}
                style={rangeProgressStyle(
                  zodiacalAmount,
                  ZODIACAL_AMOUNT_MIN,
                  ZODIACAL_AMOUNT_MAX,
                )}
                aria-label="Intensité de la lumière zodiacale"
                title="Poussière interplanétaire sur l’écliptique : cône crépusculaire, bande, Gegenschein. Visible la nuit."
                onChange={(event) =>
                  onZodiacalAmountChange(
                    clampZodiacalAmount(Number(event.target.value)),
                  )
                }
              />
            </label>
          </div>

          <div className="vf-landscape-menu__group">
            <div className="vf-landscape-menu__group-title">Étoiles</div>
            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Luminosité</span>
                <span className="vf-landscape-menu__value">
                  {starBrightness.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={STAR_BRIGHTNESS_MIN}
                max={STAR_BRIGHTNESS_MAX}
                step={0.05}
                value={starBrightness}
                style={rangeProgressStyle(
                  starBrightness,
                  STAR_BRIGHTNESS_MIN,
                  STAR_BRIGHTNESS_MAX,
                )}
                aria-label="Luminosité des étoiles"
                title="Multiplicateur de luminosité (1 = défaut)"
                onChange={(event) =>
                  onStarBrightnessChange(
                    clampStarBrightness(Number(event.target.value)),
                  )
                }
              />
            </label>

            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Glow</span>
                <span className="vf-landscape-menu__value">
                  {starGlow.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={STAR_GLOW_MIN}
                max={STAR_GLOW_MAX}
                step={0.05}
                value={starGlow}
                style={rangeProgressStyle(
                  starGlow,
                  STAR_GLOW_MIN,
                  STAR_GLOW_MAX,
                )}
                aria-label="Glow des étoiles brillantes"
                title="Halo des grosses étoiles (0 = points secs, 1 = max soft)"
                onChange={(event) =>
                  onStarGlowChange(clampStarGlow(Number(event.target.value)))
                }
              />
            </label>

            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Densité</span>
                <span className="vf-landscape-menu__value">
                  {starMagDepth.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={STAR_MAG_DEPTH_MIN}
                max={STAR_MAG_DEPTH_MAX}
                step={0.05}
                value={starMagDepth}
                style={rangeProgressStyle(
                  starMagDepth,
                  STAR_MAG_DEPTH_MIN,
                  STAR_MAG_DEPTH_MAX,
                )}
                aria-label="Densité d’étoiles du ciel nocturne"
                title="Profondeur magnitude (0 = défaut). Décale grand-angle et zoom ensemble."
                onChange={(event) =>
                  onStarMagDepthChange(
                    clampStarMagDepth(Number(event.target.value)),
                  )
                }
              />
            </label>

            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Gain zoom</span>
                <span className="vf-landscape-menu__value">
                  {starZoomSpan.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={STAR_ZOOM_SPAN_MIN}
                max={STAR_ZOOM_SPAN_MAX}
                step={0.05}
                value={starZoomSpan}
                style={rangeProgressStyle(
                  starZoomSpan,
                  STAR_ZOOM_SPAN_MIN,
                  STAR_ZOOM_SPAN_MAX,
                )}
                aria-label="Gain d’étoiles au zoom"
                title="0 = même densité à tout FOV ; 1 = proportion défaut ; plus de 1 = plus d’étoiles en télé"
                onChange={(event) =>
                  onStarZoomSpanChange(
                    clampStarZoomSpan(Number(event.target.value)),
                  )
                }
              />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  )
}
