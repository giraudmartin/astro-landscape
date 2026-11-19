/** IndexedDB store for framing thumbnail WebP blobs. */

const DB_NAME = 'astro-landscape.framings'
const DB_VERSION = 1
const STORE = 'thumbs'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'))
  })
}

export async function putFramingThumb(
  id: string,
  blob: Blob,
): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IDB put failed'))
  })
  db.close()
}

export async function getFramingThumb(id: string): Promise<Blob | null> {
  try {
    const db = await openDb()
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(id)
      req.onsuccess = () => {
        const value = req.result
        resolve(value instanceof Blob ? value : null)
      }
      req.onerror = () => reject(req.error ?? new Error('IDB get failed'))
    })
    db.close()
    return blob
  } catch {
    return null
  }
}

export async function deleteFramingThumb(id: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB delete failed'))
    })
    db.close()
  } catch {
    /* ignore */
  }
}

/** Encode a source canvas/image to WebP, longest side = maxSide. */
export async function encodeFramingThumbWebp(
  source: HTMLCanvasElement | HTMLImageElement | ImageBitmap,
  maxSide = 320,
  quality = 0.82,
): Promise<Blob | null> {
  const sw =
    'width' in source && typeof source.width === 'number'
      ? source.width
      : (source as HTMLImageElement).naturalWidth || 0
  const sh =
    'height' in source && typeof source.height === 'number'
      ? source.height
      : (source as HTMLImageElement).naturalHeight || 0
  if (!sw || !sh) return null
  const scale = Math.min(1, maxSide / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h)
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      'image/webp',
      quality,
    )
  })
}
