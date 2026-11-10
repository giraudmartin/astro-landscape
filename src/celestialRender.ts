/**
 * Shared celestial shell radius (MW, stars, grids).
 * Must sit beyond FAR_TERRAIN_RADIUS_M (~300 km) so the Milky Way never
 * passes between the near disc and distant LOD ridges, and inside the
 * atmospheric sky dome (~360 km).
 */
export const CELESTIAL_SKY_DISTANCE_M = 330_000
