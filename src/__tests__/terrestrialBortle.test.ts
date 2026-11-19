import { afterAll, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { fromFile } from 'geotiff'
import { sampleLightPollution } from '../lightPollution/sampleLightPollution'

const path = 'public/light-pollution/viirs-vnl-2024-500m.cog.tif'
const raster = existsSync(path) ? fromFile(path) : null
vi.mock('geotiff', async (importOriginal) => ({
  ...await importOriginal<typeof import('geotiff')>(),
  fromUrl: () => raster,
}))

afterAll(async () => {
  vi.unstubAllGlobals()
  await (await raster)?.close()
})

it.skipIf(!raster)('distinguishes a dark terrestrial site from a city using the shipped VIIRS data', async () => {
  vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }))
  for (const [lat, lon, expected] of [[-24, 126, 1], [48.8566, 2.3522, 8]] as const) {
    const sample = await sampleLightPollution(lat, lon, { observerElevM: 0 })
    expect(sample?.source).toBe('viirs-cog')
    expect(sample?.bortle).toBe(expected)
  }
})
