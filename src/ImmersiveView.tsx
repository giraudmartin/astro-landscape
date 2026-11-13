import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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
  type ViewfinderFrameMode,
  type ViewfinderOrientation,
} from './lensFov'
import {
  installFrustumCullingControl,
  setFrustumCullingEnabled,
} from './frustumCullingControl'
import {
  clearParkedLocalTerrain,
  createLocalTerrainMesh,
  NEAR_TERRAIN_RADIUS_M,
  parkLocalTerrain,
  takeParkedLocalTerrain,
  reviveLocalTerrainTextures,
  type LocalTerrainHandle,
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
import { clampEyeHeightM, EYE_HEIGHT_STEP_M } from './presets'
import { ViewBearingHud } from './ViewBearingHud'
import { type PanoramaPlan } from './panorama'
import { ViewfinderCaptureCapsule } from './ViewfinderCaptureCapsule'
import { ViewfinderLandscapeControl } from './ViewfinderLandscapeControl'
import { ViewfinderProjectionControl } from './ViewfinderProjectionControl'
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
  type StageProjection,
} from './stelProjector'
import { createStereoCubemapPass } from './stereoCubemapPass'
import {
  clampGroundNightBrightness,
  clampGroundNightContrast,
  clampGroundNightTemperature,
  groundAlbedoFromSky,
  hexToRgb01,
  skyPaletteFromSunAltitude,
} from './skyLighting'
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
  /** True once full terrain LOD is ready (timeline can show). */
  onTerrainReadyChange?: (ready: boolean) => void
  /**
   * When false, the WebGL scene stays mounted (same-spot cache) but skips
   * rendering — used while the user is back on the orbit map.
   */
  active?: boolean
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
  onTerrainReadyChange,
  active = true,
}: ImmersiveViewProps) {
  const onTerrainReadyChangeRef = useRef(onTerrainReadyChange)
  onTerrainReadyChangeRef.current = onTerrainReadyChange
  const activeRef = useRef(active)
  activeRef.current = active
  /** DEM height updates from the map must NOT rebuild the WebGL scene. */
  const groundElevationRef = useRef(groundElevationM)
  groundElevationRef.current = groundElevationM
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
  const [frameMode, setFrameMode] = useState<ViewfinderFrameMode>(
    savedImmersive.frameMode,
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
  const [terrainDemFromCache, setTerrainDemFromCache] = useState(false)
  const [terrainProgress, setTerrainProgress] = useState(0)
  const [terrainReady, setTerrainReady] = useState(false)
  /** First DEM+preview mesh mounted — user may look / walk; upgrades continue. */
  const [terrainUnlocked, setTerrainUnlocked] = useState(false)
  const terrainUnlockedRef = useRef(false)
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
  /** Draft while typing in the elevation field (`null` = show committed value). */
  const [eyeHeightDraft, setEyeHeightDraft] = useState<string | null>(null)
  const [groundNightBrightness, setGroundNightBrightness] = useState(() =>
    clampGroundNightBrightness(savedImmersive.groundNightBrightness),
  )
  const groundNightBrightnessRef = useRef(
    clampGroundNightBrightness(savedImmersive.groundNightBrightness),
  )
  groundNightBrightnessRef.current = groundNightBrightness
  const [groundNightContrast, setGroundNightContrast] = useState(() =>
    clampGroundNightContrast(savedImmersive.groundNightContrast),
  )
  const groundNightContrastRef = useRef(
    clampGroundNightContrast(savedImmersive.groundNightContrast),
  )
  groundNightContrastRef.current = groundNightContrast
  const [groundNightTemperature, setGroundNightTemperature] = useState(() =>
    clampGroundNightTemperature(savedImmersive.groundNightTemperature),
  )
  const groundNightTemperatureRef = useRef(
    clampGroundNightTemperature(savedImmersive.groundNightTemperature),
  )
  groundNightTemperatureRef.current = groundNightTemperature
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
        frameMode,
        panorama,
        projection,
        stageVfovDeg,
        eyeHeightM,
        groundNightBrightness,
        groundNightContrast,
        groundNightTemperature,
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
    frameMode,
    panorama,
    projection,
    stageVfovDeg,
    eyeHeightM,
    groundNightBrightness,
    groundNightContrast,
    groundNightTemperature,
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

  const applyFrameMode = (mode: ViewfinderFrameMode) => {
    setFrameMode(mode)
    setPanorama((plan) =>
      plan.enabled === (mode === 'pano')
        ? plan
        : { ...plan, enabled: mode === 'pano' },
    )
    if (mode === 'off') setFramesLocked(false)
  }

  const applyPanorama = (next: PanoramaPlan) => {
    setPanorama(next)
    if (next.enabled) {
      if (frameMode !== 'pano') setFrameMode('pano')
      return
    }
    if (frameMode === 'pano') setFrameMode('dslr')
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Freeze elev for this scene — later map DEM corrections must not remount.
    const sceneGroundElevM = groundElevationRef.current

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
    /** False on WebGL context loss — parked GPU objects would be invalid. */
    let parkOnRelease = true
    let terrainDispose: (() => void) | null = null
    let adaptTerrain: ((x: number, y: number, z: number) => void) | null = null
    /** DEM mesh Y at ENU — keeps walking glued to the ground. */
    let groundYAt: ((east: number, north: number) => number) | null = null
    let groundElevMslAt: ((east: number, north: number) => number) | null =
      null
    /** Spot MSL under the camera (updates on walk). */
    let eyeGroundElevMsl = sceneGroundElevM
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
        parkOnRelease = false
        clearParkedLocalTerrain()
        terrainDispose?.()
        terrainDispose = null
        adaptTerrain = null
        groundYAt = null
        groundElevMslAt = null
        apiRef.current = null
      },
      false,
    )

    /** Keep a fixed eye-height clearance above local DEM (no cliff flying). */
    const snapEyeToGround = (eyeH = eyeHeightRef.current) => {
      const east = camera.position.x
      const north = -camera.position.z
      const groundY = groundYAt?.(east, north) ?? 0
      camera.position.y = groundY + eyeH
      eyeGroundElevMsl =
        groundElevMslAt?.(east, north) ?? sceneGroundElevM
      sky.material.uniforms.uEyeElevM.value = Math.max(
        0,
        eyeGroundElevMsl + eyeH,
      )
    }

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
      const sun = sunPositionAt(lat, lon, sceneGroundElevM, utcMs)
      const alt = sun.altitudeDeg
      latestSunAltDeg = alt
      const dir = sunDirectionFromAltAz(alt, sun.azimuthDeg)
      const palette = skyPaletteFromSunAltitude(alt)
      const night = palette.nightAmount
      const atmosphereOn = skyTogglesRef.current.showAtmosphere

      updateAstroSkyDome(sky, {
        sunAltitudeDeg: alt,
        sunDirection: dir,
        eyeElevationMslM: eyeGroundElevMsl + eyeHeightRef.current,
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

      const groundTint = groundAlbedoFromSky(palette, alt, {
        atmosphereOn,
        nightBrightness: groundNightBrightnessRef.current,
        nightContrast: groundNightContrastRef.current,
        nightTemperature: groundNightTemperatureRef.current,
      })

      if (atmosphereOn) {
        // Skylight follows sky palette so lit LODs match ortho ground tint.
        const zen = hexToRgb01(palette.zenith)
        const hor = hexToRgb01(palette.horizon)
        const warmSky = Math.max(0, 1 - Math.abs(alt - 2) / 10) // peaks ~sunset
        hemi.color.setRGB(
          zen.r * 0.55 + hor.r * 0.45 + warmSky * 0.12,
          zen.g * 0.55 + hor.g * 0.45 + warmSky * 0.05,
          zen.b * 0.55 + hor.b * 0.45 - warmSky * 0.08,
        )
        hemi.groundColor.setRGB(
          groundTint.r * 0.55,
          groundTint.g * 0.48,
          groundTint.b * 0.4,
        )
        hemi.intensity =
          0.35 +
          (1 - night) * 0.95 +
          Math.max(0, Math.min(0.4, (alt + 4) / 36))

        ambient.color.setRGB(
          groundTint.r * 0.55 + zen.r * 0.45,
          groundTint.g * 0.55 + zen.g * 0.45,
          groundTint.b * 0.55 + zen.b * 0.45,
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

      // Ortho MeshBasic ignores lights — multiply albedo from sky tint.
      // Keep strength moderate (see groundAlbedoFromSky) so 4096 satellite
      // stays sharp, not mud / cream.
      if (landscapeMats.length > 0) {
        for (const mat of landscapeMats) {
          if (mat.userData.isSea) {
            mat.color.setRGB(
              0.29 * groundTint.r,
              0.48 * groundTint.g,
              0.59 * groundTint.b,
            )
            continue
          }
          if (mat.userData.isOrthoTerrain || mat.map) {
            mat.color.setRGB(groundTint.r, groundTint.g, groundTint.b)
          } else if (atmosphereOn) {
            // Untextured LODs: slightly stronger sky multiply + night emissive.
            const boost = 0.85 + night * 0.08
            mat.color.setRGB(
              groundTint.r * boost,
              groundTint.g * boost * (0.96 + night * 0.02),
              groundTint.b * boost * (0.94 + night * 0.06),
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
            mat.color.setRGB(groundTint.r, groundTint.g, groundTint.b)
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
        const elev = eyeGroundElevMsl + eyeHeightRef.current
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

    let activeTerrain: LocalTerrainHandle | null = null
    const releaseTerrain = (terrain: LocalTerrainHandle) => {
      // Same spot quit→relaunch: keep GPU mesh. Incomplete builds still die.
      if (parkOnRelease && terrain.ready) {
        parkLocalTerrain(lat, lon, sceneGroundElevM, terrain)
      } else {
        terrain.dispose()
      }
    }
    const mountTerrain = (terrain: LocalTerrainHandle) => {
      if (disposed) {
        releaseTerrain(terrain)
        return
      }
      activeTerrain = terrain
      if (!terrain.mesh.parent) scene.add(terrain.mesh)
      if (terrain.farMesh && !terrain.farMesh.parent) scene.add(terrain.farMesh)
      terrainNearObj = terrain.mesh
      terrainFarObj = terrain.farMesh
      terrainDispose = () => {
        terrainNearObj = null
        terrainFarObj = null
        const t = activeTerrain
        activeTerrain = null
        if (t) releaseTerrain(t)
      }
      adaptTerrain = (x, y, z) => terrain.adaptToEye(x, y, z)
      groundYAt = (east, north) => terrain.groundYAt(east, north)
      groundElevMslAt = (east, north) =>
        terrain.groundElevationMslAt(east, north)
      landscapeMats = terrain.materials
      landscapeMat = terrain.mesh.material as
        | THREE.MeshBasicMaterial
        | THREE.MeshStandardMaterial
      snapEyeToGround()
      const uniform = landscapeMat.userData.eyeHeight as
        | { value: number }
        | undefined
      if (uniform) uniform.value = camera.position.y
      const eyeXZ = landscapeMat.userData.eyeXZ as
        | { value: THREE.Vector2 }
        | undefined
      eyeXZ?.value.set(camera.position.x, camera.position.z)
      applyCamera()
      applySky(latestSkyUtc)
      // First drawable relief (DEM + preview ortho) — hand control back.
      if (!terrainUnlockedRef.current) {
        terrainUnlockedRef.current = true
        setTerrainUnlocked(true)
      }
      const relief = Math.max(0, terrain.stats.maxH - terrain.stats.minH)
      const farKm = Math.round(terrain.stats.farRadiusM / 1000)
      setTerrainPhase(terrain.stats.phase)
      setTerrainProgress(terrain.stats.progress)
      if (terrain.ready) {
        setTerrainReady(true)
        onTerrainReadyChangeRef.current?.(true)
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

    const parked = takeParkedLocalTerrain(lat, lon, sceneGroundElevM)
      if (parked) {
      reviveLocalTerrainTextures(parked)
      setTerrainDemFromCache(true)
      setTerrainPhase('ready')
      setTerrainProgress(1)
      setTerrainReady(true)
      onTerrainReadyChangeRef.current?.(true)
      terrainUnlockedRef.current = true
      setTerrainUnlocked(true)
      setLoaderVisible(false)
      mountTerrain(parked)
    } else {
      clearParkedLocalTerrain()
      setTerrainLabel('Relief…')
      setTerrainPhase('dem')
      setTerrainDemFromCache(false)
      setTerrainProgress(0)
      setTerrainReady(false)
      onTerrainReadyChangeRef.current?.(false)
      terrainUnlockedRef.current = false
      setTerrainUnlocked(false)
      setLoaderVisible(true)
      void createLocalTerrainMesh({
        lat,
        lon,
        centerElevationM: sceneGroundElevM,
        radiusM: NEAR_TERRAIN_RADIUS_M,
        // 1600 + triple 4096 atlas bake OOMed the GPU (Context Lost). Stay ≤1400.
        resolution: 1200,
        onPreview: (terrain) => mountTerrain(terrain),
        onUpgrade: (terrain) => mountTerrain(terrain),
        onProgress: ({ phase, progress, cacheHitRatio }) => {
          if (disposed) return
          setTerrainPhase(phase)
          setTerrainProgress(progress)
          if (cacheHitRatio != null && cacheHitRatio >= 0.7) {
            setTerrainDemFromCache(true)
          }
          if (phase === 'ready') {
            setTerrainReady(true)
            onTerrainReadyChangeRef.current?.(true)
            window.setTimeout(() => {
              if (!disposed) setLoaderVisible(false)
            }, 650)
          }
        },
      })
        .then((terrain) => {
          if (disposed) {
            releaseTerrain(terrain)
            return
          }
          mountTerrain(terrain)
        })
        .catch((err: unknown) => {
          console.error('[terrain]', err)
          if (!disposed) {
            setTerrainLabel('Relief indisponible')
            terrainUnlockedRef.current = true
            setTerrainUnlocked(true)
            setTerrainReady(true)
            onTerrainReadyChangeRef.current?.(true)
            setLoaderVisible(false)
          }
        })
    }

    const resize = () => {
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      applyStageProjection(camera, stageFov)
      setSize({ w, h })
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!terrainUnlockedRef.current) return
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
      host.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || !terrainUnlockedRef.current) return
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
      if (!terrainUnlockedRef.current) return
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
        snapEyeToGround(h)
        syncEyeUniform()
        applyCamera()
      },
      step: (dir) => {
        if (!terrainUnlockedRef.current) return
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
        // Follow DEM so cliffs / ridges don't leave the eye floating.
        snapEyeToGround()
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
      if (!activeRef.current) {
        raf = window.requestAnimationFrame(tick)
        return
      }
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
        elevationM: sceneGroundElevM,
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
    // lat/lon only — groundElevationM updates from the map DEM must NOT remount
    // (that was reloading the whole terrain on every quit→relaunch).
    // bearingDeg must NOT remount either — that dropped back to muddy preview.
  }, [lat, lon])

  useEffect(() => {
    apiRef.current?.setSkyUtc(skyUtcMs)
  }, [
    skyUtcMs,
    showAtmosphere,
    groundNightBrightness,
    groundNightContrast,
    groundNightTemperature,
  ])

  // Re-entering the parked same-spot view: restore ready flag for the timeline.
  useEffect(() => {
    if (!active) return
    if (terrainReady) onTerrainReadyChangeRef.current?.(true)
  }, [active, terrainReady])

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
        if (terrainReady || terrainUnlocked) return true
        const canvas = hostRef.current?.querySelector('canvas')
        if (!canvas || canvas.width < 64 || canvas.height < 64) return false
        // Preview+ already shows textured landscape; enough for FOV QA.
        return (
          terrainPhase === 'preview' ||
          terrainPhase === 'ortho' ||
          terrainPhase === 'detail' ||
          terrainPhase === 'far' ||
          terrainPhase === 'ready' ||
          terrainProgress >= 0.3
        )
      },
      getStageVfovDeg: () => stageVfovLiveRef.current,
      getProjection: () => projection,
    }
    window.__astroQaImmersive = api
    return () => {
      if (window.__astroQaImmersive === api) delete window.__astroQaImmersive
    }
  }, [terrainReady, terrainUnlocked, terrainPhase, terrainProgress, projection])

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
      if (!terrainUnlockedRef.current) return
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
    <div
      className={
        terrainUnlocked ? 'immersive' : 'immersive immersive--terrain-locked'
      }
    >
      <div ref={hostRef} className="immersive__canvas" />
      {!terrainUnlocked ? (
        <div className="immersive__input-lock" aria-hidden="true" />
      ) : null}
      <PhotoFrameOverlay
        stageW={size.w}
        stageH={size.h}
        orientation={orientation}
        frameMode={frameMode}
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
      {loaderVisible ? (
        <div
          className={`immersive__loader${terrainReady ? ' immersive__loader--done' : ''}${terrainUnlocked ? ' immersive__loader--upgrading' : ''}`}
          role="status"
          aria-live="polite"
          aria-busy={!terrainReady}
        >
          <div className="immersive__loader-card">
            <div className="immersive__loader-row">
              <p className="immersive__loader-phase">
                {terrainReady
                  ? 'Vue prête'
                  : terrainPhase === 'dem' && terrainDemFromCache
                    ? 'Relief (cache)\u2026'
                    : TERRAIN_PHASE_LABEL[terrainPhase]}
              </p>
              <p className="immersive__loader-pct">
                {Math.round(terrainProgress * 100)} %
              </p>
            </div>
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
          </div>
        </div>
      ) : null}
      <div className="moon-preview-pitch-stack">
        <ViewPitchHud pitchDeg={pitchDeg} />
        <RenderDiagnosticCard
          liveRef={renderDiagLiveRef}
          getContext={() => ({ ...diagContextRef.current })}
        />
      </div>

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
        <ViewfinderCaptureCapsule
          focalMm={focalMm}
          orientation={orientation}
          sensorFormat={sensorFormat}
          frameMode={frameMode}
          panorama={panorama}
          opticalHFovDeg={optical.h}
          opticalVFovDeg={optical.v}
          onFocalMmChange={setFocalMm}
          onOrientationChange={setOrientation}
          onSensorFormatChange={setSensorFormat}
          onFrameModeChange={applyFrameMode}
          onPanoramaChange={applyPanorama}
        />
      </div>

      <div className="move-stack">
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
                disabled={!terrainUnlocked}
                onPointerDown={(event) => {
                  if (!terrainUnlockedRef.current) return
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

        <div className="eye-height">
          <span className="eye-height__label" id="eye-height-label">
            Élévation
          </span>
          <div
            className="eye-height__stepper"
            role="group"
            aria-labelledby="eye-height-label"
          >
            <button
              type="button"
              className="eye-height__btn"
              aria-label={`Baisser de ${EYE_HEIGHT_STEP_M * 100} cm`}
              onClick={() => {
                setEyeHeightDraft(null)
                setEyeHeightM((h) =>
                  clampEyeHeightM(
                    Math.round((h - EYE_HEIGHT_STEP_M) * 100) / 100,
                  ),
                )
              }}
            >
              −
            </button>
            <input
              className="eye-height__input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={
                eyeHeightDraft ?? formatEyeHeightDisplay(eyeHeightM)
              }
              aria-label="Élévation de l'objectif au-dessus du sol, en mètres"
              onChange={(event) => {
                setEyeHeightDraft(event.target.value)
              }}
              onBlur={() => {
                if (eyeHeightDraft == null) return
                const parsed = Number(
                  eyeHeightDraft.trim().replace(',', '.'),
                )
                setEyeHeightDraft(null)
                if (!Number.isFinite(parsed)) return
                setEyeHeightM(clampEyeHeightM(parsed))
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                } else if (event.key === 'Escape') {
                  setEyeHeightDraft(null)
                  event.currentTarget.blur()
                }
              }}
            />
            <span className="eye-height__unit" aria-hidden="true">
              m
            </span>
            <button
              type="button"
              className="eye-height__btn"
              aria-label={`Monter de ${EYE_HEIGHT_STEP_M * 100} cm`}
              onClick={() => {
                setEyeHeightDraft(null)
                setEyeHeightM((h) =>
                  clampEyeHeightM(
                    Math.round((h + EYE_HEIGHT_STEP_M) * 100) / 100,
                  ),
                )
              }}
            >
              +
            </button>
          </div>
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
        <ViewfinderLandscapeControl
          brightness={groundNightBrightness}
          contrast={groundNightContrast}
          temperature={groundNightTemperature}
          onBrightnessChange={setGroundNightBrightness}
          onContrastChange={setGroundNightContrast}
          onTemperatureChange={setGroundNightTemperature}
        />
        <ViewfinderProjectionControl
          projection={projection}
          onProjectionChange={setProjection}
        />
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

function formatEyeHeightDisplay(meters: number): string {
  const tenths = Math.round(meters * 10)
  if (Math.abs(meters * 10 - tenths) < 1e-6) return (tenths / 10).toFixed(1)
  return String(meters)
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
