import { describe, expect, it } from 'vitest'
import {
  EDGE_PHASES_DEG,
  refineTerrainEdges,
  terrainEdgeNeedsSplit,
} from '../localTerrainMesh'
import { TRIPOD_HEIGHT_M } from '../presets'

/** Verbatim copy of the pre-typed-array synchronous implementation. */
function referenceRefine(
  srcPos: Float32Array,
  srcUv: Float32Array,
  srcIdx: number[],
  sampleY: (east: number, north: number) => number,
) {
  const edgeCos = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ) => {
    const la = Math.hypot(ax, ay, az)
    const lb = Math.hypot(bx, by, bz)
    if (la < 1e-8 || lb < 1e-8) return 1
    return Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (la * lb)))
  }
  const pos = Array.from(srcPos)
  const uv = Array.from(srcUv)
  let indices = srcIdx
  const vertCap = srcPos.length / 3 + 750_000
  let phaseDeg = EDGE_PHASES_DEG[0]!
  const rel = (i: number) =>
    [pos[i * 3]!, pos[i * 3 + 1]! - TRIPOD_HEIGHT_M, pos[i * 3 + 2]!] as const
  const wide = (i: number, j: number): boolean => {
    const [ax, ay, az] = rel(i)
    const [bx, by, bz] = rel(j)
    const dy = Math.abs(pos[i * 3 + 1]! - pos[j * 3 + 1]!)
    return terrainEdgeNeedsSplit(ax, ay, az, bx, by, bz, phaseDeg, dy)
  }
  const bisectT = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): number => {
    let lo = 0.04
    let hi = 0.96
    for (let step = 0; step < 8; step += 1) {
      const t = (lo + hi) * 0.5
      const mx = ax + (bx - ax) * t
      const my = ay + (by - ay) * t
      const mz = az + (bz - az) * t
      const ca = edgeCos(ax, ay, az, mx, my, mz)
      const cb = edgeCos(mx, my, mz, bx, by, bz)
      if (ca < cb) hi = t
      else lo = t
    }
    return (lo + hi) * 0.5
  }
  for (const nextPhase of EDGE_PHASES_DEG) {
    if (pos.length / 3 >= vertCap) break
    phaseDeg = nextPhase
    for (let pass = 0; pass < 6; pass += 1) {
      if (pos.length / 3 >= vertCap) break
      const mid = new Map<string, number>()
      const midpoint = (i: number, j: number): number => {
        const key = i < j ? `${i},${j}` : `${j},${i}`
        const found = mid.get(key)
        if (found != null) return found
        const [ax, ay, az] = rel(i)
        const [bx, by, bz] = rel(j)
        const t = bisectT(ax, ay, az, bx, by, bz)
        const east = ax + (bx - ax) * t
        const z = az + (bz - az) * t
        const north = -z
        const y0 = pos[i * 3 + 1]!
        const y1 = pos[j * 3 + 1]!
        const yLin = y0 + (y1 - y0) * t
        const yDem = sampleY(east, north)
        const parent = Math.acos(edgeCos(ax, ay, az, bx, by, bz))
        let y = yLin
        let lo = 0
        let hi = 1
        for (let step = 0; step < 6; step += 1) {
          const k = (lo + hi) * 0.5
          const yt = yLin + (yDem - yLin) * k
          const my = yt - TRIPOD_HEIGHT_M
          const ca = Math.acos(edgeCos(ax, ay, az, east, my, z))
          const cb = Math.acos(edgeCos(bx, by, bz, east, my, z))
          if (ca < parent * 0.72 && cb < parent * 0.72) {
            y = yt
            lo = k
          } else {
            hi = k
          }
        }
        const n = pos.length / 3
        pos.push(east, y, z)
        uv.push(
          uv[i * 2]! + (uv[j * 2]! - uv[i * 2]!) * t,
          uv[i * 2 + 1]! + (uv[j * 2 + 1]! - uv[i * 2 + 1]!) * t,
        )
        mid.set(key, n)
        return n
      }
      const next: number[] = []
      let grew = false
      for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t]!
        const b = indices[t + 1]!
        const c = indices[t + 2]!
        const room = pos.length / 3 < vertCap
        const ab = room && wide(a, b) ? midpoint(a, b) : -1
        const bc = room && wide(b, c) ? midpoint(b, c) : -1
        const ca = room && wide(c, a) ? midpoint(c, a) : -1
        const mask = (ab >= 0 ? 1 : 0) | (bc >= 0 ? 2 : 0) | (ca >= 0 ? 4 : 0)
        if (mask === 0) {
          next.push(a, b, c)
          continue
        }
        grew = true
        if (mask === 7) next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca)
        else if (mask === 1) next.push(a, ab, c, ab, b, c)
        else if (mask === 2) next.push(a, b, bc, a, bc, c)
        else if (mask === 4) next.push(a, b, ca, ca, b, c)
        else if (mask === 3) next.push(a, ab, c, ab, b, bc, ab, bc, c)
        else if (mask === 5) next.push(a, ab, ca, ab, b, c, ab, c, ca)
        else next.push(a, b, bc, a, bc, ca, bc, c, ca)
      }
      indices = next
      if (!grew) break
    }
  }
  return {
    positions: Float32Array.from(pos),
    uvs: Float32Array.from(uv),
    indices,
  }
}

