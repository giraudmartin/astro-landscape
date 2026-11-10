import * as maplibregl from 'maplibre-gl'

const MAPTERHORN_TILE = 'https://tiles.mapterhorn.com'

/** Protocol URL for MapLibre (Terrarium WebP, 512px). */
export const MAPTERHORN_SAFE_DEM_URL = 'mapterhorn-dem://{z}/{x}/{y}'

const TILE_SIZE = 512
/** Global planet archive ends at z12; climb at least that far on miss. */
const MIN_FALLBACK_ZOOM = 0

let registered = false

function tileUrl(z: number, x: number, y: number) {
  return `${MAPTERHORN_TILE}/${z}/${x}/${y}.webp`
}

async function fetchTileBytes(
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer | null> {
  const response = await fetch(tileUrl(z, x, y), { signal })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Mapterhorn DEM HTTP ${response.status} z=${z}`)
  }
  return response.arrayBuffer()
}

/**
 * Upscale a parent DEM quadrant to a full child tile.
 * Nearest-neighbor keeps Terrarium RGB channels un-interpolated
 * (bilinear on R/G/B would invent wrong elevations).
 */
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

  ctx.imageSmoothingEnabled = false
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
      'image/webp',
      1,
    )
  })
  return blob.arrayBuffer()
}

/**
 * Prefer native z13–17 regional tiles where Mapterhorn has them.
 * Elsewhere, fall back to the nearest parent (planet max z12) and
 * nearest-neighbor overzoom so MapLibre never sees a DEM hole.
 */
async function resolveTile(
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const direct = await fetchTileBytes(z, x, y, signal)
  if (direct) return direct

  for (let parentZ = z - 1; parentZ >= MIN_FALLBACK_ZOOM; parentZ--) {
    const shift = z - parentZ
    const parentX = x >> shift
    const parentY = y >> shift
    try {
      const parentBytes = await fetchTileBytes(parentZ, parentX, parentY, signal)
      if (!parentBytes) continue
      const parent = await createImageBitmap(
        new Blob([parentBytes], { type: 'image/webp' }),
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

  throw new Error(`No Mapterhorn DEM for ${z}/${x}/${y}`)
}

export function ensureMapterhornSafeDemProtocol() {
  if (registered) return
  registered = true

  maplibregl.addProtocol('mapterhorn-dem', async (params, abortController) => {
    const path = params.url.replace('mapterhorn-dem://', '')
    const [z, x, y] = path.split('/').map(Number)
    if (![z, x, y].every(Number.isFinite)) {
      throw new Error(`Bad mapterhorn-dem URL ${params.url}`)
    }
    const data = await resolveTile(z, x, y, abortController.signal)
    return { data }
  })
}
