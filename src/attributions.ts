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
      'Zenith SQM from EOG VIIRS VNL 2024 (~500 m, CC BY 4.0 via OpenLandMap/Zenodo) using the First Rig / Duriscoe zenith kernel. Cite Elvidge et al. 2021 and Earth Observation Group / Payne Institute. Estimate only — not a ground SQM. Method: docs/LIGHT_POLLUTION.md.',
    url: 'https://doi.org/10.5281/zenodo.17294744',
  },
  {
    id: 'nasa-black-marble',
    name: 'Pollution lumineuse (Black Marble)',
    credit:
      'Map/globe night-lights overlay: NASA Black Marble / VIIRS via NASA GIBS. Open NASA Earth science data — attribute NASA; do not imply NASA endorsement. Overlay only; zenith Bortle uses the VIIRS COG when present.',
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
