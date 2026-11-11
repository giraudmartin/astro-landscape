/**
 * Non-regression guards for Stellarium stereographic GLSL.
 *
 * Failed experiments that MUST NOT return (each caused a user-visible break):
 * - stelOffscreenSt * 50 → destroyed 3D / full-screen park
 * - shared |st| radius clamp → gray hublot disk
 * - discard n.z > 0 → 90° equator disk
 * - terrain stCap / max(h, floor) / mix→perspective soften → edge streaks
 *   (2026-11-11 pitch-down "fix" regression)
 * - terrain forcing vStelBad=0 forever → sky needles / black pillars
 *   (wireframe 2026-11-11: lines in sky WERE terrain edges to dir*12)
 *
 * If you change STEL_PROJECT_*_GLSL, update these assertions deliberately —
 * never "silence" a failing test to land a projector hack.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  STEL_PROJECT_GLSL,
  STEL_PROJECT_TERRAIN_GLSL,
  STEL_FRAGMENT_GLSL,
  attachStelProjector,
} from './stelProjector'

/** Strip // comments so guards don't false-positive on "NEVER *50" notes. */
function codeOnly(glsl: string): string {
  return glsl
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

function assertNoHublotClamp(glsl: string, label: string) {
  const code = codeOnly(glsl)
  // Shared-circle clamps that collapsed antipodes into a gray disk.
  expect(code, label).not.toMatch(/stCap/)
  expect(code, label).not.toMatch(/st\s*\*=\s*[^;]*\/\s*stLen/)
  expect(code, label).not.toMatch(/\|\s*st\s*\|\s*<=/)
}

function assertNoAggressivePark(glsl: string, label: string) {
  const code = codeOnly(glsl)
  expect(code, label).not.toMatch(/\*\s*50(?:\.0)?\b/)
  expect(code, label).not.toMatch(/stelOffscreenSt\([^)]*\)\s*\*\s*[3-9][0-9]/)
}

