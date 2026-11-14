/**
 * Compare azimuthal Black Marble glow → all-sky mag estimate vs LPM hints.
 * Usage: node scripts/diag-horizon-glow.mjs
 */
import { createRequire } from 'module'
import { writeFileSync } from 'fs'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

const BLACK_MARBLE_LUMA_FLOOR = 0.155
const YEAR = '2016-01-01'
const RING_KM = [8, 20, 40, 70, 110, 170, 250, 360]
const AZ_BINS = 64
const FOOTPRINT = 4
const MAX_DROP = 2.45

function glowFromBlackMarbleRgb(r, g, b) {
  const avg = (r + g + b) / 3
  const blueDom = b >= r - 0.02 && b >= g - 0.02
  if (blueDom && avg < 0.28) return 0
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const excess = (luma - BLACK_MARBLE_LUMA_FLOOR) / (1 - BLACK_MARBLE_LUMA_FLOOR)
  return Math.min(1, Math.max(0, excess))
}

function distanceWeight(km) {
  const d0 = 35
  return (1 / (1 + (km / d0) * (km / d0))) * Math.exp(-km / 280)
}

function peakIntensity01(peakAbs) {
  const floor = 0.03
  const span = 1.1 - floor
  if (!(peakAbs > floor) || span <= 0) return 0
  return Math.pow(Math.min(1, Math.max(0, (peakAbs - floor) / span)), 0.62)
}

function offsetLatLon(lat, lon, distanceKm, azDeg) {
  const az = (azDeg * Math.PI) / 180
  const dLat = (distanceKm / 111.32) * Math.cos(az)
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const dLon =
    cosLat > 1e-6 ? (distanceKm / (111.32 * cosLat)) * Math.sin(az) : 0
  let nextLon = lon + dLon
  if (nextLon > 180) nextLon -= 360
  if (nextLon < -180) nextLon += 360
  return {
    lat: Math.max(-85, Math.min(85, lat + dLat)),
    lon: nextLon,
  }
}

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  )
  return { z, x: ((x % n) + n) % n, y: Math.min(n - 1, Math.max(0, y)), n }
}

const tileCache = new Map()

async function loadTile(z, x, y) {
  const key = `${z}/${x}/${y}`
  if (tileCache.has(key)) return tileCache.get(key)
  const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/${YEAR}/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`
  const res = await fetch(url)
  if (!res.ok) {
    tileCache.set(key, null)
    return null
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const png = PNG.sync.read(buf)
  tileCache.set(key, png)
  return png
}

async function sampleMax(lat, lon) {
  const { z, x, y, n } = lonLatToTile(lon, lat, 8)
  const png = await loadTile(z, x, y)
  if (!png) return 0
  const worldX = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const worldY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
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
        glowFromBlackMarbleRgb(
          png.data[i] / 255,
          png.data[i + 1] / 255,
          png.data[i + 2] / 255,
        ),
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

async function profile(name, lat, lon, zenithMag, lpm) {
  const bins = new Float32Array(AZ_BINS)
  const azStep = 360 / AZ_BINS
  for (let i = 0; i < AZ_BINS; i++) {
    const azDeg = i * azStep
    let accum = 0
    for (const km of RING_KM) {
      const p = offsetLatLon(lat, lon, km, azDeg)
      accum += (await sampleMax(p.lat, p.lon)) * distanceWeight(km)
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
  const intensity = peakIntensity01(peak)
  const drop = MAX_DROP * intensity
  const horizonMag = zenithMag - 0.06 - 0.9 * drop
  const ranked = [...smoothed]
    .map((v, i) => ({ az: i * azStep, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 4)

  return {
    name,
    zenithMag,
    peakAbs: +peak.toFixed(4),
    peakAz,
    intensity: +intensity.toFixed(3),
    ourMax: +horizonMag.toFixed(2),
    ourZenith: zenithMag,
    lpm,
    top4: ranked.map((r) => ({ az: r.az, v: +r.v.toFixed(4) })),
  }
}

const sites = [
  {
    name: 'Spitzkoppe',
    lat: -21.833868,
    lon: 15.16332,
    zenithMag: 21.99,
    lpm: { zenith: 21.99, max: 21.08, maxAz: 209, note: 'lobes ESE+SW' },
  },
  {
    name: 'NamibRand',
    lat: -25.0,
    lon: 16.0,
    zenithMag: 22.0,
    lpm: { zenith: 21.9, max: null, maxAz: null, note: 'Bortle 1 empty' },
  },
  {
    name: 'La Palma',
    lat: 28.754,
    lon: -17.885,
    zenithMag: 21.95,
    lpm: { zenith: 21.9, max: null, maxAz: null, note: 'island dark' },
  },
  {
    name: 'Windhoek',
    lat: -22.57,
    lon: 17.08,
    zenithMag: 20.5,
    lpm: { zenith: null, max: null, maxAz: null, note: 'city — bright wash' },
  },
  {
    name: 'Chartres',
    lat: 48.44,
    lon: 1.49,
    zenithMag: 20.8,
    lpm: { zenith: null, max: null, maxAz: null, note: 'suburb FR' },
  },
  {
    name: 'Paris',
    lat: 48.8566,
    lon: 2.3522,
    zenithMag: 18.5,
    lpm: { zenith: null, max: null, maxAz: null, note: 'urban' },
  },
]

const out = []
for (const s of sites) {
  process.stderr.write(`… ${s.name}\n`)
  out.push(await profile(s.name, s.lat, s.lon, s.zenithMag, s.lpm))
}
writeFileSync(
  new URL('./diag-horizon-glow.json', import.meta.url),
  JSON.stringify(out, null, 2),
)
console.log(JSON.stringify(out, null, 2))
