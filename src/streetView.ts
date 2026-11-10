/** Google Street View at a viewpoint (opens nearest panorama when one exists). */
export function streetViewUrlAt(input: {
  lat: number
  lon: number
  headingDeg?: number
  pitchDeg?: number
  fovDeg?: number
}): string {
  const heading =
    input.headingDeg != null && Number.isFinite(input.headingDeg)
      ? ((input.headingDeg % 360) + 360) % 360
      : 0
  const pitch =
    input.pitchDeg != null && Number.isFinite(input.pitchDeg)
      ? Math.min(90, Math.max(-90, input.pitchDeg))
      : 0
  const fov =
    input.fovDeg != null && Number.isFinite(input.fovDeg)
      ? Math.min(120, Math.max(10, input.fovDeg))
      : 80
  const params = new URLSearchParams({
    api: '1',
    map_action: 'pano',
    viewpoint: `${input.lat.toFixed(6)},${input.lon.toFixed(6)}`,
    heading: heading.toFixed(1),
    pitch: pitch.toFixed(1),
    fov: fov.toFixed(0),
  })
  return `https://www.google.com/maps/@?${params.toString()}`
}
