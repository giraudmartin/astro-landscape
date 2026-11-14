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
import {
  clampStarBrightness,
  clampStarGlow,
  starMagLimitForFov,
  type StarRevealOptions,
} from './starRevealSettings'

export {
  STAR_BRIGHTNESS_DEFAULT,
  STAR_BRIGHTNESS_MAX,
  STAR_BRIGHTNESS_MIN,
  STAR_GLOW_DEFAULT,
  STAR_GLOW_MAX,
  STAR_GLOW_MIN,
  STAR_MAG_DEPTH_DEFAULT,
  STAR_MAG_DEPTH_MAX,
  STAR_MAG_DEPTH_MIN,
  STAR_ZOOM_SPAN_DEFAULT,
  STAR_ZOOM_SPAN_MAX,
  STAR_ZOOM_SPAN_MIN,
  clampStarBrightness,
  clampStarGlow,
  clampStarMagDepth,
  clampStarZoomSpan,
  starMagLimitForFov,
  type StarRevealOptions,
} from './starRevealSettings'

/**
 * Base star disc radius (CSS px at ~40° FOV) from visual magnitude.
 * Inspired by Stellarium's computeRCMag: bright stars get a clearly larger halo.
 */
export function celestialStarSizePx(mag: number): number {
  const m = THREE.MathUtils.clamp(mag, -1.5, 6.5)
  // Base disc stays modest — diffuse glow expands via glowPad, not a fat core.
  const flux = 10 ** (-0.4 * (m - 4))
  return 2.0 + flux ** 0.32 * 3.2
}

/**
 * Additive luminance weight (Stellarium "cmag"-like), before FOV adaptation.
 * Soft floor so the full HYG bright extract stays readable under atmosphere.
 */
export function celestialStarBrightness(mag: number): number {
  const m = THREE.MathUtils.clamp(mag, -1.5, 6.5)
  return THREE.MathUtils.clamp(10 ** (-0.2 * (m - 2)) * 0.55, 0.5, 1.25)
}

/**
 * Soft halo weight — brighter stars bloom more (Stellarium big-halo path).
 * Faint density stars → ~0 (pinprick); bright stars keep a soft halo.
 */
