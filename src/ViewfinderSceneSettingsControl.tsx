import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDownIcon, SettingsSlidersIcon } from './psIcons'
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
import type { ViewfinderWeather } from './viewfinderWeather'

type ScenePanelId = 'landscape' | 'sky' | 'weather'

type ViewfinderSceneSettingsControlProps = {
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
}

const PANEL_ITEMS: ReadonlyArray<{
  id: ScenePanelId
  label: string
  hint: string
}> = [
  {
    id: 'landscape',
    label: 'Paysage',
    hint: 'Luminosité, contraste, température, teinte',
  },
  {
    id: 'sky',
    label: 'Ciel',
    hint: 'Atmosphère, étoiles, pollution',
  },
  {
    id: 'weather',
    label: 'Météo',
    hint: 'Nuages et couverture',
  },
]

/**
 * Single Réglages trigger → menu card with Paysage / Ciel / Météo, each
 * opening the existing floating settings panel.
 */
export function ViewfinderSceneSettingsControl({
  landscape,
  sky,
  weather,
}: ViewfinderSceneSettingsControlProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [panel, setPanel] = useState<ScenePanelId | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()
  const anyPanelOpen = panel != null

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (rootRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const openPanel = (id: ScenePanelId) => {
    setPanel(id)
    setMenuOpen(false)
  }

  return (
    <div
      ref={rootRef}
      className={
        menuOpen || anyPanelOpen
          ? 'vf-proj-control is-open'
          : 'vf-proj-control'
      }
    >
      <button
        type="button"
        className={
          menuOpen || anyPanelOpen
            ? 'vf-proj-control__trigger is-active'
            : 'vf-proj-control__trigger'
        }
        aria-expanded={menuOpen}
        aria-controls={menuId}
        aria-haspopup="menu"
        title="Réglages scène"
        onClick={() => setMenuOpen((value) => !value)}
      >
        <SettingsSlidersIcon size={16} />
        <span className="vf-proj-control__muted">Réglages</span>
        <ChevronDownIcon className="vf-proj-control__chevron" size={12} />
      </button>

      {menuOpen ? (
        <div
          id={menuId}
          className="vf-proj-control__menu"
          role="menu"
          aria-label="Réglages scène"
        >
          {PANEL_ITEMS.map(({ id, label, hint }) => {
            const selected = panel === id
            return (
              <button
                key={id}
                type="button"
                role="menuitem"
                className={
                  selected
                    ? 'vf-proj-control__option is-active'
                    : 'vf-proj-control__option'
                }
                title={hint}
                onClick={() => openPanel(id)}
              >
                <span className="vf-proj-control__option-copy">
                  <b>{label}</b>
                  <small>{hint}</small>
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

      <ViewfinderLandscapeControl
        {...landscape}
        open={panel === 'landscape'}
        onOpenChange={(next) => setPanel(next ? 'landscape' : null)}
        showTrigger={false}
        anchorRef={rootRef}
      />
      <ViewfinderSkyControl
        {...sky}
        open={panel === 'sky'}
        onOpenChange={(next) => setPanel(next ? 'sky' : null)}
        showTrigger={false}
        anchorRef={rootRef}
      />
      <ViewfinderWeatherControl
        {...weather}
        open={panel === 'weather'}
        onOpenChange={(next) => setPanel(next ? 'weather' : null)}
        showTrigger={false}
        anchorRef={rootRef}
      />
    </div>
  )
}
