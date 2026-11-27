import * as THREE from 'three'
import { Observer, Rotation_EQJ_HOR } from 'astronomy-engine'
import { CELESTIAL_SKY_DISTANCE_M } from './celestialRender'
import { createCelestialVectorLayers } from './celestialVectors'
import { createConstellationHtmlLabels } from './constellationHtmlLabels'
import { createHorizonAzimuthGrid } from './horizonAzimuthGrid'
import {
  createNasaSkyTileLayer,
  loadNasaSkyTilesManifest,
  type NasaSkyTileLayerHandle,
  type NasaSkyTileLayerId,
} from './nasaSkyTiles'
import { attachStelProjector } from './stelProjector'
import {
  DEFAULT_MILKY_WAY_NEB_LOOK,
  MILKY_WAY_NEB_EXPOSURE_NO_ATMO_RATIO,
  type MilkyWayNebLook,
} from './milkyWayNebLook'

/** Shipping NASA tiles vs enhanced nebulae rebuild (A/B). */
export type MilkyWayTileVariant = Extract<
  NasaSkyTileLayerId,
  'milkyway' | 'milkyway-neb'
>

/**
 * With atmosphere: keep the translucent glow in the sky (not a solid sheet).
 * Bumped slightly vs the old 0.34 / 5 so the band is less washed out.
 */
export const MILKY_WAY_EXPOSURE = 8.5
export const MILKY_WAY_DOME_OPACITY = 0.72
/** Atmosphere off: stronger read on a black sky. */
export const MILKY_WAY_DOME_OPACITY_NO_ATMO = 0.96
export const MILKY_WAY_EXPOSURE_NO_ATMO = 10
/** @deprecated Prefer milkyWayNebLook.exposure from the temp grade card. */
export const MILKY_WAY_EXPOSURE_NEB = DEFAULT_MILKY_WAY_NEB_LOOK.exposure
export const MILKY_WAY_EXPOSURE_NEB_NO_ATMO =
  DEFAULT_MILKY_WAY_NEB_LOOK.exposure * MILKY_WAY_NEB_EXPOSURE_NO_ATMO_RATIO
export const HALPHA_GAIN = 2.4
export const HALPHA_TEXTURE_URL = '/sky/halpha_j2000.webp?v=5'
/** When true, Néb. reuses NASA tiles (A/B plumbing only). Keep false for custom. */
export const MILKY_WAY_NEB_ALIAS_NASA_TILES = false
/** Open on the custom enhanced VL. */
export const DEFAULT_MILKY_WAY_TILE_VARIANT: MilkyWayTileVariant = 'milkyway-neb'