export function celestialStarHalo(mag: number): number {
  const m = THREE.MathUtils.clamp(mag, -1.5, 6.5)
  // Bright stars get a strong bloom weight; faint stay near pinprick.
  // uGlow scales this in the shader (0 = cores only).
  return THREE.MathUtils.clamp((5.0 - m) / 5.5, 0.05, 1.0)
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
  /** User star luminance multiplier (1 = default), on top of night fade. */
  setStarBrightness: (brightness: number) => void
  /** Halo strength on bright stars (0 = cores only, 1 = default). */
  setStarGlow: (glow: number) => void
  /** Extra gain so stars punch through residual atmosphere (1 = none). */
  setSkyComp: (comp: number) => void
  /** Drive mag reveal + zoom punch from the viewfinder FOV. */
  setView: (fovYDeg: number, reveal?: StarRevealOptions) => void
  /**
   * Fixed-tripod star trail: sky arc (rad) swept during the exposure.
   * 0 hides trails; equatorial tracking should pass 0.
   */
  setStarTrailArcRad: (arcRad: number) => void
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

/**
 * B−V → display RGB for cores + glow. Saturates chroma so spectral types
 * (B blue / K–M orange-red) read clearly — no white wash that pastels them.
 */
export function starDisplayColorFromBv(
  ci: number | null | undefined,
): [number, number, number] {
  const [r, g, b] = starColorFromBv(ci)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const sat = 2.2
  return [
    THREE.MathUtils.clamp(lum + (r - lum) * sat, 0, 1),
    THREE.MathUtils.clamp(lum + (g - lum) * sat, 0, 1),
    THREE.MathUtils.clamp(lum + (b - lum) * sat, 0, 1),
  ]
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
    const [r, g, b] = starDisplayColorFromBv(star.ci)
    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
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
    // Stellarium-style GL_ONE, GL_ONE — soft halo adds directly (no SrcAlpha² kill).
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    fog: false,
    toneMapped: false,
    uniforms: {
      uStelMode: stelModeUniform,
      uOpacity: { value: 1 },
      uPixelRatio: {
        value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1,
      },
      // Diffuse max-glow needs a wide sprite; energy stays soft (no white pâté).
      uMaxPointSize: { value: 72 },
      uMagLimit: { value: 6.5 },
      // FOV adaptation (Stellarium lnfovFactor): grows as FOV shrinks.
      uZoomBoost: { value: 1 },
      // >1 helps stars punch through residual Rayleigh glow.
      uSkyComp: { value: 1 },
      // User glow on bright stars (0 = cores only).
      uGlow: { value: 1 },
    },
    vertexShader: /* glsl */ `
      ${STEL_PROJECT_GLSL}
      // Match Mesh*Materials under logarithmicDepthBuffer (Points don't get
      // Three's logdepthbuf chunks — without this they lose the depth test
      // against the sky dome and vanish).
      #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
        varying float vFragDepth;
        varying float vIsPerspective;
        bool isPerspectiveMatrix(mat4 m) { return m[2][3] == -1.0; }
      #endif
      attribute float aSize;
      attribute float aBrightness;
      attribute float aHalo;
      attribute float aMag;
      attribute vec3 aColor;
      uniform float uPixelRatio;
      uniform float uMaxPointSize;
      uniform float uMagLimit;
      uniform float uZoomBoost;
      uniform float uGlow;
      varying vec3 vColor;
      varying float vBrightness;
      varying float vHalo;
      void main() {
        float reveal = smoothstep(uMagLimit + 0.7, uMagLimit - 0.25, aMag);
        vColor = aColor;
        vBrightness = aBrightness * reveal;
        // Glow → diffuse weight; max spreads wide, not a hard pâté.
        float g = clamp(uGlow, 0.0, 1.0);
        vHalo = aHalo * (0.25 * g + 0.75 * g * g);
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
        #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
          vFragDepth = 1.0 + gl_Position.w;
          vIsPerspective = float(isPerspectiveMatrix(projectionMatrix));
        #endif
        // Wide sprite only for bloom room (PSF stays soft & dim in the fringe).
        float glowPad = 1.0 + g * clamp(aHalo, 0.0, 1.0) * 2.6;
        float r = aSize * uPixelRatio * uZoomBoost * glowPad;
        gl_PointSize = clamp(max(r, 2.4), 2.4, uMaxPointSize);
      }
    `,
    fragmentShader: /* glsl */ `
      ${STEL_FRAGMENT_GLSL}
      #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
        uniform float logDepthBufFC;
        varying float vFragDepth;
        varying float vIsPerspective;
      #endif
      uniform float uOpacity;
      uniform float uSkyComp;
      varying vec3 vColor;
      varying float vBrightness;
      varying float vHalo;
      void main() {
        #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
          gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2(vFragDepth) * logDepthBufFC * 0.5;
        #endif
        stelDiscardBow();
        if (vBrightness < 0.03) discard;
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        // Long soft fade — never a hard disc rim.
        float edge = 1.0 - smoothstep(0.2, 1.0, r2);
        // Tiny hot core (pinprick). Glow must NOT enlarge this into a pâté.
        float coreGain = vBrightness * uOpacity * uSkyComp;
        float core = exp(-r2 * 110.0) * 2.0 * coreGain;
        float coreE = 1.0 - exp(-core * 0.8);
        // Diffuse bloom: wide + dim. Peak stays well under white clip.
        float bloomGain = (0.55 + 0.45 * vBrightness) * uOpacity
          * mix(0.9, 1.1, clamp(uSkyComp - 1.0, 0.0, 1.0));
        // At max vHalo, falloffs go very soft → large milky aura, not a cookie.
        float mid = exp(-r2 * mix(4.8, 1.25, vHalo)) * vHalo * 0.55 * bloomGain;
        float outer = exp(-r2 * mix(2.0, 0.45, vHalo)) * vHalo * 0.38 * bloomGain;
        float far = exp(-r2 * mix(0.95, 0.18, vHalo)) * vHalo * 0.2 * bloomGain;
        float energy = (coreE + mid + outer + far) * edge;
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

/**
 * Star-trail chords: each star is a line whose endpoints are rotated ±½ arc
 * around the NASA-map NCP (+Y). Vertex shader applies `uTrailArcRad` live.
 */
function createHygStarTrails(
  catalog: readonly HygBrightStar[],
  radius: number,
): {
  lines: THREE.LineSegments
  material: THREE.ShaderMaterial
  dispose: () => void
} {
  const count = catalog.length
  const positions = new Float32Array(count * 2 * 3)
  const ends = new Float32Array(count * 2)
  const brightness = new Float32Array(count * 2)
  const mags = new Float32Array(count * 2)
  const colors = new Float32Array(count * 2 * 3)
  const dir = new THREE.Vector3()
  for (let i = 0; i < count; i += 1) {
    const star = catalog[i]!
    dir.copy(j2000ToNasaMapDirection(star.raHours, star.decDeg)).multiplyScalar(
      radius,
    )
    const bright = celestialStarBrightness(star.mag)
    const [cr, cg, cb] = starDisplayColorFromBv(star.ci)
    for (let e = 0; e < 2; e += 1) {
      const idx = i * 2 + e
      positions[idx * 3] = dir.x
      positions[idx * 3 + 1] = dir.y
      positions[idx * 3 + 2] = dir.z
      ends[idx] = e === 0 ? -1 : 1
      brightness[idx] = bright
      mags[idx] = star.mag
      colors[idx * 3] = cr
      colors[idx * 3 + 1] = cg
      colors[idx * 3 + 2] = cb
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1))
  geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1))
  geometry.setAttribute('aMag', new THREE.BufferAttribute(mags, 1))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
    uniforms: {
      uStelMode: stelModeUniform,
      uOpacity: { value: 1 },
      uTrailArcRad: { value: 0 },
      uMagLimit: { value: 6.5 },
    },
    vertexShader: /* glsl */ `
      ${STEL_PROJECT_GLSL}
      #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
        varying float vFragDepth;
        varying float vIsPerspective;
        bool isPerspectiveMatrix(mat4 m) { return m[2][3] == -1.0; }
      #endif
      attribute float aEnd;
      attribute float aBrightness;
      attribute float aMag;
      attribute vec3 aColor;
      uniform float uTrailArcRad;
      uniform float uMagLimit;
      varying vec3 vColor;
      varying float vBrightness;
      void main() {
        float reveal = smoothstep(uMagLimit + 0.7, uMagLimit - 0.25, aMag);
        vColor = aColor;
        vBrightness = aBrightness * reveal;
        if (vBrightness < 0.03 || uTrailArcRad < 1.0e-5) {
          vStelRay = vec3(0.0, 0.0, -1.0);
          vStelSt = vec2(0.0);
          vStelBad = 1.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        // Rotate around NASA-map NCP (+Y): equatorial stars trail the most.
        float a = aEnd * uTrailArcRad * 0.5;
        float c = cos(a);
        float s = sin(a);
        vec3 p = vec3(
          position.x * c + position.z * s,
          position.y,
          -position.x * s + position.z * c
        );
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = stelProject(mv);
        #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
          vFragDepth = 1.0 + gl_Position.w;
          vIsPerspective = float(isPerspectiveMatrix(projectionMatrix));
        #endif
      }
    `,
    fragmentShader: /* glsl */ `
      ${STEL_FRAGMENT_GLSL}
      #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
        uniform float logDepthBufFC;
        varying float vFragDepth;
        varying float vIsPerspective;
      #endif
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vBrightness;
      void main() {
        #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
          gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2(vFragDepth) * logDepthBufFC * 0.5;
        #endif
        stelDiscardBow();
        if (vBrightness < 0.03) discard;
        // Soft trail energy — brighter stars leave a denser streak.
        float energy = vBrightness * uOpacity * 0.55;
        gl_FragColor = vec4(vColor * energy, energy);
      }
    `,
  })

  const lines = new THREE.LineSegments(geometry, material)
  lines.name = 'hygCelestialStarTrails'
  lines.frustumCulled = false
  lines.visible = false
  lines.renderOrder = -4
  return {
    lines,
    material,
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
  const trails = createHygStarTrails(HYG_BRIGHT_STARS, radius * 0.994)
  const figures = createConstellationLines(CONSTELLATION_FIGURES, radius * 0.993)
  const grid = createCelestialRaDecGrid(radius * 0.992)

  stars.points.visible = false
  trails.lines.visible = false
  figures.lines.visible = false
  grid.lines.visible = false
  root.add(trails.lines, stars.points, figures.lines, grid.lines)

  const starMat = stars.points.material as THREE.ShaderMaterial
  const trailMat = trails.material
  const figureMat = figures.lines.material as THREE.LineBasicMaterial
  const gridMat = grid.lines.material as THREE.LineBasicMaterial
  const figureBase = figureMat.opacity
  const gridBase = gridMat.opacity
  let starsWanted = false
  let trailArcRad = 0
  let layerOpacity = 1
  let starBrightness = 1
  let starGlow = 1
  let skyComp = 1

  const applyStarOpacity = () => {
    const trailing = starsWanted && trailArcRad > 1e-5
    const gain = layerOpacity * starBrightness
    // Soften pinpricks so the streak reads as the exposure, not a double image.
    starMat.uniforms.uOpacity.value = trailing ? gain * 0.35 : gain
    trailMat.uniforms.uOpacity.value = gain
    starMat.uniforms.uSkyComp.value = skyComp
    starMat.uniforms.uGlow.value = starGlow
  }

  const syncTrailVisibility = () => {
    trails.lines.visible = starsWanted && trailArcRad > 1e-5
    trailMat.uniforms.uTrailArcRad.value = trailArcRad
    applyStarOpacity()
  }

  return {
    root,
    setStarsVisible: (visible) => {
      starsWanted = visible
      stars.points.visible = visible
      syncTrailVisibility()
    },
    setConstellationsVisible: (visible) => {
      figures.lines.visible = visible
    },
    setGridVisible: (visible) => {
      grid.lines.visible = visible
    },
    setOpacity: (opacity) => {
      layerOpacity = THREE.MathUtils.clamp(opacity, 0, 1)
      applyStarOpacity()
      figureMat.opacity = figureBase * layerOpacity
      gridMat.opacity = gridBase * layerOpacity
      if (typeof window !== 'undefined') {
        starMat.uniforms.uPixelRatio.value = Math.min(
          window.devicePixelRatio || 1,
          2,
        )
      }
    },
    setStarBrightness: (brightness) => {
      starBrightness = clampStarBrightness(brightness)
      applyStarOpacity()
    },
    setStarGlow: (glow) => {
      // Soft cap — slider max is already 1; never allow the old ugly 2× discs.
      starGlow = Math.min(1, clampStarGlow(glow))
      applyStarOpacity()
    },
    setSkyComp: (comp) => {
      skyComp =
        Number.isFinite(comp) && comp > 0 ? Math.min(3, Math.max(0.5, comp)) : 1
      applyStarOpacity()
    },
    setView: (fovYDeg, reveal) => {
      const mag = starMagLimitForFov(fovYDeg, reveal)
      starMat.uniforms.uMagLimit.value = mag
      starMat.uniforms.uZoomBoost.value = starZoomBoostForFov(fovYDeg)
      trailMat.uniforms.uMagLimit.value = mag
    },
    setStarTrailArcRad: (arcRad) => {
      trailArcRad =
        Number.isFinite(arcRad) && arcRad > 0 ? Math.min(arcRad, Math.PI) : 0
      syncTrailVisibility()
    },
    dispose: () => {
      stars.dispose()
      trails.dispose()
      figures.dispose()
      grid.dispose()
    },
  }
}