describe('stereographic GLSL non-regression', () => {
  it('sky stereo: r = 2·tan(θ/2) via n.xy / (0.5·(1−n.z)), antipode park dir*12', () => {
    expect(STEL_PROJECT_GLSL).toContain('0.5 * (1.0 - n.z)')
    expect(STEL_PROJECT_GLSL).toContain('st = n.xy / h')
    expect(STEL_PROJECT_GLSL).toContain('dir * 12.0')
    expect(STEL_PROJECT_GLSL).toContain('vStelBad = 1.0')
    assertNoHublotClamp(STEL_PROJECT_GLSL, 'sky')
    assertNoAggressivePark(STEL_PROJECT_GLSL, 'sky')
  })

  it('terrain stereo: same core warp as sky — no pitch-down soften / st floor / stCap', () => {
    expect(STEL_PROJECT_TERRAIN_GLSL).toContain('0.5 * (1.0 - n.z)')
    expect(STEL_PROJECT_TERRAIN_GLSL).toContain('st = n.xy / h')
    expect(STEL_PROJECT_TERRAIN_GLSL).toContain('dir * 12.0')
    // Forbidden pitch-down regression patterns (Nov 2026).
    expect(STEL_PROJECT_TERRAIN_GLSL).not.toMatch(/max\s*\(\s*hRaw/)
    expect(STEL_PROJECT_TERRAIN_GLSL).not.toContain('stPersp')
    expect(STEL_PROJECT_TERRAIN_GLSL).not.toContain('soften')
    expect(STEL_PROJECT_TERRAIN_GLSL).not.toContain('downAmt')
    expect(STEL_PROJECT_TERRAIN_GLSL).not.toContain('stCap')
    assertNoHublotClamp(STEL_PROJECT_TERRAIN_GLSL, 'terrain')
    assertNoAggressivePark(STEL_PROJECT_TERRAIN_GLSL, 'terrain')
  })

  it('sky fragment: antipode discard only — never n.z > 0 equator cull', () => {
    const code = codeOnly(STEL_FRAGMENT_GLSL)
    expect(STEL_FRAGMENT_GLSL).toContain('vStelBad')
    expect(code).not.toMatch(/if\s*\(\s*n\.z\s*>\s*0/)
    expect(code).not.toMatch(/if\s*\(\s*vStelRay\.z\s*>\s*0/)
    expect(code).toMatch(/vStelBad\s*>\s*0\.02/)
  })

  it('terrain stereo flags antipode vStelBad (bow discard kills sky needles)', () => {
    // Wireframe proved black sky lines = terrain edges to dir*12 antipode park.
    // Flag bad like sky; fragment discards straddlers. Still NEVER n.z>0 cull.
    const terrain = codeOnly(STEL_PROJECT_TERRAIN_GLSL)
    expect(STEL_PROJECT_TERRAIN_GLSL).toContain('vStelBad = 1.0')
    expect(STEL_PROJECT_TERRAIN_GLSL).toContain('dir * 12.0')
    // Must NOT force-clear bad after the stereo branch (old needle bug).
    expect(terrain).not.toMatch(
      /st\s*=\s*n\.xy\s*\/\s*h;[\s\S]*vStelBad\s*=\s*0\.0;\s*vStelSt\s*=\s*st/,
    )
    const frag = codeOnly(STEL_FRAGMENT_GLSL)
    expect(frag).not.toMatch(/if\s*\(\s*vStelRay\.z\s*>\s*0/)
    expect(frag).not.toMatch(/if\s*\(\s*n\.z\s*>\s*0/)
    expect(frag).toMatch(/vStelBad\s*>\s*0\.02/)
  })

  it('terrainSafe materials still inject stelDiscardBow (needles stay dead)', () => {
    const mat = new THREE.MeshBasicMaterial()
    attachStelProjector(mat, { terrainSafe: true })
    const key = mat.customProgramCacheKey()
    expect(key).toContain('stel-proj-v38-terrain-bow')
    expect(key).toMatch(/\|d1\|/)
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <project_vertex>\n',
      fragmentShader:
        '#include <common>\n#include <clipping_planes_fragment>\n',
    }
    mat.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      null as unknown as THREE.WebGLRenderer,
    )
    expect(shader.vertexShader).toContain('vStelBad = 1.0')
    expect(shader.vertexShader).toContain('dir * 12.0')
    expect(shader.fragmentShader).toContain('stelDiscardBow()')
    expect(shader.fragmentShader).toContain('vStelBad > 0.02')
    mat.dispose()
  })
})

/** Pure JS twin of the locked stereo formula — for numeric non-regression. */
function stereoSt(nx: number, ny: number, nz: number): {
  st: [number, number]
  bad: boolean
} {
  const h = 0.5 * (1 - nz)
  if (h < 1e-3) {
    const pl = Math.hypot(nx, ny)
    const dirX = pl > 1e-8 ? nx / pl : 1
    const dirY = pl > 1e-8 ? ny / pl : 0
    return { st: [dirX * 12, dirY * 12], bad: true }
  }
  return { st: [nx / h, ny / h], bad: false }
}

describe('stereographic math non-regression', () => {
  it('ahead look (−Z) maps near origin', () => {
    const { st, bad } = stereoSt(0, 0, -1)
    expect(bad).toBe(false)
    expect(Math.hypot(st[0], st[1])).toBeLessThan(1e-6)
  })

  it('does not clamp wide |st| (hublot / stCap regression)', () => {
    // θ = 150° from look → r = 2·tan(75°) ≈ 7.46 (above the failed stCap≈5.2)
    const theta = (150 * Math.PI) / 180
    const { st, bad } = stereoSt(Math.sin(theta), 0, -Math.cos(theta))
    expect(bad).toBe(false)
    const r = Math.hypot(st[0], st[1])
    expect(r).toBeGreaterThan(7)
  })

  it('nearby downward ground rays stay continuous (no discontinuous park jump)', () => {
    // Two close view rays slightly past the equator — both must use same branch
    // or |Δst| explodes into screen-edge filaments.
    const a = stereoSt(0.2, -0.85, 0.48)
    const b = stereoSt(0.21, -0.84, 0.49)
    expect(a.bad).toBe(false)
    expect(b.bad).toBe(false)
    const dst = Math.hypot(a.st[0] - b.st[0], a.st[1] - b.st[1])
    expect(dst).toBeLessThan(8)
  })

  it('antipode park is bad; straddling edge would discard (sky-needle contract)', () => {
    // +Z ≈ behind camera look (−Z). Terrain used to draw these as dir*12 edges
    // across the sky (black pillars). Bow discard requires bad=true here.
    const antipode = stereoSt(0, 0, 1)
    expect(antipode.bad).toBe(true)
    expect(Math.hypot(antipode.st[0], antipode.st[1])).toBeCloseTo(12, 5)

    const ground = stereoSt(0.05, -0.15, -0.98)
    expect(ground.bad).toBe(false)

    // Interpolated vStelBad on a straddling tri exceeds fragment threshold.
    const midBad = 0.5 * 1 + 0.5 * 0
    expect(midBad).toBeGreaterThan(0.02)
  })
})
