import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { OPERATE_PHONE_MQ, useMatchMedia } from './useMatchMedia'
import { useT } from './i18n'

type MapZoomControlsProps = {
  mapRef: RefObject<MapLibreMap | null>
}

const ZOOM_STEP = 1
const CLICK_FLASH_MS = 280

/**
 * Phone-only zoom — compact +/− pill under the map quick-actions cluster.
 */
export function MapZoomControls({ mapRef }: MapZoomControlsProps) {
  const t = useT()
  const isPhone = useMatchMedia(OPERATE_PHONE_MQ)
  const [canZoomIn, setCanZoomIn] = useState(true)
  const [canZoomOut, setCanZoomOut] = useState(true)
  const [clicked, setClicked] = useState<'in' | 'out' | null>(null)
  const clickTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isPhone) return
    const map = mapRef.current
    if (!map) return

    const sync = () => {
      const z = map.getZoom()
      setCanZoomIn(z < map.getMaxZoom() - 1e-3)
      setCanZoomOut(z > map.getMinZoom() + 1e-3)
    }
    sync()
    map.on('zoom', sync)
    map.on('zoomend', sync)
    return () => {
      map.off('zoom', sync)
      map.off('zoomend', sync)
    }
  }, [isPhone, mapRef])

  useEffect(() => {
    return () => {
      if (clickTimerRef.current != null) {
        window.clearTimeout(clickTimerRef.current)
      }
    }
  }, [])

  if (!isPhone) return null

  const flash = (which: 'in' | 'out') => {
    if (clickTimerRef.current != null) {
      window.clearTimeout(clickTimerRef.current)
    }
    setClicked(which)
    clickTimerRef.current = window.setTimeout(() => {
      setClicked(null)
      clickTimerRef.current = null
    }, CLICK_FLASH_MS)
  }

  const zoomBy = (delta: number, which: 'in' | 'out') => {
    const map = mapRef.current
    if (!map) return
    flash(which)
    const next = Math.min(
      map.getMaxZoom(),
      Math.max(map.getMinZoom(), map.getZoom() + delta),
    )
    map.easeTo({ zoom: next, duration: 220 })
  }

  return (
    <div className="map-zoom-controls" role="group" aria-label={t('map.zoomAria')}>
      <button
        type="button"
        className="map-zoom-controls__btn"
        data-clicked={clicked === 'in' ? 'true' : undefined}
        aria-label={t('map.zoomIn')}
        title={t('map.zoomIn')}
        disabled={!canZoomIn}
        onClick={() => zoomBy(ZOOM_STEP, 'in')}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <button
        type="button"
        className="map-zoom-controls__btn"
        data-clicked={clicked === 'out' ? 'true' : undefined}
        aria-label={t('map.zoomOut')}
        title={t('map.zoomOut')}
        disabled={!canZoomOut}
        onClick={() => zoomBy(-ZOOM_STEP, 'out')}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M5 12h14" />
        </svg>
      </button>
    </div>
  )
}
