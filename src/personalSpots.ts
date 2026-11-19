import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap, Marker } from 'maplibre-gl'

export const PERSONAL_SPOTS_STORAGE_KEY = 'astro-landscape.personal-spots.v1'

export type PersonalSpotFolder = {
  id: string
  name: string
  visible: boolean
  createdAtIso: string
}

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
  /** Parent folder id, or null when unfiled. */
  folderId: string | null
  /** When false, the spot marker is hidden on the map. */
  visible: boolean
}

export type PersonalSpotsState = {
  spots: PersonalSpot[]
  folders: PersonalSpotFolder[]
}

function newId(prefix = 'spot'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
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
  folderId?: string | null
  visible?: boolean
}): PersonalSpot {
  const height = input.heightM
  return {
    id: newId('spot'),
    name: input.name.trim() || 'Spot sans nom',
    lat: input.lat,
    lon: input.lon,
    heightM: height != null && Number.isFinite(height) ? height : null,
    bearingDeg: Number.isFinite(input.bearingDeg) ? Number(input.bearingDeg) : 0,
    pitchDeg: Number.isFinite(input.pitchDeg) ? Number(input.pitchDeg) : 55,
    createdAtIso: new Date().toISOString(),
    folderId: input.folderId ?? null,
    visible: input.visible !== false,
  }
}

export function createPersonalSpotFolder(input: {
  name: string
  visible?: boolean
}): PersonalSpotFolder {
  return {
    id: newId('folder'),
    name: input.name.trim() || 'Dossier sans nom',
    visible: input.visible !== false,
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
  const id = typeof row.id === 'string' && row.id ? row.id : newId('spot')
  const elevRaw = Number(row.heightM)
  const heightM = Number.isFinite(elevRaw) ? elevRaw : null
  const bearingDeg = Number(row.bearingDeg)
  const pitchDeg = Number(row.pitchDeg)
  const createdAtIso =
    typeof row.createdAtIso === 'string' && row.createdAtIso
      ? row.createdAtIso
      : new Date().toISOString()
  const folderId =
    typeof row.folderId === 'string' && row.folderId ? row.folderId : null
  const visible = row.visible !== false
  return {
    id,
    name,
    lat,
    lon,
    heightM,
    bearingDeg: Number.isFinite(bearingDeg) ? bearingDeg : 0,
    pitchDeg: Number.isFinite(pitchDeg) ? pitchDeg : 55,
    createdAtIso,
    folderId,
    visible,
  }
}

function normalizeStoredFolder(value: unknown): PersonalSpotFolder | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const name =
    typeof row.name === 'string' && row.name.trim()
      ? row.name.trim()
      : 'Dossier sans nom'
  const id = typeof row.id === 'string' && row.id ? row.id : newId('folder')
  const createdAtIso =
    typeof row.createdAtIso === 'string' && row.createdAtIso
      ? row.createdAtIso
      : new Date().toISOString()
  return {
    id,
    name,
    visible: row.visible !== false,
    createdAtIso,
  }
}

function sortSpots(spots: PersonalSpot[]): PersonalSpot[] {
  return spots
    .slice()
    .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))
}

function sortFolders(folders: PersonalSpotFolder[]): PersonalSpotFolder[] {
  return folders
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

function sanitizeState(spots: PersonalSpot[], folders: PersonalSpotFolder[]): PersonalSpotsState {
  const folderIds = new Set(folders.map((folder) => folder.id))
  const cleanedSpots = spots.map((spot) =>
    spot.folderId && !folderIds.has(spot.folderId)
      ? { ...spot, folderId: null }
      : spot,
  )
  return {
    spots: sortSpots(cleanedSpots),
    folders: sortFolders(folders),
  }
}

export function loadPersonalSpotsState(): PersonalSpotsState {
  try {
    const raw = localStorage.getItem(PERSONAL_SPOTS_STORAGE_KEY)
    if (!raw) return { spots: [], folders: [] }
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return sanitizeState(
        parsed
          .map(normalizeStoredSpot)
          .filter((spot): spot is PersonalSpot => spot != null),
        [],
      )
    }
    if (!parsed || typeof parsed !== 'object') return { spots: [], folders: [] }
    const row = parsed as Record<string, unknown>
    const spotsRaw = Array.isArray(row.spots) ? row.spots : []
    const foldersRaw = Array.isArray(row.folders) ? row.folders : []
    return sanitizeState(
      spotsRaw
        .map(normalizeStoredSpot)
        .filter((spot): spot is PersonalSpot => spot != null),
      foldersRaw
        .map(normalizeStoredFolder)
        .filter((folder): folder is PersonalSpotFolder => folder != null),
    )
  } catch {
    return { spots: [], folders: [] }
  }
}

