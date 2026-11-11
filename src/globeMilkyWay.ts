/**
 * Decorative NASA milky-way + star skybox behind the MapLibre globe.
 * Baked z1 cover (4k) — not the immersive tiled LOD dome.
 */
import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MaplibreMap,
} from 'maplibre-gl'
import * as THREE from 'three'
import { groundViewAmount } from './applyMapSky'
import {
  celestialStarBrightness,
  celestialStarHalo,
  celestialStarSizePx,
  j2000ToNasaMapDirection,
} from './celestialVectors'
import {
  DEFAULT_GLOBE_SPACE_SETTINGS,
  GLOBE_SPACE_STAR_MAX,
  type GlobeSpaceSettings,
} from './globeSpaceSettings'
import { HYG_BRIGHT_STARS } from './hygBrightStars'

export const GLOBE_MILKY_WAY_LAYER_ID = 'astro-globe-milky-way'
export const GLOBE_MILKY_WAY_URL = '/sky/milkyway_globe.webp'

type GlobeMilkyWayLayer = CustomLayerInterface

let activeLayer: GlobeMilkyWayLayer | null = null

function starColorFromBv(ci: number | null | undefined): [number, number, number] {
  if (ci == null || !Number.isFinite(ci)) return [0.9, 0.94, 1]
  const bv = THREE.MathUtils.clamp(ci, -0.4, 2)
  const kelvin = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))
  const temperature = THREE.MathUtils.clamp(kelvin / 100, 10, 400)
  const red =
    temperature <= 66
      ? 1
      : THREE.MathUtils.clamp(
          1.292936186 * (temperature - 60) ** -0.1332047592,
          0,
          1,
        )
  const green =
    temperature <= 66
      ? THREE.MathUtils.clamp(
          0.3900815788 * Math.log(temperature) - 0.6318414438,
          0,
          1,
        )
      : THREE.MathUtils.clamp(
          1.129890861 * (temperature - 60) ** -0.0755148492,
          0,
          1,
        )
  const blue =
    temperature >= 66
      ? 1
      : temperature <= 19
        ? 0
        : THREE.MathUtils.clamp(
            0.5432067891 * Math.log(temperature - 10) - 1.1962540891,
            0,
            1,
          )
  return [red, green, blue]
}

/** Brightest N HYG stars in the NASA map frame (aligned with the VL bake). */
function buildStarGeometry(count: number): THREE.BufferGeometry {
  const n = Math.min(
    Math.max(1, Math.round(count)),
    GLOBE_SPACE_STAR_MAX,
    HYG_BRIGHT_STARS.length,
  )
  const positions = new Float32Array(n * 3)
  const sizes = new Float32Array(n)
  const brightness = new Float32Array(n)
  const halos = new Float32Array(n)
  const colors = new Float32Array(n * 3)
  const dir = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    const star = HYG_BRIGHT_STARS[i]!
    dir.copy(j2000ToNasaMapDirection(star.raHours, star.decDeg))
    const i3 = i * 3
    positions[i3] = dir.x
    positions[i3 + 1] = dir.y
    positions[i3 + 2] = dir.z
    sizes[i] = celestialStarSizePx(star.mag)
    brightness[i] = celestialStarBrightness(star.mag)
    halos[i] = celestialStarHalo(star.mag)
    const [r, g, b] = starColorFromBv(star.ci)
    colors[i3] = Math.min(1, r * 1.1 + 0.08)
    colors[i3 + 1] = Math.min(1, g * 1.1 + 0.08)
    colors[i3 + 2] = Math.min(1, b * 1.1 + 0.1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1))
  geo.setAttribute('aBrightness', new THREE.Float32BufferAttribute(brightness, 1))
  geo.setAttribute('aHalo', new THREE.Float32BufferAttribute(halos, 1))
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3))
  return geo
}

