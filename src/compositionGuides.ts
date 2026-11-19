export type CompositionGuideMode =
  | 'off'
  | 'thirds'
  | 'phi'
  | 'center'
  | 'golden'

export const COMPOSITION_GUIDE_CYCLE: readonly CompositionGuideMode[] = [
  'off',
  'thirds',
  'phi',
  'center',
  'golden',
] as const

export const COMPOSITION_GUIDE_LABEL: Record<CompositionGuideMode, string> = {
  off: 'Aucune grille',
  thirds: 'Grille 3×3',
  phi: 'Grille Phi',
  center: 'Centrage',
  golden: 'Triangle d’or',
}

/** φ⁻¹ ≈ 0.618 — Phi grid lines sit at 1−φ⁻¹ and φ⁻¹. */
export const PHI_INV = (Math.sqrt(5) - 1) / 2

export function nextCompositionGuideMode(
  mode: CompositionGuideMode,
): CompositionGuideMode {
  const i = COMPOSITION_GUIDE_CYCLE.indexOf(mode)
  return COMPOSITION_GUIDE_CYCLE[(i + 1) % COMPOSITION_GUIDE_CYCLE.length]!
}

export function normalizeCompositionGuideMode(
  value: unknown,
): CompositionGuideMode {
  if (
    value === 'off' ||
    value === 'thirds' ||
    value === 'phi' ||
    value === 'center' ||
    value === 'golden'
  ) {
    return value
  }
  return 'off'
}

/** Foot of perpendicular from corner onto diagonal BL→TR in a W×H frame. */
export function goldenTriangleFeet(
  width: number,
  height: number,
): { fromTopLeft: { x: number; y: number }; fromBottomRight: { x: number; y: number } } {
  const den = width * width + height * height
  return {
    fromTopLeft: {
      x: (width * height * height) / den,
      y: (width * width * height) / den,
    },
    fromBottomRight: {
      x: (width * width * width) / den,
      y: (height * height * height) / den,
    },
  }
}
