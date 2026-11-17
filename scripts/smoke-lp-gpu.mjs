/**
 * GPU smoke: post-frame fullscreen LP + screen-ray — sodium alive, no sphere tuiles.
 *
 *   node scripts/smoke-lp-gpu.mjs
 *   (expects Vite on http://localhost:5180)
 */
import { chromium } from '@playwright/test'

const BASE = process.env.LP_SMOKE_URL || 'http://localhost:5180/'

const result = await (async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60_000 })
  const out = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js')
    const skyMod = await import('/src/skyDome.ts')
    const { setStageProjection, applyStageProjection } = await import(
      '/src/stelProjector.ts'
    )
    setStageProjection('stereographic')
    const sky = skyMod.createAstroSkyDome()
    const spike = new Float32Array(64)
    spike[0] = 1
    spike[1] = 0.7
    spike[63] = 0.7
    skyMod.setLightPollutionProfile(sky, spike, 0.1)
    const mat = sky.lightPollutionMaterial
    mat.uniforms.uLightPollution.value = 1
    mat.uniforms.uLpBortle.value = 0.4
    mat.uniforms.uLpIntensity.value = 0.4
    mat.uniforms.uLpMean.value = 0.1
    mat.uniforms.uSunAltitude.value = -20
    mat.uniforms.uEyeElevM.value = 1900
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      logarithmicDepthBuffer: true,
      preserveDrawingBuffer: true,
    })
    renderer.debug.checkShaderErrors = true
    renderer.setSize(256, 256, false)
    renderer.setClearColor(0x000000, 1)
    const camera = new THREE.PerspectiveCamera(90, 1, 0.5, 500_000)
    camera.position.set(0, 0, 0)
    camera.up.set(0, 1, 0)
    camera.lookAt(0, 0.08, -1)
    applyStageProjection(camera, 120)
    const errors = []
    const oldErr = console.error
    console.error = (...args) => {
      errors.push(args.map(String).join(' ').slice(0, 400))
      oldErr.apply(console, args)
    }
    renderer.compile(sky._lpOverlay.scene, sky._lpOverlay.camera)
    renderer.clear()
    skyMod.renderImmersiveLightPollution(sky, renderer, camera)
    console.error = oldErr
    const gl = renderer.getContext()
    const buf = new Uint8Array(256 * 256 * 4)
    gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    let maxR = 0
    let maxG = 0
    let nonzero = 0
    let maxStep = 0
    let hotCount = 0
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i] || buf[i + 1] || buf[i + 2]) nonzero++
      maxR = Math.max(maxR, buf[i])
      maxG = Math.max(maxG, buf[i + 1])
    }
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 255; x++) {
        const r = buf[(y * 256 + x) * 4]
        const r2 = buf[(y * 256 + x + 1) * 4]
        if (r > 25 || r2 > 25) {
          hotCount++
          maxStep = Math.max(maxStep, Math.abs(r2 - r))
        }
      }
    }
    const frag = mat.fragmentShader
    const vert = mat.vertexShader
    sky.lightPollutionMesh.geometry.dispose()
    sky.geometry.dispose()
    mat.dispose()
    sky.material.dispose()
    sky.zodiacalMaterial.dispose()
    sky.lightPollutionProfile.dispose()
    renderer.dispose()
    return {
      anyYellow: maxR > 20 && maxG > 5,
      maxR,
      maxStep,
      hotCount,
      nonzero,
      errors,
      hasScreenRay: frag.includes('lpDirFromScreen'),
      hasFullscreen: vert.includes('position.xy'),
      hasSphereProject: vert.includes('stelProject'),
      depthTest: mat.depthTest,
      depthWrite: mat.depthWrite,
      hasFarDepth: vert.includes('uLpCameraFar'),
      geo: 'PlaneGeometry',
    }
  })
  await browser.close()
  return out
})()

console.log(JSON.stringify(result, null, 2))
if (result.errors?.length) {
  console.error('FAIL: shader errors', result.errors)
  process.exit(1)
}
if (!result.hasScreenRay || !result.hasFullscreen || result.hasSphereProject) {
  console.error('FAIL: expected fullscreen screen-ray LP', result)
  process.exit(1)
}
if (!result.depthTest || result.depthWrite || !result.hasFarDepth) {
  console.error('FAIL: LP must depth-test at far plane (terrain occlusion)', result)
  process.exit(1)
}
if (!result.anyYellow || result.maxR < 40) {
  console.error('FAIL: no visible sodium pixels', result)
  process.exit(1)
}
if (result.hotCount > 20 && result.maxStep > 45) {
  console.error('FAIL: hard tile steps still present', result)
  process.exit(1)
}
console.log('OK: LP GPU smoke — overlay sodium, depth-tested, no hard tile steps')
