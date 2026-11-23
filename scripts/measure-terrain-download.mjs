/**
 * Cold-load tile footprint + sampled CDN byte sizes for terrain quality presets.
 *
 * Usage: node scripts/measure-terrain-download.mjs
 *
 * Counts unique DEM (Mapterhorn) + Esri keys the immersive pipeline would touch,
 * samples real Content-Length / body sizes, averages across globe spots.
 */
import { writeFileSync } from 'node:fs'

const MAPTERHORN = 'https://tiles.mapterhorn.com'
const ESRI =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'

const NEAR_TERRAIN_RADIUS_M = 6_000
const FAR_TERRAIN_RADIUS_M = 300_000
const FAR_TERRAIN_INNER_M = 30_000
const WIDE_DETAIL_RADIUS_M = 32_000
const MID_DETAIL_RADIUS_M = 14_000
const MID_DETAIL_INNER_M = NEAR_TERRAIN_RADIUS_M * 0.9
const WIDE_DETAIL_INNER_M = MID_DETAIL_RADIUS_M * 0.9
const NEAR_RADIUS_M = 3_200
const ULTRA_NEAR_RADIUS_M = 1_100
const PLANET_DEM_MAX_ZOOM = 12
const DEM_MIN_FALLBACK_Z = 7
const IMAGERY_MAX_ZOOM = 18

const SPOTS = [
  { name: 'Chamonix', lat: 45.9237, lon: 6.8694 },
  { name: 'Atacama', lat: -22.9087, lon: -68.1997 },
  { name: 'Namib', lat: -24.727, lon: 15.406 },
  { name: 'Tibet', lat: 30.0, lon: 90.0 },
  { name: 'Alaska', lat: 63.0695, lon: -151.007 },
  { name: 'Patagonia', lat: -49.2733, lon: -73.0433 },
  { name: 'Alps-S', lat: 46.0207, lon: 7.7491 },
  { name: 'Hawaii', lat: 19.8207, lon: -155.4681 },
]

const PRESETS = {
  high: {
    demZoomOffset: 0,
    imageryZoomOffset: 0,
    imageryMaxZoom: 18,
    nearResolution: 1200,
    loadNearAtlas: true,
    loadUltraNear: true,
    loadDetailMid: true,
    loadDetailWide: true,
    useHighDetailBake: true,
    detailMid: { resolution: 960, imageryZooms: [13, 14, 15, 16] },
    detailWide: { resolution: 900, imageryZooms: [12, 13, 14] },
    farRings: 'full',
  },
  standard: {
    demZoomOffset: 0,
    imageryZoomOffset: 1,
    imageryMaxZoom: 15,
    nearResolution: 1100,
    loadNearAtlas: true,
    loadUltraNear: false,
    loadDetailMid: true,
    loadDetailWide: true,
    useHighDetailBake: false,
    detailMid: { resolution: 880, imageryZooms: [13, 14, 15] },
    detailWide: { resolution: 800, imageryZooms: [12, 13] },
    farRings: 'full',
  },
  medium: {
    demZoomOffset: 1,
    imageryZoomOffset: 1,
    imageryMaxZoom: 15,
    nearResolution: 800,
    loadNearAtlas: true,
    loadUltraNear: false,
    loadDetailMid: true,
    loadDetailWide: false,
    useHighDetailBake: false,
    detailMid: { resolution: 640, imageryZooms: [12, 13, 14] },
    detailWide: { resolution: 640, imageryZooms: [11, 12] },
    farRings: 'reduced',
  },
  low: {
    demZoomOffset: 2,
    imageryZoomOffset: 2,
    imageryMaxZoom: 13,
    nearResolution: 512,
    loadNearAtlas: false,
    loadUltraNear: false,
    loadDetailMid: false,
    loadDetailWide: false,
    useHighDetailBake: false,
    detailMid: { resolution: 480, imageryZooms: [11, 12] },
    detailWide: { resolution: 400, imageryZooms: [10, 11] },
    farRings: 'coarse',
  },
}

const LOD_RINGS = [
  {
    name: 'second',
    innerM: FAR_TERRAIN_INNER_M,
    outerM: 55_000,
    resolution: 480,
    imageryZooms: [12, 13],
  },
  {
    name: 'mid',
    innerM: 48_000,
    outerM: 95_000,
    resolution: 300,
    imageryZooms: [11, 12],
  },
  {
    name: 'far',
    innerM: 80_000,
    outerM: 180_000,
    resolution: 260,
    imageryZooms: [9, 10, 11],
  },
  {
    name: 'horizon',
    innerM: 150_000,
    outerM: FAR_TERRAIN_RADIUS_M,
    resolution: 240,
    imageryZooms: [8, 9],
  },
]

