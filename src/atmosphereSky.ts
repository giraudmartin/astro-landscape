/**
 * Real-time sky: Rayleigh + Mie by day; twilight uses a hybrid that keeps a
 * cool zenith (single-scatter alone paints the whole sky pink after sunset).
 * Thin Belt of Venus + Earth's shadow on the anti-solar horizon only.
 */

export type Vec3 = readonly [number, number, number]

export const BETA_RAYLEIGH: Vec3 = [5.8e-6, 13.5e-6, 33.1e-6]
export const BETA_MIE: Vec3 = [21e-6, 21e-6, 21e-6]
export const MIE_G = 0.76
export const RAYLEIGH_HEIGHT = 8_400
export const MIE_HEIGHT = 1_200

const SUN_RADIANCE: Vec3 = [20.0, 18.5, 16.0]

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
}

function mul3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function mix3(a: Vec3, b: Vec3, t: number): Vec3 {
  const u = clamp01(t)
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ]
}

function luminance(rgb: Vec3): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

export function opticalAirMass(cosElev: number): number {
  const c = clamp(cosElev, 0.0, 1.0)
  return (
    1.0 /
    (c +
      0.15 *
        Math.pow(
          Math.max(0.001, 93.885 - (Math.acos(c) * 180) / Math.PI),
          -1.253,
        ))
  )
}

export function rayleighPhase(cosTheta: number): number {
  return 0.75 * (1 + cosTheta * cosTheta)
}

export function miePhase(cosTheta: number, g = MIE_G): number {
  const g2 = g * g
  const num = (1 - g2) * (1 + cosTheta * cosTheta)
  const den = (2 + g2) * Math.pow(1 + g2 - 2 * g * cosTheta, 1.5)
  return 1.5 * (num / Math.max(den, 1e-6))
}

function transmittance(beta: Vec3, height: number, mass: number): Vec3 {
  return [
    Math.exp(-beta[0] * height * mass),
    Math.exp(-beta[1] * height * mass),
    Math.exp(-beta[2] * height * mass),
  ]
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / Math.max(e1 - e0, 1e-6))
  return t * t * (3 - 2 * t)
}

function antiSunWeight(view: Vec3, sun: Vec3): number {
  const vh = normalize3([view[0], 0, view[2]])
  const sh = normalize3([sun[0], 0, sun[2]])
  const toward = clamp(dot3(vh, sh) * 0.5 + 0.5, 0, 1)
  return Math.pow(1 - toward, 1.6)
}

function towardSunWeight(view: Vec3, sun: Vec3): number {
  const vh = normalize3([view[0], 0, view[2]])
  const sh = normalize3([sun[0], 0, sun[2]])
  return clamp(dot3(vh, sh) * 0.5 + 0.5, 0, 1)
}

/**
 * Twilight envelope — belt peaks in deep civil twilight, gone by nautical.
 */
export function twilightEnvelope(sunAltDeg: number): {
  dayFactor: number
  /** 0…1 strength of anti-solar belt / shadow (peaks ~−2°…−4°). */
  beltFactor: number
  /** How much cool zenith replaces reddened single-scatter. */
  coolZenith: number
} {
  if (sunAltDeg >= 6) return { dayFactor: 1, beltFactor: 0, coolZenith: 0 }
  if (sunAltDeg >= 0) {
    // Golden hour — continuous with civil at 0° (no one-minute sky jump).
    const t = clamp01((6 - sunAltDeg) / 6) // 0 @ +6° → 1 @ 0°
    const midPeak = Math.sin(t * Math.PI) // extra cool mid-hour, 0 at both ends
    return {
      dayFactor: 1,
      beltFactor: t * 0.15,
      coolZenith: t * 0.25 + midPeak * 0.35,
    }
  }
  if (sunAltDeg >= -4) {
    // Civil twilight — belt peaks, cool zenith rises (matches golden at 0°).
    const t = clamp01(-sunAltDeg / 4)
    return {
      dayFactor: 1 - t * 0.25,
      beltFactor: 0.15 + t * 0.85,
      coolZenith: 0.25 + t * 0.55,
    }
  }
  if (sunAltDeg >= -8) {
    // Blue hour — belt fades, cool indigo dominates (no pink fill).
    const t = clamp01((-sunAltDeg - 4) / 4)
    return {
      dayFactor: 0.75 * (1 - t * 0.45),
      beltFactor: 1 - t,
      coolZenith: 0.8 + t * 0.15,
    }
  }
  if (sunAltDeg >= -12) {
    const t = clamp01((-sunAltDeg - 8) / 4)
    return {
      dayFactor: 0.4 * (1 - t * 0.7),
      beltFactor: 0,
      coolZenith: 0.95,
    }
  }
  if (sunAltDeg >= -18) {
    const t = clamp01((-sunAltDeg - 12) / 6)
    return {
      dayFactor: 0.12 * (1 - t),
      beltFactor: 0,
      coolZenith: 1,
    }
  }
  return { dayFactor: 0.02, beltFactor: 0, coolZenith: 1 }
}

