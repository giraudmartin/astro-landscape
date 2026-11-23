/**
 * Running total of bytes received over the network by the page.
 *
 * - Cross-origin `fetch` bodies are counted as they stream: Resource Timing
 *   reports 0 there without `Timing-Allow-Origin`. HTTP-cache hits on those
 *   hosts are indistinguishable and get counted too.
 * - Everything same-origin (scripts, textures, catalogs) uses Resource Timing
 *   `transferSize`, which is 0 for HTTP-cache hits.
 * IndexedDB / in-memory cache hits never touch the network and are not counted.
 */

type Listener = (totalBytes: number) => void

let totalBytes = 0
const bytesByHost = new Map<string, number>()
let installed = false
const listeners = new Set<Listener>()
let notifyScheduled = false

function notify(): void {
  if (notifyScheduled) return
  notifyScheduled = true
  setTimeout(() => {
    notifyScheduled = false
    for (const l of listeners) l(totalBytes)
  }, 250)
}

type HostFetchStats = {
  requests: number
  failed: number
  /** Sum of request start → response headers, ms. */
  waitMs: number
  statuses: Record<number, number>
}
const fetchStatsByHost = new Map<string, HostFetchStats>()

function recordFetch(host: string, status: number, waitMs: number): void {
  let s = fetchStatsByHost.get(host)
  if (!s) {
    s = { requests: 0, failed: 0, waitMs: 0, statuses: {} }
    fetchStatsByHost.set(host, s)
  }
  s.requests++
  s.waitMs += waitMs
  if (status === 0 || status >= 400) s.failed++
  s.statuses[status] = (s.statuses[status] ?? 0) + 1
}

function hostOf(url: string): string {
  try {
    return new URL(url, location.href).host
  } catch {
    return '?'
  }
}

function add(bytes: number, url: string): void {
  if (!(bytes > 0)) return
  totalBytes += bytes
  const host = hostOf(url)
  bytesByHost.set(host, (bytesByHost.get(host) ?? 0) + bytes)
  notify()
}

function countingResponse(res: Response): Response {
  if (!res.body || typeof TransformStream === 'undefined') return res
  const url = res.url
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      add(chunk.byteLength, url)
      controller.enqueue(chunk)
    },
  })
  const wrapped = new Response(res.body.pipeThrough(counter), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
  Object.defineProperties(wrapped, {
    url: { value: res.url },
    redirected: { value: res.redirected },
    type: { value: res.type },
  })
  return wrapped
}

export function installNetworkBytesMeter(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const input = args[0]
    const reqHost = hostOf(
      typeof input === 'string' || input instanceof URL ? String(input) : input.url,
    )
    const t0 = performance.now()
    let res: Response
    try {
      res = await nativeFetch(...args)
    } catch (err) {
      recordFetch(reqHost, 0, performance.now() - t0)
      throw err
    }
    recordFetch(reqHost, res.status, performance.now() - t0)
    const method = (
      args[1]?.method ??
      (args[0] instanceof Request ? args[0].method : 'GET')
    ).toUpperCase()
    if (method === 'HEAD' || res.status === 204 || res.status === 304) return res
    if (!/^https?:/.test(res.url) || hostOf(res.url) === location.host) {
      return res
    }
    return countingResponse(res)
  }

  ;(window as unknown as { __netStats?: () => Record<string, unknown> })
    .__netStats = () => {
    const hosts = new Set([...bytesByHost.keys(), ...fetchStatsByHost.keys()])
    return Object.fromEntries(
      [...hosts].map((h) => {
        const s = fetchStatsByHost.get(h)
        return [
          h,
          {
            data: formatMegabytes(bytesByHost.get(h) ?? 0),
            requests: s?.requests ?? 0,
            failed: s?.failed ?? 0,
            avgWaitMs: s?.requests ? Math.round(s.waitMs / s.requests) : 0,
            statuses: s?.statuses ?? {},
          },
        ]
      }),
    )
  }

  if (typeof PerformanceObserver === 'undefined') return
  const onEntries = (entries: PerformanceEntryList) => {
    for (const e of entries as PerformanceResourceTiming[]) {
      if (e.initiatorType === 'fetch' && hostOf(e.name) !== location.host) {
        continue
      }
      add(e.transferSize, e.name)
    }
  }
  try {
    new PerformanceObserver((list) => onEntries(list.getEntries())).observe({
      type: 'resource',
      buffered: true,
    })
  } catch {
    /* Resource Timing unavailable — fetch counting still works. */
  }
}

export function getNetworkBytesTotal(): number {
  return totalBytes
}

export function subscribeNetworkBytes(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function formatMegabytes(bytes: number, unit = 'Mo'): string {
  const mb = bytes / (1024 * 1024)
  if (mb < 10) return `${mb.toFixed(1)} ${unit}`
  return `${Math.round(mb)} ${unit}`
}
