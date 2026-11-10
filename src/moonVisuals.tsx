/** Ported from Photo Sightline — do not reinvent. */
import { useId } from 'react'
import { illuminatedMoonPath } from './moonPhaseDisc'
import type { LightingBand } from './celestial'

/** Same near-side crop as Photo Sightline. */
const MOON_PHASE_ALBEDO_URL = '/models/moon-albedo.jpg'

/**
 * Atmospheric extinction on the lit face — viewfinder language (cream / amber),
 * not the Overview lighting-chip palette (blue / orange / rose).
 */
const MOON_HORIZON_TINT: Record<
  LightingBand,
  { wash: string; washOpacity: number; gloss: string; glow: string }
> = {
  night: {
    wash: '#f0ece4',
    washOpacity: 0.22,
    gloss: '#f7f4ee',
    glow: '200, 210, 230',
  },
  day: {
    wash: '#e4e6e8',
    washOpacity: 0.3,
    gloss: '#eef0f2',
    glow: '180, 190, 205',
  },
  near_sunset: {
    wash: '#f0c888',
    washOpacity: 0.4,
    gloss: '#ffe6b8',
    glow: '255, 190, 110',
  },
  near_sunrise: {
    wash: '#ecc89a',
    washOpacity: 0.36,
    gloss: '#ffe8cc',
    glow: '255, 200, 150',
  },
}

function svgId(prefix: string, reactId: string): string {
  return `${prefix}-${reactId.replace(/:/g, '')}`
}

export function MoonPhaseDisc({
  illuminationFraction,
  waxing,
  label,
  size = 52,
  lighting = null,
}: {
  illuminationFraction: number
  waxing: boolean
  label: string
  size?: number
  lighting?: LightingBand | null
}) {
  const reactId = useId()
  const discClip = svgId('moon-disc', reactId)
  const litClip = svgId('moon-lit', reactId)
  const shade = svgId('moon-shade', reactId)
  const gloss = svgId('moon-gloss', reactId)
  const k = Math.min(1, Math.max(0, illuminationFraction))
  const lit = illuminatedMoonPath(12, 12, 10, k, waxing)
  const glossCx = waxing ? '62%' : '38%'
  const tint = MOON_HORIZON_TINT[lighting ?? 'night']
  const shine = Math.pow(k, 1.35)
  const glossPeak = 0.52 * shine
  const glossMid = 0.18 * shine
  const washOpacity = tint.washOpacity * (0.45 + 0.55 * k)
  const glowAlpha = 0.06 + 0.26 * shine
  const glowBlur = 3 + 5 * shine

  return (
    <svg
      className="moon-phase-disc"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      style={{
        filter: `drop-shadow(0 0 ${glowBlur.toFixed(1)}px rgba(${tint.glow}, ${glowAlpha.toFixed(3)}))`,
      }}
    >
      <defs>
        <clipPath id={discClip}>
          <circle cx="12" cy="12" r="10" />
        </clipPath>
        {lit ? (
          <clipPath id={litClip}>
            <path d={lit} />
          </clipPath>
        ) : null}
        <radialGradient id={shade} cx="36%" cy="30%" r="68%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.08 + 0.14 * shine} />
          <stop offset="48%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.4" />
        </radialGradient>
        <radialGradient id={gloss} cx={glossCx} cy="34%" r="42%">
          <stop offset="0%" stopColor={tint.gloss} stopOpacity={glossPeak} />
          <stop offset="35%" stopColor={tint.gloss} stopOpacity={glossMid} />
          <stop offset="100%" stopColor={tint.gloss} stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="12" cy="12" r="10" fill="#0b0f16" />
      <g clipPath={`url(#${discClip})`}>
        <image
          href={MOON_PHASE_ALBEDO_URL}
          x="2"
          y="2"
          width="20"
          height="20"
          preserveAspectRatio="xMidYMid slice"
          opacity="0.34"
        />
        <rect x="2" y="2" width="20" height="20" fill="#121826" opacity="0.62" />
      </g>

      {lit ? (
        <g clipPath={`url(#${litClip})`}>
          <image
            href={MOON_PHASE_ALBEDO_URL}
            x="2"
            y="2"
            width="20"
            height="20"
            preserveAspectRatio="xMidYMid slice"
          />
          <rect
            x="2"
            y="2"
            width="20"
            height="20"
            fill={tint.wash}
            opacity={washOpacity}
          />
          {shine > 0.02 ? (
            <circle cx="12" cy="12" r="10" fill={`url(#${gloss})`} />
          ) : null}
        </g>
      ) : null}

      <circle cx="12" cy="12" r="10" fill={`url(#${shade})`} />
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke={`rgba(${tint.glow}, ${0.12 + 0.18 * shine})`}
        strokeWidth="0.55"
      />
    </svg>
  )
}
