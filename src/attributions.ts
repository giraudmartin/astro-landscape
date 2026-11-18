/**
 * In-app credit lines for third-party content/data.
 * Keep in sync with docs/THIRD_PARTY_ATTRIBUTIONS.md when adding assets.
 */
export type AttributionEntry = {
  id: string
  name: string
  credit: string
  url?: string
}

export const APP_ATTRIBUTIONS: readonly AttributionEntry[] = [
  {
    id: 'viirs-cog',
    name: 'Bortle / zenith SQM (VIIRS)',
    credit:
      'Zenith SQM and plan-map coloured PL overlay from EOG VIIRS VNL 2024 (~500 m, CC BY 4.0 via OpenLandMap/Zenodo). Spot Bortle uses the First Rig / Duriscoe zenith kernel; the map overlay false-colours the same radiance COG (not World Atlas). Cite Elvidge et al. 2021 and Earth Observation Group / Payne Institute. Estimate only — not a ground SQM. Method: docs/LIGHT_POLLUTION.md.',
    url: 'https://doi.org/10.5281/zenodo.17294744',
  },
  {
    id: 'nasa-black-marble',
    name: 'Pollution lumineuse (Black Marble)',
    credit:
      'Globe night-lights: NASA Black Marble / VIIRS via NASA GIBS. Open NASA Earth science data — attribute NASA; do not imply NASA endorsement. Plan-map coloured PL overlay uses the VIIRS COG (see Bortle / zenith SQM), not Black Marble.',
    url: 'https://blackmarble.gsfc.nasa.gov/',
  },
  {
    id: 'mapterhorn',
    name: 'Relief (Mapterhorn)',
    credit: 'Terrain DEM tiles © Mapterhorn.',
    url: 'https://mapterhorn.com/attribution',
  },
  {
    id: 'esri-imagery',
    name: 'Imagerie satellite',
    credit:
      'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community.',
  },
  {
    id: 'maplibre',
    name: 'MapLibre GL JS',
    credit: 'Map rendering powered by MapLibre GL JS (BSD).',
    url: 'https://maplibre.org/',
  },
]
