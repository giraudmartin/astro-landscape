import type { Object3D } from 'three'

const armed = new WeakSet<Object3D>()
let cullEnabled = false
let rootRef: Object3D | null = null

function applyTo(obj: Object3D): void {
  obj.frustumCulled = cullEnabled
}

function arm(obj: Object3D): void {
  if (armed.has(obj)) {
    applyTo(obj)
    return
  }
  armed.add(obj)
  applyTo(obj)
  obj.addEventListener('childadded', (event: { child?: Object3D }) => {
    if (event.child) arm(event.child)
  })
  for (const child of obj.children) arm(child)
}

/** Install on the immersive scene. Default: frustum culling OFF. */
export function installFrustumCullingControl(root: Object3D): void {
  rootRef = root
  cullEnabled = false
  arm(root)
}

/** `enabled=true` → Three.js culls; `false` → never cull (incl. new tiles). */
export function setFrustumCullingEnabled(enabled: boolean): void {
  cullEnabled = enabled
  if (rootRef) arm(rootRef)
}

export function getFrustumCullingEnabled(): boolean {
  return cullEnabled
}