function tileFolderForVariant(
  variant: MilkyWayTileVariant,
): NasaSkyTileLayerId {
  if (variant === 'milkyway-neb' && MILKY_WAY_NEB_ALIAS_NASA_TILES) {
    return 'milkyway'
  }
  return variant
}

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
    /** Which MW tile folder to show (`milkyway` vs `milkyway-neb`). */
    milkyWayTileVariant?: MilkyWayTileVariant
    /** Temporary grade for `milkyway-neb` only. */
    milkyWayNebLook?: MilkyWayNebLook
    showHalpha?: boolean
    /** Rayleigh amount 0…1 (legacy: showAtmosphere true/false). */
    atmosphereAmount?: number
    showAtmosphere?: boolean
    showConstellations?: boolean
    showCelestialGrid?: boolean
    showAzimuthGrid?: boolean
    /** Extra HYG magnitude depth (0 = default FOV curve). */
    starMagDepth?: number
    /** Wide↔tele magnitude-span multiplier (1 = default). */
    starZoomSpan?: number
    /** Star luminance multiplier (1 = default). */
    starBrightness?: number
    /** Halo on bright stars (0 = cores only, 1 = default). */
    starGlow?: number
    /** Fixed-tripod exposure trail (rad of sky arc); 0 = pinpricks. */
    starTrailArcRad?: number
    /** Mag cut from local Bortle (0 = dark, ~2.2 = inner city). */
    lightPollutionMagPenalty?: number
    /** Extra star luminance crush under urban skyglow. */
    lightPollutionStarBrightMul?: number
    /** Milky Way opacity × local zenith pollution (0 = gone). */
    lightPollutionMilkyWayMul?: number
    /** CSS px size of the viewfinder canvas (for HTML constellation names). */
    viewSize?: { width: number; height: number }
    /**
     * Cheap ridge occlusion for constellation HTML names (height samples).
     * Do NOT pass full terrain meshes — Mesh raycasts froze night frames.
     */
    terrainOccluded?: (
      origin: THREE.Vector3,
      dir: THREE.Vector3,
      maxDist: number,
    ) => boolean
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
export function createNightSky(opts?: {
  /** Host for crisp HTML constellation names (same font as Paysage / Ciel). */
  labelHost?: HTMLElement | null
}): NightSkyHandle {
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

  const htmlLabels = opts?.labelHost
    ? createConstellationHtmlLabels(opts.labelHost)
    : null
  htmlLabels?.setVisible(false)

  let milkyWayTiles: NasaSkyTileLayerHandle | null = null
  let milkyManifest: Awaited<
    ReturnType<typeof loadNasaSkyTilesManifest>
  > = null
  let milkyFolderMounted: NasaSkyTileLayerId | null = null
  let milkyReady = false
  let lastRotation: { utcMs: number; lat: number; lon: number; elevationM: number } | undefined
  let disposed = false

  const blackHalpha = createBlackDataTexture()
  const exposureUniform = { value: MILKY_WAY_EXPOSURE }
  const milkyWayAmountUniform = { value: 1 }
  const mwGradeOnUniform = { value: 0 }
  const mwBrightnessUniform = { value: 1 }
  const mwContrastUniform = { value: 1 }
  const mwSaturationUniform = { value: 1 }
  const halphaAmountUniform = { value: 0 }
  const halphaGainUniform = { value: HALPHA_GAIN }
  const halphaMapUniform: { value: THREE.Texture } = { value: blackHalpha }

  let halphaLoad: Promise<void> | null = null
  let halphaTexture: THREE.Texture | null = null

  const milkyShaderHook = (material: THREE.MeshBasicMaterial) => {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uMilkyWayExposure = exposureUniform
      shader.uniforms.uMilkyWayAmount = milkyWayAmountUniform
      shader.uniforms.uMwGradeOn = mwGradeOnUniform
      shader.uniforms.uMwBrightness = mwBrightnessUniform
      shader.uniforms.uMwContrast = mwContrastUniform
      shader.uniforms.uMwSaturation = mwSaturationUniform
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
            uniform float uMwGradeOn;
            uniform float uMwBrightness;
            uniform float uMwContrast;
            uniform float uMwSaturation;
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

            if (uMwGradeOn > 0.5) {
              diffuseColor.rgb *= uMwBrightness;
              diffuseColor.rgb = (diffuseColor.rgb - 0.5) * uMwContrast + 0.5;
              float luma = dot(
                max(diffuseColor.rgb, vec3(0.0)),
                vec3(0.2126, 0.7152, 0.0722)
              );
              diffuseColor.rgb = mix(vec3(luma), diffuseColor.rgb, uMwSaturation);
              diffuseColor.rgb = max(diffuseColor.rgb, vec3(0.0));
            }

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
    material.customProgramCacheKey = () => 'astro-milky-way-halpha-v8'
    material.depthWrite = false
    material.needsUpdate = true
    attachStelProjector(material)
  }

  const remountMilkyFolder = (folder: NasaSkyTileLayerId): boolean => {
    if (!milkyManifest?.layers[folder]) {
      console.warn('[nightSky] milky folder missing in manifest', folder, milkyManifest?.layers)
      return false
    }
    if (milkyWayTiles && milkyFolderMounted === folder) return true
    if (milkyWayTiles) {
      celestialLayers.remove(milkyWayTiles.root)
      milkyWayTiles.dispose()
      milkyWayTiles = null
    }
    milkyWayTiles = createNasaSkyTileLayer({
      layer: folder,
      manifest: milkyManifest,
      radius: CELESTIAL_SKY_DISTANCE_M * 0.995,
      renderOrder: 20,
      blending: THREE.NormalBlending,
      transparent: true,
      depthTest: true,
      cacheTag: folder === 'milkyway' ? 'nasa-v1' : 'neb-v8-custom',
      configureMaterial: milkyShaderHook,
    })
    if (!milkyWayTiles) {
      console.warn('[nightSky] createNasaSkyTileLayer returned null', folder)
      milkyFolderMounted = null
      milkyReady = false
      return false
    }
    milkyWayTiles.setVisible(false)
    celestialLayers.add(milkyWayTiles.root)
    celestialLayers.remove(vectorLayers.root)
    celestialLayers.add(vectorLayers.root)
    milkyFolderMounted = folder
    milkyReady = true
    console.info('[nightSky] milky layer mounted', folder)
    return true
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
    if (disposed || !manifest) return
    milkyManifest = manifest
    remountMilkyFolder(tileFolderForVariant(DEFAULT_MILKY_WAY_TILE_VARIANT))
  })

  root.traverse((obj) => {
    obj.frustumCulled = false
  })

  // Temporary QA probe for the custom VL A/B (remove after lock-in).
  ;(window as unknown as { __astroMilkyDebug?: () => unknown }).__astroMilkyDebug =
    () => ({
      disposed,
      milkyReady,
      milkyFolderMounted,
      hasHandle: !!milkyWayTiles,
      manifestLayers: milkyManifest ? Object.keys(milkyManifest.layers) : null,
      aliasNasa: MILKY_WAY_NEB_ALIAS_NASA_TILES,
      defaultVariant: DEFAULT_MILKY_WAY_TILE_VARIANT,
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
      milkyWayTileVariant = DEFAULT_MILKY_WAY_TILE_VARIANT,
      milkyWayNebLook = DEFAULT_MILKY_WAY_NEB_LOOK,
      showHalpha = false,
      showAtmosphere = true,
      atmosphereAmount,
      showConstellations = false,
      showCelestialGrid = false,
      showAzimuthGrid = false,
      starMagDepth = 0,
      starZoomSpan = 1,
      starBrightness = 1,
      starGlow = 1,
      starTrailArcRad = 0,
      /** Mag cut from local Bortle (0 = dark, ~2.2 = inner city). */
      lightPollutionMagPenalty = 0,
      /** Extra star luminance crush under urban skyglow. */
      lightPollutionStarBrightMul = 1,
      /** Milky Way opacity × local zenith pollution (0 = gone). */
      lightPollutionMilkyWayMul = 1,
      viewSize,
      terrainOccluded,
    }) => {
      if (disposed) return
      root.position.copy(camera.position)
      if (!lastRotation || lastRotation.utcMs !== utcMs ||
          lastRotation.lat !== lat || lastRotation.lon !== lon ||
          lastRotation.elevationM !== elevationM) {
        celestialLayers.quaternion.setFromRotationMatrix(
          getNasaCelestialToThreeLocalMatrix(new Date(utcMs), lat, lon, elevationM),
        )
        lastRotation = { utcMs, lat, lon, elevationM }
      }

      // Stars start appearing from civil/nautical twilight (−4° → −16°).
      const deepNight = THREE.MathUtils.clamp(
        (-sunAltitudeDeg - 4) / 12,
        0,
        1,
      )
      const nightOn = deepNight > 0.02

      const atmoAmt =
        typeof atmosphereAmount === 'number' && Number.isFinite(atmosphereAmount)
          ? THREE.MathUtils.clamp(atmosphereAmount, 0, 1)
          : showAtmosphere
            ? 1
            : 0

      // Never let the field collapse to invisible under residual twilight.
      const layerOpacity = Math.max(deepNight, nightOn ? 0.75 : 0)
      const lpStarMul =
        Number.isFinite(lightPollutionStarBrightMul) &&
        lightPollutionStarBrightMul > 0
          ? Math.min(1, Math.max(0.2, lightPollutionStarBrightMul))
          : 1
      const lpMwMul =
        Number.isFinite(lightPollutionMilkyWayMul)
          ? Math.min(1, Math.max(0, lightPollutionMilkyWayMul))
          : 1
      vectorLayers.setOpacity(layerOpacity)
      vectorLayers.setStarBrightness(starBrightness * lpStarMul)
      vectorLayers.setStarGlow(starGlow * (0.55 + 0.45 * lpStarMul))
      // Punch through Rayleigh without depending on night-crush hacks.
      // Urban wash: less skyComp so stars don't look like deep-sky pinpricks.
      vectorLayers.setSkyComp((1.6 + atmoAmt * 0.5) * (0.65 + 0.35 * lpStarMul))
      const stageFov =
        typeof camera.userData.stageVfovDeg === 'number' &&
        Number.isFinite(camera.userData.stageVfovDeg)
          ? (camera.userData.stageVfovDeg as number)
          : camera.fov
      vectorLayers.setView(stageFov, {
        depth: starMagDepth,
        zoomSpan: starZoomSpan,
        magPenalty: lightPollutionMagPenalty,
      })
      vectorLayers.setStarTrailArcRad(
        nightOn && Number.isFinite(starTrailArcRad) ? starTrailArcRad : 0,
      )
      vectorLayers.setStarsVisible(nightOn)
      const constellationsOn = nightOn && showConstellations
      vectorLayers.setConstellationsVisible(constellationsOn)
      vectorLayers.setGridVisible(nightOn && showCelestialGrid)

      if (htmlLabels) {
        htmlLabels.setVisible(constellationsOn)
        htmlLabels.setOpacity(layerOpacity)
        if (constellationsOn) {
          const w = viewSize?.width ?? 0
          const h = viewSize?.height ?? 0
          htmlLabels.update({
            camera,
            celestialRoot: celestialLayers,
            stageVfovDeg: stageFov,
            canvasWidth: w,
            canvasHeight: h,
            terrainOccluded,
          })
        }
      }

      // Local alt/az grid: useful day & night; dim a bit under bright sky.
      const azOn = showAzimuthGrid
      azimuthGrid.setVisible(azOn)
      azimuthGrid.setOpacity(azOn ? 0.55 + deepNight * 0.45 : 0)

      milkyWayAmountUniform.value = showMilkyWay ? 1 : 0
      halphaAmountUniform.value = showHalpha && halphaTexture ? 1 : 0
      const useNeb = milkyWayTileVariant === 'milkyway-neb'
      const wantFolder = tileFolderForVariant(milkyWayTileVariant)
      if (milkyManifest) remountMilkyFolder(wantFolder)
      // At defaults, use the exact NASA exposure path so A/B only differs by tiles.
      const nebExp = milkyWayNebLook.exposure
      const expNoAtmo = useNeb
        ? Math.abs(nebExp - MILKY_WAY_EXPOSURE) < 0.05
          ? MILKY_WAY_EXPOSURE_NO_ATMO
          : nebExp * MILKY_WAY_NEB_EXPOSURE_NO_ATMO_RATIO
        : MILKY_WAY_EXPOSURE_NO_ATMO
      const expAtmo = useNeb
        ? Math.abs(nebExp - MILKY_WAY_EXPOSURE) < 0.05
          ? MILKY_WAY_EXPOSURE
          : nebExp
        : MILKY_WAY_EXPOSURE
      exposureUniform.value = THREE.MathUtils.lerp(expNoAtmo, expAtmo, atmoAmt)
      const gradeLive =
        useNeb &&
        (Math.abs(milkyWayNebLook.brightness - 1) > 0.001 ||
          Math.abs(milkyWayNebLook.contrast - 1) > 0.001 ||
          Math.abs(milkyWayNebLook.saturation - 1) > 0.001)
      mwGradeOnUniform.value = gradeLive ? 1 : 0
      mwBrightnessUniform.value = gradeLive ? milkyWayNebLook.brightness : 1
      mwContrastUniform.value = gradeLive ? milkyWayNebLook.contrast : 1
      mwSaturationUniform.value = gradeLive ? milkyWayNebLook.saturation : 1

      if (milkyWayTiles && milkyReady) {
        // Hα lives in the MW shader — keep the dome up if either layer is on.
        // Bortle ≥7: MW invisible; still allow Hα alone if the user forces it.
        const mwVisible = showMilkyWay && lpMwMul > 0.02
        const showDome =
          nightOn &&
          deepNight > 0.05 &&
          (mwVisible || (showHalpha && !!halphaTexture))
        const baseOp =
          deepNight *
          THREE.MathUtils.lerp(
            MILKY_WAY_DOME_OPACITY_NO_ATMO,
            MILKY_WAY_DOME_OPACITY,
            atmoAmt,
          )
        const opacity =
          showHalpha && !mwVisible ? baseOp : baseOp * lpMwMul
        milkyWayTiles.setVisible(showDome)
        milkyWayTiles.setOpacity(opacity)
        // Preload cover tiles as soon as night falls (don't wait for showDome).
        if (nightOn || showDome) milkyWayTiles.update(camera)
      }
    },
    dispose: () => {
      disposed = true
      htmlLabels?.dispose()
      vectorLayers.dispose()
      azimuthGrid.dispose()
      milkyWayTiles?.dispose()
      milkyWayTiles = null
      milkyFolderMounted = null
      milkyManifest = null
      milkyReady = false
      if (halphaTexture) {
        halphaTexture.dispose()
        halphaTexture = null
      }
      halphaMapUniform.value = blackHalpha
      blackHalpha.dispose()
    },
  }
}
