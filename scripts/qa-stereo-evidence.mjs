/**
 * Long-wait stereo FOV evidence capture for astro-landscape.
 * The skill inspector's 10s prep deadline is too short for DEM/ortho load.
 *
 * Usage:
 *   node scripts/qa-stereo-evidence.mjs [--url http://127.0.0.1:5180] [--out artifacts/qa-stereo-before]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'

const require = createRequire(import.meta.url)
const { chromium } = await import(
  pathToFileURL(require.resolve('@playwright/test')).href
).then((m) => m.default ?? m).catch(async () => import('@playwright/test'))

function parseArgs(argv) {
  const args = {
    url: 'http://localhost:5180',
    out: 'artifacts/qa-stereo-after',
    runId: `run-${Date.now()}`,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--url') args.url = next()
    else if (a === '--out') args.out = next()
    else if (a === '--run-id') args.runId = next()
  }
  return args
}

const STATES = [
  'mirador-fov72',
  'mirador-fov120',
  'mirador-fov185',
  'mirador-fov270',
  'mirador-pan-south',
]

function analyzePng(buffer) {
  const png = PNG.sync.read(buffer)
  const { width, height, data } = png
  let nonBlack = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  const buckets = new Map()
  // Sample every 4th pixel for stretch heuristics.
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = data[i + 3]
      if (a < 8) continue
      if (r + g + b > 12) nonBlack += 1
      sumR += r
      sumG += g
      sumB += b
      const key = `${r >> 4},${g >> 4},${b >> 4}`
      buckets.set(key, (buckets.get(key) || 0) + 1)
    }
  }
  const samples = Math.max(1, Math.ceil(width / 2) * Math.ceil(height / 2))
  // Horizontal edge energy vs vertical — stretched ground often has strong
  // vertical streaking / radial lines near the horizon band.
  let horizEdge = 0
  let vertEdge = 0
  const midY0 = Math.floor(height * 0.45)
  const midY1 = Math.floor(height * 0.75)
  for (let y = midY0; y < midY1; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const i = (y * width + x) * 4
      const lum = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11
      const left =
        data[i - 8] * 0.3 + data[i - 7] * 0.59 + data[i - 6] * 0.11
      const up =
        data[i - width * 8] * 0.3 +
        data[i - width * 8 + 1] * 0.59 +
        data[i - width * 8 + 2] * 0.11
      horizEdge += Math.abs(lum - left)
      vertEdge += Math.abs(lum - up)
    }
  }
  const uniqueColors = buckets.size
  return {
    width,
    height,
    nonBlackRatio: nonBlack / samples,
    meanRgb: [sumR / samples, sumG / samples, sumB / samples].map((v) =>
      Math.round(v),
    ),
    uniqueColorBuckets: uniqueColors,
    horizonEdgeRatio: vertEdge > 1 ? horizEdge / vertEdge : null,
    blank: nonBlack / samples < 0.02,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = path.resolve(args.out)
  await mkdir(outDir, { recursive: true })

  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=default'],
  })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })

  const consoleErrors = []
  page.on('pageerror', (err) => consoleErrors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForFunction(
    () => !!window.__THREE_GAME_TEST_HOOKS__,
    null,
    { timeout: 30_000 },
  )

  const captures = []
  for (const state of STATES) {
    const started = Date.now()
    await page.evaluate(async (name) => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__
      await hooks.setPausedForScreenshot(false)
      const ack = await hooks.setState(name)
      if (!ack || ack.state !== name) throw new Error(`bad ack for ${name}`)
      await hooks.setPausedForScreenshot(true)
      hooks.hideDebugUi?.()
    }, state)

    // Extra settle for atlas/ortho uploads after terrainReady.
    await page.waitForTimeout(1500)

    const canvasInfo = await page.evaluate(() => {
      const canvas = document.querySelector('.immersive__canvas canvas')
      const imm = window.__astroQaImmersive
      if (!canvas) return { ok: false }
      return {
        ok: true,
        w: canvas.width,
        h: canvas.height,
        stageVfovDeg: imm?.getStageVfovDeg?.() ?? null,
        projection: imm?.getProjection?.() ?? null,
        terrainReady: imm?.isTerrainReady?.() ?? false,
      }
    })

    const shotPath = path.join(outDir, `${state}.png`)
    // Prefer canvas element screenshot for pure render evidence.
    const canvas = page.locator('.immersive__canvas canvas')
    const buffer = await canvas.screenshot({ type: 'png' })
    await writeFile(shotPath, buffer)
    const metrics = analyzePng(buffer)

    const row = {
      state,
      ms: Date.now() - started,
      canvasInfo,
      metrics,
      screenshot: shotPath,
      consoleErrorCount: consoleErrors.length,
    }
    captures.push(row)
    const verdict = metrics.blank ? 'FAIL' : 'PASS-pixels'
    console.log(
      `${verdict} ${state} fov=${canvasInfo.stageVfovDeg} edgeH/V=${metrics.horizonEdgeRatio?.toFixed(2) ?? 'n/a'} nonBlack=${metrics.nonBlackRatio.toFixed(3)} ${path.basename(shotPath)}`,
    )
  }

  const report = {
    runId: args.runId,
    url: args.url,
    viewport: { width: 1440, height: 900 },
    site: 'Mirador del Rio 28.7542,-17.8845 bearing 270 pitch -8 date 2025-06-15 17:00 local',
    captures,
    consoleErrors: consoleErrors.slice(0, 40),
  }
  const reportPath = path.join(outDir, 'report.json')
  await writeFile(reportPath, JSON.stringify(report, null, 2))
  console.log(`report ${reportPath}`)
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
