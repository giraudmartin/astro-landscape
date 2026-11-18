import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { SettingsSlidersIcon } from './psIcons'
import { ViewfinderFloatPanel } from './ViewfinderFloatPanel'
import {
  applyWeatherCoverPreset,
  clampCloudAltKm,
  clampCloudCoverPct,
  clampCloudDensityPct,
  clampCloudThickKm,
  clampCloudWind,
  getWeatherTotalCloudCoverPct,
  WEATHER_COVER_PRESETS,
  type ViewfinderWeather,
  type WeatherCloudLayer,
} from './viewfinderWeather'

export type WeatherControls = ViewfinderWeather & {
  totalCloudsPct: number
}

type ViewfinderWeatherControlProps = {
  weather: WeatherControls
  manual: ViewfinderWeather
  onWeatherChange: (next: ViewfinderWeather) => void
}

const FLOAT_POS_STORAGE_KEY = 'vf-weather-panel-float-pos'
const DEFAULT_FLOAT_POS = { x: 470, y: 72 }

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

function WeatherSection({
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

function LayerEditor({
  title,
  layer,
  altMin,
  altMax,
  onChange,
}: {
  title: string
  layer: WeatherCloudLayer
  altMin: number
  altMax: number
  onChange: (next: WeatherCloudLayer) => void
}) {
  return (
    <WeatherSection title={title}>
      <label className="vf-landscape-menu__field vf-landscape-menu__field--row">
        <span className="vf-landscape-menu__label">Activer la couche</span>
        <input
          type="checkbox"
          checked={layer.enabled}
          aria-label={`Activer ${title}`}
          onChange={(event) =>
            onChange({ ...layer, enabled: event.target.checked })
          }
        />
      </label>
      <label className="vf-landscape-menu__field">
        <span className="vf-landscape-menu__label">
          <span>Couverture</span>
          <span className="vf-landscape-menu__value">{layer.cover} %</span>
        </span>
        <input
          type="range"
          className="vf-landscape-menu__range"
          min={0}
          max={100}
          step={1}
          value={layer.cover}
          style={rangeProgressStyle(layer.cover, 0, 100)}
          aria-label={`Couverture ${title}`}
          onChange={(event) =>
            onChange({
              ...layer,
              cover: clampCloudCoverPct(Number(event.target.value)),
            })
          }
        />
      </label>
      <label className="vf-landscape-menu__field">
        <span className="vf-landscape-menu__label">
          <span>Altitude de base</span>
          <span className="vf-landscape-menu__value">
            {layer.altKm.toFixed(1)} km
          </span>
        </span>
        <input
          type="range"
          className="vf-landscape-menu__range"
          min={altMin}
          max={altMax}
          step={0.1}
          value={layer.altKm}
          style={rangeProgressStyle(layer.altKm, altMin, altMax)}
          aria-label={`Altitude ${title}`}
          onChange={(event) =>
            onChange({
              ...layer,
              altKm: clampCloudAltKm(Number(event.target.value), altMin, altMax),
            })
          }
        />
      </label>
      <label className="vf-landscape-menu__field">
        <span className="vf-landscape-menu__label">
          <span>Épaisseur</span>
          <span className="vf-landscape-menu__value">
            {layer.thickKm.toFixed(1)} km
          </span>
        </span>
        <input
          type="range"
          className="vf-landscape-menu__range"
          min={0.3}
          max={2}
          step={0.1}
          value={layer.thickKm}
          style={rangeProgressStyle(layer.thickKm, 0.3, 2)}
          aria-label={`Épaisseur ${title}`}
          onChange={(event) =>
            onChange({
              ...layer,
              thickKm: clampCloudThickKm(Number(event.target.value)),
            })
          }
        />
      </label>
      <label className="vf-landscape-menu__field">
        <span className="vf-landscape-menu__label">
          <span>Densité</span>
          <span className="vf-landscape-menu__value">{layer.densityPct} %</span>
        </span>
        <input
          type="range"
          className="vf-landscape-menu__range"
          min={0}
          max={200}
          step={5}
          value={layer.densityPct}
          style={rangeProgressStyle(layer.densityPct, 0, 200)}
          aria-label={`Densité ${title}`}
          onChange={(event) =>
            onChange({
              ...layer,
              densityPct: clampCloudDensityPct(Number(event.target.value)),
            })
          }
        />
      </label>
    </WeatherSection>
  )
}

function WeatherPanelBody({
  manual: base,
  weather,
  onWeatherChange,
}: ViewfinderWeatherControlProps) {
  return (
    <>
      <WeatherSection title="Nuages">
        <label className="vf-landscape-menu__field vf-landscape-menu__field--row">
          <span className="vf-landscape-menu__label">Activer</span>
          <input
            type="checkbox"
            checked={weather.enabled}
            aria-label="Activer les nuages volumétriques"
            onChange={(event) =>
              onWeatherChange({ ...base, enabled: event.target.checked })
            }
          />
        </label>
        <p className="vf-landscape-menu__legend-note">
          Couverture max {weather.totalCloudsPct}% · prototype Chamonix
        </p>
        <div className="vf-landscape-menu__field vf-landscape-menu__field--row">
          {(
            [
              ['clear', 'Dégagé'],
              ['scattered', 'Épars'],
              ['overcast', 'Couvert'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="hud-btn"
              style={{ width: 'auto', minWidth: 0, padding: '4px 8px', fontSize: '0.7rem' }}
              onClick={() =>
                onWeatherChange(applyWeatherCoverPreset(base, key))
              }
            >
              {label}
            </button>
          ))}
        </div>
        <label className="vf-landscape-menu__field vf-landscape-menu__field--row">
          <span className="vf-landscape-menu__label">Suivre Open-Meteo</span>
          <input
            type="checkbox"
            checked={Boolean(weather.followForecast)}
            aria-label="Suivre la prévision Open-Meteo"
            onChange={(event) =>
              onWeatherChange({
                ...base,
                followForecast: event.target.checked,
              })
            }
          />
        </label>
        <label className="vf-landscape-menu__field vf-landscape-menu__field--row">
          <span className="vf-landscape-menu__label">Animer la dérive</span>
          <input
            type="checkbox"
            checked={weather.animateClouds}
            aria-label="Animer la dérive des nuages"
            onChange={(event) =>
              onWeatherChange({
                ...base,
                animateClouds: event.target.checked,
              })
            }
          />
        </label>
        <label className="vf-landscape-menu__field">
          <span className="vf-landscape-menu__label">
            <span>Vent</span>
            <span className="vf-landscape-menu__value">
              {weather.wind.toFixed(1)}×
            </span>
          </span>
          <input
            type="range"
            className="vf-landscape-menu__range"
            min={0}
            max={8}
            step={0.1}
            value={weather.wind}
            style={rangeProgressStyle(weather.wind, 0, 8)}
            aria-label="Vitesse du vent des nuages"
            onChange={(event) =>
              onWeatherChange({
                ...base,
                wind: clampCloudWind(Number(event.target.value)),
              })
            }
          />
        </label>
      </WeatherSection>

      <LayerEditor
        title="Basses · stratus / cumulus"
        layer={weather.low}
        altMin={1.2}
        altMax={3.5}
        onChange={(low) =>
          onWeatherChange({ ...base, followForecast: false, low })
        }
      />
      <LayerEditor
        title="Moyennes · altocumulus"
        layer={weather.mid}
        altMin={3.6}
        altMax={6}
        onChange={(mid) =>
          onWeatherChange({ ...base, followForecast: false, mid })
        }
      />
      <LayerEditor
        title="Hautes · cirrus"
        layer={weather.high}
        altMin={6.1}
        altMax={9}
        onChange={(high) =>
          onWeatherChange({ ...base, followForecast: false, high })
        }
      />
    </>
  )
}

export function ViewfinderWeatherControl(props: ViewfinderWeatherControlProps) {
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
        title="Réglages météo"
        onClick={() => setOpen((value) => !value)}
      >
        <SettingsSlidersIcon size={16} />
        <span className="vf-proj-control__muted">Météo</span>
      </button>

      <ViewfinderFloatPanel
        open={open}
        onClose={() => setOpen(false)}
        title="Météo"
        storageKey={FLOAT_POS_STORAGE_KEY}
        defaultPos={DEFAULT_FLOAT_POS}
        triggerRef={rootRef}
      >
        <WeatherPanelBody {...props} />
      </ViewfinderFloatPanel>
    </div>
  )
}

export function weatherControlsFromSettings(
  settings: ViewfinderWeather,
): WeatherControls {
  return {
    ...settings,
    totalCloudsPct: getWeatherTotalCloudCoverPct(settings),
  }
}

// Silence unused preset map warning in some bundlers.
void WEATHER_COVER_PRESETS
