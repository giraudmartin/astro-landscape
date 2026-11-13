/**
 * Sun disc + Moon globe + day trajectories in the ImmersiveView ENU frame.
 * Visuals and sampling match Photo Sightline `realSky.ts` / `sunDisc` /
 * `moonGlobe` — not reinvented here.
 */
import * as THREE from 'three'
import {
  civilDateFromUtc,
  civilDayStartUtcMs,
  shiftIsoDate,
} from './celestial'
import {
  CELESTIAL_SKY_DISTANCE_M,
  LUNAR_TRAJECTORY_COLOR,
  cloneMoonTopoModel,
  getMoonTopoAlbedo,
  loadMoonAlbedoTexture,
  moonAngularRadiusMeters,
  MOON_MODEL_CREDIT,
} from './celestialRender'
import {
  applyMoonSkyOrientation,
  createMoonGlobeMaterial,
  createMoonGlowMaterial,
  createMoonOrientationRig,
  setMoonGlobePhase,
  setMoonGlowTurbulence,
  setMoonGlobeTurbulence,
  setMoonTurbulenceSettings,
} from './moonGlobe'
import {
  displayExtinctionRgb,
  extinctionAirmassFromAltitudeDeg,
  transmittanceRgb,
} from './moonHorizonExtinction'
import { createSunDisc } from './sunDisc'
import { sunDirectionFromAltAz } from './skyDome'
import {
  sampleMoonSkyAt,
  sampleMoonSkyPath,
  type SkySample,
} from './skySamples'
import {
  DEFAULT_HORIZON_TURBULENCE_SETTINGS,
  horizonTurbulenceAmount,
  type HorizonTurbulenceSettings,
} from './horizonTurbulence'
import {
  attachStelProjector,
  attachStelProjectorMv,
} from './stelProjector'

const DEG = Math.PI / 180
/** Apparent solar angular radius used by Photo Sightline realSky. */
const SUN_ANGULAR_RADIUS_DEG = 0.2666

export { MOON_MODEL_CREDIT }

export type SkyBodiesHandle = {
  root: THREE.Group
  update: (input: {
    utcMs: number
    lat: number
    lon: number
    elevationM: number
    camera: THREE.PerspectiveCamera
  }) => void
  dispose: () => void
}

function createPath(color: THREE.ColorRepresentation): THREE.Line {
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.7,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  })
  // Same stel warp as stars / az grid — otherwise stereo pan makes arcs swim.
  attachStelProjector(material)
  const line = new THREE.Line(new THREE.BufferGeometry(), material)
  line.frustumCulled = false
  line.visible = false
  line.renderOrder = 3
  return line
}

function updatePaths(
  sunPath: THREE.Line,
  moonPath: THREE.Line,
  samples: SkySample[],
): void {
  const set = (line: THREE.Line, positions: number[]) => {
    line.geometry.dispose()
    if (positions.length < 6) {
      line.geometry = new THREE.BufferGeometry()
      line.visible = false
      return
    }
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < positions.length; i += 3) {
      pts.push(
        new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]),
      )
    }
    line.geometry = new THREE.BufferGeometry().setFromPoints(pts)
    line.visible = true
  }
  const sun: number[] = []
  const moon: number[] = []
  for (const sample of samples) {
    if (sample.sunAltitudeDeg >= -1) {
      const p = sunDirectionFromAltAz(
        sample.sunAltitudeDeg,
        sample.sunAzimuthDeg,
      ).multiplyScalar(CELESTIAL_SKY_DISTANCE_M * 1.02)
      sun.push(p.x, p.y, p.z)
    }
    if (sample.altitudeApparentDeg >= -1) {
      const p = sunDirectionFromAltAz(
        sample.altitudeApparentDeg,
        sample.azimuthDeg,
      ).multiplyScalar(CELESTIAL_SKY_DISTANCE_M * 1.08)
      moon.push(p.x, p.y, p.z)
    }
  }
  set(sunPath, sun)
  set(moonPath, moon)
}

function pathKey(
  lat: number,
  lon: number,
  elevationM: number,
  civilDate: string,
): string {
  return `${civilDate}|${lat.toFixed(4)}|${lon.toFixed(4)}|${Math.round(elevationM)}`
}

/**
 * Sun + Moon discs and their civil-day arcs — same models as PlanetStudio.
 */
