# Sadr3D Sphere

Web app for planning night-landscape astrophotography: scout relief and light pollution, frame in the viewfinder, preview an interactive immersive sky shaped by real terrain.

Built with **MapLibre GL JS** + **Mapterhorn** terrain (same map family as Sadr3D Horizon) and Three.js immersive sky.

## Dev

```bash
npm install
npm run dev
```

Opens on **http://localhost:5180** (away from Sadr3D Horizon’s 5173–5175 / 3000).

Optional VIIRS COG for Bortle / PL heatmap (gitignored):  
`public/light-pollution/viirs-vnl-2024-500m.cog.tif` — see `.env.example` and `docs/LIGHT_POLLUTION.md`.

## Production (OVH)

Same VPS as Horizon. Domain: **https://sphere.sadr3d.com**  
Deploy docs: [`docs/DEPLOY_OVH.md`](docs/DEPLOY_OVH.md) · Caddy example: [`deploy/Caddyfile.sadr3d.example`](deploy/Caddyfile.sadr3d.example)

## Stack

- React + TypeScript + Vite
- MapLibre GL JS terrain (`raster-dem` Terrarium)
- Mapterhorn DEM + Esri World Imagery
- Three.js immersive sky / VIIRS COG light pollution
