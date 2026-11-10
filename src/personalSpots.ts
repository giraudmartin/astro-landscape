import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap, Marker } from 'maplibre-gl'

export const PERSONAL_SPOTS_STORAGE_KEY = 'astro-landscape.personal-spots.v1'

export type PersonalSpot = {
  id: string
  name: string
  lat: number
  lon: number
  /** Terrain elevation at pin when known (m). */
  heightM: number | null
  bearingDeg: number
  pitchDeg: number
  createdAtIso: string
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `spot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function createPersonalSpot(input: {
  name: string
  lat: number
  lon: number
  heightM?: number | null
  bearingDeg?: number
  pitchDeg?: number
}): PersonalSpot {
  const height = input.heightM
  return {
    id: newId(),
    name: input.name.trim() || 'Spot sans nom',
    lat: input.lat,
    lon: input.lon,
    heightM: height != null && Number.isFinite(height) ? height : null,
    bearingDeg: Number.isFinite(input.bearingDeg) ? Number(input.bearingDeg) : 0,
    pitchDeg: Number.isFinite(input.pitchDeg) ? Number(input.pitchDeg) : 55,
    createdAtIso: new Date().toISOString(),
  }
}

function normalizeStoredSpot(value: unknown): PersonalSpot | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const lat = Number(row.lat)
  const lon = Number(row.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  const name =
    typeof row.name === 'string' && row.name.trim()
      ? row.name.trim()
      : 'Spot sans nom'
  const id = typeof row.id === 'string' && row.id ? row.id : newId()
  const elevRaw = Number(row.heightM)
  const heightM = Number.isFinite(elevRaw) ? elevRaw : null
  const bearingDeg = Number(row.bearingDeg)
  const pitchDeg = Number(row.pitchDeg)
  const createdAtIso =
    typeof row.createdAtIso === 'string' && row.createdAtIso
      ? row.createdAtIso
      : new Date().toISOString()
  return {
    id,
    name,
    lat,
    lon,
    heightM,
    bearingDeg: Number.isFinite(bearingDeg) ? bearingDeg : 0,
    pitchDeg: Number.isFinite(pitchDeg) ? pitchDeg : 55,
    createdAtIso,
  }
}

export function loadPersonalSpots(): PersonalSpot[] {
  try {
    const raw = localStorage.getItem(PERSONAL_SPOTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeStoredSpot)
      .filter((spot): spot is PersonalSpot => spot != null)
      .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))
  } catch {
    return []
  }
}

export function savePersonalSpots(spots: PersonalSpot[]): void {
  localStorage.setItem(PERSONAL_SPOTS_STORAGE_KEY, JSON.stringify(spots))
}

export function upsertPersonalSpot(
  existing: PersonalSpot[],
  spot: PersonalSpot,
): PersonalSpot[] {
  const index = existing.findIndex((row) => row.id === spot.id)
  if (index < 0) {
    return [spot, ...existing]
  }
  const next = existing.slice()
  next[index] = spot
  return next
}

export function removePersonalSpot(
  existing: PersonalSpot[],
  spotId: string,
): PersonalSpot[] {
  return existing.filter((spot) => spot.id !== spotId)
}

/** Same camera glyph as Photo Sightline personal-spot markers. */
const PERSONAL_SPOT_CAMERA_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">' +
  '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/>' +
  '<circle cx="12" cy="13" r="3"/>' +
  '</svg>'

export function createPersonalSpotMarkerElement(
  spot: PersonalSpot,
): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'personal-spot-marker'
  el.style.width = '46.4px'
  el.style.height = '46.4px'
  el.style.position = 'absolute'
  el.innerHTML =
    `<span class="personal-spot-marker__center" title="${escapeHtml(spot.name)}">` +
    `<span class="personal-spot-marker__camera">${PERSONAL_SPOT_CAMERA_ICON}</span>` +
    '</span>' +
    `<span class="personal-spot-marker__label">${escapeHtml(spot.name)}</span>`
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', `Spot ${spot.name}`)
  el.title = spot.name
  return el
}

export function renderPersonalSpotMarkers(
  map: MapLibreMap,
  spots: PersonalSpot[],
  selectedId: string | null,
  onSelect: (spot: PersonalSpot) => void,
): Marker[] {
  // Selected spot uses the main pin marker — skip its camera pin.
  const visible = spots.filter((spot) => spot.id !== selectedId)
  return visible.map((spot) => {
    const marker = new maplibregl.Marker({
      element: createPersonalSpotMarkerElement(spot),
      anchor: 'center',
      offset: [0, 0],
    })
      .setLngLat([spot.lon, spot.lat])
      .addTo(map)
    marker.getElement().addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      onSelect(spot)
    })
    return marker
  })
}

export function fitPersonalSpots(
  map: MapLibreMap,
  spots: PersonalSpot[],
): void {
  if (spots.length === 0) return
  if (spots.length === 1) {
    map.flyTo({
      center: [spots[0]!.lon, spots[0]!.lat],
      zoom: Math.max(map.getZoom(), 13),
      duration: 600,
    })
    return
  }
  const bounds = new maplibregl.LngLatBounds()
  for (const spot of spots) bounds.extend([spot.lon, spot.lat])
  map.fitBounds(bounds, {
    padding: { top: 88, right: 48, bottom: 88, left: 48 },
    maxZoom: 14,
    duration: 600,
  })
}
