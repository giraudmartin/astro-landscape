import * as THREE from 'three'
import { Observer, Rotation_EQJ_HOR } from 'astronomy-engine'
import { CELESTIAL_SKY_DISTANCE_M } from './celestialRender'
import { createCelestialVectorLayers } from './celestialVectors'
import { createHorizonAzimuthGrid } from './horizonAzimuthGrid'
import {
  createNasaSkyTileLayer,
  loadNasaSkyTilesManifest,
  type NasaSkyTileLayerHandle,
} from './nasaSkyTiles'
import { attachStelProjector } from './stelProjector'

/**
 * With atmosphere: keep the translucent glow in the sky (not a solid sheet).
 * Bumped slightly vs the old 0.34 / 5 so the band is less washed out.
 */
export const MILKY_WAY_EXPOSURE = 6
export const MILKY_WAY_DOME_OPACITY = 0.42
/** Atmosphere off: stronger read on a black sky. */
export const MILKY_WAY_DOME_OPACITY_NO_ATMO = 0.92
export const MILKY_WAY_EXPOSURE_NO_ATMO = 7.5
export const HALPHA_GAIN = 2.4
export const HALPHA_TEXTURE_URL = '/sky/halpha_j2000.webp?v=5'

/**
 * Astronomy Engine J2000 → Three local (X=east, Y=up, Z=south).
 * Same transform as Photo Sightline `realSky.ts`.
 */
export function getJ2000ToThreeLocalMatrix(
  when: Date,
  latitudeDeg: number,
  longitudeDeg: number,
  elevationM = 0,
): THREE.Matrix4 {
  const horizontal = Rotation_EQJ_HOR(
    when,
    new Observer(latitudeDeg, longitudeDeg, elevationM),
  ).rot
  return new THREE.Matrix4().set(
    -horizontal[0]![1]!,
    -horizontal[1]![1]!,
    -horizontal[2]![1]!,
    0,
    horizontal[0]![2]!,
    horizontal[1]![2]!,
    horizontal[2]![2]!,
    0,
    -horizontal[0]![0]!,
    -horizontal[1]![0]!,
    -horizontal[2]![0]!,
    0,
    0,
    0,
    0,
    1,
  )
}

/** NASA equirect map axes → Three local (via J2000). */
export function getNasaCelestialToThreeLocalMatrix(
  when: Date,
  latitudeDeg: number,
  longitudeDeg: number,
  elevationM = 0,
): THREE.Matrix4 {
  const nasaMapToJ2000 = new THREE.Matrix4().set(
    1,
    0,
    0,
    0,
    0,
    0,
    -1,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    0,
    1,
  )
  return getJ2000ToThreeLocalMatrix(
    when,
    latitudeDeg,
    longitudeDeg,
    elevationM,
  ).multiply(nasaMapToJ2000)
}

export type NightSkyHandle = {
  root: THREE.Group
  update: (input: {
    utcMs: number
    lat: number
    lon: number
    elevationM: number
    sunAltitudeDeg: number
    camera: THREE.PerspectiveCamera
    showMilkyWay?: boolean
    showHalpha?: boolean
    showAtmosphere?: boolean
    showConstellations?: boolean
    showCelestialGrid?: boolean
    showAzimuthGrid?: boolean
  }) => void
  /** Lazy-load the Hα equirect on first enable. */
  ensureHalphaLoaded: () => Promise<void>
  dispose: () => void
}

function createBlackDataTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
  texture.colorSpace = THREE.LinearSRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/**
 * HYG stars + NASA milky-way tiles (Photo Sightline VF night sky),
 * oriented with Astronomy Engine for the observer.
 */
