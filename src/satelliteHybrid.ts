import { satellite } from '@versatiles/style'
import type {
  AddLayerObject,
  LayerSpecification,
  Map as MapLibreMap,
  StyleSpecification,
} from 'maplibre-gl'
import type { BasemapMode } from './basemapMode'

const HYBRID_SOURCE_ID = 'astro-versatiles-osm'
const HYBRID_PREFIX = 'astro-versatiles-hybrid-'
const PLAN_PREFIX = 'astro-openfreemap-'
const PLAN_SOURCE_PREFIX = 'astro-ofm-'
const VERSATILES_VECTOR_SOURCE_ID = 'versatiles-shortbread'
const OPENFREEMAP_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark'

/** Same basin tint Photo Sightline applies on OpenFreeMap dark. */
const BASIN = {
  background: '#22262f',
  water: '#1a2838',
  park: '#242a26',
  wood: '#212822',
  roadMinor: '#6a5f4e',
  roadMajor: '#a89068',
  roadCasing: '#2a2820',
  label: '#e4e7ec',
  labelHalo: '#14161c',
  building: '#464c58',
} as const

let hybridStylePromise: Promise<StyleSpecification> | null = null
let planStylePromise: Promise<StyleSpecification> | null = null

function loadHybridStyle(): Promise<StyleSpecification> {
  if (hybridStylePromise == null) {
    const style = satellite({
      urls: { base: 'https://tiles.versatiles.org' },
      osmOverlay: { layerOpacity: true },
    })
    style.sources[VERSATILES_VECTOR_SOURCE_ID] = {
      type: 'vector',
      scheme: 'xyz',
      tiles: ['https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}'],
      minzoom: 0,
      maxzoom: 14,
      bounds: [-180, -90, 180, 90],
      attribution:
        '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap</a> · VersaTiles',
    }
    hybridStylePromise = Promise.resolve(style)
  }
  return hybridStylePromise
}

function loadPlanStyle(): Promise<StyleSpecification> {
  if (planStylePromise == null) {
    planStylePromise = fetch(OPENFREEMAP_DARK_STYLE).then(async (res) => {
      if (!res.ok) throw new Error(`OpenFreeMap style HTTP ${res.status}`)
      return (await res.json()) as StyleSpecification
    })
  }
  return planStylePromise
}

function stripIcons(layout: Record<string, unknown> | undefined) {
  const next: Record<string, unknown> = { ...(layout ?? {}) }
  delete next['icon-image']
  delete next['icon-size']
  delete next['icon-rotate']
  delete next['icon-rotation-alignment']
  delete next['icon-padding']
  delete next['icon-optional']
  return next
}

function setPrefixedVisibility(
  map: MapLibreMap,
  prefix: string,
  visible: boolean,
): void {
  for (const layer of map.getStyle().layers ?? []) {
    if (!layer.id.startsWith(prefix)) continue
    map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none')
  }
}

function setPaintIfLayer(
  map: MapLibreMap,
  layerId: string,
  property: string,
  value: unknown,
): void {
  if (!map.getLayer(layerId)) return
  try {
    map.setPaintProperty(layerId, property, value)
  } catch {
    // property not supported on this layer
  }
}

/** Photo Sightline basin colors on OpenFreeMap dark layer ids (prefixed). */
function applyBasinTint(map: MapLibreMap): void {
  const p = PLAN_PREFIX
  setPaintIfLayer(map, `${p}background`, 'background-color', BASIN.background)
  setPaintIfLayer(map, `${p}water`, 'fill-color', BASIN.water)
  setPaintIfLayer(map, `${p}waterway`, 'line-color', BASIN.water)
  setPaintIfLayer(map, `${p}landuse_park`, 'fill-color', BASIN.park)
  setPaintIfLayer(map, `${p}landcover_grass`, 'fill-color', BASIN.park)
  setPaintIfLayer(map, `${p}landcover_wood`, 'fill-color', BASIN.wood)
  setPaintIfLayer(map, `${p}landuse_residential`, 'fill-color', BASIN.background)
  setPaintIfLayer(map, `${p}landuse`, 'fill-color', BASIN.background)
  setPaintIfLayer(map, `${p}landcover`, 'fill-color', BASIN.background)
  setPaintIfLayer(map, `${p}building`, 'fill-color', BASIN.building)

  for (const id of [
    'highway_path',
    'highway_minor',
    'highway_major_subtle',
    'highway_motorway_subtle',
  ]) {
    setPaintIfLayer(map, `${p}${id}`, 'line-color', BASIN.roadMinor)
    setPaintIfLayer(map, `${p}${id}`, 'line-opacity', 0.5)
  }
  for (const id of ['highway_major_inner', 'highway_motorway_inner']) {
    setPaintIfLayer(map, `${p}${id}`, 'line-color', BASIN.roadMajor)
    setPaintIfLayer(map, `${p}${id}`, 'line-opacity', 0.75)
  }
  for (const id of ['highway_major_casing', 'highway_motorway_casing']) {
    setPaintIfLayer(map, `${p}${id}`, 'line-color', BASIN.roadCasing)
    setPaintIfLayer(map, `${p}${id}`, 'line-opacity', 0.85)
  }

  for (const id of [
    'highway_name_other',
    'highway_name_motorway',
    'place_other',
    'place_suburb',
    'place_village',
    'place_town',
    'place_city',
    'place_city_large',
    'place_state',
    'place_country_other',
    'place_country_minor',
    'place_country_major',
    'water_name',
  ]) {
    setPaintIfLayer(map, `${p}${id}`, 'text-color', BASIN.label)
    setPaintIfLayer(map, `${p}${id}`, 'text-halo-color', BASIN.labelHalo)
  }
}

