# Light pollution (zenith SQM / Bortle) — method & data

This document freezes **how** we estimate zenith sky brightness. No ad-hoc
mag drops. Constants come from published sources only.

## What we estimate

| Quantity | Meaning |
|---|---|
| **Zenith SQM** | Moonless, cloudless artificial+natural sky brightness overhead (mag/arcsec²) |
| **Bortle** | Discrete class from SQM (UI convention — see below) |
| **All-sky panel** | Directional *visualization* from ring glow (not Falchi) |

Satellite models estimate **artificial** skyglow. Natural airglow / Milky Way /
zodiacal light vary by ±0.3–0.4 mag; we use a fixed natural floor.

## Canonical zenith formula (shipped)

**Source:** [First Rig — Sky brightness from satellite data](https://firstrig.com/method/sky-brightness)
(September 2026), itself a zenith re-fit of Duriscoe et al. 2018 (JQSRT 214,
133–145, CC BY 4.0).

For every VIIRS cell \(i\) within 300 km of the observer:

\[
S = \sum_i r_i\, A_i\, d_i^{-\alpha(d_i)}
\qquad
\alpha(d) = 2.47\,\Bigl(\frac{d}{350\,\mathrm{km}}\Bigr)^{0.158}
\]

\[
\mathrm{ZLR} = \frac{S}{66.89}
\qquad
10^{-0.4\,m}
  = 10^{-0.4\times 21.83}
  + \mathrm{ZLR}\cdot 10^{-0.4\times 22.0}
\]

| Symbol | Value | Role |
|---|---|---|
| \(r_i\) | nW cm⁻² sr⁻¹ | VIIRS upward radiance |
| \(A_i\) | km² | Cell / sample area |
| \(d_i\) | km | Distance to observer (\(d=0\) → weight 1) |
| \(\alpha\) scale / power | **2.47 / 0.158** | Zenith re-fit (Duriscoe all-sky used 2.3 / 0.28) |
| ZLR divisor | **66.89** | Calibration → units of 171 µcd/m² |
| Natural floor | **21.83** mag | NPS median moonless zenith (not textbook 22.0) |

Duriscoe’s **all-sky** form (\(\alpha = 2.3\,(d/350)^{0.28}\)) under-weights nearby
light for **zenith** SQM; First Rig re-fitted for zenith and published validation
(NPS / Kyba / Globe at Night). We ship that zenith form.

Code: `src/lightPollution/duriscoeZenith.ts` (math),
`src/lightPollution/sampleFromCog.ts` (`sumFirstRigFromCog`),
`src/lightPollution/zenithFromSurroundings.ts` (orchestration).

### Background clip

Duriscoe et al. zero VIIRS pixels **&lt; 0.5 nW cm⁻² sr⁻¹** (airglow / noise).
We do the same before summing.

### GeoTIFF Scale tag (do not apply ×10)

The Zenodo Hengl 2024 COG is **int16** with a GeoTIFF `Scale=10` tag.
Applying that scale makes Paris ~740 nW (nonsense vs EOG / LPM).
**Raw DN already matches EOG nW cm⁻² sr⁻¹** (Paris ~74, Chamonix ~23).
`viirsDnToRadianceNw` therefore ignores Scale and treats DN as nW.
Validation (raw DN, full 300 km sum):

| Site | Model SQM | LPM-ish target | Notes |
|---|---|---|---|
| Paris | ~17.95 | ~18.13 | city OK |
| Tokyo | ~17.86 | ~17.66 | city OK |
| Chamonix | ~20.58 | ~20.9 | valley OK |
| Mer de Glace | ~21.27 flat / darker with DEM | ~21.7 | DEM near-field softens valley towns |
| Spitzkoppe | ~21.78 | ~21.99 | natural floor 21.83 |

### Alpine / high-observer DEM (near-field)

For `observerElevM ≥ 900 m` we apply soft **Mapterhorn height-field** gates
per azimuth (`terrainGate.ts` + `ridgeTransmission`) on sources ≲80 km, plus
a geometric near-field fade when looking down into valleys. This is **not**
full radiative transfer — residual ~0.2–0.4 mag vs LPM can remain. Never
invent mag scalars to force a Bortle class.

## Bortle class (UI)

SQM → Bortle uses the same thresholds as GeoInsight / common LPM-style tables
(so our badge matches what users compare on lightpollutionmap.info):

| Bortle | SQM (mag/arcsec²) |
|---|---|
| 1 | ≥ 21.99 |
| 2 | ≥ 21.89 |
| 3 | ≥ 21.69 |
| 4 | ≥ 20.49 |
| 5 | ≥ 19.50 |
| 6 | ≥ 18.94 |
| 7 | ≥ 18.38 |
| 8 | ≥ 17.80 |
| 9 | &lt; 17.80 |

**Note:** First Rig’s own Bortle edges differ slightly and never emit class 1
(natural floor 21.83). We keep the LPM-compatible table for product consistency;
the **SQM number** is the scientific output.

## Data sources (resolution & licence)

| Source | Resolution | Licence | Use |
|---|---|---|---|
| **EOG VIIRS VNL `average_masked`** (via OpenLandMap / Zenodo Hengl 2024) | **~500 m** (15″) | CC BY 4.0 | **Preferred** zenith input |
| NASA Black Marble (GIBS z8) | ~600 m/px viz | NASA open + attribution | Fallback only (visualization → radiance proxy) |
| Falchi World Atlas 2015 | ~1 km zenith map | **CC BY-NC** | **Forbidden** (commercial) |
| Lorenz LP Atlas 2025 | 1/120° | No clear commercial licence | **Do not ship** without written permission |
| LPM QueryRaster / all-sky API | — | Service ToS; WA layer NC | **Do not scrape** for product data |

### Is our data fine enough?

| Need | Verdict |
|---|---|
| Valley town vs glacier (Chamonix / Mer de Glace) | **Needs ≤1 km.** Old GIBS bake at **0.05° (~5.5 km)** erased towns and capped cities at 18 — **inadequate**. |
| Zenith SQM scout (±0.3–0.5 mag) | **500 m VIIRS + Duriscoe/First Rig** is the open-data state of the art. |
| Exact match to LPM alpine | LPM adds **DEM + full radiative transfer**. We will still differ by a few tenths of a mag in mountains without that stack. |
| Horizon lobes / panoramic panel | Separate ring model (directional). Zenith SQM does **not** include horizon domes (First Rig §5). |

Shipped raster path: `public/light-pollution/viirs-vnl-2024-500m.cog.tif`
(Zenodo [10.5281/zenodo.17294744](https://doi.org/10.5281/zenodo.17294744),
year 2024 average, CC BY 4.0). Cite Elvidge et al. 2021 + Hengl 2025.
Gitignores `*.tif` under that folder (~64 MB) — place the COG locally (or CDN)
before expecting `viirs-cog` source. Offline check:

```bash
python scripts/validate-first-rig-zenith.py
python scripts/validate-pl-anchors.py   # frozen SQM windows (flat First Rig)
npm run test -- src/__tests__/plAnchors.test.ts src/__tests__/terrainGate.test.ts
```

Env overrides:

```bash
VITE_LIGHT_POLLUTION_COG_URL=/light-pollution/viirs-vnl-2024-500m.cog.tif
# optional: force EOG path even if filename differs
VITE_LIGHT_POLLUTION_COG_IS_EOG=1
```

## What we will not do

- Tune mag with unexplained scalars (“make Mer = 3”).
- Treat the **single pixel** under the pin as zenith SQM.
- Use Falchi / Lorenz grids in the product without a commercial licence.
- Scrape lightpollutionmap.info as a data backend.

## All-sky / panoramic panel (domes)

**Kernel:** Duriscoe 2018 **all-sky** `α = 2.3·(d/350)^0.28`, times a mild
Gaussian mid-range lift (~50 km, boost 1.8) so 30–80 km cities (Hilo-scale)
feed horizon lobes without inventing a new model family.

**Data:** same VIIRS 500 m COG, cells binned by azimuth → wedge sum `S(az)`.
Intensity: `I = S_peak / (S_peak + 16)`, max drop **1.4** mag (fitted Mer≈0.35 /
Paris≈1.2 vs LPM+LPMap.app). Spitz / noise: `S < 0.4` → no lobe.

**Known gap:** Mauna Kea–class coastal lobes under a pristine zenith can reach
~2.5 mag on LPM; our open-data stack under-predicts those extremes (no full RT).

**Rendering:** azimuth profile is Gaussian-blurred into a wide mound
(~18° σ at the horizon, wider with altitude) plus a regional wash — real
skyglow is a **dome**, not vertical pillars (`skyBrightnessField.ts`).

Black Marble rings remain a degraded fallback only. Zenith badge always uses
First Rig (above). Code: `sumDirectionalFromCog`, `horizonGlowProfile.ts`.

## References

1. Duriscoe et al. (2018), JQSRT 214:133–145 — simplified VIIRS → ALR/ZLR.
2. First Rig (2026), [firstrig.com/method/sky-brightness](https://firstrig.com/method/sky-brightness) — zenith constants.
3. PlanAstro (2026) — alternate zenith path \(B_\mathrm{art}=0.299\,P\) (documented for comparison; not shipped).
4. Falchi et al. (2016), Sci. Adv. — natural floor convention only (no atlas data).
5. Elvidge et al. (2021), Remote Sensing 13(5):922 — VIIRS VNL.
6. EOG CC BY 4.0 licence PDF — commercial OK with attribution.
