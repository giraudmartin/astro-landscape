import { useRef, useState, type RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { MapAddressSearch } from './MapAddressSearch'
import { MapCompass } from './MapCompass'
import { MySpotsToggle } from './MySpotsCard'
import type { AddressSearchResult } from './addressSearch'
import {
  basemapModeLabel,
  nextBasemapMode,
  type BasemapMode,
} from './basemapMode'

type MapControlsStackProps = {
  mapRef: RefObject<MapLibreMap | null>
  threeDimensional: boolean
  onThreeDimensionalChange: (next: boolean) => void
  basemapMode: BasemapMode
  onBasemapModeChange: (next: BasemapMode) => void
  addressSearchOpen: boolean
  onAddressSearchOpenChange: (open: boolean) => void
  onAddressSelect: (result: AddressSearchResult) => void
  onMyLocation: () => void
  mySpotsOpen: boolean
  onMySpotsOpenChange: (open: boolean) => void
}

export function MapControlsStack({
  mapRef,
  threeDimensional,
  onThreeDimensionalChange,
  basemapMode,
  onBasemapModeChange,
  addressSearchOpen,
  onAddressSearchOpenChange,
  onAddressSelect,
  onMyLocation,
  mySpotsOpen,
  onMySpotsOpenChange,
}: MapControlsStackProps) {
  const [locating, setLocating] = useState(false)
  const [clicked, setClicked] = useState(false)
  const clickTimerRef = useRef<number | null>(null)

  const handleMyLocation = () => {
    if (locating) return
    if (clickTimerRef.current != null) {
      window.clearTimeout(clickTimerRef.current)
    }
    setClicked(true)
    clickTimerRef.current = window.setTimeout(() => {
      setClicked(false)
      clickTimerRef.current = null
    }, 480)
    setLocating(true)
    onMyLocation()
    window.setTimeout(() => setLocating(false), 10_500)
  }

  const planActive = basemapMode !== 'satellite'
  const label = basemapModeLabel(basemapMode)

  return (
    <div className="map-controls-stack">
      <MapCompass mapRef={mapRef} threeDimensional={threeDimensional} />
      <div className="map-quick-actions-cluster">
        <MapAddressSearch
          open={addressSearchOpen}
          onOpenChange={onAddressSearchOpenChange}
          onSelect={onAddressSelect}
          getMapCenter={() => {
            const map = mapRef.current
            if (!map) return null
            const center = map.getCenter()
            return { lat: center.lat, lon: center.lng }
          }}
          getViewbox={() => {
            const map = mapRef.current
            if (!map) return null
            const b = map.getBounds()
            return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
          }}
        />
        <div className="map-quick-actions" aria-label="Contrôles carte">
          <button
            type="button"
            className={
              addressSearchOpen
                ? 'map-quick-actions__button map-quick-actions__button--active'
                : 'map-quick-actions__button'
            }
            data-map-address-search-toggle=""
            aria-pressed={addressSearchOpen}
            aria-expanded={addressSearchOpen}
            aria-label="Rechercher un lieu"
            title="Rechercher un lieu"
            onClick={() => onAddressSearchOpenChange(!addressSearchOpen)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4.5 4.5" />
            </svg>
          </button>

          <button
            type="button"
            className={
              threeDimensional
                ? 'map-quick-actions__button map-quick-actions__button--active'
                : 'map-quick-actions__button'
            }
            aria-pressed={threeDimensional}
            aria-label="Vue 3D"
            title="Vue 3D"
            onClick={() => onThreeDimensionalChange(!threeDimensional)}
          >
            <span className="map-quick-actions__3d" aria-hidden="true">
              3D
            </span>
          </button>

          <button
            type="button"
            className={
              planActive
                ? 'map-quick-actions__button map-quick-actions__button--active'
                : 'map-quick-actions__button'
            }
            data-basemap-mode={basemapMode}
            aria-pressed={planActive}
            aria-label={`${label} — cliquer pour changer`}
            title={`${label} (satellite → sat+plan → plan)`}
            onClick={() => onBasemapModeChange(nextBasemapMode(basemapMode))}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m12 3 8 4.5-8 4.5L4 7.5 12 3Z" />
              <path d="m4 12 8 4.5 8-4.5" />
              <path d="m4 16.5 8 4.5 8-4.5" />
            </svg>
          </button>

          <button
            type="button"
            className="map-quick-actions__button"
            aria-label="Ma position"
            title="Ma position"
            aria-busy={locating}
            data-clicked={clicked ? 'true' : undefined}
            onClick={handleMyLocation}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
              <path d="M12 5V3M19 12h2M12 21v-2M3 12h2" />
            </svg>
          </button>
        </div>
      </div>
      <MySpotsToggle open={mySpotsOpen} onOpenChange={onMySpotsOpenChange} />
    </div>
  )
}
