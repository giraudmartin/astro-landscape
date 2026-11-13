import * as THREE from 'three'
import type { HorizonTurbulenceSettings } from './horizonTurbulence'

export type SunDiscHandle = {
  root: THREE.Group
  /** Kept for API parity with the Moon — sun disc is not mesh-warped. */
  setTurbulence: (input: { timeSec: number; amount: number }) => void
  setTurbulenceSettings: (settings: HorizonTurbulenceSettings) => void
  /** Photosphere + aureole warm with falling altitude (day → sunset). */
  setAltitudeDeg: (altitudeDeg: number) => void
  faceCamera: (camera: THREE.Camera) => void
  dispose: () => void
}

/**
 * Clean procedural sun: billboard disc + soft aureole.
 * No granulation / Worley — at viewfinder scale those read as jagged “potato” shards.
 */
export function createSunDisc(): SunDiscHandle {
  const root = new THREE.Group()
  // Keep at/under veg/building draw order so depth-tested canopy can occlude us.
  root.renderOrder = 1
  const billboard = new THREE.Group()
  root.add(billboard)

  const glowUniforms = {
    uWarmth: { value: 0 },
    uStrength: { value: 1.0 },
  }
  // Plane covers 3× disc radius; shader r in disc-radius units (|p|=1 = limb).
  const glowMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: glowUniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uWarmth;
      uniform float uStrength;
      varying vec2 vUv;

      void main() {
        vec2 p = (vUv * 2.0 - 1.0) * 1.5;
        float r = length(p);

        float tight = exp(-r * r * 3.2) * mix(0.22, 0.12, uWarmth);
        float wide = exp(-r * r * 1.6) * mix(0.04, 0.18, uWarmth);
        float a = (tight + wide) * uStrength;
        a *= smoothstep(1.48, 1.15, r);
        if (a < 0.002) discard;

        vec3 dayCol = vec3(1.0, 0.82, 0.38);
        vec3 setCol = vec3(1.0, 0.42, 0.1);
        vec3 col = mix(dayCol, setCol, uWarmth);
        gl_FragColor = vec4(col * a, a);
      }
    `,
  })
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), glowMat)
  glow.renderOrder = 0
  billboard.add(glow)

  const discUniforms = {
    uWarmth: { value: 0 },
  }
  const discMat = new THREE.ShaderMaterial({
    fog: false,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    uniforms: discUniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uWarmth;
      varying vec2 vUv;

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float aa = fwidth(r) * 1.5;
        float cover = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
        if (cover < 0.004) discard;

        // Soft radial limb darkening only — no noise, no cells.
        float mu = sqrt(max(0.0, 1.0 - r * r));

        vec3 dayCore = vec3(1.0, 0.88, 0.54);
        vec3 dayLimb = vec3(1.0, 0.72, 0.28);
        vec3 setCore = vec3(1.0, 0.78, 0.28);
        vec3 setLimb = vec3(0.95, 0.32, 0.06);
        vec3 coreCol = mix(dayCore, setCore, uWarmth);
        vec3 limbCol = mix(dayLimb, setLimb, uWarmth);

        float limbT = pow(mu, mix(0.55, 0.4, uWarmth));
        vec3 base = mix(limbCol, coreCol, limbT);
        base += coreCol * exp(-r * r * 4.5) * mix(0.08, 0.05, uWarmth);

        gl_FragColor = vec4(clamp(base, 0.0, 1.0), cover);
      }
    `,
  })
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), discMat)
  disc.renderOrder = 1
  billboard.add(disc)

  /**
   * Map solar altitude → warmth 0 (high day) … 1 (deep sunset / limb).
   * Continuous so scrubbing the day timeline feels photographic.
   */
  const setWarmthFromAltitude = (altitudeDeg: number): void => {
    if (!Number.isFinite(altitudeDeg)) {
      glowUniforms.uWarmth.value = 0
      discUniforms.uWarmth.value = 0
      return
    }
    // ≥18°: cool day. 6→2°: golden. ≤0°: deep orange like the reference.
    let w: number
    if (altitudeDeg >= 18) {
      w = 0
    } else if (altitudeDeg >= 6) {
      w = (1 - (altitudeDeg - 6) / 12) * 0.35
    } else if (altitudeDeg >= 1.5) {
      w = 0.35 + (1 - (altitudeDeg - 1.5) / 4.5) * 0.35
    } else if (altitudeDeg >= -1) {
      w = 0.7 + (1 - (altitudeDeg + 1) / 2.5) * 0.25
    } else {
      w = Math.min(1, 0.95 + (-1 - altitudeDeg) * 0.05)
    }
    glowUniforms.uWarmth.value = w
    discUniforms.uWarmth.value = w
  }

  return {
    root,
    setTurbulence: () => {
      // no-op: mesh shimmer reads as broken facets on the Sun.
    },
    setTurbulenceSettings: () => {
      // no-op
    },
    setAltitudeDeg: setWarmthFromAltitude,
    faceCamera: (camera) => {
      billboard.lookAt(camera.position)
    },
    dispose: () => {
      glow.geometry.dispose()
      glowMat.dispose()
      disc.geometry.dispose()
      discMat.dispose()
    },
  }
}
