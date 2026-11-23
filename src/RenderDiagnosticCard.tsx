import { useEffect, useId, useRef, useState, type MutableRefObject } from 'react'
import {
  RENDER_DIAG_DEFAULTS,
  type RenderDiagLive,
  type RenderDiagSettings,
} from './renderDiagnostic'
import { intlLocale, useLocale, useT } from './i18n'
import { RenderDiagIcon } from './psIcons'
import type { StageProjection } from './stelProjector'

export type RenderDiagContext = {
  projection: StageProjection
  stageVfovDeg: number
  yawDeg: number
  pitchDeg: number
  eyeHeightM: number
  cameraPos: { x: number; y: number; z: number }
  logDepthBuffer: true
}

type Props = {
  liveRef: MutableRefObject<RenderDiagLive>
  getContext: () => RenderDiagContext
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  const t = useT()
  return (
    <label className="render-diag__row" title={hint}>
      <span className="render-diag__label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={
          checked ? 'render-diag__switch is-on' : 'render-diag__switch'
        }
        onClick={() => onChange(!checked)}
      >
        {checked ? t('common.on') : t('common.off')}
      </button>
    </label>
  )
}

function NumRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
  hint?: string
}) {
  const { locale } = useLocale()
  return (
    <label className="render-diag__block" title={hint}>
      <span className="render-diag__label">
        {label}
        <span className="render-diag__value">
          {value.toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 })}{' '}
          {unit}
        </span>
      </span>
      <input
        className="render-diag__range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        className="render-diag__num"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
        }}
      />
    </label>
  )
}

/**
 * Collapsible debug card — isolate black-band causes one knob at a time.
 * Does not touch tile loading / LOD. Keeps look orientation.
 */
export function RenderDiagnosticCard({ liveRef, getContext }: Props) {
  const { locale, t } = useLocale()
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<RenderDiagSettings>({
    ...RENDER_DIAG_DEFAULTS,
  })
  const [stats, setStats] = useState(liveRef.current.stats)
  const [copied, setCopied] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()

  useEffect(() => {
    liveRef.current.settings = { ...settings }
  }, [settings, liveRef])

  useEffect(() => {
    if (!open) return
    const id = window.setInterval(() => {
      setStats({ ...liveRef.current.stats })
    }, 400)
    return () => window.clearInterval(id)
  }, [open, liveRef])

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

  const patch = (partial: Partial<RenderDiagSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }))
  }

  const reset = () => {
    setSettings({ ...RENDER_DIAG_DEFAULTS })
  }

  const copyDiag = async () => {
    const ctx = getContext()
    const payload = {
      settings: liveRef.current.settings,
      stats: liveRef.current.stats,
      projection: ctx.projection,
      stageVfovDeg: ctx.stageVfovDeg,
      look: { yawDeg: ctx.yawDeg, pitchDeg: ctx.pitchDeg },
      eyeHeightM: ctx.eyeHeightM,
      cameraPos: ctx.cameraPos,
      notes: {
        logDepthBuffer: 'ON (locked at WebGLRenderer create — recreate to change)',
        cameraFar:
          'Clip plane only — not terrain LOD / tile load distance',
        path:
          'direct = vertex warp; cubemap = 6×RT + composite (debug)',
      },
    }
    const text = JSON.stringify(payload, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt(t('diag.copyPrompt'), text)
    }
  }

  return (
    <div
      className={open ? 'render-diag is-open' : 'render-diag'}
      ref={rootRef}
    >
      <button
        type="button"
        className={
          open ? 'render-diag__warn-btn is-open' : 'render-diag__warn-btn'
        }
        aria-label={t('diag.title')}
        title={t('diag.title')}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <RenderDiagIcon size={15} />
      </button>
      {open ? (
        <div className="render-diag__panel" id={panelId} role="dialog" aria-label={t('diag.title')}>
          <p className="render-diag__hint">
            {t('diag.hint.before')}
            <strong>{t('diag.hint.strong')}</strong>
            {t('diag.hint.after')}
          </p>

          <p className="render-diag__section">{t('diag.section.stats')}</p>
          <div className="render-diag__stats">
            <span>{stats.fps.toFixed(0)} FPS</span>
            <span>
              {stats.passes}{' '}
              {stats.passes > 1 ? t('diag.passPlural') : t('diag.passSingular')}
            </span>
            <span>{stats.drawCalls} draws</span>
            <span>{stats.triangles.toLocaleString(intlLocale(locale))} tris</span>
            <span className="render-diag__path">{stats.path}</span>
          </div>

          <p className="render-diag__section">{t('diag.section.culling')}</p>
          <Toggle
            label={t('diag.frustum')}
            checked={settings.frustumCulling}
            hint={t('diag.frustumHint')}
            onChange={(v) => patch({ frustumCulling: v })}
          />
          <NumRow
            label={t('diag.near')}
            value={settings.cameraNearM}
            min={0.05}
            max={50}
            step={0.05}
            unit="m"
            hint={t('diag.nearHint')}
            onChange={(v) => patch({ cameraNearM: v })}
          />
          <NumRow
            label={t('diag.far')}
            value={settings.cameraFarM}
            min={1_000}
            max={500_000}
            step={1_000}
            unit="m"
            hint={t('diag.farHint')}
            onChange={(v) => patch({ cameraFarM: v })}
          />

          <p className="render-diag__section">{t('diag.section.terrain')}</p>
          <Toggle
            label={t('diag.wireframe')}
            checked={settings.terrainWireframe}
            onChange={(v) => patch({ terrainWireframe: v })}
          />
          <Toggle
            label={t('diag.terrainNear')}
            checked={settings.showTerrainNear}
            onChange={(v) => patch({ showTerrainNear: v })}
          />
          <Toggle
            label={t('diag.terrainFar')}
            checked={settings.showTerrainFar}
            hint={t('diag.terrainFarHint')}
            onChange={(v) => patch({ showTerrainFar: v })}
          />

          <p className="render-diag__section">{t('diag.section.sky')}</p>
          <Toggle
            label={t('diag.skyDome')}
            checked={settings.showSky}
            onChange={(v) => patch({ showSky: v })}
          />
          <Toggle
            label={t('diag.nightSky')}
            checked={settings.showNightSky}
            onChange={(v) => patch({ showNightSky: v })}
          />

          <p className="render-diag__section">{t('diag.section.pass')}</p>
          <p className="render-diag__note">
            {t('diag.passNote')}
          </p>
          <Toggle
            label={t('diag.cubemap')}
            checked={settings.useCubemapPass}
            hint={t('diag.cubemapHint')}
            onChange={(v) =>
              patch({
                useCubemapPass: v,
                cubemapAtlasPreview: v ? settings.cubemapAtlasPreview : false,
              })
            }
          />
          <Toggle
            label={t('diag.atlas')}
            checked={settings.cubemapAtlasPreview}
            hint={t('diag.atlasHint')}
            onChange={(v) =>
              patch({
                cubemapAtlasPreview: v,
                useCubemapPass: v ? true : settings.useCubemapPass,
              })
            }
          />

          <p className="render-diag__locked">
            {t('diag.depthLocked')}
          </p>

          <div className="render-diag__actions">
            <button type="button" className="render-diag__btn" onClick={reset}>
              {t('diag.reset')}
            </button>
            <button
              type="button"
              className="render-diag__btn"
              onClick={() => void copyDiag()}
            >
              {copied ? t('diag.copied') : t('diag.copy')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
