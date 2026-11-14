/**
 * World calibration: fetch LPM all-sky panoramas + compute our dome model.
 * Usage: node scripts/calib-world-domes.mjs
 */
import { createRequire } from 'module'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'lpm-allsky-cache')
mkdirSync(OUT, { recursive: true })

const SITES = [
  { id: 'spitzkoppe', name: 'Spitzkoppe NA', lat: -21.833868, lon: 15.16332, kind: 'dark' },
  { id: 'namibrand', name: 'NamibRand NA', lat: -25.05, lon: 16.0, kind: 'dark' },
  { id: 'atacama', name: 'Atacama CL', lat: -24.627, lon: -70.404, kind: 'dark' },
  { id: 'maunakea', name: 'Mauna Kea US', lat: 19.8207, lon: -155.4681, kind: 'dark' },
  { id: 'lapalma', name: 'La Palma ES', lat: 28.754, lon: -17.885, kind: 'dark' },
  { id: 'deathvalley', name: 'Death Valley US', lat: 36.505, lon: -117.079, kind: 'dark' },
  { id: 'cherrysprings', name: 'Cherry Springs US', lat: 41.661, lon: -77.822, kind: 'rural' },
  { id: 'elchalten', name: 'El Chaltén AR', lat: -49.331, lon: -72.886, kind: 'rural' },
  { id: 'alicesprings', name: 'Alice Springs AU', lat: -23.698, lon: 133.881, kind: 'town' },
  { id: 'windhoek', name: 'Windhoek NA', lat: -22.5609, lon: 17.0658, kind: 'city' },
  { id: 'chartres', name: 'Chartres FR', lat: 48.447, lon: 1.489, kind: 'suburb' },
  { id: 'capetown', name: 'Cape Town ZA', lat: -33.9249, lon: 18.4241, kind: 'city' },
  { id: 'reykjavik', name: 'Reykjavik IS', lat: 64.1466, lon: -21.9426, kind: 'city' },
  { id: 'paris', name: 'Paris FR', lat: 48.8566, lon: 2.3522, kind: 'urban' },
  { id: 'tokyo', name: 'Tokyo JP', lat: 35.6812, lon: 139.7671, kind: 'urban' },
  { id: 'singapore', name: 'Singapore SG', lat: 1.3521, lon: 103.8198, kind: 'urban' },
  { id: 'tibet', name: 'Changtang CN', lat: 33.5, lon: 88.0, kind: 'dark' },
  { id: 'joshuatree', name: 'Joshua Tree US', lat: 33.8734, lon: -115.901, kind: 'rural' },
]

const BLACK_MARBLE_LUMA_FLOOR = 0.155
const YEAR_BM = '2016-01-01'
const RING_KM = [8, 20, 40, 70, 110, 170, 250, 360]
const AZ_BINS = 64
const FOOTPRINT = 6
const MAX_DROP = 2.9

function glowFromBlackMarbleRgb(r, g, b) {
  const avg = (r + g + b) / 3
  const blueDom = b >= r - 0.02 && b >= g - 0.02
  if (blueDom && avg < 0.28) return 0
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return Math.min(1, Math.max(0, (luma - BLACK_MARBLE_LUMA_FLOOR) / (1 - BLACK_MARBLE_LUMA_FLOOR)))
}

function distanceWeight(km) {
  return (1 / (1 + (km / 35) ** 2)) * Math.exp(-km / 280)
}

function peakIntensity01(peakAbs) {
  const floor = 0.025
  if (!(peakAbs > floor)) return 0
  if (peakAbs >= 1.05) return 1
  const x = (peakAbs - floor) / (peakAbs - floor + 0.16)
  return Math.min(1, Math.pow(Math.max(0, x), 0.78))
}

function horizonMagDropFromPeak(peakAbs) {
  return MAX_DROP * peakIntensity01(peakAbs)
}

function elevFalloff(altDeg) {
  const elevN = Math.min(1, Math.max(0, altDeg / 90))
  return 0.12 * (1 - elevN) ** 1.55 + 0.88 * (1 - elevN) ** 3.55
}

function offsetLatLon(lat, lon, distanceKm, azDeg) {
  const az = (azDeg * Math.PI) / 180
  const dLat = (distanceKm / 111.32) * Math.cos(az)
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const dLon = cosLat > 1e-6 ? (distanceKm / (111.32 * cosLat)) * Math.sin(az) : 0
  let nextLon = lon + dLon
  if (nextLon > 180) nextLon -= 360
  if (nextLon < -180) nextLon += 360
  return { lat: Math.max(-85, Math.min(85, lat + dLat)), lon: nextLon }
}

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  return { z, x: ((x % n) + n) % n, y: Math.min(n - 1, Math.max(0, y)), n }
}