/** Lines + labels over satellite (same VersaTiles overlay as Photo Sightline). */
export async function ensureSatelliteHybridOverlay(
  map: MapLibreMap,
): Promise<string | undefined> {
  const style = await loadHybridStyle()
  if (!map.isStyleLoaded()) return style.glyphs

  if (!map.getSource(HYBRID_SOURCE_ID)) {
    const source = style.sources[VERSATILES_VECTOR_SOURCE_ID]
    if (!source || source.type !== 'vector') {
      throw new Error('VersaTiles OSM source unavailable.')
    }
    map.addSource(HYBRID_SOURCE_ID, source)
  }

  for (const layer of style.layers ?? []) {
    if (
      (layer.type !== 'line' && layer.type !== 'symbol') ||
      layer.source !== VERSATILES_VECTOR_SOURCE_ID
    ) {
      continue
    }
    const id = `${HYBRID_PREFIX}${layer.id}`
    if (map.getLayer(id)) continue
    map.addLayer({
      ...layer,
      id,
      source: HYBRID_SOURCE_ID,
      layout: {
        ...stripIcons(layer.layout as Record<string, unknown>),
        visibility: 'none',
      },
    } as AddLayerObject)
  }
  return style.glyphs
}

/**
 * OpenFreeMap dark plan (Photo Sightline basemap), inserted so hillshade can
 * sit above land fills and shade the relief.
 */
export async function ensurePlanBasemap(
  map: MapLibreMap,
): Promise<string | undefined> {
  const style = await loadPlanStyle()
  if (!map.isStyleLoaded()) return style.glyphs

  for (const [sourceId, source] of Object.entries(style.sources ?? {})) {
    const id = `${PLAN_SOURCE_PREFIX}${sourceId}`
    if (!map.getSource(id)) {
      map.addSource(id, source)
    }
  }

  if (style.sprite) {
    try {
      map.setSprite(
        typeof style.sprite === 'string' ? style.sprite : String(style.sprite),
      )
    } catch {
      // optional icons
    }
  }

  const beforeHillshade = map.getLayer('hillshade') ? 'hillshade' : undefined

  for (const layer of style.layers ?? []) {
    const id = `${PLAN_PREFIX}${layer.id}`
    if (map.getLayer(id)) continue

    const rewritten: LayerSpecification = {
      ...layer,
      id,
      layout: {
        ...(layer.layout ?? {}),
        visibility: 'none',
      },
    } as LayerSpecification

    if ('source' in rewritten && typeof rewritten.source === 'string') {
      rewritten.source = `${PLAN_SOURCE_PREFIX}${rewritten.source}`
    }

    // Land / water fills under hillshade; roads + labels above it.
    const underShade =
      layer.type === 'background' ||
      layer.type === 'fill' ||
      layer.id.includes('land') ||
      layer.id.includes('water')

    if (underShade && beforeHillshade) {
      map.addLayer(rewritten as AddLayerObject, beforeHillshade)
    } else {
      map.addLayer(rewritten as AddLayerObject)
    }
  }

  applyBasinTint(map)
  return style.glyphs
}

export async function applyBasemapMode(
  map: MapLibreMap,
  mode: BasemapMode,
): Promise<void> {
  if (!map.isStyleLoaded()) return

  let glyphs: string | undefined
  if (mode === 'hybrid') {
    glyphs = await ensureSatelliteHybridOverlay(map)
  } else if (mode === 'plan') {
    glyphs = await ensurePlanBasemap(map)
  }
  if (glyphs) {
    try {
      map.setGlyphs(glyphs)
    } catch {
      // keep existing glyphs
    }
  }

  const satOn = mode === 'satellite' || mode === 'hybrid'
  if (map.getLayer('imagery')) {
    map.setLayoutProperty('imagery', 'visibility', satOn ? 'visible' : 'none')
  }
  // Relief stays on for every mode (shaded satellite + shaded plan).
  if (map.getLayer('hillshade')) {
    map.setLayoutProperty('hillshade', 'visibility', 'visible')
    map.setPaintProperty(
      'hillshade',
      'hillshade-exaggeration',
      mode === 'plan' ? 0.35 : 0.22,
    )
  }

  setPrefixedVisibility(map, HYBRID_PREFIX, mode === 'hybrid')
  setPrefixedVisibility(map, PLAN_PREFIX, mode === 'plan')
}