export function createNightSky(): NightSkyHandle {
  const root = new THREE.Group()
  root.name = 'nightSky'

  const celestialLayers = new THREE.Group()
  celestialLayers.name = 'nasaCelestialLayers'
  root.add(celestialLayers)

  // Horizon-fixed (does NOT rotate with J2000 celestial layers).
  const azimuthGrid = createHorizonAzimuthGrid()
  root.add(azimuthGrid.root)

  const vectorLayers = createCelestialVectorLayers(CELESTIAL_SKY_DISTANCE_M)
  // After atmosphere (renderOrder 10). Celestial radius is beyond all DEM
  // (see CELESTIAL_SKY_DISTANCE_M); depthTest keeps every terrain ridge in front.
  vectorLayers.root.traverse((obj) => {
    if ((obj as THREE.Points).isPoints) {
      obj.renderOrder = 24
      return
    }
    if ((obj as THREE.LineSegments).isLineSegments) {
      // Grid under figures under stars (same parent, after atmosphere @ 10).
      obj.renderOrder = obj.name === 'celestialRaDecGrid' ? 21 : 23
    }
  })
  celestialLayers.add(vectorLayers.root)

  let milkyWayTiles: NasaSkyTileLayerHandle | null = null
  let milkyReady = false
  let disposed = false

  const blackHalpha = createBlackDataTexture()
  const exposureUniform = { value: MILKY_WAY_EXPOSURE }
  const milkyWayAmountUniform = { value: 1 }
  const halphaAmountUniform = { value: 0 }
  const halphaGainUniform = { value: HALPHA_GAIN }
  const halphaMapUniform: { value: THREE.Texture } = { value: blackHalpha }

  let halphaLoad: Promise<void> | null = null
  let halphaTexture: THREE.Texture | null = null

  const milkyShaderHook = (material: THREE.MeshBasicMaterial) => {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uMilkyWayExposure = exposureUniform
      shader.uniforms.uMilkyWayAmount = milkyWayAmountUniform
      shader.uniforms.uHalphaAmount = halphaAmountUniform
      shader.uniforms.uHalphaGain = halphaGainUniform
      shader.uniforms.uHalphaMap = halphaMapUniform

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
            #include <common>
            varying vec3 vHalphaDir;
          `,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
            #include <begin_vertex>
            vHalphaDir = position;
          `,
        )

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
            #include <common>
            uniform float uMilkyWayExposure;
            uniform float uMilkyWayAmount;
            uniform float uHalphaAmount;
            uniform float uHalphaGain;
            uniform sampler2D uHalphaMap;
            varying vec3 vHalphaDir;
          `,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
            #include <map_fragment>
            // Same MW path as before Hα: exposure only; thinness = material opacity.
            diffuseColor.rgb *= uMilkyWayAmount;
            diffuseColor.rgb *= uMilkyWayExposure;

            if (uHalphaAmount > 0.001) {
              vec3 haDir = normalize(vHalphaDir);
              float haU = atan(haDir.z, -haDir.x) / (2.0 * 3.141592653589793);
              haU = fract(1.0 - haU);
              float haV = acos(clamp(haDir.y, -1.0, 1.0)) / 3.141592653589793;
              float ha = texture2D(uHalphaMap, vec2(haU, haV)).r;
              // Additive crimson only — does not rewrite MW rgb.
              diffuseColor.rgb += vec3(1.0, 0.12, 0.04) * ha * uHalphaGain * uHalphaAmount;
            }
          `,
        )
    }
    material.customProgramCacheKey = () => 'astro-milky-way-halpha-v5'
    material.depthWrite = false
    material.needsUpdate = true
    attachStelProjector(material)
  }

  const ensureHalphaLoaded = (): Promise<void> => {
    if (halphaTexture) return Promise.resolve()
    if (halphaLoad) return halphaLoad
    halphaLoad = new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader()
      loader.load(
        HALPHA_TEXTURE_URL,
        (texture) => {
          if (disposed) {
            texture.dispose()
            resolve()
            return
          }
          // Match NASA EXR tiles (flipY=false): file top/NCP → WebGL v=0 with
          // haV=acos(y)/π. TextureLoader default flipY=true inverted the sky.
          texture.flipY = false
          texture.colorSpace = THREE.LinearSRGBColorSpace
          texture.wrapS = THREE.RepeatWrapping
          texture.wrapT = THREE.ClampToEdgeWrapping
          // No mipmaps: averaging sparse nebulae into empty sky creates a red fog.
          texture.generateMipmaps = false
          texture.minFilter = THREE.LinearFilter
          texture.magFilter = THREE.LinearFilter
          texture.needsUpdate = true
          halphaTexture = texture
          halphaMapUniform.value = texture
          resolve()
        },
        undefined,
        () => {
          halphaLoad = null
          reject(new Error(`Failed to load ${HALPHA_TEXTURE_URL}`))
        },
      )
    })
    return halphaLoad
  }

  void loadNasaSkyTilesManifest().then((manifest) => {
    if (disposed || !manifest?.layers.milkyway) return
    milkyWayTiles = createNasaSkyTileLayer({
      layer: 'milkyway',
      manifest,
      radius: CELESTIAL_SKY_DISTANCE_M * 0.995,
      renderOrder: 20,
      blending: THREE.NormalBlending,
      transparent: true,
      depthTest: true,
      configureMaterial: milkyShaderHook,
    })
    if (milkyWayTiles) {
      milkyWayTiles.setVisible(false)
      // Milky under additive stars (renderOrder 20 vs 22).
      celestialLayers.add(milkyWayTiles.root)
      celestialLayers.remove(vectorLayers.root)
      celestialLayers.add(vectorLayers.root)
      milkyReady = true
    }
  })

  root.traverse((obj) => {
    obj.frustumCulled = false
  })

  return {
    root,
    ensureHalphaLoaded,
    update: ({
      utcMs,
      lat,
      lon,
      elevationM,
      sunAltitudeDeg,
      camera,
      showMilkyWay = true,
      showHalpha = false,
      showAtmosphere = true,
      showConstellations = false,
      showCelestialGrid = false,
      showAzimuthGrid = false,
    }) => {
      if (disposed) return
      root.position.copy(camera.position)
      celestialLayers.quaternion.setFromRotationMatrix(
        getNasaCelestialToThreeLocalMatrix(
          new Date(utcMs),
          lat,
          lon,
          elevationM,
        ),
      )

      // Fade in from nautical → astronomical twilight (−8° → −18°).
      const deepNight = THREE.MathUtils.clamp(
        (-sunAltitudeDeg - 8) / 10,
        0,
        1,
      )
      const nightOn = deepNight > 0.02

      vectorLayers.setOpacity(deepNight)
      const stageFov = camera.userData.stageVfovDeg
      vectorLayers.setView(
        typeof stageFov === 'number' && Number.isFinite(stageFov)
          ? stageFov
          : camera.fov,
      )
      vectorLayers.setStarsVisible(nightOn)
      vectorLayers.setConstellationsVisible(nightOn && showConstellations)
      vectorLayers.setGridVisible(nightOn && showCelestialGrid)

      // Local alt/az grid: useful day & night; dim a bit under bright sky.
      const azOn = showAzimuthGrid
      azimuthGrid.setVisible(azOn)
      azimuthGrid.setOpacity(azOn ? 0.55 + deepNight * 0.45 : 0)

      milkyWayAmountUniform.value = showMilkyWay ? 1 : 0
      halphaAmountUniform.value = showHalpha && halphaTexture ? 1 : 0
      exposureUniform.value = showAtmosphere
        ? MILKY_WAY_EXPOSURE
        : MILKY_WAY_EXPOSURE_NO_ATMO

      if (milkyWayTiles && milkyReady) {
        // Hα lives in the MW shader — keep the dome up if either layer is on.
        const showDome =
          nightOn &&
          deepNight > 0.05 &&
          (showMilkyWay || (showHalpha && !!halphaTexture))
        milkyWayTiles.setVisible(showDome)
        milkyWayTiles.setOpacity(
          deepNight *
            (showAtmosphere
              ? MILKY_WAY_DOME_OPACITY
              : MILKY_WAY_DOME_OPACITY_NO_ATMO),
        )
        if (showDome) milkyWayTiles.update(camera)
      }
    },
    dispose: () => {
      disposed = true
      vectorLayers.dispose()
      azimuthGrid.dispose()
      milkyWayTiles?.dispose()
      milkyWayTiles = null
      if (halphaTexture) {
        halphaTexture.dispose()
        halphaTexture = null
      }
      halphaMapUniform.value = blackHalpha
      blackHalpha.dispose()
    },
  }
}
