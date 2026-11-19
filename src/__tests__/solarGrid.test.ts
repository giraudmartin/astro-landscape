import { it, expect } from 'vitest'
import { fillSolarGrid, sunAltitudeFromSubsolar } from '../nightShadeProtocol'

it('matches the scalar solar altitude at every tile sample', () => {
  const sun = { lon: -104.3, lat: 21.5 }
  for (const [z, x, y] of [[0, 0, 0], [3, 7, 0], [7, 8, 127]] as const) {
    let checked = 0
    fillSolarGrid(z, x, y, sun, (i, altitude) => {
      const px = (i % 64 + 0.5) * 4
      const py = (Math.floor(i / 64) + 0.5) * 4
      const lon = ((x + px / 256) / 2 ** z) * 360 - 180
      const mercY = Math.PI * (1 - (2 * (y + py / 256)) / 2 ** z)
      const lat = Math.max(-85.0511, Math.min(85.0511,
        (2 * Math.atan(Math.exp(mercY)) * 180) / Math.PI - 90))
      expect(altitude).toBe(sunAltitudeFromSubsolar({ lon, lat }, sun))
      checked++
    })
    expect(checked).toBe(4096)
  }
})
