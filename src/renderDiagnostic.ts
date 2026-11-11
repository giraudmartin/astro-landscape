/** Live knobs read each frame by ImmersiveView — change one at a time. */

export const RENDER_DIAG_DEFAULTS = {
  frustumCulling: false,
  cameraNearM: 0.5,
  cameraFarM: 450_000,
  terrainWireframe: false,
  showTerrainNear: true,
  showTerrainFar: true,
  showSky: true,
  showNightSky: true,
  /** Optional cubemap path (normally OFF — production uses vertex warp). */
  useCubemapPass: false,
  /** 3×2 face atlas before stereographic composite (implies cubemap pass). */
  cubemapAtlasPreview: false,
} as const

export type RenderDiagSettings = {
  -readonly [K in keyof typeof RENDER_DIAG_DEFAULTS]: (typeof RENDER_DIAG_DEFAULTS)[K]
}

export type RenderDiagStats = {
  fps: number
  /** Whole frame: 1 for direct path, 7 for cubemap (6 faces + composite). */
  passes: number
  drawCalls: number
  triangles: number
  points: number
  lines: number
  path: 'direct' | 'cubemap' | 'cubemap-atlas'
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
