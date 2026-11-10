import * as THREE from 'three'
import { CELESTIAL_SKY_DISTANCE_M } from './celestialRender'
import { attachStelProjector } from './stelProjector'

const DEG = Math.PI / 180

/** Local ENU: +X east, +Y up, +Z south — same as ImmersiveView / skyDome. */
function directionFromAltAz(altitudeDeg: number, azimuthDeg: number): THREE.Vector3 {
  const alt = altitudeDeg * DEG
  const az = azimuthDeg * DEG
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(alt),
    Math.sin(alt),
    -Math.cos(az) * Math.cos(alt),
  )
}

export type HorizonAzimuthGridHandle = {
  root: THREE.Group
  setVisible: (visible: boolean) => void
  setOpacity: (opacity: number) => void
  dispose: () => void
}

/**
 * Horizon-fixed alt/az grid (not celestial):
 * - azimuth meridians every 15° (cardinals stronger)
 * - altitude parallels every 15° + mathematical horizon
 */
export function createHorizonAzimuthGrid(
  radius = CELESTIAL_SKY_DISTANCE_M * 0.988,
): HorizonAzimuthGridHandle {
  const root = new THREE.Group()
  root.name = 'horizonAzimuthGrid'

  const minorPos: number[] = []
  const majorPos: number[] = []
  const push = (out: number[], alt: number, az: number) => {
    const p = directionFromAltAz(alt, az).multiplyScalar(radius)
    out.push(p.x, p.y, p.z)
  }

  // Azimuth meridians: −5° … +90° so the ring dips just under the horizon.
  for (let az = 0; az < 360; az += 15) {
    const major = az % 90 === 0
    const out = major ? majorPos : minorPos
    for (let alt = -5; alt < 90; alt += 2.5) {
      push(out, alt, az)
      push(out, Math.min(alt + 2.5, 90), az)
    }
  }

  // Altitude parallels (skip zenith point).
  for (let alt = 0; alt <= 75; alt += 15) {
    const out = alt === 0 ? majorPos : minorPos
    for (let az = 0; az < 360; az += 2) {
      push(out, alt, az)
      push(out, alt, (az + 2) % 360)
    }
  }

  const makeLines = (
    positions: number[],
    color: number,
    opacity: number,
    name: string,
    renderOrder: number,
  ) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    )
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    })
    attachStelProjector(material)
    const lines = new THREE.LineSegments(geometry, material)
    lines.name = name
    lines.frustumCulled = false
    lines.renderOrder = renderOrder
    lines.visible = false
    root.add(lines)
    return { lines, material, geometry, baseOpacity: opacity }
  }

  const minor = makeLines(minorPos, 0xb8c4d8, 0.18, 'horizonAzGridMinor', 19)
  const major = makeLines(majorPos, 0xe8f0ff, 0.38, 'horizonAzGridMajor', 19)

  return {
    root,
    setVisible: (visible) => {
      minor.lines.visible = visible
      major.lines.visible = visible
    },
    setOpacity: (opacity) => {
      const o = THREE.MathUtils.clamp(opacity, 0, 1)
      minor.material.opacity = minor.baseOpacity * o
      major.material.opacity = major.baseOpacity * o
    },
    dispose: () => {
      minor.geometry.dispose()
      minor.material.dispose()
      major.geometry.dispose()
      major.material.dispose()
    },
  }
}
