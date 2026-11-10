# Astro Landscape

Prototype web app for planning landscape astro photos: explore world relief, pick a spot, preview the view from tripod height.

Built with **MapLibre GL JS** + **Mapterhorn** terrain (same map family as Photo Sightline). Three.js sky / Milky Way comes later.

## Dev

```bash
npm install
npm run dev
```

Opens on **http://localhost:5180** (away from Photo Sightline’s 5173–5175 / 3000).

## Stack

- React + TypeScript + Vite
- MapLibre GL JS terrain (`raster-dem` Terrarium)
- Mapterhorn DEM + Esri World Imagery
