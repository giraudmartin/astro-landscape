export type AddressSearchResult = {
  label: string
  lat: number
  lon: number
  bbox: [number, number, number, number] | null
}

export type MapNear = { lat: number; lon: number }

type NominatimItem = {
  display_name?: string
  lat?: string
  lon?: string
  boundingbox?: [string, string, string, string]
}

function haversineKm(a: MapNear, b: MapNear): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Rank hits by distance to the map center (never drops distant unique places). */
export function sortByDistanceTo(
  results: AddressSearchResult[],
  near: MapNear,
): AddressSearchResult[] {
  return [...results].sort(
    (a, b) =>
      haversineKm(near, { lat: a.lat, lon: a.lon }) -
      haversineKm(near, { lat: b.lat, lon: b.lon }),
  )
}

function parseNominatimItems(data: NominatimItem[]): AddressSearchResult[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((item) => {
    const lat = Number(item.lat)
    const lon = Number(item.lon)
    const label = item.display_name?.trim()
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) return []
    let bbox: [number, number, number, number] | null = null
    if (item.boundingbox?.length === 4) {
      const south = Number(item.boundingbox[0])
      const north = Number(item.boundingbox[1])
      const west = Number(item.boundingbox[2])
      const east = Number(item.boundingbox[3])
      if ([south, north, west, east].every(Number.isFinite)) {
        bbox = [west, south, east, north]
      }
    }
    return [{ label, lat, lon, bbox }]
  })
}

/**
 * Nominatim search (browser).
 * Always worldwide — never `bounded=1` (that hid Deadvlei outside Namibia).
 * Soft viewbox + client distance sort only prefer nearby when several hits exist.
 */
export async function searchAddresses(
  query: string,
  options?: {
    limit?: number
    signal?: AbortSignal
    /** Soft bias toward current map view (bounded=0 only). */
    viewbox?: [number, number, number, number] | null
    /** Map center — used only to re-rank results. */
    near?: MapNear | null
  },
): Promise<AddressSearchResult[]> {
  const q = query.trim()
  if (q.length < 3) return []

  const limit = options?.limit ?? 5
  // Ask Nominatim for a few extra so distance re-rank can surface nearby hits
  // without ever excluding a unique far match like Deadvlei.
  const fetchLimit = Math.min(10, Math.max(limit, limit * 2))

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('q', q)
  url.searchParams.set('limit', String(fetchLimit))
  url.searchParams.set('addressdetails', '0')
  if (options?.viewbox) {
    const [west, south, east, north] = options.viewbox
    url.searchParams.set('viewbox', `${west},${north},${east},${south}`)
    // Soft preference only — hard bound hides places outside the viewport.
    url.searchParams.set('bounded', '0')
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
    signal: options?.signal,
  })
  if (!response.ok) {
    throw new Error(`Address search failed (${response.status})`)
  }

  const data = (await response.json()) as NominatimItem[]
  const results = parseNominatimItems(data)
  if (options?.near) {
    return sortByDistanceTo(results, options.near).slice(0, limit)
  }
  return results.slice(0, limit)
}