const tileCache = new Map()
async function loadTile(z, x, y) {
  const key = `${z}/${x}/${y}`
  if (tileCache.has(key)) return tileCache.get(key)
  const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/${YEAR_BM}/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`
  const res = await fetch(url)
  if (!res.ok) {
    tileCache.set(key, null)
    return null
  }
  const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()))
  tileCache.set(key, png)
  return png
}

async function sampleMax(lat, lon) {
  const { z, x, y, n } = lonLatToTile(lon, lat, 8)
  const png = await loadTile(z, x, y)
  if (!png) return 0
  const worldX = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const worldY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const cx = Math.floor((worldX - x) * png.width)
  const cy = Math.floor((worldY - y) * png.height)
  let best = 0
  for (let dy = -FOOTPRINT; dy <= FOOTPRINT; dy++) {
    for (let dx = -FOOTPRINT; dx <= FOOTPRINT; dx++) {
      const px = Math.min(png.width - 1, Math.max(0, cx + dx))
      const py = Math.min(png.height - 1, Math.max(0, cy + dy))
      const i = (py * png.width + px) * 4
      best = Math.max(
        best,
        glowFromBlackMarbleRgb(png.data[i] / 255, png.data[i + 1] / 255, png.data[i + 2] / 255),
      )
    }
  }
  return best
}

function smoothCircular(bins, radius) {
  const n = bins.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    let w = 0
    for (let d = -radius; d <= radius; d++) {
      const j = (i + d + n * 4) % n
      const ww = radius + 1 - Math.abs(d)
      sum += bins[j] * ww
      w += ww
    }
    out[i] = sum / w
  }
  return out
}

function skyBrightnessMagFromRadiance(rad) {
  const NATURAL = 0.171168465
  const total = 0.5 * Math.max(0, rad) + NATURAL
  return Math.log10(total / 108_000_000) / -0.4
}

function radianceFromGlow(g) {
  if (g < 0.01) return 0
  return Math.pow(g, 1.25) * 18
}

async function ourProfile(site) {
  const bins = new Float32Array(AZ_BINS)
  const azStep = 360 / AZ_BINS
  for (let i = 0; i < AZ_BINS; i++) {
    let accum = 0
    const az = i * azStep
    for (const km of RING_KM) {
      const center = offsetLatLon(site.lat, site.lon, km, az)
      let glow = await sampleMax(center.lat, center.lon)
      if (km >= 20) {
        const left = offsetLatLon(site.lat, site.lon, km, az - 4)
        const right = offsetLatLon(site.lat, site.lon, km, az + 4)
        glow = Math.max(
          glow,
          await sampleMax(left.lat, left.lon),
          await sampleMax(right.lat, right.lon),
        )
      }
      accum += glow * distanceWeight(km)
    }
    bins[i] = accum
  }
  const smoothed = smoothCircular(bins, 2)
  let peak = 0
  let peakAz = 0
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] > peak) {
      peak = smoothed[i]
      peakAz = i * azStep
    }
  }
  const zenithGlow = await sampleMax(site.lat, site.lon)
  const zenithMag = +skyBrightnessMagFromRadiance(radianceFromGlow(zenithGlow)).toFixed(2)
  const intensity = peakIntensity01(peak)
  const drop = horizonMagDropFromPeak(peak)
  const elev = elevFalloff(0)
  const meanNorm =
    peak > 1e-6
      ? [...smoothed].reduce((s, v) => s + v, 0) / smoothed.length / peak
      : 0
  const city = 1
  const contrast = Math.max(0, city - meanNorm * 0.82)
  const wash = meanNorm * 0.22 * intensity
  const excess = (contrast * 1.05 + wash * 0.35) * elev * drop
  const maxMag = +(zenithMag - 0.06 * elev - excess).toFixed(2)
  const top = [...smoothed]
    .map((v, i) => ({ az: i * azStep, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map((r) => ({ az: r.az, v: +r.v.toFixed(4) }))

  return {
    zenithMag,
    peakAbs: +peak.toFixed(4),
    peakAz,
    intensity: +intensity.toFixed(3),
    maxMag,
    top,
  }
}

function apiKey() {
  return Buffer.from(`${Date.now()};isuckdicks:)`).toString('base64')
}

function parseMultipart(buf, contentType) {
  const m = /boundary=([^\s;]+)/i.exec(contentType || '')
  if (!m) return [{ name: 'body', buf }]
  const boundary = m[1]
  const parts = []
  const sep = Buffer.from(`--${boundary}`)
  let start = buf.indexOf(sep) + sep.length
  while (start > sep.length - 1 && start < buf.length) {
    if (buf[start] === 45 && buf[start + 1] === 45) break
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2
    const next = buf.indexOf(sep, start)
    const end = next < 0 ? buf.length : next
    let chunk = buf.subarray(start, end)
    if (chunk.length >= 2 && chunk[chunk.length - 2] === 13) chunk = chunk.subarray(0, chunk.length - 2)
    const headerEnd = chunk.indexOf('\r\n\r\n')
    if (headerEnd >= 0) {
      const headers = chunk.subarray(0, headerEnd).toString('utf8')
      const body = chunk.subarray(headerEnd + 4)
      const fn = /filename="([^"]+)"/i.exec(headers)
      parts.push({ name: fn?.[1] || `part${parts.length}`, buf: body })
    }
    start = next < 0 ? buf.length : next + sep.length
  }
  return parts
}

/**
 * Approximate LPM max azimuth by finding the warmest non-terrain pixel
 * along the lower panoramic band (near horizon).
 * Panorama layout (from Spitzkoppe 1848×722): plot roughly inset.
 */
function analyzePanoramaColors(pngBuf) {
  const png = PNG.sync.read(pngBuf)
  const { width: w, height: h, data } = png
  // Plot region heuristic for LPM panoramic charts.
  const left = Math.floor(w * 0.07)
  const right = Math.floor(w * 0.88)
  const top = Math.floor(h * 0.12)
  const bottom = Math.floor(h * 0.72)
  const plotW = right - left
  const plotH = bottom - top

  let bestScore = -1
  let bestAz = 0
  let bestY = 0
  // Scan near-horizon band (bottom 18% of plot, above terrain black).
  const y0 = bottom - Math.floor(plotH * 0.18)
  const y1 = bottom - 2
  for (let y = y0; y <= y1; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * w + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      // Skip near-black terrain / grey empty sky
      if (r + g + b < 40) continue
      if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8 && r < 80) continue
      // Warmth / greenness score — LPM lobes are cyan→green→yellow
      const score = r * 0.35 + g * 0.55 - b * 0.25
      if (score > bestScore) {
        bestScore = score
        bestAz = ((x - left) / plotW) * 360
        bestY = y
      }
    }
  }
  return {
    colorPeakAz: +bestAz.toFixed(1),
    colorScore: +bestScore.toFixed(1),
    colorPeakAltApprox: +((1 - (bestY - top) / plotH) * 90).toFixed(1),
  }
}

async function fetchLpm(site) {
  const panPath = join(OUT, `${site.id}_panorama.png`)
  const fishPath = join(OUT, `${site.id}_fisheye.png`)
  if (existsSync(panPath) && existsSync(fishPath)) {
    return {
      panorama: readFileSync(panPath),
      fisheye: readFileSync(fishPath),
      cached: true,
    }
  }
  const qk = apiKey()
  const url = `https://www.lightpollutionmap.info/api/allsky?lat=${site.lat}&lon=${site.lon}&year=2025&both=1&qk=${encodeURIComponent(qk)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`LPM ${site.id} ${res.status}`)
  const ct = res.headers.get('content-type') || ''
  const buf = Buffer.from(await res.arrayBuffer())
  const parts = parseMultipart(buf, ct)
  let panorama = null
  let fisheye = null
  for (const p of parts) {
    if (/panorama/i.test(p.name)) panorama = p.buf
    else if (/allsky/i.test(p.name) || /png/i.test(p.name)) fisheye = fisheye || p.buf
  }
  if (!panorama && parts[1]) panorama = parts[1].buf
  if (!fisheye && parts[0]) fisheye = parts[0].buf
  if (panorama) writeFileSync(panPath, panorama)
  if (fisheye) writeFileSync(fishPath, fisheye)
  return { panorama, fisheye, cached: false }
}

const results = []
for (const site of SITES) {
  process.stderr.write(`… ${site.name}\n`)
  try {
    const [lpm, ours] = await Promise.all([fetchLpm(site), ourProfile(site)])
    const color = lpm.panorama ? analyzePanoramaColors(lpm.panorama) : null
    results.push({
      ...site,
      ours,
      lpmColor: color,
      images: {
        panorama: `${site.id}_panorama.png`,
        fisheye: `${site.id}_fisheye.png`,
      },
    })
  } catch (e) {
    results.push({ ...site, error: String(e) })
  }
}

const outPath = join(OUT, 'calib-world.json')
writeFileSync(outPath, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
console.log('wrote', outPath)
