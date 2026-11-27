import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MILKY_WAY_TILE_LAYER } from '../nightSky'

const root = join(process.cwd(), 'public', 'sky', 'tiles')

describe('shipping milky-way tiles', () => {
  it('points at the milkyway layer', () => {
    expect(MILKY_WAY_TILE_LAYER).toBe('milkyway')
  })

  it('manifest lists milkyway from the enhanced EXR', () => {
    const manifest = JSON.parse(
      readFileSync(join(root, 'manifest.json'), 'utf8'),
    ) as {
      layers: Record<string, { source?: string }>
    }
    expect(manifest.layers.milkyway).toBeTruthy()
    expect(manifest.layers['milkyway-neb']).toBeUndefined()
    expect(String(manifest.layers.milkyway.source)).toMatch(/enhanced/i)
  })

  it('ships z0+z1 EXRs', () => {
    for (const z of [0, 1] as const) {
      const cols = 2 ** (z + 1)
      const rows = 2 ** z
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const tile = join(root, 'milkyway', `z${z}`, `${x}_${y}.exr`)
          expect(existsSync(tile), tile).toBe(true)
          expect(statSync(tile).size).toBeGreaterThan(100_000)
        }
      }
    }
  })
})
