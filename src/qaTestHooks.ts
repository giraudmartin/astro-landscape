/**
 * Deterministic QA hooks for threejs-qa-release canvas inspection.
 * Fixed Mirador scene — do not rely on live map clicks.
 */

import { civilDateFromUtc, civilDayStartUtcMs } from './celestial'
import type { StageProjection } from './stelProjector'

/** Mirador del Río (La Palma) — cliff + sea, prior accepted baseline site. */
export const QA_SITE = {
  lat: 28.7542,
  lon: -17.8845,
  heightM: 740,
  bearingDeg: 270,
  pitchDeg: -8,
} as const

/** Local civil afternoon light (~17:00). */
export const QA_LOCAL_HOUR = 17
export const QA_DATE = '2025-06-15'

export type QaImmersiveApi = {
  setLook: (yaw: number, pitch: number) => void
  setStageFov: (vfovDeg: number) => void
  setProjection?: (mode: StageProjection) => void
  isTerrainReady: () => boolean
  /** Preview mesh + ortho enough to judge stretch — full ready can take minutes. */
  isCaptureReady: () => boolean
  getStageVfovDeg: () => number
  getProjection: () => StageProjection
}

export type QaAppApi = {
  enterImmersive: (opts: {
    lat: number
    lon: number
    heightM: number
    bearingDeg: number
    pitchDeg: number
    date: string
    localHour: number
  }) => void
  setPlayheadUtcMs: (utcMs: number) => void
  setDate: (date: string) => void
  exitImmersive: () => void
  isImmersive: () => boolean
}

declare global {
  interface Window {
    __astroQaApp?: QaAppApi
    __astroQaImmersive?: QaImmersiveApi
    __THREE_GAME_TEST_HOOKS__?: {
      seed: (n: number) => void | Promise<void>
      setState: (
        name: string,
      ) => Promise<{ state: string }> | { state: string }
      setPausedForScreenshot: (paused: boolean) => void | Promise<void>
      setReducedMotion?: (on: boolean) => void
      hideDebugUi?: () => void
    }
  }
}

const SUPPORTED = new Set([
  'mirador-fov72',
  'mirador-fov120',
  'mirador-fov185',
  'mirador-fov270',
  'mirador-pan-south',
])

function qaUtcMs(date: string, lon: number, localHour: number): number {
  return civilDayStartUtcMs(date, lon) + localHour * 3600_000
}

function waitFor(
  pred: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const start = performance.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (pred()) {
        resolve()
        return
      }
      if (performance.now() - start > timeoutMs) {
        reject(new Error(`QA timeout waiting for ${label}`))
        return
      }
      window.requestAnimationFrame(tick)
    }
    tick()
  })
}

async function ensureMiradorBase(): Promise<void> {
  const app = window.__astroQaApp
  if (!app) throw new Error('__astroQaApp missing')

  if (!app.isImmersive()) {
    app.enterImmersive({
      lat: QA_SITE.lat,
      lon: QA_SITE.lon,
      heightM: QA_SITE.heightM,
      bearingDeg: QA_SITE.bearingDeg,
      pitchDeg: QA_SITE.pitchDeg,
      date: QA_DATE,
      localHour: QA_LOCAL_HOUR,
    })
  } else {
    app.setDate(QA_DATE)
    app.setPlayheadUtcMs(qaUtcMs(QA_DATE, QA_SITE.lon, QA_LOCAL_HOUR))
  }

  await waitFor(() => !!window.__astroQaImmersive, 15_000, 'immersive api')
  const imm = window.__astroQaImmersive!
  await waitFor(
    () => imm.isCaptureReady() || imm.isTerrainReady(),
    120_000,
    'terrain capture-ready',
  )
  imm.setLook(QA_SITE.bearingDeg, QA_SITE.pitchDeg)
  imm.setProjection?.('stereographic')
  // Let React apply projection before FOV (effect can otherwise overwrite).
  await new Promise<void>((r) => {
    window.setTimeout(r, 50)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    window.setTimeout(r, ms)
  })
}

async function applyNamedState(name: string): Promise<{ state: string }> {
  if (!SUPPORTED.has(name)) throw new Error(`Unknown test state: ${name}`)
  await ensureMiradorBase()
  const imm = window.__astroQaImmersive!
  if (name === 'mirador-fov72') imm.setStageFov(72)
  else if (name === 'mirador-fov120') imm.setStageFov(120)
  else if (name === 'mirador-fov185') imm.setStageFov(185)
  else if (name === 'mirador-fov270') imm.setStageFov(270)
  else if (name === 'mirador-pan-south') {
    imm.setStageFov(185)
    imm.setLook(180, QA_SITE.pitchDeg)
  }
  // Re-apply FOV after React effects from projection/look settle.
  await sleep(80)
  if (name === 'mirador-fov72') imm.setStageFov(72)
  else if (name === 'mirador-fov120') imm.setStageFov(120)
  else if (name === 'mirador-fov185') imm.setStageFov(185)
  else if (name === 'mirador-fov270') imm.setStageFov(270)
  else if (name === 'mirador-pan-south') {
    imm.setStageFov(185)
    imm.setLook(180, QA_SITE.pitchDeg)
  }
  await new Promise<void>((r) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => r()))
  })
  return { state: name }
}

/** Call once from App mount. */
export function installThreeGameTestHooks(): void {
  let paused = false
  window.__THREE_GAME_TEST_HOOKS__ = {
    seed: () => {
      // Scene is fully deterministic via fixed site/date; seed acknowledged.
    },
    setState: (name) => applyNamedState(name),
    setPausedForScreenshot: (next) => {
      paused = next
      document.documentElement.dataset.qaPaused = paused ? '1' : '0'
    },
    setReducedMotion: () => {},
    hideDebugUi: () => {
      document.documentElement.dataset.qaHideChrome = '1'
    },
  }
}

export function qaUtcForSite(
  date = QA_DATE,
  lon = QA_SITE.lon,
  localHour = QA_LOCAL_HOUR,
): number {
  return qaUtcMs(date, lon, localHour)
}

export function qaCivilDateLabel(
  utcMs: number,
  lon = QA_SITE.lon,
): string {
  return civilDateFromUtc(utcMs, lon)
}
