import {
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
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
import { useT } from './i18n'
import { SettingsSlidersIcon } from './psIcons'
import { ViewfinderFloatPanel } from './ViewfinderFloatPanel'
import {
  clampLocalHaloHaze,
  clampLocalHaloHeightKm,
  clampLocalHaloIntensity,
  clampLocalHaloTempK,
  LOCAL_HALO_HAZE_MAX,
  LOCAL_HALO_HAZE_MIN,
  LOCAL_HALO_HEIGHT_KM_MAX,
  LOCAL_HALO_HEIGHT_KM_MIN,
  LOCAL_HALO_INTENSITY_MAX,
  LOCAL_HALO_INTENSITY_MIN,
  LOCAL_HALO_TEMP_K_MAX,
  LOCAL_HALO_TEMP_K_MIN,
} from './lightPollution/localHalo/localHaloSettings'

export type LocalHaloControls = {
  enabled: boolean
  intensity: number
  heightKm: number
  haze: number
  tempK: number
  viirsGround: boolean
  viirsOpacity: number
}

type ViewfinderSkyControlProps = {
  /** Sky-flat / sans DEM — local-halo controls (relief-screened) are hidden. */
  flatTerrain?: boolean
  atmosphereAmount: number
  moonlightEnabled: boolean
  onMoonlightChange: (enabled: boolean) => void
  showTrajectories: boolean
  onShowTrajectoriesChange: (enabled: boolean) => void
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
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onBack?: () => void
  showTrigger?: boolean
  anchorRef?: RefObject<HTMLElement | null>
  floatStorageKey?: string
  floatDefaultPos?: { x: number; y: number }
  embed?: boolean
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

type SkyPanelBodyProps = Omit<
  ViewfinderSkyControlProps,
  | 'open'
  | 'onOpenChange'
  | 'onBack'
  | 'showTrigger'
  | 'anchorRef'
  | 'floatStorageKey'
  | 'floatDefaultPos'
  | 'embed'
>

function SkyPanelBody({
  flatTerrain = false,
  atmosphereAmount,
  moonlightEnabled,
  onMoonlightChange,
  showTrajectories,
  onShowTrajectoriesChange,
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
  const t = useT()
  const showAirglowDetails = airglowAmount > 0.001
  const showHaloDetails = !flatTerrain && localHalo.enabled

  return (
    <>
      <SkySection title={t('viewfinder.sky.section.sky')}>
        <label className="vf-landscape-menu__field vf-landscape-menu__field--row">
          <span className="vf-landscape-menu__label">
            {t('viewfinder.sky.moonlight')}
          </span>
          <input type="checkbox" checked={moonlightEnabled}
            onChange={(event) => onMoonlightChange(event.target.checked)}
            title={t('viewfinder.sky.moonlightTip')} />
        </label>
        <label className="vf-landscape-menu__field vf-landscape-menu__field--row">
          <span className="vf-landscape-menu__label">
            {t('viewfinder.sky.trajectories')}
          </span>
          <input
            type="checkbox"
            checked={showTrajectories}
            onChange={(event) => onShowTrajectoriesChange(event.target.checked)}
            title={t('viewfinder.sky.trajectoriesTip')}
          />
        </label>
        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>{t('viewfinder.sky.atmosphere')}</span>
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
            aria-label={t('viewfinder.sky.atmosphereAria')}
            title={t('viewfinder.sky.atmosphereTip')}
            onChange={(event) =>
              onAtmosphereAmountChange(
                clampAtmosphereAmount(Number(event.target.value)),
              )
            }
          />
        </label>

        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>{t('viewfinder.sky.airglow')}</span>
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
            aria-label={t('viewfinder.sky.airglowAria')}
            title={t('viewfinder.sky.airglowTip')}
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
                <span>{t('viewfinder.sky.airglowHue')}</span>
                <span className="vf-landscape-menu__value">
                  {airglowHue < 0.28
                    ? t('viewfinder.sky.hue.green')
                    : airglowHue > 0.82
                      ? t('viewfinder.sky.hue.red')
                      : t('viewfinder.sky.hue.both')}
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
                aria-label={t('viewfinder.sky.airglowHueAria')}
                title={t('viewfinder.sky.airglowHueTip')}
                onChange={(event) =>
                  onAirglowHueChange(
                    clampAirglowHue(Number(event.target.value)),
                  )
                }
              />
            </label>

            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>{t('viewfinder.sky.airglowStruct')}</span>
                <span className="vf-landscape-menu__value">
                  {airglowWaves < 0.35
                    ? t('viewfinder.sky.struct.gradient')
                    : airglowWaves > 0.7
                      ? t('viewfinder.sky.struct.waves')
                      : t('viewfinder.sky.struct.mix')}
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
                aria-label={t('viewfinder.sky.airglowStructAria')}
                title={t('viewfinder.sky.airglowStructTip')}
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
            <span>{t('viewfinder.sky.zodiacal')}</span>
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
            aria-label={t('viewfinder.sky.zodiacalAria')}
            title={t('viewfinder.sky.zodiacalTip')}
            onChange={(event) =>
              onZodiacalAmountChange(
                clampZodiacalAmount(Number(event.target.value)),
              )
            }
          />
        </label>
      </SkySection>

      <SkySection title={t('viewfinder.sky.section.pollution')}>
        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>{t('viewfinder.sky.pollutionIntensity')}</span>
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
            aria-label={t('viewfinder.sky.pollutionAria')}
            title={t('viewfinder.sky.pollutionTip')}
            onChange={(event) =>
              onLightPollutionAmountChange(
                clampLightPollutionAmount(Number(event.target.value)),
              )
            }
          />
        </label>

        {!flatTerrain ? (
          <label className="vf-landscape-menu__field vf-landscape-menu__field--row">
            <span className="vf-landscape-menu__label">
              <span>{t('viewfinder.sky.localHalos')}</span>
            </span>
            <input
              type="checkbox"
              checked={localHalo.enabled}
              title={t('viewfinder.sky.localHalosTip')}
              onChange={(event) =>
                onLocalHaloChange({ enabled: event.target.checked })
              }
            />
          </label>
        ) : null}

        {showHaloDetails ? (
          <>
            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>{t('viewfinder.sky.haloIntensity')}</span>
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
                aria-label={t('viewfinder.sky.haloIntensityAria')}
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
                <span>{t('viewfinder.sky.haloHeight')}</span>
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
                aria-label={t('viewfinder.sky.haloHeightAria')}
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
                <span>{t('viewfinder.sky.haze')}</span>
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
                aria-label={t('viewfinder.sky.hazeAria')}
                onChange={(event) =>
                  onLocalHaloChange({
                    haze: clampLocalHaloHaze(Number(event.target.value)),
                  })
                }
              />
            </label>
            <label className="vf-landscape-menu__field">
              <span className="vf-landscape-menu__label">
                <span>{t('viewfinder.sky.haloTint')}</span>
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
                aria-label={t('viewfinder.sky.haloTintAria')}
                title={t('viewfinder.sky.haloTintTip')}
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

      <SkySection title={t('viewfinder.sky.section.stars')}>
        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>{t('viewfinder.sky.starBrightness')}</span>
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
            aria-label={t('viewfinder.sky.starBrightnessAria')}
            title={t('viewfinder.sky.starBrightnessTip')}
            onChange={(event) =>
              onStarBrightnessChange(
                clampStarBrightness(Number(event.target.value)),
              )
            }
          />
        </label>

        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>{t('viewfinder.sky.starGlow')}</span>
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
            aria-label={t('viewfinder.sky.starGlowAria')}
            title={t('viewfinder.sky.starGlowTip')}
            onChange={(event) =>
              onStarGlowChange(clampStarGlow(Number(event.target.value)))
            }
          />
        </label>

        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>{t('viewfinder.sky.starDensity')}</span>
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
            aria-label={t('viewfinder.sky.starDensityAria')}
            title={t('viewfinder.sky.starDensityTip')}
            onChange={(event) =>
              onStarMagDepthChange(
                clampStarMagDepth(Number(event.target.value)),
              )
            }
          />
        </label>

        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>{t('viewfinder.sky.starZoomGain')}</span>
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
            aria-label={t('viewfinder.sky.starZoomGainAria')}
            title={t('viewfinder.sky.starZoomGainTip')}
            onChange={(event) =>
              onStarZoomSpanChange(
                clampStarZoomSpan(Number(event.target.value)),
              )
            }
          />
        </label>
      </SkySection>

    </>
  )
}

/**
 * Sky settings — floating, draggable, semi-transparent window.
 */
export function ViewfinderSkyControl(props: ViewfinderSkyControlProps) {
  const {
    open: openProp,
    onOpenChange,
    onBack,
    showTrigger = true,
    anchorRef,
    floatStorageKey,
    floatDefaultPos,
    embed = false,
    ...panelProps
  } = props
  const t = useT()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = openProp ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelAnchor = anchorRef ?? rootRef

  if (embed) return open ? <SkyPanelBody {...panelProps} /> : null

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
          title={t('viewfinder.sky.settingsTitle')}
          onClick={() => setOpen(!open)}
        >
          <SettingsSlidersIcon size={16} />
          <span className="vf-proj-control__muted">
            {t('viewfinder.sky.title')}
          </span>
        </button>
      ) : null}

      <ViewfinderFloatPanel
        open={open}
        onClose={() => setOpen(false)}
        onBack={onBack}
        title={t('viewfinder.sky.title')}
        storageKey={floatStorageKey ?? FLOAT_POS_STORAGE_KEY}
        defaultPos={floatDefaultPos ?? DEFAULT_FLOAT_POS}
        triggerRef={panelAnchor}
        tourAnchor="vf-float-sky"
      >
        <SkyPanelBody {...panelProps} />
      </ViewfinderFloatPanel>
    </div>
  )
}
