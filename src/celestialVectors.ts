import * as THREE from 'three'
import {
  STEL_FRAGMENT_GLSL,
  STEL_PROJECT_GLSL,
  attachStelProjector,
  stelModeUniform,
} from './stelProjector'
import { CELESTIAL_SKY_DISTANCE_M } from './celestialRender'
import {
  CONSTELLATION_FIGURES,
  type ConstellationFigure,
} from './constellationFigures'
import { HYG_BRIGHT_STARS, type HygBrightStar } from './hygBrightStars'

/**
 * Base star disc radius (CSS px at ~40° FOV) from visual magnitude.
 * Inspired by Stellarium's computeRCMag: bright stars get a clearly larger halo.
 */
export function celestialStarSizePx(mag: number): number {
  const m = THREE.MathUtils.clamp(mag, -1.5, 6.5)
  // Relative flux vs mag 4, soft-rooted so Rigel/Betelgeuse read as discs.
  const flux = 10 ** (-0.4 * (m - 4))
  return 2.2 + flux ** 0.42 * 7.5
}

/**
 * Additive luminance weight (Stellarium "cmag"-like), before FOV adaptation.
 */
export function celestialStarBrightness(mag: number): number {
  const m = THREE.MathUtils.clamp(mag, -1.5, 6.5)
  return THREE.MathUtils.clamp(10 ** (-0.2 * (m - 2)) * 0.55, 0.45, 1.25)
}

/** Soft halo weight — brighter stars bloom more (Stellarium big-halo path). */
export function celestialStarHalo(mag: number): number {
  const m = THREE.MathUtils.clamp(mag, -1.5, 6.5)
  return THREE.MathUtils.clamp((4.5 - m) / 6, 0.08, 0.85)
}

/**
 * Faintest magnitude revealed at this FOV.
 * Wide: naked-eye bright set; telephoto: deeper HYG stars.
 */
export function starMagLimitForFov(fovYDeg: number): number {
  return THREE.MathUtils.clamp(
    THREE.MathUtils.mapLinear(fovYDeg, 55, 8, 4.2, 6.5),
    4.2,
    6.5,
  )
}

/**
 * Stellarium-style FOV adaptation: stars grow brighter/larger as FOV shrinks
 * (halos stay readable when zoomed on Orion, etc.).
 * Reference ~40° → 1; telephoto 8° → ~3.2; wide 60° → ~0.85.
 */
export function starZoomBoostForFov(fovYDeg: number): number {
  const fov = THREE.MathUtils.clamp(fovYDeg, 8, 70)
  return THREE.MathUtils.clamp(40 / fov, 0.85, 3.4)
}

export type CelestialVectorLayerHandle = {
  root: THREE.Group
  setStarsVisible: (visible: boolean) => void
  setConstellationsVisible: (visible: boolean) => void
  setGridVisible: (visible: boolean) => void
  setOpacity: (opacity: number) => void
  /** Drive mag reveal + zoom punch from the viewfinder FOV. */
  setView: (fovYDeg: number) => void
  dispose: () => void
}

const DEG = Math.PI / 180

/**
 * Convert J2000 RA/Dec into the NASA map sphere frame used by `celestialLayers`
 * (see `getNasaCelestialToThreeLocalMatrix` in realSky.ts).
 *
 * J2000: (+X RA0, +Y RA6h, +Z NCP)
 * NASA map: (+X RA0, +Y NCP, +Z RA6h) with the historical inside-sphere U flip
 * handled by the parent texture path — vectors sit in the same parent group.
 */
export function j2000ToNasaMapDirection(
  raHours: number,
  decDeg: number,
): THREE.Vector3 {
  const ra = raHours * 15 * DEG
  const dec = decDeg * DEG
  const jx = Math.cos(dec) * Math.cos(ra)
  const jy = Math.cos(dec) * Math.sin(ra)
  const jz = Math.sin(dec)
  return new THREE.Vector3(jx, jz, -jy)
}

function starColorFromBv(ci: number | null | undefined): [number, number, number] {
  if (ci == null || !Number.isFinite(ci)) return [0.9, 0.94, 1]
  const bv = THREE.MathUtils.clamp(ci, -0.4, 2)
  const kelvin = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))
  const temperature = THREE.MathUtils.clamp(kelvin / 100, 10, 400)
  const red =
    temperature <= 66
      ? 1
      : THREE.MathUtils.clamp(1.292936186 * (temperature - 60) ** -0.1332047592, 0, 1)
  const green =
    temperature <= 66
      ? THREE.MathUtils.clamp(0.3900815788 * Math.log(temperature) - 0.6318414438, 0, 1)
      : THREE.MathUtils.clamp(1.129890861 * (temperature - 60) ** -0.0755148492, 0, 1)
  const blue =
    temperature >= 66
      ? 1
      : temperature <= 19
        ? 0
        : THREE.MathUtils.clamp(
            0.5432067891 * Math.log(temperature - 10) - 1.1962540891,
            0,
            1,
          )
  return [red, green, blue]
}

