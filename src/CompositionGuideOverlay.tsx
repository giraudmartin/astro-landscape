import {
  PHI_INV,
  goldenTriangleFeet,
  type CompositionGuideMode,
} from './compositionGuides'
import type { ViewfinderOrientation } from './lensFov'

type CompositionGuideOverlayProps = {
  mode: CompositionGuideMode
  orientation: ViewfinderOrientation
}

const PHI_A = `${((1 - PHI_INV) * 100).toFixed(3)}%`
const PHI_B = `${(PHI_INV * 100).toFixed(3)}%`

/** Optical FOV composition guides — thirds, Phi, center reticle, golden triangle. */
export function CompositionGuideOverlay({
  mode,
  orientation,
}: CompositionGuideOverlayProps) {
  if (mode === 'off') return null

  if (mode === 'thirds') {
    return (
      <div className="moon-preview-guide moon-preview-guide--thirds" aria-hidden="true">
        <span className="moon-preview-guide__vline" style={{ left: '33.333%' }} />
        <span className="moon-preview-guide__vline" style={{ left: '66.666%' }} />
        <span className="moon-preview-guide__hline" style={{ top: '33.333%' }} />
        <span className="moon-preview-guide__hline" style={{ top: '66.666%' }} />
      </div>
    )
  }

  if (mode === 'phi') {
    return (
      <div className="moon-preview-guide moon-preview-guide--phi" aria-hidden="true">
        <span className="moon-preview-guide__vline" style={{ left: PHI_A }} />
        <span className="moon-preview-guide__vline" style={{ left: PHI_B }} />
        <span className="moon-preview-guide__hline" style={{ top: PHI_A }} />
        <span className="moon-preview-guide__hline" style={{ top: PHI_B }} />
      </div>
    )
  }

  if (mode === 'center') {
    return (
      <div className="moon-preview-guide moon-preview-guide--center" aria-hidden="true">
        <span className="moon-preview-guide__corner is-tl" />
        <span className="moon-preview-guide__corner is-tr" />
        <span className="moon-preview-guide__corner is-bl" />
        <span className="moon-preview-guide__corner is-br" />
        <span className="moon-preview-guide__cross" />
      </div>
    )
  }

  const width = orientation === 'landscape' ? 3 : 2
  const height = orientation === 'landscape' ? 2 : 3
  const feet = goldenTriangleFeet(width, height)

  return (
    <svg
      className="moon-preview-guide moon-preview-guide--golden"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line x1={0} y1={height} x2={width} y2={0} />
      <line x1={0} y1={0} x2={feet.fromTopLeft.x} y2={feet.fromTopLeft.y} />
      <line
        x1={width}
        y1={height}
        x2={feet.fromBottomRight.x}
        y2={feet.fromBottomRight.y}
      />
    </svg>
  )
}
