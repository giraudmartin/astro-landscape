import { createRequire } from 'module'
import { writeFileSync } from 'fs'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

function tileXY(lon, lat, z) {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  )
  return { z, x: ((x % n) + n) % n, y: Math.min(n - 1, Math.max(0, y)), n }
}

function fracPixel(lon, lat, z, x, y, w, h) {
  const n = 2 ** z
  const worldX = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const worldY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return {
    px: Math.floor((worldX - x) * w),
    py: Math.floor((worldY - y) * h),
  }
}

function lumaAt(png, px, py) {
  const x = Math.min(png.width - 1, Math.max(0, px))
  const y = Math.min(png.height - 1, Math.max(0, py))
  const i = (y * png.width + x) * 4
  const r = png.data[i]
  const g = png.data[i + 1]
  const b = png.data[i + 2]
  const a = png.data[i + 3]
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const maxc = Math.max(r, g, b) / 255
  return { r, g, b, a, luma, maxc, px: x, py: y }
}

async function sample(name, lat, lon, z = 8) {
  const { x, y } = tileXY(lon, lat, z)
  const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${name} ${res.status}`)
  const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()))
  const { px, py } = fracPixel(lon, lat, z, x, y, png.width, png.height)
  const center = lumaAt(png, px, py)
  let max = 0
  let sum = 0
  let c = 0
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const s = lumaAt(png, px + dx, py + dy)
      max = Math.max(max, s.luma)
      sum += s.luma
      c++
    }
  }
  return {
    name,
    lat,
    lon,
    tile: { z, x, y },
    center,
    neighAvg: sum / c,
    neighMax: max,
  }
}

const sites = [
  ['Spitzkoppe', -21.8342, 15.163],
  ['La Palma Roque', 28.754, -17.885],
  ['Namib desert', -24.5, 15.2],
  ['Sahara empty', 24.0, 10.0],
  ['rural Auvergne', 45.1, 2.9],
  ['Chartres suburb', 48.44, 1.49],
  ['Orleans', 47.9, 1.9],
  ['Windhoek', -22.57, 17.08],
  ['Paris', 48.8566, 2.3522],
  ['NYC', 40.7128, -74.006],
]

const out = []
for (const [name, lat, lon] of sites) {
  out.push(await sample(name, lat, lon))
}
writeFileSync(
  'scripts/sample-bortle-luma.json',
  JSON.stringify(out, null, 2),
)
console.log(JSON.stringify(out, null, 2))
