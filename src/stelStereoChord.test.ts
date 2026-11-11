/**
 * Artifact source (per projection): nonlinear vertex warp + coarse mesh.
 * Same world edge → large eye angle underfoot; stereo/equirect then chord it
 * into pillars / bands. Not a DEM-tile bug — loading just shows a coarser mesh.
 */
import { describe, expect, it } from 'vitest'

function normalize(x: number, y: number, z: number) {
  const L = Math.hypot(x, y, z)
  return [x / L, y / L, z / L] as const
}

/** Locked Stellarium stereo: st = n.xy / (0.5*(1-n.z)). */
function stereoSt(nx: number, ny: number, nz: number) {
  const h = 0.5 * (1 - nz)
  if (h < 1e-3) return null
  return [nx / h, ny / h] as const
}

function lookRot(yawDeg: number, pitchDeg: number) {
  const yaw = (yawDeg * Math.PI) / 180
  const pitch = (pitchDeg * Math.PI) / 180
  const fx = Math.sin(yaw) * Math.cos(pitch)
  const fy = Math.sin(pitch)
  const fz = -Math.cos(yaw) * Math.cos(pitch)
  const forward = normalize(fx, fy, fz)
  let rx = -forward[2]
  let rz = forward[0]
  const rL = Math.hypot(rx, rz)
  rx /= rL
  rz /= rL
  const ux = 0 * forward[2] - rz * forward[1]
  const uy = rz * forward[0] - rx * forward[2]
  const uz = rx * forward[1] - 0 * forward[0]
  return {
    right: [rx, 0, rz] as const,
    up: [ux, uy, uz] as const,
    forward,
  }
}

function toView(
  wx: number,
  wy: number,
  wz: number,
  eye: readonly [number, number, number],
  basis: ReturnType<typeof lookRot>,
) {
  const dx = wx - eye[0]
  const dy = wy - eye[1]
  const dz = wz - eye[2]
  return [
    dx * basis.right[0] + dy * basis.right[1] + dz * basis.right[2],
    dx * basis.up[0] + dy * basis.up[1] + dz * basis.up[2],
    -(dx * basis.forward[0] + dy * basis.forward[1] + dz * basis.forward[2]),
  ] as const
}

function edgeMetrics(
  pitchDeg: number,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) {
  const eye = [0, 1.7, 0] as const
  const basis = lookRot(270, pitchDeg)
  const va = toView(a[0], a[1], a[2], eye, basis)
  const vb = toView(b[0], b[1], b[2], eye, basis)
  const na = normalize(va[0], va[1], va[2])
  const nb = normalize(vb[0], vb[1], vb[2])
  const eyeAngleDeg =
    (Math.acos(
      Math.min(1, Math.max(-1, na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2])),
    ) *
      180) /
    Math.PI
  const sa = stereoSt(na[0], na[1], na[2])
  const sb = stereoSt(nb[0], nb[1], nb[2])
  if (!sa || !sb) return { eyeAngleDeg, stLen: Infinity }
  return {
    eyeAngleDeg,
    stLen: Math.hypot(sa[0] - sb[0], sa[1] - sb[1]),
  }
}

describe('stereographic chord vs pitch (artifact source)', () => {
  // ~29 m near-grid cell underfoot (416 over 6 km ≈ 28.8 m)
  const nearA = [0, 0, -5] as const
  const nearB = [14, 0, -5] as const

  it('near ground edges subtend huge eye angle (mesh too coarse for warp)', () => {
    const down = edgeMetrics(-8, nearA, nearB)
    expect(down.eyeAngleDeg).toBeGreaterThan(30)
    expect(down.stLen).toBeGreaterThan(1)
  })

  it('stereo |Δst| stays large — straight triangle edges become screen chords', () => {
    const flat = edgeMetrics(0, nearA, nearB)
    const down = edgeMetrics(-8, nearA, nearB)
    expect(flat.stLen).toBeGreaterThan(1)
    expect(down.stLen).toBeGreaterThan(1)
  })
})
