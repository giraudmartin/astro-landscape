import {
  civilClockFromUtc,
  civilDateFromUtc,
  shiftIsoDate,
} from './celestial'
import {
  DEFAULT_FOCAL_LENGTH_MM,
  DEFAULT_FRAME_ROLL_DEG,
  DEFAULT_ORIENTATION,
  DEFAULT_SENSOR_FORMAT,
  clampFrameRollDeg,
  normalizeViewfinderFrameMode,
  type SensorFormat,
  type ViewfinderFrameMode,
  type ViewfinderOrientation,
} from './lensFov'
import {
  DEFAULT_PANORAMA_PLAN,
  type PanoramaPlan,
} from './panorama'
import {
  DEFAULT_TIMELAPSE_PLAN,
  normalizeTimelapsePlan,
  type TimelapsePlan,
} from './timelapse'
import {
  PERSONAL_EVENTS_STORAGE_KEY,
  type PersonalEvent,
} from './personalEvents'

export const PERSONAL_FRAMINGS_STORAGE_KEY =
  'astro-landscape.personal-framings.v1'

export type FramingSource = 'immersive' | 'manual' | 'migrated'

/** Cadrage kinds — Timelapse is Photo-framed + plan, stored as its own type. */
export type FramingCaptureMode = 'dslr' | 'pano' | 'timelapse'

/** Snapshot of viewfinder + look needed to restore a cadrage. */
export type FramingViewSnapshot = {
  frameMode: FramingCaptureMode
  focalMm: number
  orientation: ViewfinderOrientation
  sensorFormat: SensorFormat
  frameRollDeg: number
  bearingDeg: number
  pitchDeg: number
  eyeHeightM: number | null
  panorama: PanoramaPlan | null
  timelapse: TimelapsePlan | null
}

export type PersonalFraming = {
  id: string
  name: string
  lat: number
  lon: number
  /** Absolute shot time (ISO UTC). */
  peakUtc: string
  /** Civil wall-clock `YYYY-MM-DDTHH:MM:SS` at observer lon. */
  peakLocal: string
  /** YYYY-MM-DD civil calendar date of the shot. */
  localDate: string
  spotId: string
  spotName: string
  heightM: number | null
  view: FramingViewSnapshot
  /** IndexedDB thumb key; null when capture failed / migrated. */
  thumbId: string | null
  source: FramingSource
  note: string | null
  createdAtIso: string
}

export type FramingsUiPersist = {
  display: 'list' | 'calendar'
  day: string
  month: string
  filterSpotId: string
}