/** @deprecated Prefer loadPersonalSpotsState — kept for call sites that only need spots. */
export function loadPersonalSpots(): PersonalSpot[] {
  return loadPersonalSpotsState().spots
}

export function savePersonalSpotsState(state: PersonalSpotsState): void {
  const cleaned = sanitizeState(state.spots, state.folders)
  localStorage.setItem(
    PERSONAL_SPOTS_STORAGE_KEY,
    JSON.stringify({
      spots: cleaned.spots,
      folders: cleaned.folders,
    }),
  )
}

export function savePersonalSpots(spots: PersonalSpot[]): void {
  const current = loadPersonalSpotsState()
  savePersonalSpotsState({ spots, folders: current.folders })
}

export function upsertPersonalSpot(
  existing: PersonalSpot[],
  spot: PersonalSpot,
): PersonalSpot[] {
  const index = existing.findIndex((row) => row.id === spot.id)
  if (index < 0) {
    return sortSpots([spot, ...existing])
  }
  const next = existing.slice()
  next[index] = spot
  return sortSpots(next)
}

export function removePersonalSpot(
  existing: PersonalSpot[],
  spotId: string,
): PersonalSpot[] {
  return existing.filter((spot) => spot.id !== spotId)
}

export function upsertPersonalSpotFolder(
  existing: PersonalSpotFolder[],
  folder: PersonalSpotFolder,
): PersonalSpotFolder[] {
  const index = existing.findIndex((row) => row.id === folder.id)
  if (index < 0) {
    return sortFolders([folder, ...existing])
  }
  const next = existing.slice()
  next[index] = folder
  return sortFolders(next)
}

export function removePersonalSpotFolder(
  spots: PersonalSpot[],
  folders: PersonalSpotFolder[],
  folderId: string,
): PersonalSpotsState {
  return {
    folders: folders.filter((folder) => folder.id !== folderId),
    spots: spots.map((spot) =>
      spot.folderId === folderId ? { ...spot, folderId: null } : spot,
    ),
  }
}

export function movePersonalSpotToFolder(
  existing: PersonalSpot[],
  spotId: string,
  folderId: string | null,
): PersonalSpot[] {
  return existing.map((spot) =>
    spot.id === spotId ? { ...spot, folderId } : spot,
  )
}

export function setPersonalSpotVisible(
  existing: PersonalSpot[],
  spotId: string,
  visible: boolean,
): PersonalSpot[] {
  return existing.map((spot) =>
    spot.id === spotId ? { ...spot, visible } : spot,
  )
}

export function setPersonalSpotFolderVisible(
  existing: PersonalSpotFolder[],
  folderId: string,
  visible: boolean,
): PersonalSpotFolder[] {
  return existing.map((folder) =>
    folder.id === folderId ? { ...folder, visible } : folder,
  )
}

/** Spot appears on the map when both the spot and its folder (if any) are visible. */
export function personalSpotMapVisible(
  spot: PersonalSpot,
  folders: PersonalSpotFolder[],
): boolean {
  if (!spot.visible) return false
  if (!spot.folderId) return true
  const folder = folders.find((row) => row.id === spot.folderId)
  if (!folder) return true
  return folder.visible
}

export function filterMapVisiblePersonalSpots(
  spots: PersonalSpot[],
  folders: PersonalSpotFolder[],
): PersonalSpot[] {
  return spots.filter((spot) => personalSpotMapVisible(spot, folders))
}

/** Map pin — saved spots at rest; active working pin uses green camera. */
const PERSONAL_SPOT_PIN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">' +
  '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>' +
  '<circle cx="12" cy="10" r="3"/>' +
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
    `<span class="personal-spot-marker__pin">${PERSONAL_SPOT_PIN_ICON}</span>` +
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
  /** Hide the marker under the working pin when coords match. */
  activeLocation?: { lat: number; lon: number } | null,
): Marker[] {
  // Active / working pin is green camera — skip that location's map marker.
  const visible = spots.filter((spot) => {
    if (spot.id === selectedId) return false
    if (
      activeLocation &&
      Math.abs(spot.lat - activeLocation.lat) < 1e-6 &&
      Math.abs(spot.lon - activeLocation.lon) < 1e-6
    ) {
      return false
    }
    return true
  })
  return visible.map((spot) => {
    const marker = new maplibregl.Marker({
      element: createPersonalSpotMarkerElement(spot),
      anchor: 'center',
      offset: [0, 0],
    })
      .setLngLat([spot.lon, spot.lat])
      .addTo(map)
    const el = marker.getElement()
    // Left-click only selects. Right-click must reach the map to place a pin.
    el.addEventListener('click', (event) => {
      if (event.button !== 0) return
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
