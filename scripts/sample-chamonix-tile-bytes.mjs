const ESRI =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'
const MAPTERHORN = 'https://tiles.mapterhorn.com'

function latLonToTile(lat, lon, z) {
  const n = 2 ** z
  const x = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { x, y }
}

async function size(url) {
  const r = await fetch(url)
  if (!r.ok) return null
  return (await r.arrayBuffer()).byteLength
}

const lat = 45.9237
const lon = 6.8694
const esri = []
const dem = []

for (const z of [12, 13, 14, 15, 16, 17, 18]) {
  const t = latLonToTile(lat, lon, z)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = Math.floor(t.x) + dx
      const y = Math.floor(t.y) + dy
      const b = await size(`${ESRI}/${z}/${y}/${x}`)
      if (b) esri.push({ z, b })
    }
  }
}

for (const z of [10, 12, 14, 16, 17]) {
  const t = latLonToTile(lat, lon, z)
  const b = await size(
    `${MAPTERHORN}/${z}/${Math.floor(t.x)}/${Math.floor(t.y)}.webp`,
  )
  if (b) dem.push({ z, b })
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length
console.log(
  'Esri Chamonix n',
  esri.length,
  'avgKiB',
  (avg(esri.map((x) => x.b)) / 1024).toFixed(1),
)
for (const z of [...new Set(esri.map((x) => x.z))].sort((a, b) => a - b)) {
  const g = esri.filter((x) => x.z === z).map((x) => x.b)
  console.log(`  z${z}: ${(avg(g) / 1024).toFixed(1)} KiB (n=${g.length})`)
}
console.log(
  'DEM avgKiB',
  (avg(dem.map((x) => x.b)) / 1024).toFixed(1),
  dem.map((d) => `z${d.z}:${(d.b / 1024).toFixed(0)}`),
)
