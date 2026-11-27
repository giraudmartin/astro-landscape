/**
 * In-app credit lines for third-party content/data.
 * Keep in sync with docs/THIRD_PARTY_ATTRIBUTIONS.md when adding assets.
 */
export type AttributionEntry = {
  id: string
  /** i18n key of the display name (settings.attr.*). */
  nameKey: string
  /** Licence / credit line — kept in the original (English) legal wording. */
  credit: string
  url?: string
}

export const APP_ATTRIBUTIONS: readonly AttributionEntry[] = [
  {
    id: 'hyg',
    nameKey: 'settings.attr.hyg',
    credit:
      'Bright-star catalog from HYG Database v4.1 (Astronexus), mag ≤ 6 extract. Licensed under CC BY-SA 4.0 — share-alike applies to adapted catalog extracts.',
    url: 'https://github.com/astronexus/HYG-Database',
  },
  {
    id: 'openngc',
    nameKey: 'settings.attr.openngc',
    credit:
      'Messier + bright/named NGC/IC subset from OpenNGC (Mattia Verga). Licensed under CC BY-SA 4.0.',
    url: 'https://github.com/mattiaverga/OpenNGC',
  },
  {
    id: 'constellations',
    nameKey: 'settings.attr.constellations',
    credit:
      'IAU 88 constellation designations (public domain). Stick-figure geometry derived from Alan MacRobert / Dominic Ford figures (CC BY 4.0).',
    url: 'https://www.iau.org/public/themes/constellations/',
  },
  {
    id: 'viirs-cog',
    nameKey: 'settings.attr.viirs',
    credit:
      'Zenith SQM and plan-map coloured PL overlay from EOG VIIRS VNL 2024 (~500 m, CC BY 4.0 via OpenLandMap/Zenodo). Spot Bortle uses the First Rig / Duriscoe zenith kernel; the map overlay false-colours the same radiance COG (not World Atlas). Cite Elvidge et al. 2021 and Earth Observation Group / Payne Institute. Estimate only — not a ground SQM. Method: docs/LIGHT_POLLUTION.md.',
    url: 'https://doi.org/10.5281/zenodo.17294744',
  },
  {
    id: 'nasa-black-marble',
    nameKey: 'settings.attr.blackMarble',
    credit:
      'Globe night-lights: NASA Black Marble / VIIRS via NASA GIBS. Open NASA Earth science data — attribute NASA; do not imply NASA endorsement. Plan-map coloured PL overlay uses the VIIRS COG (see Bortle / zenith SQM), not Black Marble.',
    url: 'https://blackmarble.gsfc.nasa.gov/',
  },
  {
    id: 'nasa-milky-way',
    nameKey: 'settings.attr.milkyWay',
    credit:
      'Immersive Milky Way backdrop based on NASA SVS #4851 (All-Sky Milky Way Mosaic / Gaia + MSS). Enhanced with additional nebulae from Martin Giraud photographs. NASA Earth science data — attribute NASA; do not imply NASA endorsement.',
    url: 'https://svs.gsfc.nasa.gov/4851/',
  },
  {
    id: 'mapterhorn',
    nameKey: 'settings.attr.mapterhorn',
    credit: 'Terrain DEM tiles © Mapterhorn.',
    url: 'https://mapterhorn.com/attribution',
  },
  {
    id: 'esri-imagery',
    nameKey: 'settings.attr.esri',
    credit:
      'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community.',
  },
  {
    id: 'openstreetmap',
    nameKey: 'settings.attr.osm',
    credit:
      'Basemap labels via OpenFreeMap / OpenStreetMap contributors (ODbL). Place search via Photon (Komoot) on OpenStreetMap data — fair-use of the public photon.komoot.io API.',
    url: 'https://www.openstreetmap.org/copyright',
  },
  {
    id: 'open-meteo',
    nameKey: 'settings.attr.openMeteo',
    credit:
      'Hourly forecast and recent archive weather from Open-Meteo (CC BY 4.0). Estimate only — not a substitute for official aviation / marine forecasts.',
    url: 'https://open-meteo.com/',
  },
  {
    id: 'maplibre',
    nameKey: 'settings.attr.maplibre',
    credit: 'Map rendering powered by MapLibre GL JS (BSD).',
    url: 'https://maplibre.org/',
  },
]
