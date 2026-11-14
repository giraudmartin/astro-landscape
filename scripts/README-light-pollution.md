# Light pollution

## Map / globe overlay

NASA GIBS `VIIRS_Black_Marble` (commercial-OK, zero self-hosting).  
Terminator-masked via `astro-lightpollution` protocol.

## Bortle at selected spot (preferred)

Hosted **radiance COG** → mag/arcsec² → Bortle. The app auto-uses
`public/light-pollution/viirs-vnl-average-masked.cog.tif` when present.

```bash
# Default (no EOG login): NASA GIBS Black Marble → radiance-proxy COG
npm run build:viirs-bortle

# Best accuracy: EOG VIIRS VNL average_masked (free account + manual download)
# https://eogdata.mines.edu/products/vnl/ → then:
python scripts/build-viirs-bortle-cog-rasterio.py --input path/to/average_masked.tif
```

Or host the COG and set:

```
VITE_LIGHT_POLLUTION_COG_URL=https://your-cdn/.../viirs-vnl-average-masked.cog.tif
```

If the COG is missing, the app falls back to live Black Marble tile sampling.

Do **not** use World Atlas 2015 (CC BY-NC) or scrape lightpollutionmap.info tiles.

Credits: Settings gear on the map + `docs/THIRD_PARTY_ATTRIBUTIONS.md`.
