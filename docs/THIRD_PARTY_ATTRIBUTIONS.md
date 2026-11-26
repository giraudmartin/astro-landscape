# Third-party attributions

Keep in sync with `src/attributions.ts` (Settings panel on the map).
Celestial catalog build notes: `public/catalogs/ATTRIBUTION.md`.

## HYG (stars)

- **What**: Bright-star positions / magnitudes in the night sky and globe.
- **Source**: [HYG Database v4.1](https://github.com/astronexus/HYG-Database) (Astronexus), mag ≤ 6 extract (`hygBrightStars.ts` / `catalogs/stars.json`).
- **License**: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

## OpenNGC (deep sky)

- **What**: Messier + bright/named NGC/IC subset for search / overlays.
- **Source**: [OpenNGC](https://github.com/mattiaverga/OpenNGC) (Mattia Verga).
- **License**: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

## Constellations

- **What**: IAU 88 names + stick-figure geometry.
- **Source**: IAU designations (public domain); geometry derived from Alan MacRobert / Dominic Ford figures.
- **License**: Designations public domain; geometry [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## VIIRS radiance COG (Bortle / zenith SQM)

- **What**: Hosted VIIRS VNL radiance COG → First Rig zenith SQM → Bortle.
- **Shipped**: `public/light-pollution/viirs-vnl-2024-500m.cog.tif` (~500 m, year 2024) from Zenodo [10.5281/zenodo.17294744](https://doi.org/10.5281/zenodo.17294744) (OpenLandMap / Hengl mirror of EOG VNL `average_masked`, **CC BY 4.0**).
- **Cite**: Elvidge et al. 2021 (Remote Sensing 13(5):922); Earth Observation Group / Payne Institute; Hengl 2025 Zenodo mirror.
- **Override**: `VITE_LIGHT_POLLUTION_COG_URL`.
- **Legacy**: `npm run build:viirs-bortle` GIBS Black Marble ~0.05° proxy is **not** used for zenith (too coarse).
- **Note**: Method + resolution audit in `docs/LIGHT_POLLUTION.md`. Not an on-site SQM.

## NASA Black Marble / VIIRS (map overlay)

- **What**: Night lights overlay on the MapLibre globe/map.
- **Source**: NASA Black Marble via [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/).
- **Terms**: NASA Earth science data — open for commercial use with attribution; do **not** imply NASA endorsement.
- **Fallback**: If the COG is missing, Bortle is estimated from live Black Marble tiles.

## Mapterhorn

- Terrain DEM tiles — see [Mapterhorn attribution](https://mapterhorn.com/attribution).

## Esri World Imagery

- Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community.

## OpenStreetMap / OpenFreeMap / Photon

- Plan basemap labels via OpenFreeMap (OSM data, [ODbL](https://www.openstreetmap.org/copyright)).
- Place search via [Photon](https://photon.komoot.io/) (Komoot) on OpenStreetMap data — fair use of the public API; availability is not guaranteed.

## Open-Meteo

- Forecast + recent archive weather — [Open-Meteo](https://open-meteo.com/) ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).

## MapLibre GL JS

- Map rendering — [MapLibre](https://maplibre.org/) (BSD).
