# Privacy (minimal)

Keep in sync with `src/privacy.ts` (Settings → Confidentialité).

Sadr3D Sphere is a client-side planning app. There is **no user account** and **no first-party analytics**.

## What stays on your device

- Personal spots, framings, app settings, and floating-panel positions in `localStorage` / IndexedDB.
- Clearing site data in the browser removes them.

## Geolocation

- GPS is requested only when you use **Me localiser**.
- The coordinates are used locally to center the map; they are not uploaded to a Sadr3D Sphere backend (there is none).

## Network requests to third parties

The browser may contact, depending on features used:

| Service | Why |
|---------|-----|
| Mapterhorn | Terrain DEM tiles |
| Esri World Imagery | Satellite basemap |
| OpenFreeMap / OpenStreetMap | Plan labels |
| Photon (Komoot) / OSM | Address / place search |
| Open-Meteo | Forecast / recent archive weather |
| NASA GIBS / Black Marble | Night-lights overlay / fallback |
| VIIRS COG host (or same origin `/light-pollution/…`) | Zenith SQM / PL map |

Those services see your IP and the tile/query parameters required for the request (location, date, zoom).

## Bug reports

The in-app bug form may collect a title, description, and optional screenshot. Until a submit endpoint is wired, submissions stay on the device (local stub).

## Contact

App copyright: see in-app chrome (`APP_COPYRIGHT` in `src/appMeta.ts`).
