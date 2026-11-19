import { describe, expect, it } from 'vitest'
import {
  framingNightGroupDay,
  framingNightLabel,
  groupFramingsByNight,
  createPersonalFraming,
} from '../personalFramings'

const view = {
  frameMode: 'dslr' as const,
  focalMm: 35,
  orientation: 'landscape' as const,
  sensorFormat: 'ff' as const,
  frameRollDeg: 0,
  bearingDeg: 180,
  pitchDeg: 10,
  eyeHeightM: 1.6,
  panorama: null,
  timelapse: null,
}

describe('personalFramings night grouping', () => {
  it('assigns pre-6h shots to the previous civil night', () => {
    expect(framingNightGroupDay('2026-12-12T02:15:00')).toBe('2026-12-11')
    expect(framingNightGroupDay('2026-12-11T22:40:00')).toBe('2026-12-11')
    expect(framingNightGroupDay('2026-12-11T06:00:00')).toBe('2026-12-11')
  })

  it('groups 02:15 with the previous evening under the same night', () => {
    const evening = createPersonalFraming({
      name: 'Orion',
      lat: 28.7,
      lon: -17.8,
      peakUtc: '2026-12-11T22:40:00.000Z',
      peakLocal: '2026-12-11T22:40:00',
      localDate: '2026-12-11',
      spotId: 's1',
      spotName: 'Andenes',
      view,
    })
    const afterMidnight = createPersonalFraming({
      name: 'Vallée',
      lat: 28.7,
      lon: -17.8,
      peakUtc: '2026-12-12T02:15:00.000Z',
      peakLocal: '2026-12-12T02:15:00',
      localDate: '2026-12-12',
      spotId: 's1',
      spotName: 'Andenes',
      view,
    })
    const groups = groupFramingsByNight([evening, afterMidnight])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.day).toBe('2026-12-11')
    expect(groups[0]?.items).toHaveLength(2)
    expect(framingNightLabel('2026-12-11', groups[0]!.items)).toMatch(/Nuit du/)
  })
})