function demZoomForDistance(distM) {
  if (distM < 2_000) return 17
  if (distM < 4_500) return 16
  if (distM < 8_000) return 14
  if (distM < 16_000) return 13
  if (distM < 32_000) return 12
  if (distM < 70_000) return 11
  if (distM < 140_000) return 10
  if (distM < 220_000) return 8
  return 7
}

function demZoomActive(distM, offset) {
  return Math.max(DEM_MIN_FALLBACK_Z, demZoomForDistance(distM) - offset)
}

function latLonToTile(lat, lon, z) {
  const n = 2 ** z
  const x = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { x, y, n }
}

function enuToLatLon(east, north, lat0, lon0) {
  const cosLat = Math.cos((lat0 * Math.PI) / 180)
  return {
    lat: lat0 + north / 111_320,
    lon: lon0 + east / (111_320 * Math.max(0.2, cosLat)),
  }
}

function addDemTileKeys(tileKeys, lat, lon, z) {
  const { x, y } = latLonToTile(lat, lon, z)
  tileKeys.add(`${z}/${Math.floor(x)}/${Math.floor(y)}`)
  if (z > PLANET_DEM_MAX_ZOOM) {
    const p = latLonToTile(lat, lon, PLANET_DEM_MAX_ZOOM)
    tileKeys.add(`${PLANET_DEM_MAX_ZOOM}/${Math.floor(p.x)}/${Math.floor(p.y)}`)
  }
  if (z > 10) {
    const p = latLonToTile(lat, lon, 10)
    tileKeys.add(`10/${Math.floor(p.x)}/${Math.floor(p.y)}`)
  }
}

function shiftImageryZooms(zooms, offset, maxZ) {
  return zooms.map((z) =>
    Math.max(DEM_MIN_FALLBACK_Z, Math.min(maxZ, z - offset)),
  )
}

function addEsriLayerKeys(esriKeys, lat0, lon0, radiusM, zoom, clipRadiusM) {
  const corners = [
    enuToLatLon(-clipRadiusM, -clipRadiusM, lat0, lon0),
    enuToLatLon(clipRadiusM, clipRadiusM, lat0, lon0),
  ]
  const t0 = latLonToTile(corners[0].lat, corners[0].lon, zoom)
  const t1 = latLonToTile(corners[1].lat, corners[1].lon, zoom)
  const minX = Math.floor(Math.min(t0.x, t1.x))
  const maxX = Math.floor(Math.max(t0.x, t1.x))
  const minY = Math.floor(Math.min(t0.y, t1.y))
  const maxY = Math.floor(Math.max(t0.y, t1.y))
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      esriKeys.add(`${zoom}/${tx}/${ty}`)
    }
  }
}

function addDemGridKeys(demKeys, lat0, lon0, radiusM, resolution, offset, opts = {}) {
  const innerM = opts.innerM ?? 0
  for (let j = 0; j <= resolution; j++) {
    for (let i = 0; i <= resolution; i++) {
      const east = -radiusM + (i / resolution) * radiusM * 2
      const north = -radiusM + (j / resolution) * radiusM * 2
      const dist = Math.hypot(east, north)
      if (opts.annulus) {
        if (dist > radiusM * 1.02 || dist < innerM * 0.85) continue
      }
      const { lat, lon } = enuToLatLon(east, north, lat0, lon0)
      addDemTileKeys(demKeys, lat, lon, demZoomActive(dist, offset))
    }
  }
}

function farRingsFor(mode) {
  if (mode === 'full') return LOD_RINGS
  if (mode === 'reduced') return LOD_RINGS.filter((r) => r.name !== 'second')
  return LOD_RINGS.filter((r) => r.name === 'far' || r.name === 'horizon').map(
    (r) => ({
      ...r,
      resolution: Math.min(r.resolution, 200),
      imageryZooms: r.imageryZooms.map((z) => Math.max(7, z - 1)),
    }),
  )
}