export function createGlobeMilkyWayLayer(
  textureUrl = GLOBE_MILKY_WAY_URL,
): GlobeMilkyWayLayer {
  let map: MaplibreMap | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let camera: THREE.Camera | null = null
  let milkyMaterial: THREE.ShaderMaterial | null = null
  let starMaterial: THREE.ShaderMaterial | null = null
  let starPoints: THREE.Points | null = null
  let texture: THREE.Texture | null = null
  let zoomFade = 1
  let params: GlobeSpaceSettings = { ...DEFAULT_GLOBE_SPACE_SETTINGS }

  const syncZoomFade = () => {
    if (!map) return
    zoomFade = 1 - groundViewAmount(map.getZoom())
    pushUniforms()
  }

  const pushUniforms = () => {
    const live = params.enabled ? zoomFade * params.opacity : 0
    if (milkyMaterial) {
      milkyMaterial.uniforms.uBrightness.value = params.brightness
      milkyMaterial.uniforms.uContrast.value = params.contrast
      milkyMaterial.uniforms.uSaturation.value = params.saturation
      milkyMaterial.uniforms.uFade.value = params.showMilkyWay ? live : 0
      milkyMaterial.visible = params.enabled && params.showMilkyWay && live > 0.001
    }
    if (starMaterial) {
      starMaterial.uniforms.uBrightness.value = params.starBrightness
      starMaterial.uniforms.uSize.value = params.starSize
      starMaterial.uniforms.uFade.value = params.showStars ? live : 0
    }
    if (starPoints) {
      starPoints.visible =
        params.enabled && params.showStars && live > 0.001
    }
  }

  const rebuildStars = (count: number) => {
    if (!scene) return
    if (starPoints) {
      scene.remove(starPoints)
      starPoints.geometry.dispose()
      starPoints = null
    }
    if (!starMaterial) return
    const geo = buildStarGeometry(count)
    starPoints = new THREE.Points(geo, starMaterial)
    starPoints.frustumCulled = false
    scene.add(starPoints)
    pushUniforms()
  }

  const layer: GlobeMilkyWayLayer = {
    id: GLOBE_MILKY_WAY_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',

    onAdd(nextMap, gl) {
      map = nextMap
      scene = new THREE.Scene()
      camera = new THREE.Camera()

      milkyMaterial = new THREE.ShaderMaterial({
        uniforms: {
          tSky: { value: null },
          uBrightness: { value: params.brightness },
          uContrast: { value: params.contrast },
          uSaturation: { value: params.saturation },
          uFade: { value: 1 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            vec4 clipPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            clipPos.z = clipPos.w * 0.99999;
            gl_Position = clipPos;
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform sampler2D tSky;
          uniform float uBrightness;
          uniform float uContrast;
          uniform float uSaturation;
          uniform float uFade;
          varying vec3 vDir;
          // NASA SVS equirect in the same frame as j2000ToNasaMapDirection:
          // 0h RA at center, RA increases left, NCP at top.
          vec2 nasaEquirectUv(vec3 dir) {
            vec3 d = normalize(dir);
            float ra = atan(-d.z, d.x);
            float dec = asin(clamp(d.y, -1.0, 1.0));
            float u = fract(0.5 - ra / (2.0 * 3.14159265));
            float v = 0.5 - dec / 3.14159265;
            return vec2(u, v);
          }
          void main() {
            if (uFade <= 0.001) discard;
            vec3 color = texture2D(tSky, nasaEquirectUv(vDir)).rgb;
            color *= uBrightness;
            color = (color - 0.5) * uContrast + 0.5;
            float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
            color = mix(vec3(luma), color, uSaturation);
            color = max(color, vec3(0.0)) * uFade;
            gl_FragColor = vec4(color, 1.0);
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
      })

      const milkyMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 96, 48),
        milkyMaterial,
      )
      milkyMesh.frustumCulled = false
      scene.add(milkyMesh)

      starMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uBrightness: { value: params.starBrightness },
          uSize: { value: params.starSize },
          uFade: { value: 1 },
          uPixelRatio: {
            value:
              typeof window !== 'undefined'
                ? Math.min(window.devicePixelRatio || 1, 2)
                : 1,
          },
          uMaxPointSize: { value: 64 },
        },
        vertexShader: /* glsl */ `
          attribute float aSize;
          attribute float aBrightness;
          attribute float aHalo;
          attribute vec3 aColor;
          uniform float uSize;
          uniform float uFade;
          uniform float uPixelRatio;
          uniform float uMaxPointSize;
          varying vec3 vColor;
          varying float vBrightness;
          varying float vHalo;
          void main() {
            vColor = aColor;
            vBrightness = aBrightness * uFade;
            vHalo = aHalo;
            vec4 clipPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            clipPos.z = clipPos.w * 0.99999;
            gl_Position = clipPos;
            // Fixed CSS-px sizing (MapLibre w is useless for skybox attenuation).
            float r = aSize * uSize * uPixelRatio;
            gl_PointSize = clamp(max(r, 2.8), 2.8, uMaxPointSize);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform float uBrightness;
          varying vec3 vColor;
          varying float vBrightness;
          varying float vHalo;
          void main() {
            if (vBrightness < 0.03) discard;
            vec2 p = gl_PointCoord * 2.0 - 1.0;
            float r2 = dot(p, p);
            if (r2 > 1.0) discard;
            // Same soft PSF as immersive HYG stars: tight core + wide halo.
            float core = exp(-r2 * 11.0);
            float halo = exp(-r2 * mix(3.2, 1.15, vHalo)) * mix(0.12, 0.55, vHalo);
            float energy = (core + halo) * vBrightness * uBrightness;
            gl_FragColor = vec4(vColor * energy, energy);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
      })

      rebuildStars(params.starCount)

      new THREE.TextureLoader().load(textureUrl, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        // nasaEquirectUv expects file top = NCP at v=0 (same as immersive tiles).
        tex.flipY = false
        tex.wrapS = THREE.RepeatWrapping
        tex.wrapT = THREE.ClampToEdgeWrapping
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.anisotropy = 8
        tex.generateMipmaps = true
        tex.needsUpdate = true
        texture = tex
        if (milkyMaterial) {
          milkyMaterial.uniforms.tSky.value = tex
          milkyMaterial.needsUpdate = true
        }
        map?.triggerRepaint()
      })

      renderer = new THREE.WebGLRenderer({
        canvas: nextMap.getCanvas(),
        context: gl,
      })
      renderer.autoClear = false

      syncZoomFade()
      pushUniforms()
      nextMap.on('zoom', syncZoomFade)
      nextMap.on('zoomend', syncZoomFade)
    },

    render(_gl, options: CustomRenderMethodInput) {
      if (!renderer || !scene || !camera) return
      if (!params.enabled || zoomFade * params.opacity <= 0.001) return

      const P = new THREE.Matrix4().fromArray(
        options.projectionMatrix as unknown as number[],
      )
      const MVP = new THREE.Matrix4().fromArray(
        options.modelViewProjectionMatrix as unknown as number[],
      )
      const MV = new THREE.Matrix4().copy(P).invert().multiply(MVP)
      MV.elements[12] = 0
      MV.elements[13] = 0
      MV.elements[14] = 0
      camera.projectionMatrix.multiplyMatrices(P, MV)

      renderer.resetState()
      renderer.render(scene, camera)
      renderer.resetState()
    },

    onRemove(nextMap) {
      nextMap.off('zoom', syncZoomFade)
      nextMap.off('zoomend', syncZoomFade)
      scene?.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
          obj.geometry.dispose()
        }
      })
      milkyMaterial?.dispose()
      milkyMaterial = null
      starMaterial?.dispose()
      starMaterial = null
      starPoints = null
      texture?.dispose()
      texture = null
      renderer?.dispose()
      renderer = null
      scene = null
      camera = null
      map = null
      if (activeLayer === layer) activeLayer = null
    },
  }

  activeLayer = layer
  return layer
}

export function ensureGlobeMilkyWayLayer(map: MaplibreMap): void {
  if (map.getLayer(GLOBE_MILKY_WAY_LAYER_ID)) return
  const layer = createGlobeMilkyWayLayer()
  if (map.getLayer('imagery')) {
    map.addLayer(layer, 'imagery')
  } else {
    map.addLayer(layer)
  }
  if (map.getLayer('background')) {
    map.setPaintProperty('background', 'background-opacity', 0)
  }
}
