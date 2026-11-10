export type AddressSearchResult = {
  label: string
  lat: number
  lon: number
  bbox: [number, number, number, number] | null
}

type NominatimItem = {
  display_name?: string
  lat?: string
  lon?: string
  boundingbox?: [string, string, string, string]
}

/**
 * Nominatim search (browser). Keep it light — debounce + short queries only.
 */
export async function searchAddresses(
  query: string,
  options?: {
    limit?: number
    signal?: AbortSignal
    /** Soft bias toward current map view (viewbox). */
    viewbox?: [number, number, number, number] | null
  },
): Promise<AddressSearchResult[]> {
  const q = query.trim()
  if (q.length < 3) return []

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('q', q)
  url.searchParams.set('limit', String(options?.limit ?? 5))
  url.searchParams.set('addressdetails', '0')
  if (options?.viewbox) {
    const [west, south, east, north] = options.viewbox
    url.searchParams.set('viewbox', `${west},${north},${east},${south}`)
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
