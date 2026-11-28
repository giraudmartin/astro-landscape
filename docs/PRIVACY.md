# Privacy (minimal)

Keep in sync with `src/privacy.ts` (Settings → Confidentialité).

Sadr3D Sphere is a client-side planning app. There is **no user account**.
Audience measurement uses **first-party Umami** on our VPS (see below) — not an ad network.

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

The in-app bug form sends a title, a description and an optional image screenshot (max 10 MB) via [FormSubmit](https://formsubmit.co/) to `bugs@sadr3d.com`. App version, locale, page URL and user-agent are included.

## Analytics (first-party)

When enabled in production, the app loads a small tracker from our Umami instance
(`analytics.sadr3d.com` on the same OVH VPS). It records aggregated page views and
a few product events (e.g. open immersive, save a spot, bug report). No advertising
cookies, no user account, no data sold to third parties. Setup: [`UMAMI.md`](./UMAMI.md).

## Contact

App copyright: see in-app chrome (`APP_COPYRIGHT` in `src/appMeta.ts`).
