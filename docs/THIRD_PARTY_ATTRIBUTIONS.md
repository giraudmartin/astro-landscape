# Third-party attributions

Keep in sync with `src/attributions.ts` (Settings panel on the map).

## VIIRS radiance COG (Bortle)

- **What**: Hosted radiance COG → estimated Bortle at selected spots.
- **Default bake**: `npm run build:viirs-bortle` — NASA GIBS `VIIRS_Black_Marble` → radiance-proxy COG (no login).
- **Preferred bake**: EOG VIIRS VNL `average_masked` ([products/vnl](https://eogdata.mines.edu/products/vnl/), free account) then  
  `python scripts/build-viirs-bortle-cog-rasterio.py --input your.tif`  
  → `public/light-pollution/viirs-vnl-average-masked.cog.tif`  
  Or set `VITE_LIGHT_POLLUTION_COG_URL`.
- **Terms**: NASA Black Marble — open with attribution, no endorsement. EOG VNL — public domain / unrestricted subsequent use as stated by EOG (cite Payne Institute / Elvidge et al.).
- **Note**: Estimate from upward satellite radiance — not an on-site SQM.

## NASA Black Marble / VIIRS (map overlay)

- **What**: Night lights overlay on the MapLibre globe/map.
- **Source**: NASA Black Marble via [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/).
- **Terms**: NASA Earth science data — open for commercial use with attribution; do **not** imply NASA endorsement.
- **Fallback**: If the COG is missing, Bortle is estimated from live Black Marble tiles.

## Mapterhorn

- Terrain DEM tiles — see [Mapterhorn attribution](https://mapterhorn.com/attribution).

## Esri World Imagery

- Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community.

## MapLibre GL JS

- Map rendering — [MapLibre](https://maplibre.org/) (BSD).
