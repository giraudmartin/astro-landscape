import * as maplibregl from 'maplibre-gl'

const ESRI_TILE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'

/** Protocol URL template for MapLibre (Esri order: z / y / x). */
export const ESRI_SAFE_IMAGERY_URL = 'esri-safe://{z}/{y}/{x}'

const TILE_SIZE = 256
const MIN_FALLBACK_ZOOM = 10
/** Below this, run the gray-plate detector (stubs are tiny JPEGs). */
const STUB_SIZE_PROBE = 16_000

let registered = false

function tileUrl(z: number, x: number, y: number) {
  return `${ESRI_TILE}/${z}/${y}/${x}`
}

async function fetchTileBytes(
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetch(tileUrl(z, x, y), { signal })
  if (!response.ok) {
    throw new Error(`Esri tile HTTP ${response.status} z=${z}`)
  }
  return response.arrayBuffer()
}

/**
 * Esri's "Map data not yet available" plates are flat light-gray JPEGs.
 * Real desert/ocean tiles are either bigger or not that gray.
 */
async function isStubTile(bytes: ArrayBuffer): Promise<boolean> {
  if (bytes.byteLength === 0) return true
  if (bytes.byteLength >= STUB_SIZE_PROBE) return false

  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }))
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      bitmap.close()
      return false
    }
    ctx.drawImage(bitmap, 0, 0, 8, 8)
    bitmap.close()
    const { data } = ctx.getImageData(0, 0, 8, 8)
    let sum = 0
    let sumSq = 0
    const n = data.length / 4
    for (let i = 0; i < data.length; i += 4) {
      const g = (data[i] + data[i + 1] + data[i + 2]) / 3
      sum += g
      sumSq += g * g
    }
    const mean = sum / n
    const variance = sumSq / n - mean * mean
    return mean > 185 && mean < 245 && variance < 90
  } catch {
    return false
  }
}

async function cropParentToChild(
  parent: ImageBitmap,
  childZ: number,
  childX: number,
  childY: number,
  parentZ: number,
  parentX: number,
  parentY: number,
): Promise<ArrayBuffer> {
  const levels = childZ - parentZ
  const span = 1 << levels
  const localX = childX - (parentX << levels)
  const localY = childY - (parentY << levels)
  const srcSize = TILE_SIZE / span

  const canvas = document.createElement('canvas')
  canvas.width = TILE_SIZE
  canvas.height = TILE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')

  ctx.imageSmoothingEnabled = true
  ctx.drawImage(
    parent,
    localX * srcSize,
    localY * srcSize,
    srcSize,
    srcSize,
    0,
    0,
    TILE_SIZE,
    TILE_SIZE,
  )

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      0.92,
    )
  })
  return blob.arrayBuffer()
}

/**
 * Fetch z/x/y. On Esri stub tiles, climb to a real parent and crop the
 * matching quadrant so close zooms keep detail where Maxar exists, without
 * gray "Map data not yet available" plates in deserts.
 */
async function resolveTile(
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const direct = await fetchTileBytes(z, x, y, signal)
  if (!(await isStubTile(direct))) return direct

  for (let parentZ = z - 1; parentZ >= MIN_FALLBACK_ZOOM; parentZ--) {
    const shift = z - parentZ
    const parentX = x >> shift
    const parentY = y >> shift
    try {
      const parentBytes = await fetchTileBytes(parentZ, parentX, parentY, signal)
      if (await isStubTile(parentBytes)) continue
      const parent = await createImageBitmap(
        new Blob([parentBytes], { type: 'image/jpeg' }),
      )
      try {
        return await cropParentToChild(
          parent,
          z,
          x,
          y,
          parentZ,
          parentX,
          parentY,
        )
      } finally {
        parent.close()
      }
    } catch {
      // try next parent
    }
  }

  return direct
}

export function ensureEsriSafeImageryProtocol() {
  if (registered) return
  registered = true

  maplibregl.addProtocol('esri-safe', async (params, abortController) => {
    const path = params.url.replace('esri-safe://', '')
    const [z, y, x] = path.split('/').map(Number)
    if (![z, x, y].every(Number.isFinite)) {
      throw new Error(`Bad esri-safe URL ${params.url}`)
    }
    const data = await resolveTile(z, x, y, abortController.signal)
    return { data }
  })
}
