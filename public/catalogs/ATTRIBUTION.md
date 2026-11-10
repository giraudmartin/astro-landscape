# Celestial catalog attribution

Compiled for Photo Sightline / Astro Landscape search.

| File | Source | License |
|------|--------|---------|
| `stars.json` | HYG Database v4.1 (Astronexus), filtered mag ≤ 6 from in-repo `hygBrightStars.ts` | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `constellations.json` | IAU 88 constellation designations; centers derived from in-repo stick figures (Alan MacRobert / Dominic Ford, CC BY 4.0) | Designations public domain; geometry CC BY 4.0 |
| `deep-sky.json` | [OpenNGC](https://github.com/mattiaverga/OpenNGC) (Mattia Verga) — `NGC.csv` + `addendum.csv`; all 110 Messier (M102 → NGC 5866) + bright/named NGC/IC subset (~960 objects) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

French common-name aliases are curated for search UX and are not an authoritative IAU translation.

Regenerate after placing OpenNGC CSVs in `scripts/`:

```bash
# once
curl -L -o scripts/_openngc_NGC.csv https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv
curl -L -o scripts/_openngc_addendum.csv https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv
npm run build:catalogs
```
