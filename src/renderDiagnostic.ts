/** Live knobs read each frame by ImmersiveView — change one at a time. */

export type RenderDiagSettings = {
  frustumCulling: boolean
  cameraNearM: number
  cameraFarM: number
  terrainWireframe: boolean
  showTerrainNear: boolean
  showTerrainFar: boolean
  showSky: boolean
  showNightSky: boolean
  /** Optional cubemap path (normally OFF — production uses vertex warp). */
  useCubemapPass: boolean
  /** 3×2 face atlas before stereographic composite (implies cubemap pass). */
  cubemapAtlasPreview: boolean
}

export const RENDER_DIAG_DEFAULTS: RenderDiagSettings = {
  frustumCulling: false,
  cameraNearM: 0.5,
  cameraFarM: 450_000,
  terrainWireframe: false,
  showTerrainNear: true,
  showTerrainFar: true,
  showSky: true,
  showNightSky: true,
  useCubemapPass: false,
  cubemapAtlasPreview: false,
}

export type RenderDiagStats = {
  fps: number
  /** Whole frame: 1 for direct path, 7 for cubemap (6 faces + composite). */
  passes: number
  drawCalls: number
  triangles: number
  points: number
  lines: number
  path:
    | 'direct'
    | 'direct-local-halo'
    | 'direct-weather'
    | 'cubemap'
    | 'cubemap-atlas'
}

export type RenderDiagLive = {
  settings: RenderDiagSettings
  stats: RenderDiagStats
}

export function createRenderDiagLive(): RenderDiagLive {
  return {
    settings: { ...RENDER_DIAG_DEFAULTS },
    stats: {
      fps: 0,
      passes: 1,
      drawCalls: 0,
      triangles: 0,
      points: 0,
      lines: 0,
      path: 'direct',
    },
  }
}