function newId(prefix = 'framing'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function formatCivilLocalTimestamp(utcMs: number, lon: number): string {
  return `${civilDateFromUtc(utcMs, lon)}T${civilClockFromUtc(utcMs, lon)}`
}

export function framingMonthFromDay(day: string): string {
  return day.slice(0, 7)
}

/** Stable id for an unsaved map pin (geo-only cadrages). */
export function framingGeoSpotId(lat: number, lon: number): string {
  return `geo:${lat.toFixed(5)},${lon.toFixed(5)}`
}

/** Compact coords label when the pin has no saved spot name. */
export function framingCoordsLabel(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(5)}°${ns} · ${Math.abs(lon).toFixed(5)}°${ew}`
}

/** Night bucket: before 06:00 local → previous civil day. */
export function framingNightGroupDay(peakLocal: string): string {
  const day = peakLocal.slice(0, 10)
  const hm = peakLocal.slice(11, 16)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(hm)) {
    return day || ''
  }
  if (hm < '06:00') {
    return shiftIsoDate(day, -1) ?? day
  }
  return day
}

export function isNightLocalTime(peakLocal: string): boolean {
  const hour = Number(peakLocal.slice(11, 13))
  if (!Number.isFinite(hour)) return false
  return hour < 6 || hour >= 18
}

/** Display label for cadrage type (list tags + default names). */
export type FramingTypeKind = 'photo' | 'pano' | 'timelapse'

export function framingTypeKind(frameMode: FramingCaptureMode): FramingTypeKind {
  if (frameMode === 'pano') return 'pano'
  if (frameMode === 'timelapse') return 'timelapse'
  return 'photo'
}

export function framingTypeLabel(frameMode: FramingCaptureMode): string {
  const kind = framingTypeKind(frameMode)
  if (kind === 'pano') return 'Pano'
  if (kind === 'timelapse') return 'Timelapse'
  return 'Photo'
}

/** List badge: `Pano 5×2` when grid is known, else plain type label. */
export function framingTypeBadgeLabel(view: FramingViewSnapshot): string {
  if (view.frameMode !== 'pano') return framingTypeLabel(view.frameMode)
  const columns = view.panorama?.columns
  const rows = view.panorama?.rows
  if (
    typeof columns === 'number' &&
    typeof rows === 'number' &&
    Number.isFinite(columns) &&
    Number.isFinite(rows) &&
    columns > 0 &&
    rows > 0
  ) {
    return `Pano ${Math.round(columns)}×${Math.round(rows)}`
  }
  return 'Pano'
}

/** Default name: `Photo 1`, `Pano 2`, … — next free index among existingNames. */
export function suggestFramingName(
  view: FramingViewSnapshot,
  existingNames: readonly string[] = [],
): string {
  const type = framingTypeLabel(view.frameMode)
  const re = new RegExp(`^${escapeRegExp(type)}(?:\\s+(\\d+))?$`, 'i')
  let max = 0
  for (const raw of existingNames) {
    const m = raw.trim().match(re)
    if (!m) continue
    const n = m[1] ? Number(m[1]) : 1
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${type} ${max + 1}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function framingViewSummary(view: FramingViewSnapshot): string {
  const mode = framingTypeLabel(view.frameMode)
  const orient = view.orientation === 'portrait' ? 'Portrait' : 'Paysage'
  return `${mode} · ${Math.round(view.focalMm)} mm · ${orient}`
}

export function framingAngleSummary(view: FramingViewSnapshot): string {
  const alt =
    view.pitchDeg > 0
      ? `+${Math.round(view.pitchDeg)}°`
      : `${Math.round(view.pitchDeg)}°`
  return `${Math.round(((view.bearingDeg % 360) + 360) % 360)}° az. · ${alt} él.`
}

export function createPersonalFraming(input: {
  name: string
  lat: number
  lon: number
  peakUtc: string
  peakLocal: string
  localDate: string
  spotId: string
  spotName: string
  heightM?: number | null
  view: FramingViewSnapshot
  thumbId?: string | null
  source?: FramingSource
  note?: string | null
}): PersonalFraming {
  const elev = input.heightM
  return {
    id: newId('framing'),
    name: input.name.trim() || 'Cadrage sans nom',
    lat: input.lat,
    lon: input.lon,
    peakUtc: input.peakUtc,
    peakLocal: input.peakLocal,
    localDate: input.localDate.slice(0, 10),
    spotId: input.spotId,
    spotName: input.spotName.trim() || 'Spot',
    heightM: elev != null && Number.isFinite(elev) ? elev : null,
    view: normalizeViewSnapshot(input.view),
    thumbId: input.thumbId?.trim() ? input.thumbId : null,
    source: input.source ?? 'immersive',
    note: input.note?.trim() ? input.note.trim() : null,
    createdAtIso: new Date().toISOString(),
  }
}

export function upsertPersonalFraming(
  framings: PersonalFraming[],
  next: PersonalFraming,
): PersonalFraming[] {
  const idx = framings.findIndex((row) => row.id === next.id)
  if (idx < 0) return [next, ...framings]
  const copy = [...framings]
  const prev = copy[idx]!
  copy[idx] = {
    ...prev,
    ...next,
    id: prev.id,
    createdAtIso: prev.createdAtIso,
  }
  return copy
}

export function removePersonalFraming(
  framings: PersonalFraming[],
  id: string,
): PersonalFraming[] {
  return framings.filter((row) => row.id !== id)
}

export function sortFramingsByPeak(
  framings: PersonalFraming[],
): PersonalFraming[] {
  return [...framings].sort((a, b) => {
    const byPeak = a.peakUtc.localeCompare(b.peakUtc)
    if (byPeak !== 0) return byPeak
    return b.createdAtIso.localeCompare(a.createdAtIso)
  })
}

export type FramingNightGroup = {
  day: string
  items: PersonalFraming[]
}

export function groupFramingsByNight(
  framings: PersonalFraming[],
): FramingNightGroup[] {
  const map = new Map<string, PersonalFraming[]>()
  for (const framing of sortFramingsByPeak(framings)) {
    const day = framingNightGroupDay(framing.peakLocal)
    const list = map.get(day)
    if (list) list.push(framing)
    else map.set(day, [framing])
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, items]) => ({ day, items }))
}

export function framingNightLabel(
  day: string,
  items: PersonalFraming[],
  locale = 'fr-FR',
): string {
  const dayFmt = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
  const fullFmt = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const asUtc = (iso: string) => new Date(`${iso}T12:00:00Z`)
  if (!items.some((row) => isNightLocalTime(row.peakLocal))) {
    return fullFmt.format(asUtc(day))
  }
  const next = shiftIsoDate(day, 1) ?? day
  const sameYear = day.slice(0, 4) === next.slice(0, 4)
  const sameMonth = day.slice(0, 7) === next.slice(0, 7)
  const start = sameMonth
    ? String(asUtc(day).getUTCDate())
    : sameYear
      ? dayFmt.format(asUtc(day))
      : fullFmt.format(asUtc(day))
  const end = sameYear
    ? `${dayFmt.format(asUtc(next))} ${next.slice(0, 4)}`
    : fullFmt.format(asUtc(next))
  return `Nuit du ${start} au ${end}`
}

function defaultViewSnapshot(): FramingViewSnapshot {
  return {
    frameMode: 'dslr',
    focalMm: DEFAULT_FOCAL_LENGTH_MM,
    orientation: DEFAULT_ORIENTATION,
    sensorFormat: DEFAULT_SENSOR_FORMAT,
    frameRollDeg: DEFAULT_FRAME_ROLL_DEG,
    bearingDeg: 0,
    pitchDeg: 0,
    eyeHeightM: null,
    panorama: null,
    timelapse: null,
  }
}

function normalizeViewSnapshot(value: unknown): FramingViewSnapshot {
  const base = defaultViewSnapshot()
  if (!value || typeof value !== 'object') return base
  const row = value as Record<string, unknown>
  const frameMode: FramingCaptureMode =
    row.frameMode === 'timelapse'
      ? 'timelapse'
      : normalizeViewfinderFrameMode(row.frameMode) === 'pano'
        ? 'pano'
        : 'dslr'
  const focal = Number(row.focalMm)
  const bearing = Number(row.bearingDeg)
  const pitch = Number(row.pitchDeg)
  const eye = Number(row.eyeHeightM)
  const orientation =
    row.orientation === 'portrait' || row.orientation === 'landscape'
      ? row.orientation
      : base.orientation
  const sensorFormat =
    row.sensorFormat === 'ff' ||
    row.sensorFormat === 'apsc15' ||
    row.sensorFormat === 'apsc16'
      ? row.sensorFormat
      : base.sensorFormat
  let panorama: PanoramaPlan | null = null
  if (row.panorama && typeof row.panorama === 'object') {
    panorama = { ...DEFAULT_PANORAMA_PLAN, ...(row.panorama as PanoramaPlan) }
  }
  let timelapse: TimelapsePlan | null = null
  if (row.timelapse && typeof row.timelapse === 'object') {
    timelapse = normalizeTimelapsePlan(row.timelapse as TimelapsePlan)
  }
  return {
    frameMode,
    focalMm: Number.isFinite(focal) ? focal : base.focalMm,
    orientation,
    sensorFormat,
    frameRollDeg: clampFrameRollDeg(Number(row.frameRollDeg)),
    bearingDeg: Number.isFinite(bearing) ? bearing : 0,
    pitchDeg: Number.isFinite(pitch) ? pitch : 0,
    eyeHeightM: Number.isFinite(eye) ? eye : null,
    panorama,
    timelapse,
  }
}

function migrateEvent(event: PersonalEvent): PersonalFraming {
  return {
    id: event.id,
    name: event.name,
    lat: event.lat,
    lon: event.lon,
    peakUtc: event.peakUtc,
    peakLocal: event.peakLocal,
    localDate: event.localDate,
    spotId: event.spotId?.trim() || `geo:${event.lat.toFixed(5)},${event.lon.toFixed(5)}`,
    spotName: event.spotName?.trim() || 'Position carte',
    heightM: event.heightM,
    view: {
      ...defaultViewSnapshot(),
      bearingDeg: event.bearingDeg,
      pitchDeg: event.pitchDeg,
    },
    thumbId: null,
    source: 'migrated',
    note: event.note,
    createdAtIso: event.createdAtIso,
  }
}

function normalizeStoredFraming(value: unknown): PersonalFraming | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const lat = Number(row.lat)
  const lon = Number(row.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const peakUtc = typeof row.peakUtc === 'string' ? row.peakUtc : ''
  const peakLocal = typeof row.peakLocal === 'string' ? row.peakLocal : ''
  const localDate = typeof row.localDate === 'string' ? row.localDate : ''
  if (!peakUtc || !peakLocal || !/^\d{4}-\d{2}-\d{2}/.test(localDate)) {
    return null
  }
  const spotId =
    typeof row.spotId === 'string' && row.spotId.trim()
      ? row.spotId.trim()
      : `geo:${lat.toFixed(5)},${lon.toFixed(5)}`
  const spotName =
    typeof row.spotName === 'string' && row.spotName.trim()
      ? row.spotName.trim()
      : 'Spot'
  const name =
    typeof row.name === 'string' && row.name.trim()
      ? row.name.trim()
      : 'Cadrage sans nom'
  const id = typeof row.id === 'string' && row.id ? row.id : newId('framing')
  const elevRaw = Number(row.heightM)
  const source: FramingSource =
    row.source === 'immersive' || row.source === 'migrated'
      ? row.source
      : 'manual'
  const thumbId =
    typeof row.thumbId === 'string' && row.thumbId.trim()
      ? row.thumbId.trim()
      : null
  const note =
    typeof row.note === 'string' && row.note.trim() ? row.note.trim() : null
  const createdAtIso =
    typeof row.createdAtIso === 'string' && row.createdAtIso
      ? row.createdAtIso
      : new Date().toISOString()
  const view =
    row.view != null
      ? normalizeViewSnapshot(row.view)
      : {
          ...defaultViewSnapshot(),
          bearingDeg: Number(row.bearingDeg) || 0,
          pitchDeg: Number(row.pitchDeg) || 0,
        }
  return {
    id,
    name,
    lat,
    lon,
    peakUtc,
    peakLocal,
    localDate: localDate.slice(0, 10),
    spotId,
    spotName,
    heightM: Number.isFinite(elevRaw) ? elevRaw : null,
    view,
    thumbId,
    source,
    note,
    createdAtIso,
  }
}

function loadLegacyEvents(): PersonalFraming[] {
  try {
    const raw = localStorage.getItem(PERSONAL_EVENTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((row) => {
        // Reuse personalEvents normalizer shape loosely via migrate
        if (!row || typeof row !== 'object') return null
        const r = row as Record<string, unknown>
        const lat = Number(r.lat)
        const lon = Number(r.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
        const peakUtc = typeof r.peakUtc === 'string' ? r.peakUtc : ''
        const peakLocal = typeof r.peakLocal === 'string' ? r.peakLocal : ''
        const localDate = typeof r.localDate === 'string' ? r.localDate : ''
        if (!peakUtc || !peakLocal || !/^\d{4}-\d{2}-\d{2}/.test(localDate)) {
          return null
        }
        const event: PersonalEvent = {
          id: typeof r.id === 'string' && r.id ? r.id : newId('event'),
          name:
            typeof r.name === 'string' && r.name.trim()
              ? r.name.trim()
              : 'Événement sans nom',
          lat,
          lon,
          peakUtc,
          peakLocal,
          localDate: localDate.slice(0, 10),
          spotId:
            typeof r.spotId === 'string' && r.spotId.trim() ? r.spotId : null,
          spotName:
            typeof r.spotName === 'string' && r.spotName.trim()
              ? r.spotName.trim()
              : null,
          heightM: Number.isFinite(Number(r.heightM)) ? Number(r.heightM) : null,
          bearingDeg: Number.isFinite(Number(r.bearingDeg))
            ? Number(r.bearingDeg)
            : 0,
          pitchDeg: Number.isFinite(Number(r.pitchDeg))
            ? Number(r.pitchDeg)
            : 55,
          source: 'manual',
          note:
            typeof r.note === 'string' && r.note.trim() ? r.note.trim() : null,
          createdAtIso:
            typeof r.createdAtIso === 'string' && r.createdAtIso
              ? r.createdAtIso
              : new Date().toISOString(),
        }
        return migrateEvent(event)
      })
      .filter((row): row is PersonalFraming => row != null)
  } catch {
    return []
  }
}

export function loadPersonalFramings(): PersonalFraming[] {
  try {
    const raw = localStorage.getItem(PERSONAL_FRAMINGS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .map(normalizeStoredFraming)
          .filter((row): row is PersonalFraming => row != null)
      }
    }
  } catch {
    /* fall through to legacy */
  }
  const legacy = loadLegacyEvents()
  if (legacy.length > 0) {
    savePersonalFramings(legacy)
  }
  return legacy
}

export function savePersonalFramings(framings: PersonalFraming[]): void {
  localStorage.setItem(PERSONAL_FRAMINGS_STORAGE_KEY, JSON.stringify(framings))
}

export function datetimeLocalFromPeakLocal(peakLocal: string): string {
  // datetime-local wants YYYY-MM-DDTHH:MM
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(peakLocal)) {
    return peakLocal.slice(0, 16)
  }
  return peakLocal
}

export function peakLocalFromDatetimeLocal(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return `${value}:00`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    return value.slice(0, 19)
  }
  return value
}

/** Convert civil local stamp at lon → UTC ISO. */
export function peakUtcFromCivilLocal(peakLocal: string, lon: number): string {
  const local = peakLocalFromDatetimeLocal(peakLocal)
  const date = local.slice(0, 10)
  const clock = local.slice(11, 19) || '00:00:00'
  const [y, mo, d] = date.split('-').map(Number)
  const [hh, mm, ss] = clock.split(':').map(Number)
  const asIfUtc = Date.UTC(y!, mo! - 1, d!, hh ?? 0, mm ?? 0, ss ?? 0)
  const offsetMs =
    Math.max(-12, Math.min(14, Math.round(lon / 15))) * 3600_000
  return new Date(asIfUtc - offsetMs).toISOString()
}
