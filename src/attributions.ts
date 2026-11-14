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
    name: 'Bortle (VIIRS COG)',
    credit:
      'Nighttime radiance COG for Bortle: default bake from NASA GIBS Black Marble (attribute NASA, no endorsement). Preferred upgrade: EOG VIIRS VNL average_masked (Payne Institute / Colorado School of Mines). Bortle is derived from upward radiance, not a ground SQM reading.',
    url: 'https://eogdata.mines.edu/products/vnl/',
  },
  {
    id: 'nasa-black-marble',
    name: 'Pollution lumineuse (Black Marble)',
    credit:
      'Map/globe night-lights overlay: NASA Black Marble / VIIRS via NASA GIBS. Open NASA Earth science data — attribute NASA; do not imply NASA endorsement of this product. Used for visualization; Bortle prefers the hosted radiance COG when present.',
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
