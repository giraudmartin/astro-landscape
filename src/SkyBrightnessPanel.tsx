import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { useT } from './i18n'
import {
  bortleColorCss,
  bortleLabel,
  clampBortle,
} from './lightPollution/bortleFromRadiance'
import {
  buildHorizonGlowProfile,
  type HorizonGlowProfile,
} from './lightPollution/horizonGlowProfile'
import {
  buildSkyBrightnessField,
  horizonWorthDrawing,
  legendRangeForField,
  magToRgb,
  sampleAzimuth,
  sampleFieldMag,
  skyBrightnessLegendGradientCss,
  type SkyBrightnessField,
} from './lightPollution/skyBrightnessField'
import type { LightPollutionSample } from './lightPollution/types'

type ViewMode = 'fisheye' | 'panoramic'

type SkyBrightnessPanelProps = {
  open: boolean
  onClose: () => void
  lat: number
  lon: number
  elevM: number
  sample: LightPollutionSample
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

function formatMag(m: number): string {
  return m.toFixed(2)
}

function formatPlace(lat: number, lon: number, elevM: number): string {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}° ${ns} · ${Math.abs(lon).toFixed(4)}° ${ew} · ${Math.round(elevM)} m`
}

type TFn = ReturnType<typeof useT>

function sourceLabel(sample: LightPollutionSample, t: TFn): string {
  if (sample.source === 'viirs-cog') {
    return t('bortle.sky.source.viirs')
  }
  return t('bortle.sky.source.blackMarble')
}

function chartNoteForMode(mode: ViewMode, t: TFn): string {
  if (mode === 'fisheye') {
    return t('bortle.sky.noteFisheye')
  }
  return t('bortle.sky.notePano')
}

/**
 * Short blurb from field geometry — never invent a hardcoded sky quality sentence.
 */
function assessmentBlurb(field: SkyBrightnessField, t: TFn): string {
  const lobe = field.zenithMag - field.minMag
  if (!Number.isFinite(lobe) || lobe < 0.12) {
    return t('bortle.sky.assess.flat')
  }
  if (field.minAltDeg <= 15) {
    return t('bortle.sky.assess.horizon')
  }
  if (field.minAltDeg >= 60) {
    return t('bortle.sky.assess.high')
  }
  return t('bortle.sky.assess.mid')
}

function drawCardinalsFisheye(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
) {
  const labels = [
    { az: 0, t: 'N' },
    { az: 90, t: 'E' },
    { az: 180, t: 'S' },
    { az: 270, t: 'W' },
  ]
  ctx.fillStyle = 'rgba(244,246,251,0.85)'
  ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const { az, t } of labels) {
    const rad = ((az - 90) * Math.PI) / 180
    const x = cx + Math.cos(rad) * (radius + 16)
    const y = cy + Math.sin(rad) * (radius + 16)
    ctx.fillText(t, x, y)
  }
}

function paintFisheye(
  canvas: HTMLCanvasElement,
  field: SkyBrightnessField,
  legendMin: number,
  legendMax: number,
) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const cssW = canvas.clientWidth
  const cssH = canvas.clientHeight
  canvas.width = Math.max(1, Math.floor(cssW * dpr))
  canvas.height = Math.max(1, Math.floor(cssH * dpr))
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const pad = 28
  const size = Math.min(cssW - pad * 2, cssH - pad * 2)
  const cx = cssW / 2
  const cy = cssH / 2
  const radius = size / 2 - 4

  const dim = Math.max(1, Math.floor(size))
  const img = ctx.createImageData(dim, dim)
  const data = img.data
  for (let py = 0; py < dim; py++) {
    for (let px = 0; px < dim; px++) {
      const dx = px - dim / 2 + 0.5
      const dy = py - dim / 2 + 0.5
      const r = Math.hypot(dx, dy)
      const i = (py * dim + px) * 4
      if (r > dim / 2 - 1) {
        data[i + 3] = 0
        continue
      }
      const altDeg = 90 * (1 - r / (dim / 2))
      let azDeg = (Math.atan2(dx, -dy) * 180) / Math.PI
      if (azDeg < 0) azDeg += 360
      const mag = sampleFieldMag(field, azDeg, altDeg)
      const [rr, gg, bb] = magToRgb(mag, legendMin, legendMax)
      data[i] = rr
      data[i + 1] = gg
      data[i + 2] = bb
      data[i + 3] = 255
    }
  }
  const tmp = document.createElement('canvas')
  tmp.width = dim
  tmp.height = dim
  tmp.getContext('2d')!.putImageData(img, 0, 0)
  ctx.drawImage(tmp, cx - size / 2, cy - size / 2, size, size)

  if (horizonWorthDrawing(field.horizonAltDeg)) {
    ctx.beginPath()
    const steps = Math.max(180, Math.floor(radius * 2))
    for (let s = 0; s <= steps; s++) {
      const azDeg = (s / steps) * 360
      const hor = sampleAzimuth(field.horizonAltDeg, azDeg)
      const rSky = radius * (1 - Math.min(89, hor) / 90)
      const rad = ((azDeg - 90) * Math.PI) / 180
      const x = cx + Math.cos(rad) * rSky
      const y = cy + Math.sin(rad) * rSky
      if (s === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    for (let s = steps; s >= 0; s--) {
      const azDeg = (s / steps) * 360
      const rad = ((azDeg - 90) * Math.PI) / 180
      ctx.lineTo(cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius)
    }
    ctx.closePath()
    ctx.fillStyle = '#07070a'
    ctx.fill()
  }

  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.lineWidth = 1
  ctx.stroke()

  drawCardinalsFisheye(ctx, cx, cy, radius)
}

function paintPanoramic(
  canvas: HTMLCanvasElement,
  field: SkyBrightnessField,
  legendMin: number,
  legendMax: number,
) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const cssW = canvas.clientWidth
  const cssH = canvas.clientHeight
  canvas.width = Math.max(1, Math.floor(cssW * dpr))
  canvas.height = Math.max(1, Math.floor(cssH * dpr))
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const left = 40
  const right = 16
  const top = 14
  const bottom = 32
  const plotW = cssW - left - right
  const plotH = cssH - top - bottom

  const img = ctx.createImageData(
    Math.max(1, Math.floor(plotW)),
    Math.max(1, Math.floor(plotH)),
  )
  const data = img.data
  const w = img.width
  const h = img.height
  for (let py = 0; py < h; py++) {
    const altDeg = 90 * (1 - py / (h - 1))
    for (let px = 0; px < w; px++) {
      const azDeg = (px / (w - 1)) * 360
      const mag = sampleFieldMag(field, azDeg, altDeg)
      const [rr, gg, bb] = magToRgb(mag, legendMin, legendMax)
      const i = (py * w + px) * 4
      data[i] = rr
      data[i + 1] = gg
      data[i + 2] = bb
      data[i + 3] = 255
    }
  }
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  tmp.getContext('2d')!.putImageData(img, 0, 0)
  ctx.drawImage(tmp, left, top, plotW, plotH)

  if (horizonWorthDrawing(field.horizonAltDeg)) {
    ctx.beginPath()
    ctx.moveTo(left, top + plotH)
    const cols = Math.max(2, Math.floor(plotW))
    for (let px = 0; px <= cols; px++) {
      const azDeg = (px / cols) * 360
      const hor = sampleAzimuth(field.horizonAltDeg, azDeg)
      const y = top + plotH * (1 - Math.min(89, Math.max(0, hor)) / 90)
      ctx.lineTo(left + (px / cols) * plotW, y)
    }
    ctx.lineTo(left + plotW, top + plotH)
    ctx.closePath()
    ctx.fillStyle = '#07070a'
    ctx.fill()
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.strokeRect(left + 0.5, top + 0.5, plotW - 1, plotH - 1)

  ctx.fillStyle = 'rgba(244,246,251,0.7)'
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const alt of [0, 30, 60, 90]) {
    const y = top + plotH * (1 - alt / 90)
    ctx.fillText(`${alt}°`, left - 8, y)
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(left + 4, y)
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.stroke()
  }

  const cards = [
    { az: 0, t: 'N' },
    { az: 45, t: 'NE' },
    { az: 90, t: 'E' },
    { az: 135, t: 'SE' },
    { az: 180, t: 'S' },
    { az: 225, t: 'SW' },
    { az: 270, t: 'W' },
    { az: 315, t: 'NW' },
    { az: 360, t: 'N' },
  ]
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const { az, t } of cards) {
    const x = left + (az / 360) * plotW
    ctx.fillText(t, x, top + plotH + 8)
  }
}

export function SkyBrightnessPanel({
  open,
  onClose,
  lat,
  lon,
  elevM,
  sample,
}: SkyBrightnessPanelProps) {
  const t = useT()
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<ViewMode>('fisheye')
  const [profile, setProfile] = useState<HorizonGlowProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    closeRef.current?.focus()
    return () => {
      restoreFocusRef.current?.focus?.()
      restoreFocusRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(false)
    void buildHorizonGlowProfile(lat, lon, { observerElevM: elevM })
      .then((p) => {
        if (cancelled) return
        setProfile(p)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, lat, lon, elevM])

  const field: SkyBrightnessField | null = useMemo(() => {
    if (!profile) return null
    return buildSkyBrightnessField(sample.skyBrightnessMag, profile)
  }, [profile, sample.skyBrightnessMag])

  const legend = useMemo(() => {
    if (!field) return null
    return legendRangeForField(field)
  }, [field])

  const legendGradient = useMemo(() => skyBrightnessLegendGradientCss(), [])

  useEffect(() => {
    if (!open || !field || !legend) return
    const canvas = canvasRef.current
    if (!canvas) return
    const paint = () => {
      if (mode === 'fisheye') paintFisheye(canvas, field, legend.min, legend.max)
      else paintPanoramic(canvas, field, legend.min, legend.max)
    }
    paint()
    const ro = new ResizeObserver(paint)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [open, field, mode, legend])

  if (!open || typeof document === 'undefined') return null

  const bortle = clampBortle(sample.bortle)
  const bortleTone = bortleColorCss(bortle)
  const quality = bortleLabel(bortle)
  const place = formatPlace(lat, lon, elevM)
  const brightest =
    field &&
    Number.isFinite(field.minMag) &&
    Number.isFinite(field.minAzDeg) &&
    Number.isFinite(field.minAltDeg)
      ? {
          mag: field.minMag,
          azDeg: field.minAzDeg,
          altDeg: field.minAltDeg,
        }
      : null

  return createPortal(
    <div
      className="settings-overlay sky-brightness-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="sky-brightness-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ '--bortle-tone': bortleTone } as CSSProperties}
      >
        <header className="sky-brightness-panel__header">
          <div className="sky-brightness-panel__titles">
            <h2 id={titleId} className="sky-brightness-panel__title">
              {t('bortle.sky.title')}
            </h2>
            <p className="sky-brightness-panel__sub">{place}</p>
          </div>
          <div
            className="sky-brightness-panel__bortle"
            aria-label={`Bortle ${bortle}, ${quality}`}
          >
            <span className="sky-brightness-panel__bortle-label">
              {t('bortle.sky.bortleWord')}
            </span>
            <span className="sky-brightness-panel__bortle-value">{bortle}</span>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="settings-panel__close"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="sky-brightness-panel__workspace">
          <div className="sky-brightness-panel__chart-col">
            <div className="sky-brightness-panel__chart">
              <div
                className="sky-brightness-panel__modes"
                role="radiogroup"
                aria-label={t('bortle.sky.projectionAria')}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === 'fisheye'}
                  className={
                    mode === 'fisheye'
                      ? 'sky-brightness-panel__mode is-active'
                      : 'sky-brightness-panel__mode'
                  }
                  onClick={() => setMode('fisheye')}
                >
                  {t('bortle.sky.modeFisheye')}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === 'panoramic'}
                  className={
                    mode === 'panoramic'
                      ? 'sky-brightness-panel__mode is-active'
                      : 'sky-brightness-panel__mode'
                  }
                  onClick={() => setMode('panoramic')}
                >
                  {t('bortle.sky.modePanoramic')}
                </button>
              </div>
              {loading ? (
                <p className="sky-brightness-panel__status">
                  {t('bortle.sky.computing')}
                </p>
              ) : error ? (
                <p className="sky-brightness-panel__status is-error">
                  {t('bortle.sky.errCompute')}
                </p>
              ) : (
                <canvas
                  ref={canvasRef}
                  className="sky-brightness-panel__canvas"
                  aria-label={
                    mode === 'fisheye'
                      ? t('bortle.sky.canvasFisheye')
                      : t('bortle.sky.canvasPano')
                  }
                />
              )}
            </div>

            {legend ? (
              <div className="sky-brightness-panel__legend" aria-hidden="true">
                <div className="sky-brightness-panel__legend-top">
                  <span>{t('bortle.sky.legendBrighter')}</span>
                  <span>{t('bortle.sky.legendDarker')}</span>
                </div>
                <div
                  className="sky-brightness-panel__legend-ramp"
                  style={{ background: legendGradient }}
                />
                <div className="sky-brightness-panel__legend-values">
                  <span>{formatMag(legend.min)}</span>
                  <small>mag/arcsec²</small>
                  <span>{formatMag(legend.max)}</span>
                </div>
              </div>
            ) : null}

            <p className="sky-brightness-panel__chart-note">
              {chartNoteForMode(mode, t)}
            </p>
            <p className="sky-brightness-panel__disclaimer" role="note">
              {t('bortle.sky.disclaimer')}
            </p>
          </div>

          <aside className="sky-brightness-panel__side">
            <div className="sky-brightness-panel__side-title">
              {t('bortle.sky.sideTitle')}
            </div>
            <div className="sky-brightness-panel__assessment">
              <h3 className="sky-brightness-panel__quality">
                <span
                  className="sky-brightness-panel__quality-dot"
                  aria-hidden="true"
                />
                {quality}
              </h3>
              <p>
                {field
                  ? assessmentBlurb(field, t)
                  : loading
                    ? t('bortle.sky.assess.loading')
                    : error
                      ? t('bortle.sky.assess.error')
                      : t('bortle.sky.assess.empty')}
              </p>
            </div>

            <div className="sky-brightness-panel__metrics">
              <div className="sky-brightness-panel__metric">
                <span className="sky-brightness-panel__metric-label">
                  {t('bortle.sky.metric.zenith')}
                </span>
                {field && Number.isFinite(field.zenithMag) ? (
                  <>
                    <strong>{formatMag(field.zenithMag)}</strong>
                    <small>mag/arcsec²</small>
                  </>
                ) : (
                  <strong className="is-empty">—</strong>
                )}
              </div>
              <div className="sky-brightness-panel__metric">
                <span className="sky-brightness-panel__metric-label">
                  {t('bortle.sky.metric.mean')}
                </span>
                {field && Number.isFinite(field.meanMag) ? (
                  <>
                    <strong>{formatMag(field.meanMag)}</strong>
                    <small>mag/arcsec²</small>
                  </>
                ) : (
                  <strong className="is-empty">—</strong>
                )}
              </div>
              <div className="sky-brightness-panel__metric">
                <span className="sky-brightness-panel__metric-label">
                  {t('bortle.sky.metric.brightest')}
                </span>
                {brightest ? (
                  <>
                    <strong>{formatMag(brightest.mag)}</strong>
                    <small>mag/arcsec²</small>
                    <div className="sky-brightness-panel__metric-dir">
                      {t('bortle.sky.metric.dir', {
                        az: brightest.azDeg.toFixed(0),
                        alt: brightest.altDeg.toFixed(0),
                      })}
                    </div>
                  </>
                ) : (
                  <strong className="is-empty">—</strong>
                )}
              </div>
            </div>

            <p className="sky-brightness-panel__guide">
              <strong>{t('bortle.sky.guideTitle')}</strong>
              <br />
              {t('bortle.sky.guideBody')}
            </p>
          </aside>
        </div>

        <footer className="sky-brightness-panel__footer">
          <span className="sky-brightness-panel__source">
            {sourceLabel(sample, t)}
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