export function atmosphereRadiance(viewDir: Vec3, sunDir: Vec3): Vec3 {
  const v = normalize3(viewDir)
  const s = normalize3(sunDir)
  const viewCos = clamp(v[1], 0.002, 1)
  const sunCos = s[1]
  const cosTheta = clamp(dot3(v, s), -1, 1)
  const elevN = clamp(v[1], 0, 1)

  const mView = opticalAirMass(viewCos)
  const mSun =
    sunCos > 0.002
      ? opticalAirMass(clamp(sunCos, 0.002, 1))
      : opticalAirMass(0.002) + -sunCos * 22

  const tSunR = transmittance(BETA_RAYLEIGH, RAYLEIGH_HEIGHT, mSun)
  const tSunM = transmittance(BETA_MIE, MIE_HEIGHT, mSun)
  const sunIrr: Vec3 = [
    SUN_RADIANCE[0] * tSunR[0] * tSunM[0],
    SUN_RADIANCE[1] * tSunR[1] * tSunM[1],
    SUN_RADIANCE[2] * tSunR[2] * tSunM[2],
  ]

  const phaseR = rayleighPhase(cosTheta)
  const phaseM = miePhase(cosTheta)
  const tViewR = transmittance(BETA_RAYLEIGH, RAYLEIGH_HEIGHT, mView)
  const tViewM = transmittance(BETA_MIE, MIE_HEIGHT, mView)

  const scatterR: Vec3 = [
    sunIrr[0] * phaseR * (1 - tViewR[0]),
    sunIrr[1] * phaseR * (1 - tViewR[1]),
    sunIrr[2] * phaseR * (1 - tViewR[2]),
  ]
  // Soft Mie — avoid flat mustard blowout on the solar limb.
  const mieAmt = 0.08 * (0.35 + 0.65 * smoothstep(0.2, 0.95, cosTheta))
  const scatterM: Vec3 = [
    sunIrr[0] * phaseM * (1 - tViewM[0]) * mieAmt,
    sunIrr[1] * phaseM * (1 - tViewM[1]) * mieAmt,
    sunIrr[2] * phaseM * (1 - tViewM[2]) * mieAmt,
  ]

  let rgb = add3(scatterR, scatterM)

  const sunAltDeg = (Math.asin(clamp(sunCos, -1, 1)) * 180) / Math.PI
  const tw = twilightEnvelope(sunAltDeg)
  rgb = mul3(rgb, tw.dayFactor)

  const toward = towardSunWeight(v, s)
  const anti = antiSunWeight(v, s)

  // Cool zenith stand-in — kills full-sky mustard / pink (smooth across sunset).
  if (tw.coolZenith > 0.01) {
    // Blend day-blue → dusk-indigo over ±2° so 19:38→19:39 stays continuous.
    const nightAmt = smoothstep(2, -2, sunAltDeg)
    const zenithCool = mix3([0.22, 0.42, 0.82], [0.06, 0.1, 0.28], nightAmt)
    const midCool = mix3([0.45, 0.48, 0.58], [0.12, 0.16, 0.32], nightAmt)
    const cool = mix3(midCool, zenithCool, smoothstep(0.08, 0.65, elevN))
    const keepWarm = toward * toward * (1 - smoothstep(0.0, 0.32, elevN))
    const coolAmt = tw.coolZenith * (1 - keepWarm * 0.9)
    rgb = mix3(rgb, cool, coolAmt)
  }

  // Solar horizon glow (thin, warm) — not a full-frame yellow slab.
  if (sunAltDeg > -8 && sunAltDeg < 8) {
    const sunGlow =
      toward *
      toward *
      (1 - smoothstep(0.0, 0.22, elevN)) *
      clamp01(1 - Math.abs(sunAltDeg) / 8)
    const glowCol: Vec3 = [
      Math.min(sunIrr[0] * 0.45, 2.2),
      Math.min(sunIrr[1] * 0.22, 1.1),
      Math.min(sunIrr[2] * 0.08, 0.45),
    ]
    rgb = add3(rgb, mul3(glowCol, sunGlow * 0.55))
  }

  // Earth's shadow + thin Belt of Venus (anti-sun only, civil twilight).
  if (tw.beltFactor > 0.02 && sunAltDeg < 0.5 && sunAltDeg > -8) {
    const depression = Math.max(-sunAltDeg, 0.3)
    // Shadow fills ~0 → depression°; belt is a ~4–8° thin arch above it.
    const shadowTop = Math.sin((depression * Math.PI) / 180)
    const beltLo = shadowTop + 0.02
    const beltHi = shadowTop + 0.1
    const beltFade = shadowTop + 0.18

    const inShadow =
      anti * (1 - smoothstep(0, Math.max(shadowTop, 0.03), elevN)) * tw.beltFactor
    const shadowCol: Vec3 = [0.05, 0.07, 0.16]
    rgb = mix3(rgb, shadowCol, inShadow * 0.85)

    // Thin pink arch — mix, never additive flood.
    const beltBand =
      anti *
      smoothstep(beltLo, beltHi, elevN) *
      (1 - smoothstep(beltHi, beltFade, elevN)) *
      tw.beltFactor
    const beltCol: Vec3 = [0.55, 0.28, 0.38]
    rgb = mix3(rgb, beltCol, beltBand * 0.55)
  }

  // Night airglow — cool only, no pink.
  if (sunAltDeg < -10) {
    const night = clamp01((-sunAltDeg - 10) / 8)
    const glow: Vec3 = [0.02, 0.03, 0.07]
    rgb = mix3(rgb, glow, night * (0.5 + 0.5 * elevN))
  }

  if (v[1] < 0) {
    rgb = mul3(rgb, clamp01(1 + v[1] * 4))
  }

  // Soft highlight clamp — prevents flat yellow slabs.
  const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-6)
  if (peak > 3.5) {
    rgb = mul3(rgb, 3.5 / peak)
  }

  return rgb
}

