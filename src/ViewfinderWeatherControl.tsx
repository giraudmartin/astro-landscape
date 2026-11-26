import {
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { useT } from './i18n'
import { SettingsSlidersIcon } from './psIcons'
import { ViewfinderFloatPanel } from './ViewfinderFloatPanel'
import {
  clampCloudAltKm,
  clampCloudCoverPct,
  clampCloudDensityPct,
  clampCloudThickKm,
  clampCloudWind,
  getWeatherTotalCloudCoverPct,
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
  open?: boolean
  onOpenChange?: (open: boolean) => void
  showTrigger?: boolean
  anchorRef?: RefObject<HTMLElement | null>
}

const FLOAT_POS_STORAGE_KEY = 'vf-weather-panel-float-pos'
/** Prefer right side so tour coach cards can sit bottom-left. */
const DEFAULT_FLOAT_POS = { x: 520, y: 56 }

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
  const t = useT()
  return (
    <WeatherSection title={title}>
      <label className="vf-landscape-menu__field vf-landscape-menu__field--row">
        <span className="vf-landscape-menu__label">
          {t('viewfinder.weather.layerEnable')}
        </span>
        <input
          type="checkbox"
          checked={layer.enabled}
          aria-label={t('viewfinder.weather.layerEnableAria', { title })}
          onChange={(event) =>
            onChange({ ...layer, enabled: event.target.checked })
          }
        />
      </label>
      <label className="vf-landscape-menu__field">
        <span className="vf-landscape-menu__label">
          <span>{t('viewfinder.weather.cover')}</span>
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
          aria-label={t('viewfinder.weather.coverAria', { title })}
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
          <span>{t('viewfinder.weather.baseAlt')}</span>
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
          aria-label={t('viewfinder.weather.baseAltAria', { title })}
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
          <span>{t('viewfinder.weather.thickness')}</span>
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
          aria-label={t('viewfinder.weather.thicknessAria', { title })}
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
          <span>{t('viewfinder.weather.density')}</span>
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
          aria-label={t('viewfinder.weather.densityAria', { title })}
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
  const t = useT()
  return (
    <>
      <WeatherSection title={t('viewfinder.weather.clouds')}>
        <label className="vf-landscape-menu__field vf-landscape-menu__field--row">
          <span className="vf-landscape-menu__label">
            {t('viewfinder.weather.enable')}
          </span>
          <input
            type="checkbox"
            checked={weather.enabled}
            aria-label={t('viewfinder.weather.enableVolumetric')}
            onChange={(event) =>
              onWeatherChange({ ...base, enabled: event.target.checked })
            }
          />
        </label>
        <label className="vf-landscape-menu__field vf-landscape-menu__field--row">
          <span className="vf-landscape-menu__label">
            {t('viewfinder.weather.followOwm')}
          </span>
          <input
            type="checkbox"
            checked={Boolean(weather.followForecast)}
            aria-label={t('viewfinder.weather.followOwmAria')}
            onChange={(event) =>
              onWeatherChange({
                ...base,
                followForecast: event.target.checked,
              })
            }
          />
        </label>
        <label className="vf-landscape-menu__field vf-landscape-menu__field--row">
          <span className="vf-landscape-menu__label">
            {t('viewfinder.weather.animateDrift')}
          </span>
          <input
            type="checkbox"
            checked={weather.animateClouds}
            aria-label={t('viewfinder.weather.animateDriftAria')}
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
            <span>{t('viewfinder.weather.wind')}</span>
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
            aria-label={t('viewfinder.weather.windAria')}
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
        title={t('viewfinder.weather.layer.low')}
        layer={weather.low}
        altMin={0.5}
        altMax={5}
        onChange={(low) =>
          onWeatherChange({ ...base, followForecast: false, low })
        }
      />
      <LayerEditor
        title={t('viewfinder.weather.layer.mid')}
        layer={weather.mid}
        altMin={2.5}
        altMax={9}
        onChange={(mid) =>
          onWeatherChange({ ...base, followForecast: false, mid })
        }
      />
      <LayerEditor
        title={t('viewfinder.weather.layer.high')}
        layer={weather.high}
        altMin={5}
        altMax={14}
        onChange={(high) =>
          onWeatherChange({ ...base, followForecast: false, high })
        }
      />
    </>
  )
}

export function ViewfinderWeatherControl(props: ViewfinderWeatherControlProps) {
  const {
    open: openProp,
    onOpenChange,
    showTrigger = true,
    anchorRef,
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
          title={t('viewfinder.weather.settingsTitle')}
          onClick={() => setOpen(!open)}
        >
          <SettingsSlidersIcon size={16} />
          <span className="vf-proj-control__muted">
            {t('viewfinder.weather.title')}
          </span>
        </button>
      ) : null}

      <ViewfinderFloatPanel
        open={open}
        onClose={() => setOpen(false)}
        title={t('viewfinder.weather.title')}
        storageKey={FLOAT_POS_STORAGE_KEY}
        defaultPos={DEFAULT_FLOAT_POS}
        triggerRef={panelAnchor}
        tourAnchor="vf-float-weather"
      >
        <WeatherPanelBody {...panelProps} />
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