function createHygStarPoints(
  catalog: readonly HygBrightStar[],
  radius: number,
): { points: THREE.Points; dispose: () => void } {
  const count = catalog.length
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const brightness = new Float32Array(count)
  const halos = new Float32Array(count)
  const mags = new Float32Array(count)
  const colors = new Float32Array(count * 3)
  const dir = new THREE.Vector3()
  for (let i = 0; i < count; i += 1) {
    const star = catalog[i]!
    dir.copy(j2000ToNasaMapDirection(star.raHours, star.decDeg)).multiplyScalar(radius)
    positions[i * 3] = dir.x
    positions[i * 3 + 1] = dir.y
    positions[i * 3 + 2] = dir.z
    sizes[i] = celestialStarSizePx(star.mag)
    brightness[i] = celestialStarBrightness(star.mag)
    halos[i] = celestialStarHalo(star.mag)
    mags[i] = star.mag
    const [r, g, b] = starColorFromBv(star.ci)
    colors[i * 3] = Math.min(1, r * 1.1 + 0.08)
    colors[i * 3 + 1] = Math.min(1, g * 1.1 + 0.08)
    colors[i * 3 + 2] = Math.min(1, b * 1.1 + 0.1)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1))
  geometry.setAttribute('aHalo', new THREE.BufferAttribute(halos, 1))
  geometry.setAttribute('aMag', new THREE.BufferAttribute(mags, 1))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // Stellarium uses GL_ONE, GL_ONE additive sprites for star halos.
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
    uniforms: {
      uStelMode: stelModeUniform,
      uOpacity: { value: 1 },
      uPixelRatio: {
        value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1,
      },
      uMaxPointSize: { value: 72 },
      uMagLimit: { value: 6.5 },
      // FOV adaptation (Stellarium lnfovFactor): grows as FOV shrinks.
      uZoomBoost: { value: 1 },
    },
    vertexShader: /* glsl */ `
      ${STEL_PROJECT_GLSL}
      attribute float aSize;
      attribute float aBrightness;
      attribute float aHalo;
      attribute float aMag;
      attribute vec3 aColor;
      uniform float uPixelRatio;
      uniform float uMaxPointSize;
      uniform float uMagLimit;
      uniform float uZoomBoost;
      varying vec3 vColor;
      varying float vBrightness;
      varying float vHalo;
      void main() {
        float reveal = smoothstep(uMagLimit + 0.7, uMagLimit - 0.25, aMag);
        vColor = aColor;
        vBrightness = aBrightness * reveal;
        vHalo = aHalo;
        if (vBrightness < 0.03) {
          vStelRay = vec3(0.0, 0.0, -1.0);
          vStelSt = vec2(0.0);
          vStelBad = 1.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          gl_PointSize = 0.0;
          return;
        }
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = stelProject(mv);
        // Stellarium: smaller FOV → larger on-screen halo (not fixed CSS px).
        float r = aSize * uPixelRatio * uZoomBoost;
        // Avoid sub-pixel flicker (Stellarium clamps tiny stars to ~1.2px).
        gl_PointSize = clamp(max(r, 2.4), 2.4, uMaxPointSize);
      }
    `,
    fragmentShader: /* glsl */ `
      ${STEL_FRAGMENT_GLSL}
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vBrightness;
      varying float vHalo;
      void main() {
        stelDiscardBow();
        if (vBrightness < 0.03) discard;
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        // Soft Stellarium-like PSF: tight core + wide glow for bright stars.
        float core = exp(-r2 * 11.0);
        float halo = exp(-r2 * mix(3.2, 1.15, vHalo)) * mix(0.12, 0.55, vHalo);
        float energy = (core + halo) * vBrightness * uOpacity;
        gl_FragColor = vec4(vColor * energy, energy);
      }
    `,
  })

  const points = new THREE.Points(geometry, material)
  points.name = 'hygCelestialStars'
  points.frustumCulled = false
  // Above milky way / grid / figures so pinpricks stay readable.
  points.renderOrder = -5
  return {
    points,
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}

