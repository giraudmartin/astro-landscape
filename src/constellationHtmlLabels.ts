import * as THREE from 'three'
import { CELESTIAL_SKY_DISTANCE_M } from './celestialRender'
import { constellationLabel } from './celestialObjects/liveInfo'
import {
  CONSTELLATION_FIGURES,
  type ConstellationFigure,
} from './constellationFigures'
import { j2000ToNasaMapDirection } from './celestialVectors'
import { stelProjectEye } from './stelProjector'

export type ConstellationHtmlLabelsHandle = {
  setVisible: (visible: boolean) => void
  setOpacity: (opacity: number) => void
  /**
   * Project sky centroids into the viewfinder with the same stel math as the
   * stick figures. Uses real HTML/CSS so typography matches Paysage / Ciel.
   */
  update: (input: {
    camera: THREE.Camera
    /** NASA celestial group (rotated J2000 → local). */
    celestialRoot: THREE.Object3D
    stageVfovDeg: number
    canvasWidth: number
    canvasHeight: number
    /**
     * Cheap ridge test (height samples). NEVER Mesh raycasts — intersectObjects
     * on the immersive DEM froze night frames for tens of seconds (d1699d4).
     */
    terrainOccluded?: (
      origin: THREE.Vector3,
      dir: THREE.Vector3,
      maxDist: number,
    ) => boolean
  }) => void
  dispose: () => void
}

type Anchor = {
  el: HTMLSpanElement
  local: THREE.Vector3
}

const _world = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _forward = new THREE.Vector3()
const _camPos = new THREE.Vector3()
/** ~35° elev — above this, DEM ridges almost never occlude the sky. */
const OCCLUSION_MAX_DIR_Y = Math.sin((35 * Math.PI) / 180)

function buildAnchors(
  figures: readonly ConstellationFigure[],
  radius: number,
): { name: string; text: string; local: THREE.Vector3 }[] {
  const sums = new Map<string, { x: number; y: number; z: number; n: number }>()
  const dir = new THREE.Vector3()
  for (const figure of figures) {
    let acc = sums.get(figure.name)
    if (!acc) {
      acc = { x: 0, y: 0, z: 0, n: 0 }
      sums.set(figure.name, acc)
    }
    for (const p of figure.points) {
      dir.copy(j2000ToNasaMapDirection(p.raHours, p.decDeg))
      acc.x += dir.x
      acc.y += dir.y
      acc.z += dir.z
      acc.n += 1
    }
  }
  const out: { name: string; text: string; local: THREE.Vector3 }[] = []
  for (const [name, acc] of sums) {
    if (acc.n < 1) continue
    dir.set(acc.x / acc.n, acc.y / acc.n, acc.z / acc.n)
    if (dir.lengthSq() < 1e-12) continue
    dir.normalize()
    out.push({
      name,
      text: constellationLabel(name) ?? name,
      local: dir.multiplyScalar(radius).clone(),
    })
  }
  return out
}

/**
 * DOM constellation names — same font stack / weight / color as the immersive
 * chrome (Paysage, Ciel, Projection). Never a WebGL canvas texture.
 */
export function createConstellationHtmlLabels(
  host: HTMLElement,
  radius = CELESTIAL_SKY_DISTANCE_M * 0.991,
): ConstellationHtmlLabelsHandle {
  const layer = document.createElement('div')
  layer.className = 'constellation-label-layer'
  layer.setAttribute('aria-hidden', 'true')
  host.appendChild(layer)

  const anchors: Anchor[] = buildAnchors(CONSTELLATION_FIGURES, radius).map(
    (a) => {
      const el = document.createElement('span')
      el.className = 'constellation-label'
      el.textContent = a.text
      el.style.display = 'none'
      layer.appendChild(el)
      return { el, local: a.local }
    },
  )

  let visibleWanted = false
  let opacity = 1

  const applyOpacity = () => {
    layer.style.opacity = String(THREE.MathUtils.clamp(opacity, 0, 1))
  }
  applyOpacity()

  return {
    setVisible: (visible) => {
      visibleWanted = visible
      layer.style.visibility = visible ? 'visible' : 'hidden'
      if (!visible) {
        for (const a of anchors) a.el.style.display = 'none'
      }
    },
    setOpacity: (value) => {
      opacity = value
      applyOpacity()
    },
    update: ({
      camera,
      celestialRoot,
      stageVfovDeg,
      canvasWidth,
      canvasHeight,
      terrainOccluded,
    }) => {
      if (!visibleWanted || canvasWidth < 2 || canvasHeight < 2) {
        for (const a of anchors) a.el.style.display = 'none'
        return
      }

      celestialRoot.updateWorldMatrix(true, false)
      camera.getWorldPosition(_camPos)
      camera.matrixWorld.extractBasis(_right, _up, _forward)
      // Three cameras look down −Z → forward is −basis Z.
      _forward.negate()

      const aspect = canvasWidth / canvasHeight
      const margin = 0.08

      for (const a of anchors) {
        _world.copy(a.local).applyMatrix4(celestialRoot.matrixWorld)
        _dir.copy(_world).sub(_camPos)
        const dist = _dir.length()
        if (dist < 1e-3) {
          a.el.style.display = 'none'
          continue
        }
        _dir.multiplyScalar(1 / dist)

        // Local ENU: +Y is up — drop names under the mathematical horizon.
        if (_dir.y < 0.012) {
          a.el.style.display = 'none'
          continue
        }

        // Hide names whose sightline hits a ridge before the sky shell.
        if (terrainOccluded && _dir.y < OCCLUSION_MAX_DIR_Y) {
          if (terrainOccluded(_camPos, _dir, dist)) {
            a.el.style.display = 'none'
            continue
          }
        }

        const eye = {
          x: _dir.dot(_right),
          y: _dir.dot(_up),
          z: _dir.dot(_forward),
        }
        const ndc = stelProjectEye(eye, stageVfovDeg, aspect)
        if (
          !ndc ||
          !Number.isFinite(ndc.ndcX) ||
          !Number.isFinite(ndc.ndcY) ||
          Math.abs(ndc.ndcX) > 1 + margin ||
          Math.abs(ndc.ndcY) > 1 + margin
        ) {
          a.el.style.display = 'none'
          continue
        }

        const x = ((ndc.ndcX + 1) / 2) * canvasWidth
        const y = ((1 - ndc.ndcY) / 2) * canvasHeight
        a.el.style.display = 'block'
        a.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`
      }
    },
    dispose: () => {
      layer.remove()
      anchors.length = 0
    },
  }
}
