import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MILKY_WAY_TILE_VARIANT,
  MILKY_WAY_NEB_ALIAS_NASA_TILES,
} from '../nightSky'

const root = join(process.cwd(), 'public', 'sky', 'tiles')

describe('custom milky-way neb tiles', () => {
  it('defaults to the custom layer (not NASA alias)', () => {
    expect(MILKY_WAY_NEB_ALIAS_NASA_TILES).toBe(false)
    expect(DEFAULT_MILKY_WAY_TILE_VARIANT).toBe('milkyway-neb')
  })

  it('manifest lists milkyway-neb', () => {
    const manifest = JSON.parse(
      readFileSync(join(root, 'manifest.json'), 'utf8'),
    ) as { layers: Record<string, unknown> }
    expect(manifest.layers['milkyway-neb']).toBeTruthy()
    expect(manifest.layers.milkyway).toBeTruthy()
  })

  it('ships z0+z1 EXRs that differ from NASA', () => {
    for (const z of [0, 1] as const) {
      const cols = 2 ** (z + 1)
      const rows = 2 ** z
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const nasa = join(root, 'milkyway', `z${z}`, `${x}_${y}.exr`)
          const neb = join(root, 'milkyway-neb', `z${z}`, `${x}_${y}.exr`)
          expect(existsSync(neb), neb).toBe(true)
          expect(statSync(neb).size).toBeGreaterThan(100_000)
          // Custom rebuild must not be a byte-identical NASA copy.
          const a = readFileSync(nasa)
          const b = readFileSync(neb)
          expect(Buffer.compare(a, b) !== 0, `${x}_${y} should differ`).toBe(
            true,
          )
        }
      }
    }
  })
})