function createConstellationLines(
  figures: readonly ConstellationFigure[],
  radius: number,
): { lines: THREE.LineSegments; dispose: () => void } {
  const positions: number[] = []
  const dirA = new THREE.Vector3()
  const dirB = new THREE.Vector3()
  for (const figure of figures) {
    for (let i = 0; i < figure.points.length - 1; i += 1) {
      const a = figure.points[i]!
      const b = figure.points[i + 1]!
      dirA.copy(j2000ToNasaMapDirection(a.raHours, a.decDeg)).multiplyScalar(radius)
      dirB.copy(j2000ToNasaMapDirection(b.raHours, b.decDeg)).multiplyScalar(radius)
      positions.push(dirA.x, dirA.y, dirA.z, dirB.x, dirB.y, dirB.z)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  )
  const material = new THREE.LineBasicMaterial({
    color: 0xb8c4d8,
    transparent: true,
    opacity: 0.38,
    depthTest: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  })
  attachStelProjector(material)
  const lines = new THREE.LineSegments(geometry, material)
  lines.name = 'iauConstellationFigures'
  lines.frustumCulled = false
  lines.renderOrder = -8
  return {
    lines,
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}

/** Procedural RA (1 h) / Dec (15°) grid in the NASA celestial frame. */
export function createCelestialRaDecGrid(radius: number): {
  lines: THREE.LineSegments
  dispose: () => void
} {
  const positions: number[] = []
  const push = (raHours: number, decDeg: number) => {
    const p = j2000ToNasaMapDirection(raHours, decDeg).multiplyScalar(radius)
    positions.push(p.x, p.y, p.z)
  }

  // RA meridians every hour.
  for (let ra = 0; ra < 24; ra += 1) {
    for (let dec = -90; dec < 90; dec += 5) {
      push(ra, dec)
      push(ra, Math.min(dec + 5, 90))
    }
  }
  // Dec parallels every 15°, skip poles (degenerate).
  for (let dec = -75; dec <= 75; dec += 15) {
    for (let ra = 0; ra < 24; ra += 0.25) {
      push(ra, dec)
      push((ra + 0.25) % 24, dec)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  )
  const material = new THREE.LineBasicMaterial({
    color: 0xd0d8e8,
    transparent: true,
    opacity: 0.28,
    depthTest: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  })
  attachStelProjector(material)
  const lines = new THREE.LineSegments(geometry, material)
  lines.name = 'celestialRaDecGrid'
  lines.frustumCulled = false
  lines.renderOrder = -7
  return {
    lines,
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}

/**
 * Vector celestial overlays (HYG stars, IAU figures, RA/Dec grid) that live in
 * the same NASA celestial parent as the milky-way texture/tiles.
 */
export function createCelestialVectorLayers(
  radius = CELESTIAL_SKY_DISTANCE_M,
): CelestialVectorLayerHandle {
  const root = new THREE.Group()
  root.name = 'celestialVectorLayers'

  const stars = createHygStarPoints(HYG_BRIGHT_STARS, radius * 0.994)
  const figures = createConstellationLines(CONSTELLATION_FIGURES, radius * 0.993)
  const grid = createCelestialRaDecGrid(radius * 0.992)

  stars.points.visible = false
  figures.lines.visible = false
  grid.lines.visible = false
  root.add(stars.points, figures.lines, grid.lines)

  const starMat = stars.points.material as THREE.ShaderMaterial
  const figureMat = figures.lines.material as THREE.LineBasicMaterial
  const gridMat = grid.lines.material as THREE.LineBasicMaterial
  const figureBase = figureMat.opacity
  const gridBase = gridMat.opacity

  return {
    root,
    setStarsVisible: (visible) => {
      stars.points.visible = visible
    },
    setConstellationsVisible: (visible) => {
      figures.lines.visible = visible
    },
    setGridVisible: (visible) => {
      grid.lines.visible = visible
    },
    setOpacity: (opacity) => {
      const o = THREE.MathUtils.clamp(opacity, 0, 1)
      starMat.uniforms.uOpacity.value = o
      figureMat.opacity = figureBase * o
      gridMat.opacity = gridBase * o
      if (typeof window !== 'undefined') {
        starMat.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2)
      }
    },
    setView: (fovYDeg) => {
      starMat.uniforms.uMagLimit.value = starMagLimitForFov(fovYDeg)
      starMat.uniforms.uZoomBoost.value = starZoomBoostForFov(fovYDeg)
    },
    dispose: () => {
      stars.dispose()
      figures.dispose()
      grid.dispose()
    },
  }
}
