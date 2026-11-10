/**
 * Mapterhorn Terrarium DEM (512px WebP) via safe protocol.
 * - z0–z12 : planète (Copernicus ~30 m) partout
 * - z13–z17 : archives régionales (LiDAR / nationales) quand disponibles
 * Le protocole remonte au parent + overzoom nearest si la tuile manque
 * (évite les dents de scie MapLibre sur 404).
 */
export const MAPTERHORN_DEM_URL = 'mapterhorn-dem://{z}/{x}/{y}'

/** Mapterhorn high-res regional tiles go up to z17 (~0.6 m where source allows). */
export const DEM_MAX_ZOOM = 17

/**
 * Allow high Esri zooms where Maxar exists. Stub plates are handled by the
 * esri-safe protocol (parent crop fallback).
 */
export const IMAGERY_MAX_ZOOM = 18

export const TERRAIN_EXAGGERATION = 1

/** Mean Earth radius (m) — geometric horizon + ENU curvature drop. */
export const EARTH_RADIUS_M = 6_371_000
