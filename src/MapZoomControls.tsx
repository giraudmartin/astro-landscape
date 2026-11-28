import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { OPERATE_PHONE_MQ, useMatchMedia } from './useMatchMedia'
import { useT } from './i18n'

type MapZoomControlsProps = {
  mapRef: RefObject<MapLibreMap | null>
}

const ZOOM_STEP = 1
const CLICK_FLASH_MS = 280
/** Enter aside when in-stack bottom would cross the dock by this much. */
const ASIDE_ENTER_PX = 8
/** Leave aside only once the stack clears the dock by this much (hysteresis). */
const ASIDE_LEAVE_PX = 36
/** Cluster gap above zoom when it sits under the quick-actions pill. */
const CLUSTER_GAP_PX = 10

/**
 * Phone-only zoom — compact +/− pill under the map quick-actions cluster.
 * On short viewports, parks left-center so the right rail clears the timeline.
 */
export function MapZoomControls({ mapRef }: MapZoomControlsProps) {
  const t = useT()
  const isPhone = useMatchMedia(OPERATE_PHONE_MQ)
  const [canZoomIn, setCanZoomIn] = useState(true)
  const [canZoomOut, setCanZoomOut] = useState(true)
  const [clicked, setClicked] = useState<'in' | 'out' | null>(null)
  const [aside, setAside] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef(false)
  const inFlowHeightRef = useRef(0)
  const clickTimerRef = useRef<number | null>(null)

  useEffect(() => {
    asideRef.current = aside
  }, [aside])

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

  /* Park +/− left-center when the right stack would sit on the timeline dock. */
  useEffect(() => {
    if (!isPhone) {
      setAside(false)
      return
    }

    let rafId = 0

    const dockTop = (): number => {
      const dock = document.querySelector<HTMLElement>(
        '.moon-timeline-dock:not(.is-legend-covered), .moon-timeline-dock__collapsed:not(.is-legend-covered)',
      )
      if (dock) return dock.getBoundingClientRect().top
      return (
        window.innerHeight -
        (parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            '--mobile-above-dock',
          ),
        ) || 162)
      )
    }

    const measure = () => {
      const el = rootRef.current
      const stack = el?.closest('.map-controls-stack')
      if (!el || !stack) {
        setAside(false)
        return
      }

      const stackRect = stack.getBoundingClientRect()
      const zoomRect = el.getBoundingClientRect()
      if (stackRect.height < 1) {
        setAside(false)
        return
      }

      if (!asideRef.current && zoomRect.height > 1) {
        inFlowHeightRef.current = zoomRect.height
      }

      const zoomBlock =
        (inFlowHeightRef.current || zoomRect.height || 84) + CLUSTER_GAP_PX
      /* When aside, zoom is out of flow — project the bottom if it were back in the rail. */
      const projectedBottom = asideRef.current
        ? stackRect.bottom + zoomBlock
        : stackRect.bottom

      const limit = dockTop()
      const overflow = projectedBottom - limit
      const next = asideRef.current
        ? overflow > -ASIDE_LEAVE_PX
        : overflow > ASIDE_ENTER_PX

      if (next !== asideRef.current) {
        asideRef.current = next
        setAside(next)
      }
    }

    const schedule = () => {
      if (rafId) return
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        measure()
      })
    }

    measure()

    const stack = rootRef.current?.closest('.map-controls-stack')
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    if (stack) ro?.observe(stack)
    if (rootRef.current) ro?.observe(rootRef.current)

    let dockObserved: Element | null = null
    const syncDockObserve = () => {
      const dock = document.querySelector(
        '.moon-timeline-dock, .moon-timeline-dock__collapsed',
      )
      if (dock === dockObserved) return
      if (dockObserved) ro?.unobserve(dockObserved)
      dockObserved = dock
      if (dock) ro?.observe(dock)
    }
    syncDockObserve()

    /* Timeline mount / advanced toggle — avoid a body-wide class observer. */
    const mo =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            syncDockObserve()
            schedule()
          })
        : null
    const app = document.querySelector('.app')
    if (app) {
      mo?.observe(app, { childList: true, subtree: true })
    }

    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId)
      ro?.disconnect()
      mo?.disconnect()
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
    }
  }, [isPhone])

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
    <div
      ref={rootRef}
      className={
        aside
          ? 'map-zoom-controls map-zoom-controls--aside'
          : 'map-zoom-controls'
      }
      role="group"
      aria-label={t('map.zoomAria')}
    >
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
