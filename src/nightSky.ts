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

/**
 * With atmosphere: keep the translucent glow in the sky (not a solid sheet).
 * Bumped slightly vs the old 0.34 / 5 so the band is less washed out.
 */
export const MILKY_WAY_EXPOSURE = 8.5
export const MILKY_WAY_DOME_OPACITY = 0.72
/** Atmosphere off: stronger read on a black sky. */
export const MILKY_WAY_DOME_OPACITY_NO_ATMO = 0.96
/**
 * No-VL night veil: uniform black NormalBlending stand-in for the dark
 * sky texels the MW dome would have applied. Tuned 0.25 (was matching
 * MILKY_WAY_DOME_OPACITY 0.72, too heavy).
 */
export const NIGHT_VEIL_OPACITY = 0.25
export const MILKY_WAY_EXPOSURE_NO_ATMO = 10
/** @deprecated Prefer milkyWayNebLook.exposure from the VL settings card. */
export const MILKY_WAY_EXPOSURE_NEB = DEFAULT_MILKY_WAY_NEB_LOOK.exposure
export const MILKY_WAY_EXPOSURE_NEB_NO_ATMO =
  DEFAULT_MILKY_WAY_NEB_LOOK.exposure * MILKY_WAY_NEB_EXPOSURE_NO_ATMO_RATIO
/** Shipping immersive MW tile layer (NASA SVS #4851 + photo nebulae). */
export const MILKY_WAY_TILE_LAYER: NasaSkyTileLayerId = 'milkyway'

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
    /** Session grade from the VL settings card. */
    milkyWayNebLook?: MilkyWayNebLook
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
  dispose: () => void
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

  /**
   * When VL is off, a uniform black NormalBlending veil stands in for the
   * dark sky texels the MW dome would apply — otherwise cutting VL unmasks
   * the full atmosphere glow. Stars / figures stay above (renderOrder 23–24).
   */
  const nightVeilMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    fog: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
  })
  attachStelProjector(nightVeilMaterial)
  const nightVeil = new THREE.Mesh(
    new THREE.SphereGeometry(CELESTIAL_SKY_DISTANCE_M * 0.995, 48, 32),
    nightVeilMaterial,
  )
  nightVeil.name = 'nightSkyVeil'
  nightVeil.frustumCulled = false
  nightVeil.renderOrder = 20
  nightVeil.visible = false
  root.add(nightVeil)

  let milkyWayTiles: NasaSkyTileLayerHandle | null = null
  let milkyManifest: Awaited<
    ReturnType<typeof loadNasaSkyTilesManifest>
  > = null
  let milkyFolderMounted: NasaSkyTileLayerId | null = null
  let milkyReady = false
  let lastRotation: { utcMs: number; lat: number; lon: number; elevationM: number } | undefined
  let disposed = false

  const exposureUniform = { value: MILKY_WAY_EXPOSURE }
  const milkyWayAmountUniform = { value: 1 }
  const mwGradeOnUniform = { value: 0 }
  const mwBrightnessUniform = { value: 1 }
  const mwContrastUniform = { value: 1 }
  const mwSaturationUniform = { value: 1 }

  const milkyShaderHook = (material: THREE.MeshBasicMaterial) => {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uMilkyWayExposure = exposureUniform
      shader.uniforms.uMilkyWayAmount = milkyWayAmountUniform
      shader.uniforms.uMwGradeOn = mwGradeOnUniform
      shader.uniforms.uMwBrightness = mwBrightnessUniform
      shader.uniforms.uMwContrast = mwContrastUniform
      shader.uniforms.uMwSaturation = mwSaturationUniform

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
          `,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
            #include <map_fragment>
            // Exposure only; thinness = material opacity.
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
          `,
        )
    }
    material.customProgramCacheKey = () => 'astro-milky-way-v9'
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
      cacheTag: 'milky-v12-exr',
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

  void loadNasaSkyTilesManifest().then((manifest) => {
    if (disposed || !manifest) return
    milkyManifest = manifest
    remountMilkyFolder(MILKY_WAY_TILE_LAYER)
  })

  root.traverse((obj) => {
    obj.frustumCulled = false
  })

  return {
    root,
    update: ({
      utcMs,
      lat,
      lon,
      elevationM,
      sunAltitudeDeg,
      camera,
      showMilkyWay = true,
      milkyWayNebLook = DEFAULT_MILKY_WAY_NEB_LOOK,
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
      if (milkyManifest) remountMilkyFolder(MILKY_WAY_TILE_LAYER)
      const nebExp = milkyWayNebLook.exposure
      const expNoAtmo =
        Math.abs(nebExp - MILKY_WAY_EXPOSURE) < 0.05
          ? MILKY_WAY_EXPOSURE_NO_ATMO
          : nebExp * MILKY_WAY_NEB_EXPOSURE_NO_ATMO_RATIO
      const expAtmo =
        Math.abs(nebExp - MILKY_WAY_EXPOSURE) < 0.05
          ? MILKY_WAY_EXPOSURE
          : nebExp
      exposureUniform.value = THREE.MathUtils.lerp(expNoAtmo, expAtmo, atmoAmt)
      const gradeLive =
        Math.abs(milkyWayNebLook.brightness - 1) > 0.001 ||
        Math.abs(milkyWayNebLook.saturation - 1) > 0.001
      mwGradeOnUniform.value = gradeLive ? 1 : 0
      mwBrightnessUniform.value = gradeLive ? milkyWayNebLook.brightness : 1
      mwContrastUniform.value = 1
      mwSaturationUniform.value = gradeLive ? milkyWayNebLook.saturation : 1

      const deepEnough = nightOn && deepNight > 0.05
      const mwBaseOp =
        deepNight *
        THREE.MathUtils.lerp(
          MILKY_WAY_DOME_OPACITY_NO_ATMO,
          MILKY_WAY_DOME_OPACITY,
          atmoAmt,
        )
      const mwOp = mwBaseOp * lpMwMul
      const veilOp = deepNight * NIGHT_VEIL_OPACITY * lpMwMul

      if (milkyWayTiles && milkyReady) {
        const mwVisible = showMilkyWay && lpMwMul > 0.02
        const showDome = deepEnough && mwVisible
        milkyWayTiles.setVisible(showDome)
        milkyWayTiles.setOpacity(mwOp)
        // Preload cover tiles as soon as night falls (don't wait for showDome).
        if (nightOn || showDome) milkyWayTiles.update(camera)
      }

      // Black veil only when the textured MW dome is off.
      const showVeil = deepEnough && !showMilkyWay && lpMwMul > 0.02
      nightVeil.visible = showVeil
      nightVeilMaterial.opacity = showVeil ? veilOp : 0
    },
    dispose: () => {
      disposed = true
      htmlLabels?.dispose()
      vectorLayers.dispose()
      azimuthGrid.dispose()
      nightVeil.visible = false
      root.remove(nightVeil)
      nightVeil.geometry.dispose()
      nightVeilMaterial.dispose()
      milkyWayTiles?.dispose()
      milkyWayTiles = null
      milkyFolderMounted = null
      milkyManifest = null
      milkyReady = false
    },
  }
}
