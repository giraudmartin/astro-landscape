import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useT } from './i18n'
import {
  ChevronRightIcon,
  SettingsSlidersIcon,
} from './psIcons'
import {
  ViewfinderLandscapeControl,
} from './ViewfinderLandscapeControl'
import {
  ViewfinderSkyControl,
  type LocalHaloControls,
} from './ViewfinderSkyControl'
import {
  ViewfinderWeatherControl,
  type WeatherControls,
} from './ViewfinderWeatherControl'
import { ViewfinderQualityControl } from './ViewfinderQualityControl'
import { ViewfinderMilkyWayNebControl } from './ViewfinderMilkyWayNebControl'
import {
  clearFloatPos,
  SCENE_SETTINGS_FLOAT_DEFAULT_POS,
  SCENE_SETTINGS_FLOAT_STORAGE_KEY,
  ViewfinderFloatPanel,
} from './ViewfinderFloatPanel'
import type { MilkyWayNebLook } from './milkyWayNebLook'
import type { ViewfinderWeather } from './viewfinderWeather'
import type { TerrainQuality } from './terrainQuality'
import {
  CLOSE_CELESTIAL_SEARCH_EVENT,
  OPEN_SCENE_PANEL_EVENT,
  type ImmersiveScenePanelId,
} from './onboarding/immersiveTourUi'

type ScenePanelId =
  | 'landscape'
  | 'sky'
  | 'weather'
  | 'quality'
  /** Temporary A/B grade for enhanced milky-way tiles. */
  | 'milkyWayNeb'

type ViewfinderSceneSettingsControlProps = {
  /** Sky-flat / sans DEM — Qualité, Paysage, and local-halo controls are hidden. */
  flatTerrain?: boolean
  quality: {
    value: TerrainQuality
    onChange: (quality: TerrainQuality) => void
  }
  landscape: {
    brightness: number
    contrast: number
    temperature: number
    tint: number
    onBrightnessChange: (value: number) => void
    onContrastChange: (value: number) => void
    onTemperatureChange: (value: number) => void
    onTintChange: (value: number) => void
  }
  sky: {
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
  }
  weather: {
    weather: WeatherControls
    manual: ViewfinderWeather
    onWeatherChange: (next: ViewfinderWeather) => void
  }
  /** Temporary enhanced-VL grade card (omit to hide the menu entry). */
  milkyWayNeb?: {
    look: MilkyWayNebLook
    onChange: (patch: Partial<MilkyWayNebLook>) => void
    onReset: () => void
  }
  /** Icon-only trigger (no chevron) for the compact phone top bar. */
  iconOnly?: boolean
}

const PANEL_IDS: ReadonlyArray<ScenePanelId> = [
  'quality',
  'landscape',
  'sky',
  'milkyWayNeb',
  'weather',
]

const TOUR_ANCHOR: Partial<Record<ScenePanelId, string>> = {
  quality: 'vf-float-quality',
  sky: 'vf-float-sky',
  weather: 'vf-float-weather',
}

/**
 * Single Réglages trigger → one floating panel (menu or category), like proto 01.
 */
