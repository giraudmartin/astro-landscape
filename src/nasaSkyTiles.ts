import * as THREE from 'three'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'

export type NasaSkyTileLayerId = 'milkyway' | 'hiptyc'

export type NasaSkyTilesManifest = {
  version: number
  tileSize: number
  pathTemplate: string
  layers: Record<
    string,
    {
      layer: string
      tileSize: number
      maxZ: number
      minZ: number
      width: number
      height: number
    }
  >
}

export type NasaSkyTileLayerHandle = {
  root: THREE.Group
  setOpacity: (opacity: number) => void
  setVisible: (visible: boolean) => void
  update: (camera: THREE.PerspectiveCamera) => void
  dispose: () => void
}

type TileKey = string

type ResidentTile = {
  key: TileKey
  z: number
  x: number
  y: number
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  texture: THREE.Texture
  lastWantedFrame: number
}

type QueuedTile = {
  z: number
  x: number
  y: number
  key: TileKey
  /** Lower = load sooner. */
  priority: number
}

const DEG = Math.PI / 180
/** Full-sky low-res level kept resident so the dome never has holes. */
export const NASA_SKY_COVER_Z = 1
const MAX_INFLIGHT = 4
const MAX_DETAIL_RESIDENTS = 64
/** Switch from cover → detail once this fraction of FOV detail tiles is ready. */
const DETAIL_READY_RATIO = 0.55

function tileKey(z: number, x: number, y: number): TileKey {
  return `${z}/${x}/${y}`
}

function gridForZ(z: number): { cols: number; rows: number } {
  return { cols: 2 ** (z + 1), rows: 2 ** z }
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1
}

/**
 * Zoom level from camera FOV: wide → low z, telephoto → high z.
 */
export function chooseTileZoom(
  fovYDeg: number,
  aspect: number,
  maxZ: number,
  minZ = 0,
): number {
  const fovXDeg = (2 * Math.atan(Math.tan((fovYDeg * DEG) / 2) * aspect)) / DEG
  const idealTileDeg = Math.max(fovXDeg / 2.5, 0.05)
  let best = minZ
  let bestErr = Number.POSITIVE_INFINITY
  for (let z = minZ; z <= maxZ; z += 1) {
    const tileDeg = 360 / gridForZ(z).cols
    const err = Math.abs(tileDeg - idealTileDeg)
    if (err < bestErr) {
      best = z
      bestErr = err
    }
  }
  return best
}

/** Three.js SphereGeometry: phi=0 at -X, +Z at u=0.25, +Y = north (v=0). */
export function directionToEquirectUV(dir: THREE.Vector3): { u: number; v: number } {
  const d = dir.clone().normalize()
  const phi = Math.atan2(d.z, -d.x)
  return {
    u: wrap01(phi / (Math.PI * 2)),
    v: Math.acos(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI,
  }
}

export function allTilesAtZoom(z: number): Array<{ x: number; y: number }> {
  const { cols, rows } = gridForZ(z)
  const out: Array<{ x: number; y: number }> = []
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) out.push({ x, y })
  }
  return out
}

export function tilesForView(input: {
  centerU: number
  centerV: number
  fovYDeg: number
  aspect: number
  z: number
  pad?: number
  spanScale?: number
}): Array<{ x: number; y: number }> {
  const { cols, rows } = gridForZ(input.z)
  const fovXDeg =
    (2 * Math.atan(Math.tan((input.fovYDeg * DEG) / 2) * input.aspect)) / DEG
  const pad = input.pad ?? 2
  const spanScale = input.spanScale ?? 2.4
  const spanU = Math.min(1, (fovXDeg / 360) * spanScale)
  const spanV = Math.min(1, (input.fovYDeg / 180) * spanScale)
  const u0 = input.centerU - spanU / 2
  const u1 = input.centerU + spanU / 2
  const v0 = Math.max(0, input.centerV - spanV / 2)
  const v1 = Math.min(1, input.centerV + spanV / 2)

  const yStart = Math.max(0, Math.floor(v0 * rows) - pad)
  const yEnd = Math.min(rows - 1, Math.ceil(v1 * rows) - 1 + pad)
  const result: Array<{ x: number; y: number }> = []
  const seen = new Set<string>()

  const addColumnRange = (xStart: number, xEnd: number) => {
    for (let y = yStart; y <= yEnd; y += 1) {
      for (let x = xStart; x <= xEnd; x += 1) {
        const xx = ((x % cols) + cols) % cols
        const id = `${xx},${y}`
        if (seen.has(id)) continue
        seen.add(id)
        result.push({ x: xx, y })
      }
    }
  }

  const x0 = Math.floor(u0 * cols) - pad
  const x1 = Math.ceil(u1 * cols) - 1 + pad
  if (u0 < 0 || u1 > 1) {
    addColumnRange(x0, cols - 1)
    addColumnRange(0, x1)
  } else {
    addColumnRange(x0, x1)
  }
  return result
}