function collectKeys(lat0, lon0, quality) {
  const p = PRESETS[quality]
  const demKeys = new Set()
  const esriKeys = new Set()

  // Near disc DEM (+ coarse fallbacks like createLocalTerrainMesh)
  addDemGridKeys(demKeys, lat0, lon0, NEAR_TERRAIN_RADIUS_M, p.nearResolution, p.demZoomOffset)
  const step = Math.max(1, Math.floor(p.nearResolution / 32))
  for (let j = 0; j <= p.nearResolution; j += step) {
    for (let i = 0; i <= p.nearResolution; i += step) {
      const east = -NEAR_TERRAIN_RADIUS_M + (i / p.nearResolution) * NEAR_TERRAIN_RADIUS_M * 2
      const north = -NEAR_TERRAIN_RADIUS_M + (j / p.nearResolution) * NEAR_TERRAIN_RADIUS_M * 2
      const { lat, lon } = enuToLatLon(east, north, lat0, lon0)
      for (const z of [PLANET_DEM_MAX_ZOOM, 10, 8]) {
        addDemTileKeys(demKeys, lat, lon, z)
      }
    }
  }

  // Preview LOD rings (always)
  for (const ring of [
    { outerM: MID_DETAIL_RADIUS_M, zoom: 10, res: 160 },
    { outerM: WIDE_DETAIL_RADIUS_M, zoom: 9, res: 160 },
    { outerM: FAR_TERRAIN_RADIUS_M, zoom: 7, res: 160 },
  ]) {
    addDemGridKeys(demKeys, lat0, lon0, ring.outerM, ring.res, p.demZoomOffset)
    addEsriLayerKeys(esriKeys, lat0, lon0, ring.outerM, ring.zoom, ring.outerM)
  }

  // Core ortho
  const coreLayers = [
    { z: 12, clip: NEAR_TERRAIN_RADIUS_M },
    { z: 13, clip: NEAR_TERRAIN_RADIUS_M },
    { z: 14, clip: NEAR_TERRAIN_RADIUS_M },
    { z: 15, clip: NEAR_TERRAIN_RADIUS_M },
    { z: 16, clip: Math.min(NEAR_TERRAIN_RADIUS_M, 4_000) },
    { z: 17, clip: Math.min(NEAR_TERRAIN_RADIUS_M, 2_000) },
  ]
  for (const layer of coreLayers) {
    if (layer.z > p.imageryMaxZoom) continue
    addEsriLayerKeys(
      esriKeys,
      lat0,
      lon0,
      NEAR_TERRAIN_RADIUS_M,
      layer.z,
      layer.clip,
    )
  }

  if (p.loadNearAtlas) {
    const layers = [13, 15, 16, IMAGERY_MAX_ZOOM]
      .map((z) => Math.min(z, p.imageryMaxZoom))
      .filter((z, i, arr) => z >= 10 && arr.indexOf(z) === i)
    for (const z of layers) {
      addEsriLayerKeys(esriKeys, lat0, lon0, NEAR_RADIUS_M, z, NEAR_RADIUS_M)
    }
  }
  if (p.loadUltraNear) {
    const layers = [13, 15, 16, IMAGERY_MAX_ZOOM]
      .map((z) => Math.min(z, p.imageryMaxZoom))
      .filter((z, i, arr) => z >= 10 && arr.indexOf(z) === i)
    for (const z of layers) {
      addEsriLayerKeys(
        esriKeys,
        lat0,
        lon0,
        ULTRA_NEAR_RADIUS_M,
        z,
        ULTRA_NEAR_RADIUS_M,
      )
    }
  }

  if (p.loadDetailMid) {
    addDemGridKeys(
      demKeys,
      lat0,
      lon0,
      MID_DETAIL_RADIUS_M,
      p.detailMid.resolution,
      p.demZoomOffset,
      { annulus: true, innerM: MID_DETAIL_INNER_M },
    )
    if (p.useHighDetailBake) {
      const layers = [
        { z: 12, clip: MID_DETAIL_RADIUS_M },
        { z: 13, clip: MID_DETAIL_RADIUS_M },
        { z: 14, clip: MID_DETAIL_RADIUS_M },
        { z: 15, clip: MID_DETAIL_RADIUS_M },
        { z: 16, clip: Math.min(MID_DETAIL_RADIUS_M, 6_000) },
        { z: 17, clip: Math.min(MID_DETAIL_RADIUS_M, 3_000) },
      ]
      for (const layer of layers) {
        if (layer.z > p.imageryMaxZoom) continue
        addEsriLayerKeys(
          esriKeys,
          lat0,
          lon0,
          MID_DETAIL_RADIUS_M,
          layer.z,
          layer.clip,
        )
      }
    } else {
      for (const z of shiftImageryZooms(
        p.detailMid.imageryZooms,
        p.imageryZoomOffset,
        p.imageryMaxZoom,
      )) {
        addEsriLayerKeys(
          esriKeys,
          lat0,
          lon0,
          MID_DETAIL_RADIUS_M,
          z,
          MID_DETAIL_RADIUS_M,
        )
      }
    }
  }

  if (p.loadDetailWide) {
    addDemGridKeys(
      demKeys,
      lat0,
      lon0,
      WIDE_DETAIL_RADIUS_M,
      p.detailWide.resolution,
      p.demZoomOffset,
      { annulus: true, innerM: WIDE_DETAIL_INNER_M },
    )
    if (p.useHighDetailBake) {
      const layers = [
        { z: 11, clip: WIDE_DETAIL_RADIUS_M },
        { z: 12, clip: WIDE_DETAIL_RADIUS_M },
        { z: 13, clip: WIDE_DETAIL_RADIUS_M },
        { z: 14, clip: Math.min(WIDE_DETAIL_RADIUS_M, 14_000) },
      ]
      for (const layer of layers) {
        addEsriLayerKeys(
          esriKeys,
          lat0,
          lon0,
          WIDE_DETAIL_RADIUS_M,
          layer.z,
          layer.clip,
        )
      }
    } else {
      for (const z of shiftImageryZooms(
        p.detailWide.imageryZooms,
        p.imageryZoomOffset,
        p.imageryMaxZoom,
      )) {
        addEsriLayerKeys(
          esriKeys,
          lat0,
          lon0,
          WIDE_DETAIL_RADIUS_M,
          z,
          WIDE_DETAIL_RADIUS_M,
        )
      }
    }
  }

  for (const ring of farRingsFor(p.farRings)) {
    addDemGridKeys(
      demKeys,
      lat0,
      lon0,
      ring.outerM,
      ring.resolution,
      p.demZoomOffset,
      { annulus: true, innerM: ring.innerM },
    )
    for (const z of shiftImageryZooms(
      ring.imageryZooms,
      p.imageryZoomOffset,
      p.imageryMaxZoom,
    )) {
      addEsriLayerKeys(esriKeys, lat0, lon0, ring.outerM, z, ring.outerM)
    }
  }

  return { demKeys, esriKeys }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  )
  return out
}