export function toneMapSky(rgb: Vec3, exposure = 1): string {
  const mapped = rgb.map((c) => {
    const x = Math.max(0, c * exposure)
    const y = x / (1 + 0.85 * x)
    return Math.round(clamp01(Math.pow(y, 1 / 2.2)) * 255)
  }) as [number, number, number]
  return `#${mapped.map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

export function toneMapSkyRgb(rgb: Vec3, exposure = 1): number {
  const mapped = rgb.map((c) => {
    const x = Math.max(0, c * exposure)
    const y = x / (1 + 0.85 * x)
    return Math.round(clamp01(Math.pow(y, 1 / 2.2)) * 255)
  })
  return (mapped[0]! << 16) | (mapped[1]! << 8) | mapped[2]!
}

export function sunDirectionFromAltAz(
  altitudeDeg: number,
  azimuthDeg: number,
): Vec3 {
  const alt = (altitudeDeg * Math.PI) / 180
  const az = (azimuthDeg * Math.PI) / 180
  return normalize3([
    Math.sin(az) * Math.cos(alt),
    Math.sin(alt),
    Math.cos(az) * Math.cos(alt),
  ])
}

export function autoExposure(sunAltitudeDeg: number, zenith: Vec3): number {
  let target: number
  if (sunAltitudeDeg >= 8) {
    target = 1.0
  } else if (sunAltitudeDeg >= 0) {
    // 0.62 @ +6° → 0.55 @ 0° (continuous with civil)
    target = 0.62 - 0.07 * clamp01((6 - sunAltitudeDeg) / 6)
  } else if (sunAltitudeDeg >= -6) {
    // 0.55 @ 0° → 0.5 @ −6°
    target = 0.55 - 0.05 * clamp01(-sunAltitudeDeg / 6)
  } else {
    target = 0.35
  }
  const lum = Math.max(luminance(zenith), 0.05)
  return clamp(target / lum, 0.25, 1.8)
}

export function sampleAtmospherePalette(sunAltitudeDeg: number): {
  zenith: string
  horizonSun: string
  horizonAnti: string
  belt: string
  earthShadow: string
  clear: number
  fog: number
  exposure: number
} {
  const sun = sunDirectionFromAltAz(sunAltitudeDeg, 270)
  const zenithRgb = atmosphereRadiance([0, 1, 0], sun)
  const exposure = autoExposure(sunAltitudeDeg, zenithRgb)

  const sunHoriz = normalize3([sun[0], 0.04, sun[2]])
  const antiLow = normalize3([-sun[0], 0.02, -sun[2]])
  const beltDir = normalize3([-sun[0], 0.12, -sun[2]])
  const shadowDir = normalize3([-sun[0], 0.012, -sun[2]])

  const horizonSun = atmosphereRadiance(sunHoriz, sun)
  const horizonAnti = atmosphereRadiance(antiLow, sun)
  const belt = atmosphereRadiance(beltDir, sun)
  const earthShadow = atmosphereRadiance(shadowDir, sun)

  return {
    zenith: toneMapSky(zenithRgb, exposure),
    horizonSun: toneMapSky(horizonSun, exposure),
    horizonAnti: toneMapSky(horizonAnti, exposure),
    belt: toneMapSky(belt, exposure),
    earthShadow: toneMapSky(earthShadow, exposure),
    clear: toneMapSkyRgb(zenithRgb, exposure),
    fog: toneMapSkyRgb(mix3(horizonSun, zenithRgb, 0.55), exposure),
    exposure,
  }
}