/** Priority: cover first, then mid, then detail; center of view before edges. */
export function tileLoadPriority(
  z: number,
  x: number,
  y: number,
  coverZ: number,
  targetZ: number,
  centerU: number,
  centerV: number,
): number {
  const { cols, rows } = gridForZ(z)
  const du = x / cols + 0.5 / cols - centerU
  const dv = y / rows + 0.5 / rows - centerV
  const dist = du * du + dv * dv
  const tier = z === coverZ ? 0 : z < targetZ ? 1000 : 2000
  return tier + dist * 100
}

function configureTileTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.LinearSRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.repeat.x = -1
  texture.offset.x = 1
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
}

function createTileMesh(input: {
  radius: number
  z: number
  imageX: number
  y: number
  material: THREE.MeshBasicMaterial
}): THREE.Mesh {
  const { cols, rows } = gridForZ(input.z)
  const sphereX = cols - 1 - input.imageX
  const u0 = sphereX / cols
  const u1 = (sphereX + 1) / cols
  const v0 = input.y / rows
  const v1 = (input.y + 1) / rows
  const segs = Math.max(8, 24 >> Math.min(input.z, 3))
  const geometry = new THREE.SphereGeometry(
    input.radius,
    segs,
    Math.max(6, segs >> 1),
    u0 * Math.PI * 2,
    (u1 - u0) * Math.PI * 2,
    v0 * Math.PI,
    (v1 - v0) * Math.PI,
  )
  const mesh = new THREE.Mesh(geometry, input.material)
  mesh.frustumCulled = false
  return mesh
}

export async function loadNasaSkyTilesManifest(
  url = '/sky/tiles/manifest.json',
): Promise<NasaSkyTilesManifest | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return (await response.json()) as NasaSkyTilesManifest
  } catch {
    return null
  }
}

/**
 * Zoom-level LOD for one NASA celestial map.
 *
 * - Always keep a full-sky low zoom (cover) so there are never holes.
 * - Load a sharper zoom only in the camera FOV (and one parent level).
 * - Additive layers (stars) show either cover OR detail, never both stacked.
 * - Diffuse layers (milky way) keep cover under detail.
 */
