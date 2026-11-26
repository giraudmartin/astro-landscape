export type AddressSearchResult = {
  label: string
  lat: number
  lon: number
  bbox: [number, number, number, number] | null
}

export type MapNear = { lat: number; lon: number }

/** Photon / GeocodeJSON feature properties we care about. */
type PhotonProperties = {
  name?: string
  housenumber?: string
  street?: string
  district?: string
  city?: string
  county?: string
  state?: string
  country?: string
  postcode?: string
  /** Photon extent: [minLon, maxLat, maxLon, minLat] */
  extent?: [number, number, number, number]
}

type PhotonFeature = {
  type?: string
  geometry?: {
    type?: string
    coordinates?: [number, number] | number[]
  }
  properties?: PhotonProperties
}

type PhotonResponse = {
  type?: string
  features?: PhotonFeature[]
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

/** Build a single-line label from Photon GeocodeJSON properties. */
export function formatPhotonLabel(props: PhotonProperties): string {
  const streetLine = [props.housenumber, props.street]
    .filter((p): p is string => Boolean(p?.trim()))
    .join(' ')
    .trim()
  const parts = [
    props.name?.trim(),
    streetLine || null,
    props.postcode?.trim(),
    props.district?.trim(),
    props.city?.trim(),
    props.county?.trim(),
    props.state?.trim(),
    props.country?.trim(),
  ].filter((p): p is string => Boolean(p))

  // Drop consecutive duplicates (e.g. name === city for "Berlin").
  const deduped: string[] = []
  for (const part of parts) {
    if (
      deduped.length === 0 ||
      deduped[deduped.length - 1].toLowerCase() !== part.toLowerCase()
    ) {
      deduped.push(part)
    }
  }
  return deduped.join(', ')
}

function extentToBbox(
  extent: [number, number, number, number] | undefined,
): [number, number, number, number] | null {
  if (!extent || extent.length !== 4) return null
  const [minLon, maxLat, maxLon, minLat] = extent.map(Number)
  if (![minLon, maxLat, maxLon, minLat].every(Number.isFinite)) return null
  // AddressSearchResult bbox: [west, south, east, north]
  return [minLon, minLat, maxLon, maxLat]
}

/** Map Photon GeoJSON features → AddressSearchResult (exported for unit tests). */
export function parsePhotonFeatures(
  data: PhotonResponse | PhotonFeature[] | unknown,
): AddressSearchResult[] {
  const features = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as PhotonResponse).features)
      ? (data as PhotonResponse).features!
      : null
  if (!features) return []

  return features.flatMap((feature) => {
    const coords = feature?.geometry?.coordinates
    if (!coords || coords.length < 2) return []
    const lon = Number(coords[0])
    const lat = Number(coords[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []
    const props = feature.properties ?? {}
    const label = formatPhotonLabel(props)
    if (!label) return []
    return [
      {
        label,
        lat,
        lon,
        bbox: extentToBbox(props.extent),
      },
    ]
  })
}

/**
 * Photon (Komoot) place search — direct browser call to photon.komoot.io.
 * Always worldwide — never Photon's hard `bbox` filter (that hid far places).
 * Soft lat/lon location bias + client distance sort only prefer nearby when
 * several hits exist.
 */
export async function searchAddresses(
  query: string,
  options?: {
    limit?: number
    signal?: AbortSignal
    /**
     * Soft bias toward current map view. Unused as a Photon hard filter;
     * kept for API compatibility — prefer `near` for location bias.
     */
    viewbox?: [number, number, number, number] | null
    /** Map center — soft Photon lat/lon bias + client re-rank. */
    near?: MapNear | null
  },
): Promise<AddressSearchResult[]> {
  const q = query.trim()
  if (q.length < 3) return []

  const limit = options?.limit ?? 5
  // Ask Photon for a few extra so distance re-rank can surface nearby hits
  // without ever excluding a unique far match like Deadvlei.
  const fetchLimit = Math.min(10, Math.max(limit, limit * 2))

  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', q)
  url.searchParams.set('limit', String(fetchLimit))

  // Soft location bias only — never Photon's hard `bbox=` filter.
  const near =
    options?.near ??
    (options?.viewbox
      ? {
          lon: (options.viewbox[0] + options.viewbox[2]) / 2,
          lat: (options.viewbox[1] + options.viewbox[3]) / 2,
        }
      : null)
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lon)) {
    url.searchParams.set('lat', String(near.lat))
    url.searchParams.set('lon', String(near.lon))
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

  const data = (await response.json()) as PhotonResponse
  const results = parsePhotonFeatures(data)
  if (options?.near) {
    return sortByDistanceTo(results, options.near).slice(0, limit)
  }
  return results.slice(0, limit)
}
