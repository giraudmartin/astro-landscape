import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
  LIGHT_POLLUTION_AMOUNT_MAX,
  LIGHT_POLLUTION_AMOUNT_MIN,
  ZODIACAL_AMOUNT_MAX,
  ZODIACAL_AMOUNT_MIN,
  clampAirglowAmount,
  clampAirglowHue,
  clampAirglowWaves,
  clampAtmosphereAmount,
  clampLightPollutionAmount,
  clampZodiacalAmount,
} from './skyLighting'
import { SettingsSlidersIcon } from './psIcons'
import { ViewfinderFloatPanel } from './ViewfinderFloatPanel'
import {
  clampLocalHaloHaze,
  clampLocalHaloHeightKm,
  clampLocalHaloIntensity,
  clampLocalHaloTempK,
  clampLocalHaloViirsOpacity,
  LOCAL_HALO_HAZE_MAX,
  LOCAL_HALO_HAZE_MIN,
  LOCAL_HALO_HEIGHT_KM_MAX,
  LOCAL_HALO_HEIGHT_KM_MIN,
  LOCAL_HALO_INTENSITY_MAX,
  LOCAL_HALO_INTENSITY_MIN,
  LOCAL_HALO_TEMP_K_MAX,
  LOCAL_HALO_TEMP_K_MIN,
  LOCAL_HALO_VIIRS_OPACITY_MAX,
  LOCAL_HALO_VIIRS_OPACITY_MIN,
} from './lightPollution/localHalo/localHaloSettings'

export type LocalHaloControls = {
  enabled: boolean
  blocking: boolean
  intensity: number
  heightKm: number
  haze: number
  tempK: number
  viirsGround: boolean
  viirsOpacity: number
}

type ViewfinderSkyControlProps = {
  atmosphereAmount: number
  airglowAmount: number
  airglowHue: number
  airglowWaves: number
  zodiacalAmount: number
  lightPollutionAmount: number
  localHalo: LocalHaloControls
  starMagDepth: number
  starZoomSpan: number
  starBrightness: number
  starGlow: number
  onAtmosphereAmountChange: (value: number) => void
  onAirglowAmountChange: (value: number) => void
  onAirglowHueChange: (value: number) => void
  onAirglowWavesChange: (value: number) => void
  onZodiacalAmountChange: (value: number) => void
  onLightPollutionAmountChange: (value: number) => void
  onLocalHaloChange: (patch: Partial<LocalHaloControls>) => void
  onStarMagDepthChange: (value: number) => void
  onStarZoomSpanChange: (value: number) => void
  onStarBrightnessChange: (value: number) => void
  onStarGlowChange: (value: number) => void
}

const FLOAT_POS_STORAGE_KEY = 'vf-sky-panel-float-pos'
const DEFAULT_FLOAT_POS = { x: 330, y: 72 }

function rangeProgressStyle(
  value: number,
  min: number,
  max: number,
): CSSProperties {
  const span = max - min
  const pct = span <= 0 ? 0 : ((value - min) / span) * 100
  return {
    ['--range-progress' as string]: `${Math.min(100, Math.max(0, pct))}%`,
  }
}

function SkySection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="vf-sky-panel__section">
      <h3 className="vf-sky-panel__section-title">{title}</h3>
      <div className="vf-sky-panel__section-body">{children}</div>
    </section>
  )
}

type SkyPanelBodyProps = ViewfinderSkyControlProps

