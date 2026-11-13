import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import {
  extractMoonAlbedoMap,
  MOON_TOPO_BAKE_REVISION,
  prepareMoonTopoModel,
} from './moonGlobe'

/**
 * Shared celestial shell radius (MW, stars, grids, Sun/Moon discs).
 * Must sit beyond FAR_TERRAIN_RADIUS_M (~300 km) so the Milky Way never
 * passes between the near disc and distant LOD ridges, and inside the
 * atmospheric sky dome (~360 km).
 *
 * Photo Sightline uses 80 km for Google Tiles depth precision; ImmersiveView
 * keeps 330 km to match the existing night-sky / DEM contract.
 */
export const CELESTIAL_SKY_DISTANCE_M = 330_000
export const CELESTIAL_MIN_DISC_RADIUS_M = 4

/** One visual contract for Sun/Moon trajectories (Photo Sightline). */
export const LUNAR_TRAJECTORY_COLOR = 0x9dc5ff

/** Legacy smooth sphere — albedo-extraction fallback only. */
export const MOON_GLB_URL = '/models/moon.glb'
/** NASA LRO color + topographic mesh (meshopt + quantized). */
export const MOON_TOPO_GLB_URL = '/models/moon-nasa-lro-topo.glb'
export const MOON_ALBEDO_URL = '/models/moon-albedo.jpg'
export const MOON_MODEL_CREDIT =
  'Moon 3D: NASA GSFC / SVS (svs.gsfc.nasa.gov/14959)'

function createMoonGltfLoader(): GLTFLoader {
  // Topo asset requires EXT_meshopt_compression (+ KHR_mesh_quantization).
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
}

/** Shared baked prototype — clone per viewfinder; geometry is reused. */
let moonTopoPrototypePromise: Promise<THREE.Object3D | null> | null = null
let moonTopoCachedBakeRevision = -1
/** Albedo pulled once from the GLB before placeholder materials replace it. */
let moonTopoAlbedo: THREE.Texture | null = null

/**
 * Load + bake the NASA topo Moon once. Returns null on failure so callers
 * keep the procedural sphere fallback.
 */
export async function loadMoonTopoModelPrototype(): Promise<THREE.Object3D | null> {
  if (
    moonTopoPrototypePromise &&
    moonTopoCachedBakeRevision !== MOON_TOPO_BAKE_REVISION
  ) {
    moonTopoPrototypePromise = null
    moonTopoAlbedo = null
  }
  if (!moonTopoPrototypePromise) {
    moonTopoCachedBakeRevision = MOON_TOPO_BAKE_REVISION
    moonTopoPrototypePromise = (async () => {
      try {
        const gltf = await createMoonGltfLoader().loadAsync(MOON_TOPO_GLB_URL)
        prepareMoonTopoModel(gltf.scene)
        moonTopoAlbedo = extractMoonAlbedoMap(gltf.scene)
        if (moonTopoAlbedo) {
          moonTopoAlbedo.userData.moonTopoShared = true
        }
        // Drop source materials so clones never share a disposable GLB material
        // that still owns the cached albedo map.
        gltf.scene.traverse((object) => {
          const mesh = object as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.material = []
        })
        console.info('[moon] NASA LRO topo GLB ready', MOON_TOPO_GLB_URL)
        return gltf.scene
      } catch (error) {
        console.warn(
          '[moon] NASA topo GLB failed to load; using sphere fallback',
          error,
        )
        moonTopoAlbedo = null
        // Allow a later retry (e.g. after Vite restart picks up a new public/ file).
        moonTopoPrototypePromise = null
        return null
      }
    })()
  }
  return moonTopoPrototypePromise
}

/** Texture embedded in the NASA topo GLB (UV-matched). */
export function getMoonTopoAlbedo(): THREE.Texture | null {
  return moonTopoAlbedo
}

/** Instance for one scene. Shares baked geometry with other clones. */
export async function cloneMoonTopoModel(): Promise<THREE.Object3D | null> {
  const prototype = await loadMoonTopoModelPrototype()
  if (!prototype) return null
  const instance = prototype.clone(true)
  // Fresh disposable placeholders per instance (clone would share `[]`).
  instance.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.material = new THREE.MeshBasicMaterial({ color: 0xffffff })
  })
  return instance
}

export function moonAngularRadiusMeters(
  distanceMeters: number,
  angularDiameterDeg: number,
): number {
  return Math.max(
    distanceMeters * Math.tan((angularDiameterDeg * Math.PI) / 360),
    CELESTIAL_MIN_DISC_RADIUS_M,
  )
}

/**
 * Both viewfinders use the same JPEG-first lunar albedo and the same GLB
 * fallback. Creating the globe only after this resolves prevents a temporary
 * procedural disc from diverging between renderers.
 */
export async function loadMoonAlbedoTexture(): Promise<THREE.Texture | null> {
  try {
    return await new THREE.TextureLoader().loadAsync(MOON_ALBEDO_URL)
  } catch {
    try {
      const gltf = await createMoonGltfLoader().loadAsync(MOON_GLB_URL)
      const albedo = extractMoonAlbedoMap(gltf.scene)
      gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.isMesh) mesh.geometry?.dispose()
      })
      return albedo
    } catch {
      return null
    }
  }
}
