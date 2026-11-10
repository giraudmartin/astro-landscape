/** Icons copied from Photo Sightline — reuse, do not reinvent. */

type IconProps = {
  size?: number
  className?: string
}

export function CalendarIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="2.5"
        y="3.5"
        width="11"
        height="10"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ChevronLeftIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
    >
      <path
        d="M10 3.5 5.5 8 10 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ChevronRightIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
    >
      <path
        d="M6 3.5 10.5 8 6 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Photo Sightline viewfinder — Milky Way toggle. */
export function MilkyWayIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2.5 11.5c1.6-2.4 3.2-3.6 5.5-3.6s3.9 1.2 5.5 3.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="4.2" cy="5.2" r="0.9" fill="currentColor" />
      <circle cx="8" cy="3.4" r="1.1" fill="currentColor" />
      <circle cx="11.8" cy="5.5" r="0.8" fill="currentColor" />
    </svg>
  )
}

/** Photo Sightline viewfinder — constellation figures. */
export function ConstellationsIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="3.5" cy="11" r="1" fill="currentColor" />
      <circle cx="7.5" cy="4" r="1" fill="currentColor" />
      <circle cx="12.5" cy="7" r="1" fill="currentColor" />
      <path
        d="M3.5 11L7.5 4L12.5 7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Photo Sightline viewfinder — RA/Dec grid. */
export function RaDecGridIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M2.5 8H13.5M8 2.5V13.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

/** Photo Sightline viewfinder — atmosphere / sky dome toggle. */
export function AtmosphereIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2.5 11.5c1.2-3.2 3.2-5 5.5-5s4.3 1.8 5.5 5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M4 9.2c.9-1.8 2.1-2.7 4-2.7s3.1.9 4 2.7"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        opacity="0.55"
      />
      <circle cx="8" cy="5.2" r="1.15" fill="currentColor" />
    </svg>
  )
}

/** Horizon alt/az grid (local ENU) — companion to RA/Dec. */
export function AzimuthGridIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2.6" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M8 2.5V13.5M2.5 8H13.5M4.2 4.2l7.6 7.6M11.8 4.2 4.2 11.8"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  )
}