export function createNasaSkyTileLayer(input: {
  layer: NasaSkyTileLayerId
  manifest: NasaSkyTilesManifest
  radius: number
  renderOrder: number
  blending: THREE.Blending
  transparent?: boolean
  depthTest?: boolean
  configureMaterial?: (material: THREE.MeshBasicMaterial) => void
}): NasaSkyTileLayerHandle | null {
  const meta = input.manifest.layers[input.layer]
  if (!meta) return null

  const coverZ = Math.min(NASA_SKY_COVER_Z, meta.maxZ)
  const root = new THREE.Group()
  root.name = `nasaSkyTiles:${input.layer}`
  root.frustumCulled = false
  const loader = new EXRLoader()
  const residents = new Map<TileKey, ResidentTile>()
  const inflight = new Map<TileKey, true>()
  const queue: QueuedTile[] = []
  let opacity = 1
  let disposed = false
  let frame = 0
  let lastFootprintKey = ''
  let targetZ = coverZ
  let fovDetailKeys: TileKey[] = []
  const lookLocal = new THREE.Vector3()

  const pathFor = (z: number, x: number, y: number): string =>
    input.manifest.pathTemplate
      .replace('{layer}', input.layer)
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y))

  const release = (tile: ResidentTile) => {
    root.remove(tile.mesh)
    tile.mesh.geometry.dispose()
    tile.material.dispose()
    tile.texture.dispose()
  }

  const refreshVisibility = () => {
    const detailWanted = fovDetailKeys.length
    const detailReady =
      detailWanted === 0
        ? 0
        : fovDetailKeys.reduce(
            (n, key) => n + (residents.has(key) ? 1 : 0),
            0,
          ) / detailWanted
    const showDetail = targetZ > coverZ && detailReady >= DETAIL_READY_RATIO

    for (const tile of residents.values()) {
      if (tile.z === coverZ) {
        // Never stack cover + detail: two NormalBlending milky-way layers at
        // opacity 0.34 make the FOV look suddenly darker once sharp tiles land.
        // Same rule for additive stars (would double-bright otherwise).
        tile.mesh.visible = !showDetail
        continue
      }
      if (tile.z === targetZ) {
        tile.mesh.visible = showDetail
        continue
      }
      // Parent bridge (targetZ-1): only while detail is still loading.
      tile.mesh.visible = !showDetail && tile.z > coverZ
    }
  }

  const pumpQueue = () => {
    while (inflight.size < MAX_INFLIGHT && queue.length > 0) {
      queue.sort((a, b) => a.priority - b.priority)
      const next = queue.shift()!
      if (residents.has(next.key) || inflight.has(next.key)) continue
      inflight.set(next.key, true)
      loader.load(
        pathFor(next.z, next.x, next.y),
        (texture) => {
          inflight.delete(next.key)
          if (disposed) {
            texture.dispose()
            pumpQueue()
            return
          }
          configureTileTexture(texture)
          const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.BackSide,
            transparent: input.transparent ?? true,
            opacity,
            depthTest: input.depthTest ?? true,
            depthWrite: false,
            fog: false,
            blending: input.blending,
            toneMapped: false,
          })
          input.configureMaterial?.(material)
          const mesh = createTileMesh({
            radius: input.radius,
            z: next.z,
            imageX: next.x,
            y: next.y,
            material,
          })
          mesh.name = `tile:${next.key}`
          mesh.renderOrder = input.renderOrder + next.z
          root.add(mesh)
          residents.set(next.key, {
            key: next.key,
            z: next.z,
            x: next.x,
            y: next.y,
            mesh,
            material,
            texture,
            lastWantedFrame: frame,
          })
          refreshVisibility()
          pumpQueue()
        },
        undefined,
        () => {
          inflight.delete(next.key)
          pumpQueue()
        },
      )
    }
  }

  const enqueue = (
    z: number,
    x: number,
    y: number,
    priority: number,
  ) => {
    const key = tileKey(z, x, y)
    if (residents.has(key) || inflight.has(key)) return
    if (queue.some((item) => item.key === key)) return
    queue.push({ z, x, y, key, priority })
  }

  return {
    root,
    setOpacity: (next) => {
      opacity = next
      for (const tile of residents.values()) {
        tile.material.opacity = next
        tile.material.needsUpdate = true
      }
    },
    setVisible: (visible) => {
      root.visible = visible
    },
    update: (camera) => {
      if (disposed) return
      frame += 1

      const stageFov = camera.userData.stageVfovDeg
      // chooseTileZoom uses tan(fov/2), which breaks as the field nears 180°.
      const fovYDeg = Math.min(
        150,
        Math.max(
          1,
          typeof stageFov === 'number' && Number.isFinite(stageFov)
            ? stageFov
            : camera.fov,
        ),
      )
      camera.getWorldDirection(lookLocal)
      const parent = root.parent
      if (parent) {
        parent.updateWorldMatrix(true, false)
        lookLocal.transformDirection(parent.matrixWorld.clone().invert())
      }
      const { u, v } = directionToEquirectUV(lookLocal)
      const imageU = wrap01(1 - u)
      targetZ = chooseTileZoom(fovYDeg, camera.aspect, meta.maxZ, coverZ)
      const footprintKey = `${targetZ}:${imageU.toFixed(2)}:${v.toFixed(2)}`

      const wanted = new Map<TileKey, QueuedTile>()
      const addWanted = (z: number, x: number, y: number) => {
        const key = tileKey(z, x, y)
        const priority = tileLoadPriority(
          z,
          x,
          y,
          coverZ,
          targetZ,
          imageU,
          v,
        )
        const prev = wanted.get(key)
        if (!prev || priority < prev.priority) {
          wanted.set(key, { z, x, y, key, priority })
        }
      }

      // Level A — full sky, low zoom (always).
      for (const tile of allTilesAtZoom(coverZ)) {
        addWanted(coverZ, tile.x, tile.y)
      }

      // Level B/C — sharper zooms only where the camera looks.
      fovDetailKeys = []
      if (targetZ > coverZ) {
        const detail = tilesForView({
          centerU: imageU,
          centerV: v,
          fovYDeg,
          aspect: camera.aspect,
          z: targetZ,
          pad: 2,
          spanScale: 2.4,
        })
        for (const tile of detail) {
          addWanted(targetZ, tile.x, tile.y)
          fovDetailKeys.push(tileKey(targetZ, tile.x, tile.y))
        }
        if (targetZ - 1 > coverZ) {
          const mid = tilesForView({
            centerU: imageU,
            centerV: v,
            fovYDeg,
            aspect: camera.aspect,
            z: targetZ - 1,
            pad: 1,
            spanScale: 2.4,
          })
          for (const tile of mid) addWanted(targetZ - 1, tile.x, tile.y)
        }
      }

      for (const spec of wanted.values()) {
        const resident = residents.get(spec.key)
        if (resident) resident.lastWantedFrame = frame
        else enqueue(spec.z, spec.x, spec.y, spec.priority)
      }

      if (footprintKey !== lastFootprintKey) {
        lastFootprintKey = footprintKey
        for (let i = queue.length - 1; i >= 0; i -= 1) {
          if (!wanted.has(queue[i]!.key)) queue.splice(i, 1)
        }
      }

      // Evict old detail tiles; never evict the cover level.
      const detailResidents = [...residents.values()]
        .filter((tile) => tile.z > coverZ)
        .sort((a, b) => a.lastWantedFrame - b.lastWantedFrame)
      while (detailResidents.length > MAX_DETAIL_RESIDENTS) {
        const victim = detailResidents.shift()!
        if (wanted.has(victim.key)) continue
        if (frame - victim.lastWantedFrame < 45) continue
        residents.delete(victim.key)
        release(victim)
      }
      for (const [key, tile] of [...residents]) {
        if (
          tile.z > coverZ &&
          !wanted.has(key) &&
          frame - tile.lastWantedFrame > 120
        ) {
          residents.delete(key)
          release(tile)
        }
      }

      refreshVisibility()
      pumpQueue()
    },
    dispose: () => {
      disposed = true
      queue.length = 0
      inflight.clear()
      for (const tile of residents.values()) release(tile)
      residents.clear()
    },
  }
}
