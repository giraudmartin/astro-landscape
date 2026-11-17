# Light pollution

Full method, licences, and resolution audit: **`docs/LIGHT_POLLUTION.md`**.

## Map / globe overlay

NASA GIBS `VIIRS_Black_Marble` (commercial-OK, zero self-hosting).  
Terminator-masked via `astro-lightpollution` protocol.

## Bortle / zenith SQM at selected spot

**Formula:** First Rig zenith re-fit of Duriscoe 2018  
(`α = 2.47·(d/350)^0.158`, `ZLR = S/66.89`, natural floor **21.83**).  
No PlanAstro mean-P, no elev mag hacks.

**Data (default):** EOG VIIRS VNL 2024 ~500 m COG  
`public/light-pollution/viirs-vnl-2024-500m.cog.tif`  
(Zenodo [10.5281/zenodo.17294744](https://doi.org/10.5281/zenodo.17294744), CC BY 4.0).

```bash
# Override COG URL if hosted elsewhere:
VITE_LIGHT_POLLUTION_COG_URL=https://your-cdn/.../viirs-vnl-2024-500m.cog.tif
```

If the COG is missing, the app falls back to live Black Marble ring samples
with the **same** First Rig kernel (degraded — BM is a visualization).

Do **not** use World Atlas 2015 (CC BY-NC) or scrape lightpollutionmap.info.

Credits: Settings gear on the map + `docs/THIRD_PARTY_ATTRIBUTIONS.md`.