function SkyPanelBody({
  atmosphereAmount,
  airglowAmount,
  airglowHue,
  airglowWaves,
  zodiacalAmount,
  lightPollutionAmount,
  localHalo,
  starMagDepth,
  starZoomSpan,
  starBrightness,
  starGlow,
  onAtmosphereAmountChange,
  onAirglowAmountChange,
  onAirglowHueChange,
  onAirglowWavesChange,
  onZodiacalAmountChange,
  onLightPollutionAmountChange,
  onLocalHaloChange,
  onStarMagDepthChange,
  onStarZoomSpanChange,
  onStarBrightnessChange,
  onStarGlowChange,
}: SkyPanelBodyProps) {
  const showAirglowDetails = airglowAmount > 0.001
  const showHaloDetails = localHalo.enabled

  return (
    <>
      <SkySection title="Ciel">
        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>Atmosphère</span>
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

        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>Airglow</span>
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

        {showAirglowDetails ? (
          <>
            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Teinte airglow</span>
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
                <span>Structure airglow</span>
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
          </>
        ) : null}

        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>Lumière zodiacale</span>
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
      </SkySection>

      <SkySection title="Pollution">
        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>Intensité</span>
            <span className="vf-landscape-menu__value">
              {lightPollutionAmount.toFixed(2)}
            </span>
          </span>
          <input
            type="range"
            className="vf-landscape-menu__range"
            min={LIGHT_POLLUTION_AMOUNT_MIN}
            max={LIGHT_POLLUTION_AMOUNT_MAX}
            step={0.05}
            value={lightPollutionAmount}
            style={rangeProgressStyle(
              lightPollutionAmount,
              LIGHT_POLLUTION_AMOUNT_MIN,
              LIGHT_POLLUTION_AMOUNT_MAX,
            )}
            aria-label="Intensité de la pollution lumineuse"
            title="Dôme de pollution directionnel (plus clair vers les villes à l’horizon). 0 = ciel propre ; 1 = effet max. Visible la nuit."
            onChange={(event) =>
              onLightPollutionAmountChange(
                clampLightPollutionAmount(Number(event.target.value)),
              )
            }
          />
        </label>

        <label className="vf-landscape-menu__field vf-landscape-menu__field--row">
          <span className="vf-landscape-menu__label">
            <span>Halos locaux</span>
          </span>
          <input
            type="checkbox"
            checked={localHalo.enabled}
            title="Lumière VIIRS diffusée dans l’air au-dessus des émissions (zone 24 × 24 km). Visible la nuit."
            onChange={(event) =>
              onLocalHaloChange({ enabled: event.target.checked })
            }
          />
        </label>

        {showHaloDetails ? (
          <>
            <label className="vf-landscape-menu__field vf-landscape-menu__field--row">
              <span className="vf-landscape-menu__label">
                <span>Le relief fait écran</span>
              </span>
              <input
                type="checkbox"
                checked={localHalo.blocking}
                title="Les crêtes cachent les émissions à l’air situé derrière elles."
                onChange={(event) =>
                  onLocalHaloChange({ blocking: event.target.checked })
                }
              />
            </label>
            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Intensité halo</span>
                <span className="vf-landscape-menu__value">
                  {Math.round(localHalo.intensity * 100)} %
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={LOCAL_HALO_INTENSITY_MIN}
                max={LOCAL_HALO_INTENSITY_MAX}
                step={0.01}
                value={localHalo.intensity}
                style={rangeProgressStyle(
                  localHalo.intensity,
                  LOCAL_HALO_INTENSITY_MIN,
                  LOCAL_HALO_INTENSITY_MAX,
                )}
                aria-label="Intensité des halos locaux"
                onChange={(event) =>
                  onLocalHaloChange({
                    intensity: clampLocalHaloIntensity(
                      Number(event.target.value),
                    ),
                  })
                }
              />
            </label>
            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Hauteur du halo</span>
                <span className="vf-landscape-menu__value">
                  {localHalo.heightKm.toFixed(1)} km
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={LOCAL_HALO_HEIGHT_KM_MIN}
                max={LOCAL_HALO_HEIGHT_KM_MAX}
                step={0.1}
                value={localHalo.heightKm}
                style={rangeProgressStyle(
                  localHalo.heightKm,
                  LOCAL_HALO_HEIGHT_KM_MIN,
                  LOCAL_HALO_HEIGHT_KM_MAX,
                )}
                aria-label="Hauteur des halos locaux"
                onChange={(event) =>
                  onLocalHaloChange({
                    heightKm: clampLocalHaloHeightKm(
                      Number(event.target.value),
                    ),
                  })
                }
              />
            </label>
            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Brume</span>
                <span className="vf-landscape-menu__value">
                  {Math.round(localHalo.haze * 100)} %
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={LOCAL_HALO_HAZE_MIN}
                max={LOCAL_HALO_HAZE_MAX}
                step={0.01}
                value={localHalo.haze}
                style={rangeProgressStyle(
                  localHalo.haze,
                  LOCAL_HALO_HAZE_MIN,
                  LOCAL_HALO_HAZE_MAX,
                )}
                aria-label="Brume des halos locaux"
                onChange={(event) =>
                  onLocalHaloChange({
                    haze: clampLocalHaloHaze(Number(event.target.value)),
                  })
                }
              />
            </label>
            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Teinte</span>
                <span className="vf-landscape-menu__value">
                  {Math.round(localHalo.tempK)} K
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={LOCAL_HALO_TEMP_K_MIN}
                max={LOCAL_HALO_TEMP_K_MAX}
                step={100}
                value={localHalo.tempK}
                style={rangeProgressStyle(
                  localHalo.tempK,
                  LOCAL_HALO_TEMP_K_MIN,
                  LOCAL_HALO_TEMP_K_MAX,
                )}
                aria-label="Teinte des halos locaux"
                title="Réglage artistique de couleur, pas une conversion physique."
                onChange={(event) =>
                  onLocalHaloChange({
                    tempK: clampLocalHaloTempK(Number(event.target.value)),
                  })
                }
              />
            </label>
          </>
        ) : null}
      </SkySection>

      <SkySection title="Étoiles">
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
            style={rangeProgressStyle(starGlow, STAR_GLOW_MIN, STAR_GLOW_MAX)}
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
      </SkySection>

      <SkySection title="Diagnostic">
        <label className="vf-landscape-menu__field vf-landscape-menu__field--row">
          <span className="vf-landscape-menu__label">
            <span>VIIRS au sol</span>
          </span>
          <input
            type="checkbox"
            checked={localHalo.viirsGround}
            title="Pixels VIIRS natifs sur le relief (diagnostic) — survol : radiance en nW/cm²/sr."
            onChange={(event) =>
              onLocalHaloChange({ viirsGround: event.target.checked })
            }
          />
        </label>
        {localHalo.viirsGround ? (
          <>
            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>Opacité VIIRS</span>
                <span className="vf-landscape-menu__value">
                  {Math.round(localHalo.viirsOpacity * 100)} %
                </span>
              </span>
              <input
                type="range"
                className="vf-landscape-menu__range"
                min={LOCAL_HALO_VIIRS_OPACITY_MIN}
                max={LOCAL_HALO_VIIRS_OPACITY_MAX}
                step={0.01}
                value={localHalo.viirsOpacity}
                style={rangeProgressStyle(
                  localHalo.viirsOpacity,
                  LOCAL_HALO_VIIRS_OPACITY_MIN,
                  LOCAL_HALO_VIIRS_OPACITY_MAX,
                )}
                aria-label="Opacité de la couche VIIRS au sol"
                onChange={(event) =>
                  onLocalHaloChange({
                    viirsOpacity: clampLocalHaloViirsOpacity(
                      Number(event.target.value),
                    ),
                  })
                }
              />
            </label>
            <div className="vf-landscape-menu__legend">
              <div className="vf-landscape-menu__legend-ramp" />
              <p className="vf-landscape-menu__legend-note">
                0,5 → 1 → 5 → 10 → 35 nW/cm²/sr · échelle log · pixels natifs
                <br />
                Gris sombre : zéro · gris clair : sans données
              </p>
            </div>
          </>
        ) : null}
      </SkySection>
    </>
  )
}

/**
 * Sky settings — floating, draggable, semi-transparent window.
 */
export function ViewfinderSkyControl(props: ViewfinderSkyControlProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

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
        aria-haspopup="dialog"
        title="Réglages du ciel"
        onClick={() => setOpen((value) => !value)}
      >
        <SettingsSlidersIcon size={16} />
        <span className="vf-proj-control__muted">Ciel</span>
      </button>

      <ViewfinderFloatPanel
        open={open}
        onClose={() => setOpen(false)}
        title="Ciel"
        storageKey={FLOAT_POS_STORAGE_KEY}
        defaultPos={DEFAULT_FLOAT_POS}
        triggerRef={rootRef}
      >
        <SkyPanelBody {...props} />
      </ViewfinderFloatPanel>
    </div>
  )
}