async function fetchSize(url) {
  try {
    const head = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(12_000),
    })
    const cl = Number(head.headers.get('content-length'))
    if (head.ok && Number.isFinite(cl) && cl > 0) return cl
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    return buf.byteLength
  } catch {
    return null
  }
}

function pickSample(keys, n) {
  const arr = [...keys]
  if (arr.length <= n) return arr
  const out = []
  const step = arr.length / n
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)])
  return out
}

async function sampleAvgBytes(kind, keys, sampleN) {
  const sample = pickSample(keys, sampleN)
  const sizes = await mapPool(sample, 10, async (key) => {
    const [z, x, y] = key.split('/').map(Number)
    const url =
      kind === 'dem'
        ? `${MAPTERHORN}/${z}/${x}/${y}.webp`
        : `${ESRI}/${z}/${y}/${x}`
    return fetchSize(url)
  })
  const ok = sizes.filter((s) => typeof s === 'number' && s > 0)
  if (ok.length === 0) return { avg: 0, n: 0, sample: sample.length }
  return {
    avg: ok.reduce((a, b) => a + b, 0) / ok.length,
    n: ok.length,
    sample: sample.length,
  }
}

function mb(bytes) {
  return bytes / (1024 * 1024)
}

async function main() {
  const qualities = ['high', 'standard', 'medium', 'low']
  const perSpot = []

  // First pass: tile counts everywhere
  for (const spot of SPOTS) {
    const row = { spot: spot.name, lat: spot.lat, lon: spot.lon, qualities: {} }
    for (const q of qualities) {
      const { demKeys, esriKeys } = collectKeys(spot.lat, spot.lon, q)
      row.qualities[q] = {
        demTiles: demKeys.size,
        esriTiles: esriKeys.size,
        demKeys,
        esriKeys,
      }
    }
    perSpot.push(row)
    console.log(
      `${spot.name.padEnd(10)} hi ${row.qualities.high.demTiles}/${row.qualities.high.esriTiles} · std ${row.qualities.standard.demTiles}/${row.qualities.standard.esriTiles} · med ${row.qualities.medium.demTiles}/${row.qualities.medium.esriTiles} · low ${row.qualities.low.demTiles}/${row.qualities.low.esriTiles}`,
    )
  }

  // Sample sizes from a union of keys across spots (per quality) so avg is global
  const union = {
    high: { dem: new Set(), esri: new Set() },
    standard: { dem: new Set(), esri: new Set() },
    medium: { dem: new Set(), esri: new Set() },
    low: { dem: new Set(), esri: new Set() },
  }
  for (const row of perSpot) {
    for (const q of qualities) {
      for (const k of row.qualities[q].demKeys) union[q].dem.add(k)
      for (const k of row.qualities[q].esriKeys) union[q].esri.add(k)
    }
  }

  // Prefer mid/high zoom land keys for Esri (ocean stubs ~few KiB skew the mean).
  function landishEsriKeys(keys) {
    return [...keys].filter((k) => {
      const z = Number(k.split('/')[0])
      return z >= 12 && z <= 17
    })
  }

  console.log('\nSampling CDN tile sizes (land-biased Esri z12–17)…')
  const demUnionAll = new Set()
  const esriLandUnion = new Set()
  for (const q of qualities) {
    for (const k of union[q].dem) demUnionAll.add(k)
    for (const k of landishEsriKeys(union[q].esri)) esriLandUnion.add(k)
  }
  const demSample = await sampleAvgBytes('dem', demUnionAll, 56)
  const esriSample = await sampleAvgBytes('esri', esriLandUnion, 72)
  console.log(
    `  DEM avg ${(demSample.avg / 1024).toFixed(1)} KiB (n=${demSample.n}/${demSample.sample})`,
  )
  console.log(
    `  Esri avg ${(esriSample.avg / 1024).toFixed(1)} KiB (n=${esriSample.n}/${esriSample.sample})`,
  )

  // Ocean/desert stubs (~few KiB) dominate random samples; floor to alpine land
  // sizes measured at Chamonix (z12–18 ≈ 17 KiB). Stub-parent climbs add ~15%.
  const demAvg = Math.max(demSample.avg || 0, 120 * 1024)
  const esriAvg = Math.max(esriSample.avg || 0, 17 * 1024) * 1.15

  function median(values) {
    const s = [...values].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
  }

  const summary = {}
  for (const q of qualities) {
    const spotMbs = perSpot.map((row) => {
      const d = row.qualities[q]
      return mb(d.demTiles * demAvg + d.esriTiles * esriAvg)
    })
    const midLatMbs = perSpot
      .filter((row) => Math.abs(row.lat) < 55)
      .map((row) => {
        const d = row.qualities[q]
        return mb(d.demTiles * demAvg + d.esriTiles * esriAvg)
      })
    // Mercator high-lat spots (Alaska) inflate tile counts — prefer mid-lat median.
    const med = median(midLatMbs)
    const mean = midLatMbs.reduce((a, b) => a + b, 0) / midLatMbs.length
    const min = Math.min(...spotMbs)
    const max = Math.max(...spotMbs)
    summary[q] = {
      medianMb: Math.round(med),
      meanMb: Math.round(mean),
      minMb: Math.round(min),
      maxMb: Math.round(max),
      demAvgBytes: Math.round(demAvg),
      esriAvgBytes: Math.round(esriAvg),
      avgDemTiles: Math.round(
        perSpot.reduce((a, r) => a + r.qualities[q].demTiles, 0) / perSpot.length,
      ),
      avgEsriTiles: Math.round(
        perSpot.reduce((a, r) => a + r.qualities[q].esriTiles, 0) /
          perSpot.length,
      ),
      perSpotMb: Object.fromEntries(
        perSpot.map((r, i) => [r.spot, Math.round(spotMbs[i])]),
      ),
    }
  }

  console.log('\n=== Cold-load estimate (Mo) — mid-lat median (|lat|<55) ===')
  for (const q of qualities) {
    const s = summary[q]
    console.log(
      `${q.padEnd(7)} ~${s.medianMb} Mo  (mean ${s.meanMb}, global range ${s.minMb}–${s.maxMb})  tiles DEM~${s.avgDemTiles} Esri~${s.avgEsriTiles}`,
    )
    console.log('       ', s.perSpotMb)
  }

  const out = {
    generatedAt: new Date().toISOString(),
    spots: SPOTS.map((s) => s.name),
    byteAvgs: {
      demBytes: Math.round(demAvg),
      esriBytesWithStubOverhead: Math.round(esriAvg),
      note: 'Esri floored to alpine land (~17 KiB) × 1.15 stub-parent overhead',
    },
    summary,
    recommendedDefaults: {
      high: summary.high.medianMb,
      standard: summary.standard.medianMb,
      medium: summary.medium.medianMb,
      low: summary.low.medianMb,
    },
  }
  writeFileSync(
    new URL('../src/terrainDownloadEstimate.measured.json', import.meta.url),
    JSON.stringify(out, null, 2),
  )
  console.log('\nWrote src/terrainDownloadEstimate.measured.json')
  console.log('recommendedDefaults', out.recommendedDefaults)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
