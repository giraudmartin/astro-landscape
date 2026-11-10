import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'

const RESET_DURATION_MS = 520

/** Inclined like the 3D control, but facing north. */
const THREE_D_RESET = { pitch: 55, bearing: 0 } as const
const TOP_DOWN_RESET = { pitch: 0, bearing: 0 } as const

type MapCompassProps = {
  mapRef: RefObject<MapLibreMap | null>
  /** When true, reset to the inclined 3D camera; otherwise top-down north. */
  threeDimensional?: boolean
}

function syncCompassOrientation(el: HTMLElement, map: MapLibreMap): void {
  el.style.setProperty('--bearing', String(map.getBearing()))
  el.style.setProperty('--pitch', String(map.getPitch()))
}

export function MapCompass({
  mapRef,
  threeDimensional = true,
}: MapCompassProps) {
  const rootRef = useRef<HTMLButtonElement | null>(null)
  const threeDimensionalRef = useRef(threeDimensional)
  threeDimensionalRef.current = threeDimensional

  useEffect(() => {
    let attached: MapLibreMap | null = null

    const onOrient = (): void => {
      const el = rootRef.current
      const map = attached
      if (!el || !map) return
      syncCompassOrientation(el, map)
    }

    const detach = (): void => {
      if (!attached) return
      attached.off('rotate', onOrient)
      attached.off('pitch', onOrient)
      attached.off('move', onOrient)
      attached = null
    }

    const tryAttach = (): boolean => {
      const map = mapRef.current
      const el = rootRef.current
      if (!map || !el) return false
      if (attached === map) return true
      detach()
      attached = map
      syncCompassOrientation(el, map)
      map.on('rotate', onOrient)
      map.on('pitch', onOrient)
      map.on('move', onOrient)
      return true
    }

    if (!tryAttach()) {
      const pollId = window.setInterval(() => {
        if (tryAttach()) window.clearInterval(pollId)
      }, 50)
      return () => {
        window.clearInterval(pollId)
        detach()
      }
    }

    return () => {
      detach()
    }
  }, [mapRef])

  const resetView = (): void => {
    const map = mapRef.current
    if (!map) return
    const target = threeDimensionalRef.current ? THREE_D_RESET : TOP_DOWN_RESET
    map.easeTo({
      bearing: target.bearing,
      pitch: target.pitch,
      duration: RESET_DURATION_MS,
      essential: true,
    })
  }

  const initialStyle = {
    '--bearing': '0',
    '--pitch': '0',
  } as CSSProperties

  const marks = Array.from({ length: 12 }, (_, i) => (
    <span
      key={i}
      className={
        i % 3 === 0
          ? 'map-compass__mark map-compass__mark--major'
          : 'map-compass__mark'
      }
      style={{ transform: `rotate(${i * 30}deg)` }}
    />
  ))

  return (
    <button
      ref={rootRef}
      type="button"
      className="map-compass"
      aria-label={
        threeDimensional
          ? 'Remettre au nord, vue 3D'
          : 'Remettre au nord, vue du dessus'
      }
      title={
        threeDimensional
          ? 'Remettre au nord, vue 3D'
          : 'Remettre au nord, vue du dessus'
      }
      onClick={resetView}
      style={initialStyle}
    >
      <span className="map-compass__north" aria-hidden="true">
        N
      </span>
      <div className="map-compass__dial" aria-hidden="true">
        <div className="map-compass__ring" />
        {marks}
        {/* Pitch in screen space FIRST, then yaw — otherwise rotateX is remapped
            by bearing and horizontal pans tumble the needle on the wrong axis. */}
        <div className="map-compass__needle-tilt">
          <div className="map-compass__needle-rotation">
            <svg
              className="map-compass__needle"
              viewBox="0 0 105 142"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="map-compass-left" x1="0" y1="0" x2="1" y2="1">
                  <stop stopColor="#a7ffff" />
                  <stop offset="0.55" stopColor="#21d5ec" />
                  <stop offset="1" stopColor="#087caa" />
                </linearGradient>
                <linearGradient
                  id="map-compass-right"
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="1"
                >
                  <stop stopColor="#35c9e9" />
                  <stop offset="1" stopColor="#063c7a" />
                </linearGradient>
                <linearGradient id="map-compass-tail" x1="0" y1="0" x2="1" y2="1">
                  <stop stopColor="#18658f" />
                  <stop offset="1" stopColor="#082a52" />
                </linearGradient>
              </defs>
              <g transform="translate(0 -6)">
                <path
                  d="M52.5 7 L19 97 L52.5 77 Z"
                  fill="url(#map-compass-left)"
                />
                <path
                  d="M52.5 7 L86 97 L52.5 77 Z"
                  fill="url(#map-compass-right)"
                />
                <path d="M19 97 L52.5 77 L52.5 132 Z" fill="#168bb0" />
                <path
                  d="M86 97 L52.5 77 L52.5 132 Z"
                  fill="url(#map-compass-tail)"
                />
                <path
                  d="M52.5 9 L52.5 76"
                  fill="none"
                  stroke="#c4ffff"
                  strokeWidth="1.3"
                  opacity="0.68"
                />
                <path
                  d="M52.5 7 L19 97 L52.5 132 L86 97 Z"
                  fill="none"
                  stroke="#65e9f2"
                  strokeOpacity="0.45"
                  strokeWidth="1.1"
                  strokeLinejoin="round"
                />
              </g>
            </svg>
          </div>
        </div>
      </div>
    </button>
  )
}
