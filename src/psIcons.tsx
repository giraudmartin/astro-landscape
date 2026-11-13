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

/** Lucide calendar-clock — collapsed timeline restore control. */
export function CalendarClockIcon({ size, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path d="M16 14v2.2l1.6 1" />
      <path d="M16 2v3" />
      <path d="M21 7.338V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h2.338" />
      <path d="M3 9h5.859" />
      <path d="M8 2v3" />
      <circle cx="16" cy="16" r="6" />
    </svg>
  )
}

export function ChevronDownIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M3.5 6 8 10.5 12.5 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
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

/** Stage projection — stereographic (wide curved field). */
export function ProjectionStereoIcon({ size = 16, className }: IconProps) {
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
        d="M2.5 11.5c1.5-4.2 3.6-6.5 5.5-6.5s4 2.3 5.5 6.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M4 9.2c1-2.1 2.2-3.2 4-3.2s3 1.1 4 3.2"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        opacity="0.55"
      />
      <circle cx="8" cy="4.2" r="1" fill="currentColor" />
    </svg>
  )
}

/** Stage projection — equirectangular unwrap. */
export function ProjectionEquirectIcon({ size = 16, className }: IconProps) {
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
        x="2.25"
        y="4.25"
        width="11.5"
        height="7.5"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M5.2 4.4c.7 1.2.7 5.8 0 7.2M10.8 4.4c-.7 1.2-.7 5.8 0 7.2M2.4 8h11.2"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Stage projection — rectilinear / perspective frustum. */
export function ProjectionRectilinearIcon({
  size = 16,
  className,
}: IconProps) {
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
        d="M8 3.2 3.2 12.5h9.6L8 3.2Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M5.6 8.8h4.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.65"
      />
    </svg>
  )
}

/** Stage projection — orthographic hemisphere disk. */
export function ProjectionOrthoIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="8" r="5.4" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2.6 8h10.8M8 2.6v10.8"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M3.8 5.2c1.2 1 2.6 1.5 4.2 1.5s3-.5 4.2-1.5"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Frame overlay mode — no viewfinder rectangle. */
export function FrameModeOffIcon({ size = 14, className }: IconProps) {
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
        x="3.25"
        y="4.25"
        width="9.5"
        height="7.5"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.3"
        opacity="0.45"
      />
      <path
        d="M3 12.5 13 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Frame overlay mode — single DSLR optical frame. */
export function FrameModeDslrIcon({ size = 14, className }: IconProps) {
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
        x="2.75"
        y="4.25"
        width="10.5"
        height="7.5"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M8 4.3v7.4M2.9 8h10.2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  )
}

/** Capsule frame mode — Libre (eye / field of view). From validated prototype. */
export function FrameModeLibreIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="3"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  )
}

/** Capsule frame mode — Photo (open corners). From validated prototype. */
export function FrameModePhotoIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  )
}

/** Capsule frame mode — Pano band. From validated prototype. */
export function FrameModePanoIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2 5q10 4 20 0v14q-10-4-20 0zM8 7v10M16 7v10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Capsule — camera body for the gear summary. */
export function CameraBodyIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="3"
        y="6"
        width="18"
        height="14"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="m8 6 2-3h4l2 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="13"
        r="4"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  )
}

/** Capsule — panorama settings (sliders). */
export function SettingsSlidersIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M4 7h16M4 17h16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle
        cx="9"
        cy="7"
        r="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle
        cx="15"
        cy="17"
        r="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  )
}

/** Capsule — Timelapse / timeline clock. */
export function TimelapseIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle
        cx="12"
        cy="14"
        r="8"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M12 10v4l3 2M9 2h6M12 2v4M19 6l2-2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Timelapse panel — play / preview sequence. */
export function PlaySequenceIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 8.5v7l6-3.5-6-3.5z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Timelapse preview — stop square. */
export function StopSequenceIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <rect
        x="8.5"
        y="8.5"
        width="7"
        height="7"
        rx="1"
        fill="currentColor"
      />
    </svg>
  )
}

/** Timelapse preview — pause. */
export function PauseSequenceIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <rect x="8.5" y="8" width="2.4" height="8" rx="0.6" fill="currentColor" />
      <rect x="13.1" y="8" width="2.4" height="8" rx="0.6" fill="currentColor" />
    </svg>
  )
}

/** Viewfinder dock — lens / framing. */
export function CameraLensIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="8" r="5.2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" />
    </svg>
  )
}

/** Viewfinder dock — panorama grid. */
export function PanoramaGridIcon({ size = 14, className }: IconProps) {
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
        x="2.25"
        y="4.25"
        width="11.5"
        height="7.5"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M6.5 4.3v7.4M9.5 4.3v7.4M2.4 8h11.2"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Viewfinder dock — render diagnostic. */
export function RenderDiagIcon({ size = 14, className }: IconProps) {
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
        d="M3.2 11.2 7.1 3.8a1 1 0 0 1 1.8 0l3.9 7.4a1 1 0 0 1-.9 1.5H4.1a1 1 0 0 1-.9-1.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M8 6.4v2.6"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11" r="0.75" fill="currentColor" />
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