/** Polar-ish grid around the tripod with cliffs, like the near disc. */
function syntheticDisc(cells: number, radiusM: number) {
  const sampleY = (east: number, north: number) =>
    40 * Math.sin(east / 37) * Math.cos(north / 53) +
    (east > 120 ? 180 : 0) -
    Math.hypot(east, north) * 0.02
  const pos: number[] = []
  const uv: number[] = []
  for (let r = 0; r <= cells; r += 1) {
    for (let c = 0; c <= cells; c += 1) {
      const east = (c / cells - 0.5) * 2 * radiusM
      const north = (r / cells - 0.5) * 2 * radiusM
      pos.push(east, sampleY(east, north), -north)
      uv.push(c / cells, r / cells)
    }
  }
  const idx: number[] = []
  const w = cells + 1
  for (let r = 0; r < cells; r += 1) {
    for (let c = 0; c < cells; c += 1) {
      const a = r * w + c
      idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1)
    }
  }
  return {
    positions: new Float32Array(pos),
    uvs: new Float32Array(uv),
    indices: idx,
    sampleY,
  }
}

describe('refineTerrainEdges', () => {
  it('matches the reference implementation bit-for-bit', async () => {
    const disc = syntheticDisc(48, 600)
    const t0 = performance.now()
    const ref = referenceRefine(
      disc.positions,
      disc.uvs,
      disc.indices,
      disc.sampleY,
    )
    const t1 = performance.now()
    const out = await refineTerrainEdges(
      disc.positions,
      disc.uvs,
      disc.indices,
      disc.sampleY,
    )
    const t2 = performance.now()
    console.info(
      `refine: ${ref.positions.length / 3} verts, reference ${Math.round(t1 - t0)} ms, typed ${Math.round(t2 - t1)} ms`,
    )
    expect(out).not.toBeNull()
    expect(ref.positions.length).toBeGreaterThan(disc.positions.length * 2)
    expect(out!.indices).toEqual(ref.indices)
    expect(out!.positions).toEqual(ref.positions)
    expect(out!.uvs).toEqual(ref.uvs)
  }, 120_000)

  it('stops when cancelled during a yield', async () => {
    const disc = syntheticDisc(160, 2000)
    const out = await refineTerrainEdges(
      disc.positions,
      disc.uvs,
      disc.indices,
      (e, n) => {
        // Burn time so the slice budget expires and the loop yields.
        const end = performance.now() + 0.05
        while (performance.now() < end) {
          /* spin */
        }
        return disc.sampleY(e, n)
      },
      () => true,
    )
    expect(out).toBeNull()
  })
})