export function ViewfinderSceneSettingsControl({
  flatTerrain = false,
  quality,
  landscape,
  sky,
  weather,
  milkyWayNeb,
  iconOnly: _iconOnly = false,
}: ViewfinderSceneSettingsControlProps) {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const [panel, setPanel] = useState<ScenePanelId | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuListRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()
  const visiblePanelIds = (
    flatTerrain
      ? PANEL_IDS.filter((id) => id !== 'landscape' && id !== 'quality')
      : PANEL_IDS
  ).filter((id) => id !== 'milkyWayNeb' || milkyWayNeb != null)
  const chromeOpen = menuOpen || panel != null
  const showingMenu = chromeOpen && panel == null

  const closeAll = useCallback(() => {
    clearFloatPos(SCENE_SETTINGS_FLOAT_STORAGE_KEY)
    setPanel(null)
    setMenuOpen(false)
  }, [])

  const backToMenu = useCallback(() => {
    setPanel(null)
    setMenuOpen(true)
  }, [])

  useEffect(() => {
    if (
      flatTerrain &&
      (panel === 'landscape' || panel === 'quality')
    ) {
      setPanel(null)
    }
  }, [flatTerrain, panel])

  useEffect(() => {
    if (!milkyWayNeb && panel === 'milkyWayNeb') setPanel(null)
  }, [milkyWayNeb, panel])

  useEffect(() => {
    const onOpen = (event: Event) => {
      const next = (event as CustomEvent<{ panel: ImmersiveScenePanelId | null }>)
        .detail?.panel
      if (next === undefined) return
      if (next == null) {
        clearFloatPos(SCENE_SETTINGS_FLOAT_STORAGE_KEY)
        setPanel(null)
        setMenuOpen(false)
        return
      }
      if (flatTerrain && next === 'quality') {
        setPanel(null)
        return
      }
      setMenuOpen(false)
      setPanel(next)
    }
    window.addEventListener(OPEN_SCENE_PANEL_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_SCENE_PANEL_EVENT, onOpen)
  }, [flatTerrain])

  useEffect(() => {
    if (!chromeOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (rootRef.current?.contains(target)) return
      if (target.closest('[data-scene-settings-panel]')) return
      // Immersive tour opens quality/sky/weather via events — do not dismiss
      // those panels when the coach card / scrim receives the click.
      if (target.closest('.onboarding-tour-root')) return
      closeAll()
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [chromeOpen, closeAll])

  useEffect(() => {
    if (!showingMenu) return
    const first = menuListRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"]',
    )
    first?.focus()
  }, [showingMenu])

  const openPanel = (id: ScenePanelId) => {
    setPanel(id)
    setMenuOpen(true)
  }

  const toggleChrome = () => {
    if (chromeOpen) {
      closeAll()
      triggerRef.current?.focus()
      return
    }
    // Close celestial search so the two popovers never stack on the tools.
    window.dispatchEvent(new Event(CLOSE_CELESTIAL_SEARCH_EVENT))
    setMenuOpen(true)
    setPanel(null)
  }

  const panelTitle =
    panel == null
      ? t('viewfinder.scene.title')
      : t(`viewfinder.scene.${panel}`)

  return (
    <div
      ref={rootRef}
      className={chromeOpen ? 'vf-proj-control is-open' : 'vf-proj-control'}
    >
      <button
        ref={triggerRef}
        type="button"
        data-tour-anchor="vf-scene"
        className={
          chromeOpen
            ? 'vf-proj-control__trigger is-active'
            : 'vf-proj-control__trigger'
        }
        aria-expanded={chromeOpen}
        aria-controls={menuId}
        aria-haspopup="dialog"
        aria-label={t('viewfinder.scene.title')}
        title={t('viewfinder.scene.title')}
        onClick={toggleChrome}
      >
        <SettingsSlidersIcon size={16} />
      </button>

      <ViewfinderFloatPanel
        open={chromeOpen}
        onClose={() => {
          closeAll()
          triggerRef.current?.focus()
        }}
        onBack={panel != null ? backToMenu : undefined}
        title={panelTitle}
        storageKey={SCENE_SETTINGS_FLOAT_STORAGE_KEY}
        defaultPos={SCENE_SETTINGS_FLOAT_DEFAULT_POS}
        triggerRef={rootRef}
        tourAnchor={panel ? TOUR_ANCHOR[panel] : undefined}
        panelDataAttrs={{ 'data-scene-settings-panel': '' }}
      >
        {showingMenu ? (
          <div
            id={menuId}
            ref={menuListRef}
            className="vf-proj-control__menu-list vf-proj-control__menu-list--embedded"
            role="menu"
            aria-label={t('viewfinder.scene.title')}
          >
            {visiblePanelIds.map((id) => {
              const label = t(`viewfinder.scene.${id}`)
              const hint = t(`viewfinder.scene.${id}Hint`)
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  className="vf-proj-control__option"
                  title={hint}
                  onClick={() => openPanel(id)}
                >
                  <span className="vf-proj-control__option-copy">
                    <b>{label}</b>
                    <small>{hint}</small>
                  </span>
                  <ChevronRightIcon
                    className="vf-proj-control__option-chevron"
                    size={16}
                  />
                </button>
              )
            })}
          </div>
        ) : null}

        {!flatTerrain ? (
          <ViewfinderQualityControl
            quality={quality.value}
            onQualityChange={quality.onChange}
            open={panel === 'quality'}
            embed
          />
        ) : null}
        {!flatTerrain ? (
          <ViewfinderLandscapeControl
            {...landscape}
            open={panel === 'landscape'}
            embed
          />
        ) : null}
        <ViewfinderSkyControl
          {...sky}
          flatTerrain={flatTerrain}
          open={panel === 'sky'}
          embed
        />
        {milkyWayNeb ? (
          <ViewfinderMilkyWayNebControl
            look={milkyWayNeb.look}
            onChange={milkyWayNeb.onChange}
            onReset={milkyWayNeb.onReset}
            open={panel === 'milkyWayNeb'}
            embed
          />
        ) : null}
        <ViewfinderWeatherControl
          {...weather}
          open={panel === 'weather'}
          embed
        />
      </ViewfinderFloatPanel>
    </div>
  )
}