export function createSkyBodies(): SkyBodiesHandle {
  const root = new THREE.Group()
  root.name = 'skyBodies'

  const sunRig = createSunDisc()
  sunRig.root.name = 'immersiveSunDisc'
  sunRig.root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if ((mat as THREE.ShaderMaterial).isShaderMaterial) {
        attachStelProjectorMv(mat as THREE.ShaderMaterial)
      }
    }
  })
  const moonGlowMat = createMoonGlowMaterial()
  attachStelProjectorMv(moonGlowMat)
  const moonGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), moonGlowMat)
  moonGlow.name = 'immersiveMoonGlow'
  moonGlow.renderOrder = 1
  moonGlow.visible = false

  let moonAlbedo: THREE.Texture | null = null
  let moonMat: ReturnType<typeof createMoonGlobeMaterial> | null = null
  let moonRig: ReturnType<typeof createMoonOrientationRig> | null = null
  let moonAlbedoReady = false
  let disposed = false
  let turbSettings: HorizonTurbulenceSettings = DEFAULT_HORIZON_TURBULENCE_SETTINGS

  const applyMoonGlobe = (
    texture: THREE.Texture | null,
    topoRoot: THREE.Object3D | null,
  ): void => {
    if (disposed) return
    moonAlbedo = texture
    moonMat = createMoonGlobeMaterial(texture)
    attachStelProjectorMv(moonMat)
    moonRig = createMoonOrientationRig(moonMat, topoRoot)
    moonRig.root.name = 'immersiveMoonGlobe'
    moonRig.root.visible = false
    root.add(moonRig.root)
    setMoonTurbulenceSettings([moonMat, moonGlowMat], turbSettings)
    moonAlbedoReady = true
  }

  void (async () => {
    const topoRoot = await cloneMoonTopoModel()
    if (disposed) return
    const texture =
      (topoRoot ? getMoonTopoAlbedo() : null) ?? (await loadMoonAlbedoTexture())
    if (disposed) return
    if (!texture && !topoRoot) {
      console.error('[sky bodies] Moon albedo is unavailable')
      return
    }
    applyMoonGlobe(texture, topoRoot)
  })()

  root.add(sunRig.root, moonGlow)

  const sunPath = createPath(0xffc65a)
  sunPath.name = 'solarTrajectory'
  const moonPath = createPath(LUNAR_TRAJECTORY_COLOR)
  moonPath.name = 'lunarTrajectory'
  root.add(sunPath, moonPath)

  let cachedPathKey = ''
  let pathSamples: SkySample[] = []
  const localSun = new THREE.Vector3()
  const localMoon = new THREE.Vector3()
  const moonLightView = new THREE.Vector3()
  const identityWorld = new THREE.Quaternion()

  const ensurePathSamples = (
    utcMs: number,
    lat: number,
    lon: number,
    elevationM: number,
  ): void => {
    const civilDate = civilDateFromUtc(utcMs, lon)
    const key = pathKey(lat, lon, elevationM, civilDate)
    if (key === cachedPathKey && pathSamples.length > 0) return
    const dayStart = civilDayStartUtcMs(civilDate, lon)
    const nextDate = shiftIsoDate(civilDate, 1) ?? civilDate
    const dayEnd = civilDayStartUtcMs(nextDate, lon)
    pathSamples = sampleMoonSkyPath({
      latitude: lat,
      longitude: lon,
      elevationMeters: elevationM,
      startUtc: new Date(dayStart),
      endUtc: new Date(dayEnd),
    })
    updatePaths(sunPath, moonPath, pathSamples)
    cachedPathKey = key
  }

  return {
    root,
    update: ({ utcMs, lat, lon, elevationM, camera }) => {
      if (disposed) return
      root.position.copy(camera.position)
      ensurePathSamples(utcMs, lat, lon, elevationM)

      const sample = sampleMoonSkyAt({
        latitude: lat,
        longitude: lon,
        elevationMeters: elevationM,
        utcMs,
      })

      const sunDir = sunDirectionFromAltAz(
        sample.sunAltitudeDeg,
        sample.sunAzimuthDeg,
      )
      const moonDir = sunDirectionFromAltAz(
        sample.altitudeApparentDeg,
        sample.azimuthDeg,
      )
      localSun.copy(sunDir).multiplyScalar(CELESTIAL_SKY_DISTANCE_M)
      localMoon.copy(moonDir).multiplyScalar(CELESTIAL_SKY_DISTANCE_M)

      const sunSize = Math.max(
        CELESTIAL_SKY_DISTANCE_M * Math.tan(SUN_ANGULAR_RADIUS_DEG * DEG),
        4,
      )
      const moonSize = moonAngularRadiusMeters(
        CELESTIAL_SKY_DISTANCE_M,
        Number.isFinite(sample.angularDiameterDeg)
          ? sample.angularDiameterDeg
          : 0.5,
      )

      sunRig.root.position.copy(localSun)
      sunRig.root.scale.setScalar(sunSize)
      sunRig.faceCamera(camera)
      sunRig.setAltitudeDeg(sample.sunAltitudeDeg)

      moonRig?.root.position.copy(localMoon)
      moonRig?.root.scale.setScalar(moonSize)
      moonGlow.position.copy(localMoon)
      moonGlow.scale.setScalar(moonSize * 2.8)
      moonGlow.lookAt(camera.position)

      camera.updateMatrixWorld(true)
      moonLightView
        .copy(sunDir)
        .transformDirection(camera.matrixWorldInverse)

      if (moonMat && moonRig) {
        setMoonGlobePhase(moonMat, {
          illuminationFraction: sample.illuminationFraction,
          waxing: sample.waxing,
          brightness: 1.16,
          moonAltitudeDeg: sample.altitudeApparentDeg,
          angularDiameterDeg: sample.angularDiameterDeg,
          lightViewDir: moonLightView,
        })
        // Immersive ENU: +X east, +Z south → sightline south = 180° (PS realSky).
        applyMoonSkyOrientation(moonRig, camera, {
          datetimeUtc: sample.datetimeUtc,
          latitudeDeg: lat,
          longitudeDeg: lon,
          elevationMeters: elevationM,
          targetAzimuthDeg: 180,
          localToWorld: identityWorld,
        })
      }

      const timeSec = performance.now() / 1000
      const moonTurb = horizonTurbulenceAmount(sample.altitudeApparentDeg, true)
      if (moonMat) {
        setMoonGlobeTurbulence(moonMat, { timeSec, amount: moonTurb })
      }
      setMoonGlowTurbulence(moonGlowMat, { timeSec, amount: moonTurb })
      sunRig.setTurbulence({
        timeSec,
        amount: horizonTurbulenceAmount(sample.sunAltitudeDeg, true),
      })

      const centreT = displayExtinctionRgb(
        transmittanceRgb(
          extinctionAirmassFromAltitudeDeg(sample.altitudeApparentDeg),
        ),
        0.28,
      )
      moonGlowMat.uniforms.uBrightness.value = 0.45 + 1.16 * 0.15
      moonGlowMat.uniforms.uLit.value = Math.min(
        1,
        0.3 + sample.illuminationFraction * 0.55,
      )
      ;(moonGlowMat.uniforms.uGlowTint.value as THREE.Color).setRGB(
        centreT[0] * 1.02,
        centreT[1],
        centreT[2] * 0.95,
      )

      sunRig.root.visible = sample.sunAltitudeDeg > -4
      const moonAboveHorizon = sample.altitudeApparentDeg > -0.75
      if (moonRig) {
        moonRig.root.visible = moonAlbedoReady && moonAboveHorizon
      }
      moonGlow.visible = moonAlbedoReady && moonAboveHorizon
      sunPath.visible =
        sunPath.geometry.getAttribute('position')?.count >= 2
      moonPath.visible =
        moonPath.geometry.getAttribute('position')?.count >= 2
    },
    dispose: () => {
      disposed = true
      sunRig.dispose()
      moonGlow.geometry.dispose()
      moonGlowMat.dispose()
      moonRig?.root.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh || !mesh.geometry) return
        if (mesh.geometry.userData?.moonTopoShared) return
        mesh.geometry.dispose()
      })
      moonMat?.dispose()
      if (moonAlbedo && !moonAlbedo.userData?.moonTopoShared) {
        moonAlbedo.dispose()
      }
      sunPath.geometry.dispose()
      ;(sunPath.material as THREE.Material).dispose()
      moonPath.geometry.dispose()
      ;(moonPath.material as THREE.Material).dispose()
    },
  }
}
