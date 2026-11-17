/**
 * Off-main-thread halo field precompute + session cache.
 *
 * The 360-step terrain screening runs once per (raster, relief, zone) in a
 * worker; render-time sliders only touch uniforms. Results are cached by a
 * content hash so re-entering the same spot is instant.
 */
import {
  computeHaloField,
  haloFieldCacheKey,
  type HaloFieldInput,
  type HaloGroundGrid,
  type HaloProjector,
  type HaloRaster,
} from './haloFieldCore'

const CACHE_LIMIT = 4
const cache = new Map<string, Promise<Uint16Array>>()

let worker: Worker | null = null
let nextId = 1
const pending = new Map<
  number,
  {
    resolve: (field: Uint16Array) => void
    reject: (error: Error) => void
    onProgress?: (done01: number) => void
  }
>()

function getWorker(): Worker | null {
  if (worker) return worker
  if (typeof Worker === 'undefined') return null
  try {
    worker = new Worker(new URL('./haloField.worker.ts', import.meta.url), {
      type: 'module',
    })
  } catch {
    return null
  }
  worker.onmessage = (event: MessageEvent) => {
    const msg = event.data as {
      id: number
      progress?: number
      field?: Uint16Array
      error?: string
    }
    const job = pending.get(msg.id)
    if (!job) return
    if (msg.progress != null) {
      job.onProgress?.(msg.progress)
      return
    }
    pending.delete(msg.id)
    if (msg.field) job.resolve(msg.field)
    else job.reject(new Error(msg.error ?? 'halo worker failed'))
  }
  worker.onerror = (event) => {
    for (const job of pending.values()) {
      job.reject(new Error(event.message || 'halo worker crashed'))
    }
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

function runInWorker(
  input: HaloFieldInput,
  onProgress?: (done01: number) => void,
): Promise<Uint16Array> {
  const w = getWorker()
  if (!w) return Promise.resolve(computeHaloField(input, onProgress))
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    w.postMessage({ id, input })
  })
}

export function requestHaloField(
  args: {
    raster: HaloRaster
    ground: HaloGroundGrid
    projector: HaloProjector
    input: HaloFieldInput
  },
  onProgress?: (done01: number) => void,
): { key: string; field: Promise<Uint16Array> } {
  const key = haloFieldCacheKey(args)
  let hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    onProgress?.(1)
    return { key, field: hit }
  }
  hit = runInWorker(args.input, onProgress)
  hit.catch(() => cache.delete(key))
  cache.set(key, hit)
  while (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value!)
  }
  return { key, field: hit }
}
