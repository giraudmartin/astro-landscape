import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { loadAppSettings, patchAppSettings } from './appSettings'
import { CelestialSearchPanel } from './CelestialSearchPanel'
import { CelestialTargetCard } from './CelestialTargetCard'
import {
  objectHorizontalAt,
  type CelestialObject,
} from './celestialObjects'
import { sunPositionAt } from './celestial'
import {
  horizontalFovDegFromFocalMm,
  SENSOR_CROP_FACTOR,
  verticalFovDegFromFocalMm,
  type SensorFormat,
  type ViewfinderOrientation,
} from './lensFov'
import {
  installFrustumCullingControl,
  setFrustumCullingEnabled,
} from './frustumCullingControl'
import {
  createLocalTerrainMesh,
  NEAR_TERRAIN_RADIUS_M,
  type TerrainLoadPhase,
} from './localTerrainMesh'
import {
  createRenderDiagLive,
  type RenderDiagLive,
} from './renderDiagnostic'
import { RenderDiagnosticCard } from './RenderDiagnosticCard'

const TERRAIN_PHASE_LABEL: Record<TerrainLoadPhase, string> = {
  dem: 'Relief DEM\u2026',
  preview: 'Aper\u00e7u satellite\u2026',
  ortho: 'Ortho haute r\u00e9solution\u2026',
  detail: 'Relief moyen\u2026',
  far: 'Horizon 300 km\u2026',
  ready: 'Pr\u00eat',
}
import { createNightSky } from './nightSky'
import { PhotoFrameOverlay } from './PhotoFrameOverlay'
import { clampEyeHeightM, EYE_HEIGHT_MIN_M, EYE_HEIGHT_MAX_M } from './presets'
import { ViewBearingHud } from './ViewBearingHud'
import { type PanoramaPlan } from './panorama'
import { ViewfinderCameraPanel } from './ViewfinderCameraPanel'
import { ViewfinderPanoramaPanel } from './ViewfinderPanoramaPanel'
import { ViewPitchHud } from './ViewPitchHud'
import {
  AzimuthGridIcon,
  ConstellationsIcon,
  MilkyWayIcon,
  RaDecGridIcon,
} from './psIcons'
import {
  createAstroSkyDome,
  sunDirectionFromAltAz,
  updateAstroSkyDome,
} from './skyDome'
import {
  applyStageProjection,
  getStageProjection,
  setStageProjection,
  STAGE_PROJECTIONS,
  type StageProjection,
} from './stelProjector'
import { createStereoCubemapPass } from './stereoCubemapPass'
import { skyPaletteFromSunAltitude } from './skyLighting'
import type { QaImmersiveApi } from './qaTestHooks'

type MoveDir = 'up' | 'down' | 'left' | 'right'

const MOVE_DIRS: MoveDir[] = ['up', 'down', 'left', 'right']
const MOVE_STEP_MS = 160
const MOVE_KEYS: Record<string, MoveDir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}
const MOVE_LABEL: Record<MoveDir, string> = {
  up: 'Haut',
  down: 'Bas',
  left: 'Gauche',
  right: 'Droite',
}

function emptyMoveHeld(): Record<MoveDir, boolean> {
  return { up: false, down: false, left: false, right: false }
}

type ImmersiveViewProps = {
  lat: number
  lon: number
  groundElevationM: number
  /** Initial look bearing (MapLibre-style, deg clockwise from north). */
  bearingDeg: number
  /** Optional initial pitch when entering from a celestial center request. */
  initialPitchDeg?: number
  skyUtcMs: number
  date: string
  selectedCelestial: CelestialObject | null
  onSelectCelestial: (object: CelestialObject | null) => void
  onExit: () => void
}

const LOOK_PITCH_MIN = -85
const LOOK_PITCH_MAX = 85

function shortestYawDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function ImmersiveView({
  lat,
  lon,
  groundElevationM,
  bearingDeg,
  initialPitchDeg = 0,
  skyUtcMs,
  date,
  selectedCelestial,
  onSelectCelestial,
  onExit,
}: ImmersiveViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const savedImmersive = useMemo(() => loadAppSettings().immersive, [])
  const [focalMm, setFocalMm] = useState(savedImmersive.focalMm)
  const [orientation, setOrientation] = useState<ViewfinderOrientation>(
    savedImmersive.orientation,
  )
  const [sensorFormat, setSensorFormat] = useState<SensorFormat>(
    savedImmersive.sensorFormat,
  )
  const [panorama, setPanorama] = useState<PanoramaPlan>(
    savedImmersive.panorama,
  )
  const [yawDeg, setYawDeg] = useState(bearingDeg)
  const [pitchDeg, setPitchDeg] = useState(
    Math.max(LOOK_PITCH_MIN, Math.min(LOOK_PITCH_MAX, initialPitchDeg)),
  )
  const [framesLocked, setFramesLocked] = useState(false)
  const [lockLook, setLockLook] = useState({
    yaw: bearingDeg,
    pitch: Math.max(LOOK_PITCH_MIN, Math.min(LOOK_PITCH_MAX, initialPitchDeg)),
  })
  /** Latest camera look — kept in sync with the WebGL camera (not only React). */
  const lookRef = useRef({
    yaw: bearingDeg,
    pitch: Math.max(LOOK_PITCH_MIN, Math.min(LOOK_PITCH_MAX, initialPitchDeg)),
  })
  const [celestialSearchOpen, setCelestialSearchOpen] = useState(false)
  const lookAnimRef = useRef<number | null>(null)
  const [terrainLabel, setTerrainLabel] = useState('Relief…')
  const [terrainPhase, setTerrainPhase] = useState<TerrainLoadPhase>('dem')
  const [terrainProgress, setTerrainProgress] = useState(0)
  const [terrainReady, setTerrainReady] = useState(false)
  const [loaderVisible, setLoaderVisible] = useState(true)
  const [projection, setProjection] = useState<StageProjection>(
    savedImmersive.projection,
  )
  /** Independent stage zoom (mouse wheel) — not tied to focal length. */
  const [stageVfovDeg, setStageVfovDeg] = useState(savedImmersive.stageVfovDeg)
  const stageVfovInitRef = useRef(savedImmersive.stageVfovDeg)
  const stageVfovLiveRef = useRef(savedImmersive.stageVfovDeg)
  stageVfovLiveRef.current = stageVfovDeg
  const [eyeHeightM, setEyeHeightM] = useState(() =>
    clampEyeHeightM(savedImmersive.eyeHeightM),
  )
  const eyeHeightRef = useRef(clampEyeHeightM(savedImmersive.eyeHeightM))
  eyeHeightRef.current = eyeHeightM
  const [keyHeld, setKeyHeld] = useState(emptyMoveHeld)
  const [pointerHeld, setPointerHeld] = useState(emptyMoveHeld)
  const moveRepeatRef = useRef<Partial<Record<MoveDir, number>>>({})
  const [showMilkyWay, setShowMilkyWay] = useState(savedImmersive.showMilkyWay)
  const [showHalpha, setShowHalpha] = useState(savedImmersive.showHalpha)
  const [showAtmosphere, setShowAtmosphere] = useState(
    savedImmersive.showAtmosphere,
  )
  const [showConstellations, setShowConstellations] = useState(
    savedImmersive.showConstellations,
  )
  const [showCelestialGrid, setShowCelestialGrid] = useState(
    savedImmersive.showCelestialGrid,
  )
  const [showAzimuthGrid, setShowAzimuthGrid] = useState(
    savedImmersive.showAzimuthGrid,
  )

  const skyTogglesRef = useRef({
    showMilkyWay: savedImmersive.showMilkyWay,
    showHalpha: savedImmersive.showHalpha,
    showAtmosphere: savedImmersive.showAtmosphere,
    showConstellations: savedImmersive.showConstellations,
    showCelestialGrid: savedImmersive.showCelestialGrid,
    showAzimuthGrid: savedImmersive.showAzimuthGrid,
  })
  skyTogglesRef.current = {
    showMilkyWay,
    showHalpha,
    showAtmosphere,
    showConstellations,
    showCelestialGrid,
    showAzimuthGrid,
  }

  useEffect(() => {
    patchAppSettings({
      immersive: {
        focalMm,
        orientation,
        sensorFormat,
        panorama,
        projection,
        stageVfovDeg,
        eyeHeightM,
        showMilkyWay,
        showHalpha,
        showAtmosphere,
        showConstellations,
        showCelestialGrid,
        showAzimuthGrid,
      },
    })
  }, [
    focalMm,
    orientation,
    sensorFormat,
    panorama,
    projection,
    stageVfovDeg,
    eyeHeightM,
    showMilkyWay,
    showHalpha,
    showAtmosphere,
    showConstellations,
    showCelestialGrid,
    showAzimuthGrid,
  ])
  const nightSkyApiRef = useRef<ReturnType<typeof createNightSky> | null>(null)
  const renderDiagLiveRef = useRef<RenderDiagLive>(createRenderDiagLive())
  const diagContextRef = useRef({
    projection,
    stageVfovDeg,
    yawDeg,
    pitchDeg,
    eyeHeightM,
    cameraPos: { x: 0, y: 0, z: 0 },
    logDepthBuffer: true as const,
  })
  diagContextRef.current.projection = projection
  diagContextRef.current.stageVfovDeg = stageVfovDeg
  diagContextRef.current.yawDeg = yawDeg
  diagContextRef.current.pitchDeg = pitchDeg
  diagContextRef.current.eyeHeightM = eyeHeightM

  const apiRef = useRef<{
    setLook: (yaw: number, pitch: number) => void
    setSkyUtc: (utcMs: number) => void
    setStageFov: (vfovDeg: number) => void
    setEyeHeight: (meters: number) => void
    step: (dir: MoveDir) => void
  } | null>(null)

  const cropFactor = SENSOR_CROP_FACTOR[sensorFormat]
  const optical = useMemo(() => {
    const v = verticalFovDegFromFocalMm(focalMm, orientation, cropFactor)
    const h = horizontalFovDegFromFocalMm(focalMm, orientation, cropFactor)
    return { v, h }
  }, [focalMm, orientation, cropFactor])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      // near=0.08 / far=450km without log depth punches white holes through
      // mid-range ridges (z-fighting + depth precision collapse).
      logarithmicDepthBuffer: true,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    // Warp projections break world-space AABBs — frustum culling OFF by default.
    installFrustumCullingControl(scene)
    let stageFov = stageVfovInitRef.current
    // Past celestial shell (~330 km) + sky dome (~360 km).
    // Near plane 0.5 m — eye sits at ~7 m; tighter near improves depth even with log buffer.
    const camera = new THREE.PerspectiveCamera(stageFov, 1, 0.5, 450_000)
    camera.position.set(0, eyeHeightRef.current, 0)
    const stereoPass = createStereoCubemapPass()
    let terrainNearObj: THREE.Object3D | null = null
    let terrainFarObj: THREE.Object3D | null = null
    let fpsFrames = 0
    let fpsLastMs = performance.now()
    let lastWire = false
    let lastCull: boolean | null = null

    const sky = createAstroSkyDome()
    scene.add(sky.mesh)

    const nightSky = createNightSky()
    nightSkyApiRef.current = nightSky
    scene.add(nightSky.root)
    if (skyTogglesRef.current.showHalpha) {
      void nightSky.ensureHalphaLoaded()
    }

    const ambient = new THREE.AmbientLight(0xfff0dd, 0.85)
    scene.add(ambient)
    const hemi = new THREE.HemisphereLight(0xc8dcff, 0x8a6e45, 1.35)
    scene.add(hemi)
    const sunLight = new THREE.DirectionalLight(0xfff2dd, 1.35)
    scene.add(sunLight)
    // Extra sun-side fill so coarse LOD faces stay as readable as the near disc.
    const sunFill = new THREE.DirectionalLight(0xffe8d0, 0.55)
    scene.add(sunFill)

    let yaw = bearingDeg
    let pitch = Math.max(
      LOOK_PITCH_MIN,
      Math.min(LOOK_PITCH_MAX, lookRef.current.pitch),
    )
    let dragging = false
    let lastX = 0
    let lastY = 0
    let raf = 0
    let disposed = false
    let terrainDispose: (() => void) | null = null
    let adaptTerrain: ((x: number, y: number, z: number) => void) | null = null
    let landscapeMats: Array<
      THREE.MeshBasicMaterial | THREE.MeshStandardMaterial
    > = []
    let landscapeMat:
      | THREE.MeshBasicMaterial
      | THREE.MeshStandardMaterial
      | null = null
    let latestSkyUtc = skyUtcMs
    let latestSunAltDeg = 0

    // Heavy atlas / mesh uploads can OOM the GPU — stop fighting a dead context.
    renderer.domElement.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault()
        disposed = true
        terrainDispose?.()
        terrainDispose = null
        adaptTerrain = null
        apiRef.current = null
      },
      false,
    )

    const applyCamera = () => {
      const yawRad = (yaw * Math.PI) / 180
      const pitchRad = (pitch * Math.PI) / 180
      const look = new THREE.Vector3(
        Math.sin(yawRad) * Math.cos(pitchRad),
        Math.sin(pitchRad),
        -Math.cos(yawRad) * Math.cos(pitchRad),
      )
      camera.up.set(0, 1, 0)
      camera.lookAt(
        camera.position.x + look.x,
        camera.position.y + look.y,
        camera.position.z + look.z,
      )
    }

    const applySky = (utcMs: number) => {
      latestSkyUtc = utcMs
      const sun = sunPositionAt(lat, lon, groundElevationM, utcMs)
      const alt = sun.altitudeDeg
      latestSunAltDeg = alt
      const dir = sunDirectionFromAltAz(alt, sun.azimuthDeg)
      const palette = skyPaletteFromSunAltitude(alt)
      const night = palette.nightAmount
      const atmosphereOn = skyTogglesRef.current.showAtmosphere

      updateAstroSkyDome(sky, {
        sunAltitudeDeg: alt,
        sunDirection: dir,
        eyeElevationMslM: groundElevationM + eyeHeightRef.current,
        showAtmosphere: atmosphereOn,
      })

      sunLight.position.copy(dir).multiplyScalar(10_000)
      sunFill.position.copy(dir).multiplyScalar(8_000)

      // Sun disc color: noon → golden → red twilight → cool moonlight.
      if (alt >= 8) {
        sunLight.color.setRGB(1, 0.96, 0.9)
        sunFill.color.setRGB(0.95, 0.92, 0.88)
      } else if (alt >= 0) {
        const t = (8 - alt) / 8
        sunLight.color.setRGB(1, 0.92 - t * 0.35, 0.82 - t * 0.55)
        sunFill.color.copy(sunLight.color)
      } else if (alt >= -6) {
        const t = (-alt) / 6
        sunLight.color.setRGB(1, 0.45 - t * 0.15, 0.22 - t * 0.1)
        sunFill.color.copy(sunLight.color)
      } else if (atmosphereOn) {
        sunLight.color.setRGB(0.55, 0.65, 0.95)
        sunFill.color.setRGB(0.5, 0.58, 0.85)
      } else {
        // No-atmo night: neutral moonlight, no blue airglow on the ground.
        sunLight.color.setRGB(0.85, 0.86, 0.88)
        sunFill.color.setRGB(0.8, 0.82, 0.85)
      }

      if (alt > -6) {
        sunLight.intensity = Math.max(0.04, Math.min(1.85, (alt + 10) / 32))
        sunFill.intensity = Math.max(0.2, Math.min(0.75, (alt + 12) / 28))
      } else {
        // Residual skylight / moonlight — landscape still readable, clearly night.
        sunLight.intensity = Math.max(
          0.02,
          (atmosphereOn ? 0.12 : 0.16) * (1 - night) + (atmosphereOn ? 0 : 0.05),
        )
        sunFill.intensity = sunLight.intensity * 0.85
      }

      if (atmosphereOn) {
        // Skylight follows the sun — warm at golden hour so far LOD isn't a
        // cold blue slab while the near disc still catches the sun disc.
        const warmSky = Math.max(0, 1 - Math.abs(alt - 2) / 10) // peaks ~sunset
        const cool = Math.max(0, Math.min(1, (alt + 2) / 14)) // day blue
        hemi.color.setRGB(
          0.55 + (1 - night) * 0.35 + warmSky * 0.35,
          0.5 + (1 - night) * 0.25 + warmSky * 0.12,
          0.45 + cool * 0.4 - warmSky * 0.25 - night * 0.2,
        )
        hemi.groundColor.setRGB(
          0.38 * (1 - night * 0.7) + warmSky * 0.12,
          0.3 * (1 - night * 0.65) + warmSky * 0.06,
          0.2 * (1 - night * 0.5) + night * 0.06,
        )
        hemi.intensity =
          0.35 +
          (1 - night) * 0.95 +
          Math.max(0, Math.min(0.4, (alt + 4) / 36))

        ambient.color.setRGB(
          0.6 + (1 - night) * 0.4 + warmSky * 0.2,
          0.58 + (1 - night) * 0.32 + warmSky * 0.1,
          0.55 + cool * 0.25 - warmSky * 0.12 - night * 0.15,
        )
        ambient.intensity = 0.22 + (1 - night) * 0.55
      } else {
        // Dark sky, but terrain still readable — neutral fill, no blue cast.
        hemi.color.setRGB(0.42, 0.42, 0.44)
        hemi.groundColor.setRGB(0.18, 0.16, 0.14)
        hemi.intensity = 0.28 + (1 - night) * 0.5
        ambient.color.setRGB(0.4, 0.4, 0.42)
        ambient.intensity = 0.18 + (1 - night) * 0.32
      }

      // Lighting carries golden-hour warmth. Do NOT multiply ortho albedo into
      // mud, and never wipe emissiveMap — that made 4096 satellite look like
      // flat brown polys, and turned the sea mesh cream.
      if (landscapeMats.length > 0) {
        let warm = 0
        if (alt < 8 && alt > -4) {
          warm = Math.max(0, 1 - Math.abs(alt - 1) / 7)
        }
        for (const mat of landscapeMats) {
          if (mat.userData.isSea) {
            const dim = atmosphereOn ? 1 - night * 0.55 : 1 - night * 0.35
            mat.color.setRGB(0.29 * dim, 0.48 * dim, 0.59 * dim)
            continue
          }
          if (mat.userData.isOrthoTerrain || mat.map) {
            // MeshBasic ortho: only night dimming — never warm-tint albedo.
            const dim = atmosphereOn ? 1 - night * 0.45 : 1 - night * 0.28
            mat.color.setRGB(dim, dim, dim)
          } else if (atmosphereOn) {
            const dim = 1 - night * 0.72
            mat.color.setRGB(
              dim,
              dim * (1 - warm * 0.18),
              dim * (1 - warm * 0.32) * (1 - night * 0.08) + night * 0.06,
            )
            if ('emissive' in mat) {
              ;(mat as THREE.MeshStandardMaterial).emissive.setRGB(
                0.02 * night,
                0.03 * night,
                0.06 * night,
              )
              ;(mat as THREE.MeshStandardMaterial).emissiveIntensity =
                night * 0.35
            }
          } else {
            const dim = 1 - night * 0.45
            mat.color.setRGB(dim, dim * (1 - warm * 0.18), dim * (1 - warm * 0.32))
            if ('emissive' in mat) {
              ;(mat as THREE.MeshStandardMaterial).emissive.setRGB(
                0.04 * night,
                0.04 * night,
                0.045 * night,
              )
              ;(mat as THREE.MeshStandardMaterial).emissiveIntensity =
                night * 0.4
            }
          }
        }
      }

      if (getStageProjection() === 'stereographic') {
        // Outside the stereo disk (ultra-wide) must be Stellarium-black,
        // never the muddy day clear that read as a gray hublot.
        renderer.setClearColor(0x000000, 1)
      } else if (atmosphereOn) {
        // Match distant sea/haze under the geometric horizon (not a brown void).
        const elev = groundElevationM + eyeHeightRef.current
        const seaAmt = Math.min(1, Math.max(0, (elev - 120) / 780))
        const clearR = (0.05 + (1 - night) * 0.35) * (1 - seaAmt * 0.55)
        const clearG = (0.06 + (1 - night) * 0.3) * (1 - seaAmt * 0.35)
        const clearB = 0.1 + (1 - night) * 0.22 + seaAmt * 0.06
        renderer.setClearColor(
          new THREE.Color(
            clearR * (0.22 + (1 - night) * 0.2),
            clearG * (0.2 + (1 - night) * 0.18),
            clearB * (0.22 + (1 - night) * 0.12),
          ),
          1,
        )
      } else {
        // Dark sky — no Rayleigh; stars / MW read cleanly.
        renderer.setClearColor(0x010208, 1)
      }
    }

    setTerrainLabel('Relief…')
    setTerrainPhase('dem')
    setTerrainProgress(0)
    setTerrainReady(false)
    setLoaderVisible(true)
    const mountTerrain = (
      terrain: Awaited<ReturnType<typeof createLocalTerrainMesh>>,
    ) => {
      if (disposed) {
        terrain.dispose()
        return
      }
      if (!terrain.mesh.parent) scene.add(terrain.mesh)
      if (terrain.farMesh && !terrain.farMesh.parent) scene.add(terrain.farMesh)
      terrainNearObj = terrain.mesh
      terrainFarObj = terrain.farMesh
      terrainDispose = () => {
        terrainNearObj = null
        terrainFarObj = null
        terrain.dispose()
      }
      adaptTerrain = (x, y, z) => terrain.adaptToEye(x, y, z)
      landscapeMats = terrain.materials
      landscapeMat = terrain.mesh.material as
        | THREE.MeshBasicMaterial
        | THREE.MeshStandardMaterial
      const uniform = landscapeMat.userData.eyeHeight as
        | { value: number }
        | undefined
      if (uniform) uniform.value = camera.position.y
      const eyeXZ = landscapeMat.userData.eyeXZ as
        | { value: THREE.Vector2 }
        | undefined
      eyeXZ?.value.set(camera.position.x, camera.position.z)
      applySky(latestSkyUtc)
      const relief = Math.max(0, terrain.stats.maxH - terrain.stats.minH)
      const farKm = Math.round(terrain.stats.farRadiusM / 1000)
      setTerrainPhase(terrain.stats.phase)
      setTerrainProgress(terrain.stats.progress)
      if (terrain.ready) {
        setTerrainReady(true)
        setTerrainLabel(
          `DEM z${terrain.stats.demMaxZ} · ${terrain.stats.tiles} tuiles · Δ${Math.round(relief)} m · LOD ${farKm} km`,
        )
        window.setTimeout(() => {
          if (!disposed) setLoaderVisible(false)
        }, 650)
        return
      }
      if (!terrain.ready && farKm === 0) {
        setTerrainLabel(
          `DEM z${terrain.stats.demMaxZ} · ${terrain.stats.tiles} tuiles · ${terrain.mesh.children.length > 0 ? 'ortho…' : 'aperçu…'}`,
        )
        return
      }
      setTerrainLabel(
        farKm > 0
          ? `DEM z${terrain.stats.demMaxZ} · ${terrain.stats.tiles} tuiles · Δ${Math.round(relief)} m · LOD ${farKm} km`
          : `DEM z${terrain.stats.demMaxZ} · ${terrain.stats.tiles} tuiles · Δ${Math.round(relief)} m · ortho z18`,
      )
    }
    void createLocalTerrainMesh({
      lat,
      lon,
      centerElevationM: groundElevationM,
      radiusM: NEAR_TERRAIN_RADIUS_M,
      // 1600 + triple 4096 atlas bake OOMed the GPU (Context Lost). Stay ≤1400.
      resolution: 1200,
      onPreview: (terrain) => mountTerrain(terrain),
      onUpgrade: (terrain) => mountTerrain(terrain),
      onProgress: ({ phase, progress }) => {
        if (disposed) return
        setTerrainPhase(phase)
        setTerrainProgress(progress)
        if (phase === 'ready') {
          setTerrainReady(true)
          window.setTimeout(() => {
            if (!disposed) setLoaderVisible(false)
          }, 650)
        }
      },
    })
      .then((terrain) => {
        if (disposed) {
          terrain.dispose()
          return
        }
        mountTerrain(terrain)
      })
      .catch((err: unknown) => {
        console.error('[terrain]', err)
        if (!disposed) {
          setTerrainLabel('Relief indisponible')
          setLoaderVisible(false)
        }
      })

    const resize = () => {
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      applyStageProjection(camera, stageFov)
      setSize({ w, h })
    }

    const onPointerDown = (event: PointerEvent) => {
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
      host.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY
      // Grab-the-world (same feel as MapLibre): drag right → look left.
      yaw = (yaw - dx * 0.14 + 360) % 360
      pitch = Math.max(
        LOOK_PITCH_MIN,
        Math.min(LOOK_PITCH_MAX, pitch + dy * 0.14),
      )
      lookRef.current = { yaw, pitch }
      setYawDeg(yaw)
      setPitchDeg(pitch)
      applyCamera()
    }
    const onPointerUp = (event: PointerEvent) => {
      dragging = false
      try {
        host.releasePointerCapture(event.pointerId)
      } catch {
        // ignore
      }
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const factor = event.deltaY > 0 ? 1.12 : 0.9
      stageFov = applyStageProjection(camera, stageFov * factor)
      setStageVfovDeg(stageFov)
    }

    apiRef.current = {
      setLook: (nextYaw, nextPitch) => {
        yaw = ((nextYaw % 360) + 360) % 360
        pitch = Math.max(LOOK_PITCH_MIN, Math.min(LOOK_PITCH_MAX, nextPitch))
        lookRef.current = { yaw, pitch }
        setYawDeg(yaw)
        setPitchDeg(pitch)
        applyCamera()
      },
      setSkyUtc: applySky,
      setStageFov: (vfovDeg) => {
        // Persist the framed stage FOV (per-projection cap), not the raw slider.
        stageFov = applyStageProjection(camera, vfovDeg)
        stageVfovLiveRef.current = stageFov
        setStageVfovDeg(stageFov)
      },
      setEyeHeight: (meters) => {
        const h = clampEyeHeightM(meters)
        camera.position.y = h
        syncEyeUniform()
        applyCamera()
        // Horizon dip depends on MSL eye height.
        sky.material.uniforms.uEyeElevM.value = Math.max(
          0,
          groundElevationM + h,
        )
      },
      step: (dir) => {
        const yawRad = (yaw * Math.PI) / 180
        const forwardX = Math.sin(yawRad)
        const forwardZ = -Math.cos(yawRad)
        const rightX = Math.cos(yawRad)
        const rightZ = Math.sin(yawRad)
        const along =
          dir === 'left' || dir === 'right'
            ? { x: rightX, z: rightZ }
            : { x: forwardX, z: forwardZ }
        const sign = dir === 'down' || dir === 'left' ? -1 : 1
        camera.position.x += along.x * sign
        camera.position.z += along.z * sign
        syncEyeUniform()
        applyCamera()
      },
    }
    ;(
      window as unknown as {
        __astroSetLook?: (yaw: number, pitch: number) => void
        __astroSetStageFov?: (vfovDeg: number) => void
        __astroTerrainDebug?: () => unknown
      }
    ).__astroSetLook = (y, p) => apiRef.current?.setLook(y, p)
    ;(
      window as unknown as {
        __astroSetStageFov?: (vfovDeg: number) => void
      }
    ).__astroSetStageFov = (vfovDeg) => {
      apiRef.current?.setStageFov(vfovDeg)
    }
    ;(
      window as unknown as {
        __astroTerrainDebug?: () => unknown
      }
    ).__astroTerrainDebug = () =>
      landscapeMats.map((m) => {
        const map = 'map' in m ? (m.map as THREE.Texture | null) : null
        const img = map?.image as
          | { width?: number; height?: number }
          | undefined
        return {
          sea: !!m.userData.isSea,
          ortho: !!m.userData.isOrthoTerrain,
          mapW: img?.width ?? null,
          mapH: img?.height ?? null,
          flipY: map?.flipY ?? null,
          nearW: m.userData.atlasWeights?.near?.value ?? null,
          ultraW: m.userData.atlasWeights?.ultra?.value ?? null,
          stel: !!m.userData.stelProjector,
          band: m.userData.radiusBand ?? null,
          color: 'color' in m ? m.color.getHexString() : null,
        }
      })
    function syncEyeUniform() {
      const uniform = landscapeMat?.userData.eyeHeight as
        | { value: number }
        | undefined
      if (uniform) uniform.value = camera.position.y
      const eyeXZ = landscapeMat?.userData.eyeXZ as
        | { value: THREE.Vector2 }
        | undefined
      eyeXZ?.value.set(camera.position.x, camera.position.z)
    }

    applyCamera()
    applySky(skyUtcMs)
    // Clamp any saved ultra-wide FOV before first paint (avoids shard tunnel +
    // photo-frame / camera FOV desync).
    stageFov = applyStageProjection(camera, stageFov)
    setStageVfovDeg(stageFov)
    resize()

    const ro = new ResizeObserver(resize)
    ro.observe(host)
    host.addEventListener('pointerdown', onPointerDown)
    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerup', onPointerUp)
    host.addEventListener('pointercancel', onPointerUp)
    host.addEventListener('wheel', onWheel, { passive: false })

    const applyTerrainWireframe = (root: THREE.Object3D | null, on: boolean) => {
      if (!root) return
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh) return
        const mats = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]
        for (const mat of mats) {
          if (mat && 'wireframe' in mat) {
            ;(mat as THREE.MeshBasicMaterial).wireframe = on
          }
        }
      })
    }

    const tick = () => {
      if (disposed) return
      const diag = renderDiagLiveRef.current.settings
      if (lastCull !== diag.frustumCulling) {
        lastCull = diag.frustumCulling
        setFrustumCullingEnabled(diag.frustumCulling)
      }
      if (
        camera.near !== diag.cameraNearM ||
        camera.far !== diag.cameraFarM
      ) {
        camera.near = diag.cameraNearM
        camera.far = diag.cameraFarM
        camera.updateProjectionMatrix()
      }
      sky.mesh.visible = diag.showSky
      nightSky.root.visible = diag.showNightSky
      if (terrainNearObj) terrainNearObj.visible = diag.showTerrainNear
      if (terrainFarObj) terrainFarObj.visible = diag.showTerrainFar
      if (diag.terrainWireframe) {
        applyTerrainWireframe(terrainNearObj, true)
        applyTerrainWireframe(terrainFarObj, true)
        lastWire = true
      } else if (lastWire) {
        applyTerrainWireframe(terrainNearObj, false)
        applyTerrainWireframe(terrainFarObj, false)
        lastWire = false
      }

      sky.mesh.position.copy(camera.position)
      adaptTerrain?.(camera.position.x, camera.position.y, camera.position.z)
      const skyToggles = skyTogglesRef.current
      nightSky.update({
        utcMs: latestSkyUtc,
        lat,
        lon,
        elevationM: groundElevationM,
        sunAltitudeDeg: latestSunAltDeg,
        camera,
        showMilkyWay: skyToggles.showMilkyWay,
        showHalpha: skyToggles.showHalpha,
        showAtmosphere: skyToggles.showAtmosphere,
        showConstellations: skyToggles.showConstellations,
        showCelestialGrid: skyToggles.showCelestialGrid,
        showAzimuthGrid: skyToggles.showAzimuthGrid,
      })

      diagContextRef.current.cameraPos = {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      }

      const urlAtlas =
        typeof window !== 'undefined' &&
        /(?:\?|&)stereoDebug=atlas(?:&|$)/.test(window.location.search)
      const useCubemap =
        diag.useCubemapPass ||
        diag.cubemapAtlasPreview ||
        (getStageProjection() === 'stereographic' && urlAtlas)
      const atlasOn = diag.cubemapAtlasPreview || urlAtlas

      // Sum whole frame (cubemap = 6 faces + composite).
      renderer.info.autoReset = false
      renderer.info.reset()
      if (useCubemap) {
        stereoPass.setAtlasPreview(atlasOn)
        const stage = Number(camera.userData.stageVfovDeg) || stageFov
        stereoPass.render(renderer, scene, camera, stage)
        renderDiagLiveRef.current.stats.passes = 7
        renderDiagLiveRef.current.stats.path = atlasOn
          ? 'cubemap-atlas'
          : 'cubemap'
      } else {
        stereoPass.setAtlasPreview(false)
        renderer.render(scene, camera)
        renderDiagLiveRef.current.stats.passes = 1
        renderDiagLiveRef.current.stats.path = 'direct'
      }
      const info = renderer.info.render
      renderDiagLiveRef.current.stats.drawCalls = info.calls
      renderDiagLiveRef.current.stats.triangles = info.triangles
      renderDiagLiveRef.current.stats.points = info.points
      renderDiagLiveRef.current.stats.lines = info.lines
      renderer.info.autoReset = true

      fpsFrames += 1
      const now = performance.now()
      if (now - fpsLastMs >= 500) {
        renderDiagLiveRef.current.stats.fps =
          (fpsFrames * 1000) / (now - fpsLastMs)
        fpsFrames = 0
        fpsLastMs = now
      }

      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)

    return () => {
      disposed = true
      if (lookAnimRef.current != null) {
        window.cancelAnimationFrame(lookAnimRef.current)
        lookAnimRef.current = null
      }
      window.cancelAnimationFrame(raf)
      ro.disconnect()
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerup', onPointerUp)
      host.removeEventListener('pointercancel', onPointerUp)
      host.removeEventListener('wheel', onWheel)
      apiRef.current = null
      nightSkyApiRef.current = null
      sky.geometry.dispose()
      sky.material.dispose()
      nightSky.dispose()
      terrainDispose?.()
      stereoPass.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
    // bearingDeg must NOT remount the whole WebGL scene — that dropped back to
    // the muddy preview atlas on every look jump.
  }, [lat, lon, groundElevationM])

  useEffect(() => {
    apiRef.current?.setSkyUtc(skyUtcMs)
  }, [skyUtcMs, showAtmosphere])

  useEffect(() => {
    const api: QaImmersiveApi = {
      setLook: (yaw, pitch) => apiRef.current?.setLook(yaw, pitch),
      setStageFov: (vfovDeg) => apiRef.current?.setStageFov(vfovDeg),
      setProjection: (mode) => {
        setStageProjection(mode)
        setProjection(mode)
      },
      isTerrainReady: () => terrainReady,
      isCaptureReady: () => {
        if (terrainReady) return true
        const canvas = hostRef.current?.querySelector('canvas')
        if (!canvas || canvas.width < 64 || canvas.height < 64) return false
        // Detail/far phases already show textured landscape; enough for FOV QA.
        return (
          terrainPhase === 'detail' ||
          terrainPhase === 'far' ||
          terrainPhase === 'ready' ||
          terrainProgress >= 0.35
        )
      },
      getStageVfovDeg: () => stageVfovLiveRef.current,
      getProjection: () => projection,
    }
    window.__astroQaImmersive = api
    return () => {
      if (window.__astroQaImmersive === api) delete window.__astroQaImmersive
    }
  }, [terrainReady, terrainPhase, terrainProgress, projection])

  // Sync only when the PARENT bearing prop changes. Including pitchDeg here
  // re-applied the stale map bearing and wiped __astroSetLook / drag yaw.
  useEffect(() => {
    lookRef.current = { yaw: bearingDeg, pitch: lookRef.current.pitch }
    setYawDeg(bearingDeg)
    apiRef.current?.setLook(bearingDeg, lookRef.current.pitch)
  }, [bearingDeg])

  useLayoutEffect(() => {
    setStageProjection(projection)
    apiRef.current?.setStageFov(stageVfovDeg)
  }, [projection, stageVfovDeg])

  useEffect(() => {
    apiRef.current?.setEyeHeight(eyeHeightM)
  }, [eyeHeightM])

  useEffect(() => {
    const lastStep: Record<MoveDir, number> = {
      up: 0,
      down: 0,
      left: 0,
      right: 0,
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const dir = MOVE_KEYS[event.key]
      if (!dir) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      setKeyHeld((held) => (held[dir] ? held : { ...held, [dir]: true }))
      const now = performance.now()
      if (now - lastStep[dir] < MOVE_STEP_MS) return
      lastStep[dir] = now
      apiRef.current?.step(dir)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const dir = MOVE_KEYS[event.key]
      if (!dir) return
      setKeyHeld((held) => (held[dir] ? { ...held, [dir]: false } : held))
    }
    const clearKeys = () => setKeyHeld(emptyMoveHeld())
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearKeys)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearKeys)
    }
  }, [])

  useEffect(() => {
    const repeats = moveRepeatRef.current
    return () => {
      for (const id of Object.values(repeats)) {
        if (id !== undefined) window.clearInterval(id)
      }
    }
  }, [])

  setStageProjection(projection)

  return (
    <div className="immersive">
      <div ref={hostRef} className="immersive__canvas" />
      <PhotoFrameOverlay
        stageW={size.w}
        stageH={size.h}
        orientation={orientation}
        stageVfovDeg={stageVfovDeg}
        opticalVfovDeg={optical.v}
        opticalHfovDeg={optical.h}
        panorama={panorama}
        label={`${focalMm} mm · ${optical.h.toFixed(0)}° × ${optical.v.toFixed(0)}°`}
        worldLock={{
          locked: framesLocked,
          lockYawDeg: lockLook.yaw,
          lockPitchDeg: lockLook.pitch,
          lookYawDeg: yawDeg,
          lookPitchDeg: pitchDeg,
        }}
        onToggleWorldLock={() => {
          if (framesLocked) {
            setFramesLocked(false)
            return
          }
          const look = lookRef.current
          setLockLook({ yaw: look.yaw, pitch: look.pitch })
          setFramesLocked(true)
        }}
        onRecenterWorldLock={() => {
          const { yaw, pitch } = lockLook
          lookRef.current = { yaw, pitch }
          setYawDeg(yaw)
          setPitchDeg(pitch)
          apiRef.current?.setLook(yaw, pitch)
        }}
      />

      <ViewBearingHud
        bearingDeg={yawDeg}
        altitudeMslM={groundElevationM + eyeHeightM}
        altitudeAriaLabel={`Altitude objectif ${Math.round(
          groundElevationM + eyeHeightM,
        )} m`}
      />
      <ViewPitchHud pitchDeg={pitchDeg} />

      <div
        className="moon-preview-hud-tools"
        role="toolbar"
        aria-label="Ciel"
      >
        <div
          className="moon-preview-hud-tools__group"
          role="group"
          aria-label="Couches célestes"
        >
          <button
            type="button"
            className={
              showAtmosphere
                ? 'moon-preview-hud-tool is-active'
                : 'moon-preview-hud-tool'
            }
            aria-pressed={showAtmosphere}
            title="Atmosphère"
            aria-label="Atmosphère"
            onClick={() => setShowAtmosphere((v) => !v)}
          >
            <span className="moon-preview-hud-tool__atmo">Atmo</span>
          </button>
          <button
            type="button"
            className={
              showMilkyWay
                ? 'moon-preview-hud-tool is-active'
                : 'moon-preview-hud-tool'
            }
            aria-pressed={showMilkyWay}
            title="Voie lactée"
            aria-label="Voie lactée"
            onClick={() => setShowMilkyWay((v) => !v)}
          >
            <MilkyWayIcon />
          </button>
          <button
            type="button"
            className={
              showHalpha
                ? 'moon-preview-hud-tool is-active'
                : 'moon-preview-hud-tool'
            }
            aria-pressed={showHalpha}
            title="Hα — émission hydrogène"
            aria-label="Hα"
            onClick={() => {
              setShowHalpha((v) => {
                const next = !v
                if (next) void nightSkyApiRef.current?.ensureHalphaLoaded()
                return next
              })
            }}
          >
            <span className="moon-preview-hud-tool__halpha">Hα</span>
          </button>
          <button
            type="button"
            className={
              showConstellations
                ? 'moon-preview-hud-tool is-active'
                : 'moon-preview-hud-tool'
            }
            aria-pressed={showConstellations}
            title="Constellations"
            aria-label="Constellations"
            onClick={() => setShowConstellations((v) => !v)}
          >
            <ConstellationsIcon />
          </button>
          <button
            type="button"
            className={
              showCelestialGrid
                ? 'moon-preview-hud-tool is-active'
                : 'moon-preview-hud-tool'
            }
            aria-pressed={showCelestialGrid}
            title="Grille RA/Dec"
            aria-label="Grille RA/Dec"
            onClick={() => setShowCelestialGrid((v) => !v)}
          >
            <RaDecGridIcon />
          </button>
          <button
            type="button"
            className={
              showAzimuthGrid
                ? 'moon-preview-hud-tool is-active'
                : 'moon-preview-hud-tool'
            }
            aria-pressed={showAzimuthGrid}
            title="Grille azimutale"
            aria-label="Grille azimutale"
            onClick={() => setShowAzimuthGrid((v) => !v)}
          >
            <AzimuthGridIcon />
          </button>
        </div>
        {showHalpha ? (
          <p className="moon-preview-hud-credit" role="note">
            Hα{' '}
            <a
              href="https://noirlab.edu/public/images/AllSky-17_Optical656nm-Halpha-WHAM-SHASSA-VTSS/"
              target="_blank"
              rel="noreferrer"
            >
              WHAM/VTSS/SHASSA/Douglas Finkbeiner
            </a>
            {' · '}
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY 4.0
            </a>
            {' · '}
            reprojeté galactique → ICRF/J2000
          </p>
        ) : null}
      </div>

      <div className="immersive__chrome immersive__chrome--left">
        <div className="proj-mode" role="radiogroup" aria-label="Projection">
          {STAGE_PROJECTIONS.map((mode) => {
            const selected = projection === mode.id
            return (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={selected}
                title={mode.title}
                className={
                  selected ? 'proj-mode__btn is-active' : 'proj-mode__btn'
                }
                onClick={() => setProjection(mode.id)}
              >
                <span className="proj-mode__label">{mode.label}</span>
              </button>
            )
          })}
        </div>
        <ViewfinderCameraPanel
          focalMm={focalMm}
          orientation={orientation}
          sensorFormat={sensorFormat}
          onFocalMmChange={setFocalMm}
          onOrientationChange={setOrientation}
          onSensorFormatChange={setSensorFormat}
        />
        <ViewfinderPanoramaPanel
          plan={panorama}
          opticalHFovDeg={optical.h}
          opticalVFovDeg={optical.v}
          onChange={setPanorama}
        />
        <RenderDiagnosticCard
          liveRef={renderDiagLiveRef}
          getContext={() => ({ ...diagContextRef.current })}
        />
        <label className="eye-height">
          <span className="eye-height__label">
            Élévation
            <span className="eye-height__value">
              {eyeHeightM.toFixed(1)} m
            </span>
          </span>
          <input
            className="eye-height__range"
            type="range"
            min={EYE_HEIGHT_MIN_M}
            max={EYE_HEIGHT_MAX_M}
            step={0.1}
            value={eyeHeightM}
            aria-label="Élévation de l'objectif au-dessus du sol"
            onChange={(event) => {
              setEyeHeightM(clampEyeHeightM(Number(event.target.value)))
            }}
          />
        </label>
        <div className="move-pad" role="group" aria-label="Déplacement, un mètre">
          {MOVE_DIRS.map((dir) => {
            const down = keyHeld[dir] || pointerHeld[dir]
            return (
              <button
                key={dir}
                type="button"
                className={
                  down
                    ? `move-pad__key move-pad__key--${dir} is-down`
                    : `move-pad__key move-pad__key--${dir}`
                }
                aria-label={MOVE_LABEL[dir]}
                aria-keyshortcuts={`Arrow${dir === 'up' ? 'Up' : dir === 'down' ? 'Down' : dir === 'left' ? 'Left' : 'Right'}`}
                aria-pressed={down}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setPointerHeld((held) => ({ ...held, [dir]: true }))
                  apiRef.current?.step(dir)
                  window.clearInterval(moveRepeatRef.current[dir])
                  moveRepeatRef.current[dir] = window.setInterval(() => {
                    apiRef.current?.step(dir)
                  }, MOVE_STEP_MS)
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                  setPointerHeld((held) => ({ ...held, [dir]: false }))
                  window.clearInterval(moveRepeatRef.current[dir])
                  delete moveRepeatRef.current[dir]
                }}
                onPointerCancel={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                  setPointerHeld((held) => ({ ...held, [dir]: false }))
                  window.clearInterval(moveRepeatRef.current[dir])
                  delete moveRepeatRef.current[dir]
                }}
              >
                <MoveArrow dir={dir} />
              </button>
            )
          })}
        </div>
      </div>

      <div className="immersive__chrome immersive__chrome--right">
        <div className="celestial-dock">
          <button
            type="button"
            className={
              celestialSearchOpen || selectedCelestial
                ? 'hud-btn celestial-dock__toggle is-active'
                : 'hud-btn celestial-dock__toggle'
            }
            data-celestial-search-toggle=""
            aria-pressed={celestialSearchOpen}
            aria-expanded={celestialSearchOpen}
            aria-label="Rechercher un objet céleste"
            title="Rechercher un objet céleste"
            onClick={() => setCelestialSearchOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="m16 16 4.5 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <CelestialSearchPanel
            open={celestialSearchOpen}
            onOpenChange={setCelestialSearchOpen}
            selectedId={selectedCelestial?.id ?? null}
            onSelect={onSelectCelestial}
          />
          {selectedCelestial ? (
            <CelestialTargetCard
              object={selectedCelestial}
              date={date}
              playheadUtcMs={skyUtcMs}
              lat={lat}
              lon={lon}
              elevationM={groundElevationM}
              canCenter
              onClose={() => onSelectCelestial(null)}
              onCenter={() => {
                const pos = objectHorizontalAt(
                  selectedCelestial,
                  lat,
                  lon,
                  groundElevationM,
                  skyUtcMs,
                )
                if (!pos) return
                if (Math.abs(pos.altitudeDeg) > LOOK_PITCH_MAX) return

                const targetYaw = ((pos.azimuthDeg % 360) + 360) % 360
                const targetPitch = Math.max(
                  LOOK_PITCH_MIN,
                  Math.min(LOOK_PITCH_MAX, pos.altitudeDeg),
                )
                const from = lookRef.current
                if (lookAnimRef.current != null) {
                  window.cancelAnimationFrame(lookAnimRef.current)
                  lookAnimRef.current = null
                }

                if (prefersReducedMotion()) {
                  apiRef.current?.setLook(targetYaw, targetPitch)
                  return
                }

                const start = performance.now()
                const duration = 700
                const deltaYaw = shortestYawDelta(from.yaw, targetYaw)
                const deltaPitch = targetPitch - from.pitch
                const tick = (now: number) => {
                  const t = Math.min(1, (now - start) / duration)
                  const eased = 1 - (1 - t) ** 3
                  const yaw = from.yaw + deltaYaw * eased
                  const pitch = from.pitch + deltaPitch * eased
                  apiRef.current?.setLook(yaw, pitch)
                  if (t < 1) {
                    lookAnimRef.current = window.requestAnimationFrame(tick)
                  } else {
                    lookAnimRef.current = null
                    apiRef.current?.setLook(targetYaw, targetPitch)
                  }
                }
                lookAnimRef.current = window.requestAnimationFrame(tick)
              }}
            />
          ) : null}
        </div>
        <button
          type="button"
          className="hud-btn immersive__exit"
          onClick={onExit}
          title="Quitter la vue trépied"
          aria-label="Quitter la vue trépied"
        >
          ✕
        </button>
      </div>

      {loaderVisible ? (
        <div
          className={`immersive__loader${terrainReady ? ' immersive__loader--done' : ''}`}
          role="status"
          aria-live="polite"
          aria-busy={!terrainReady}
        >
          <div className="immersive__loader-card">
            <p className="immersive__loader-title">
              {terrainReady ? 'Vue pr\u00eate' : 'Chargement du paysage'}
            </p>
            <p className="immersive__loader-phase">
              {TERRAIN_PHASE_LABEL[terrainPhase]}
            </p>
            <div
              className="immersive__loader-track"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(terrainProgress * 100)}
              role="progressbar"
            >
              <div
                className="immersive__loader-fill"
                style={{ width: `${Math.round(terrainProgress * 100)}%` }}
              />
            </div>
            <p className="immersive__loader-pct">
              {Math.round(terrainProgress * 100)} %
            </p>
          </div>
        </div>
      ) : null}

      <div className="immersive__hint">
        <span>Molette pour zoomer</span>
        <span>Drag pour regarder</span>
        <span>Flèches : 1 m</span>
        <span>Focale = cadre photo seulement</span>
        {terrainLabel ? <span>{terrainLabel}</span> : null}
      </div>
    </div>
  )
}

function MoveArrow({ dir }: { dir: MoveDir }) {
  const turn = dir === 'right' ? 90 : dir === 'down' ? 180 : dir === 'left' ? 270 : 0
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M8 3.2 12.2 8.4H9.4V12.8H6.6V8.4H3.8Z"
        fill="currentColor"
        transform={`rotate(${turn} 8 8)`}
      />
    </svg>
  )
}
