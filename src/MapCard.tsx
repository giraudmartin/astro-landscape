/** Ported from Photo Sightline MapCard — keep chrome identical. */
import { useState, type ReactNode } from 'react'

type MapCardProps = {
  title: string
  children: ReactNode
  className?: string
  action?: ReactNode
  glow?: boolean
  collapsible?: boolean
  defaultCollapsed?: boolean
  collapsedSummary?: ReactNode
}

export function MapCard({
  title,
  children,
  className,
  action,
  glow,
  collapsible,
  defaultCollapsed = false,
  collapsedSummary,
}: MapCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const isCollapsed = Boolean(collapsible && collapsed)
  const showCollapsedSummary = Boolean(isCollapsed && collapsedSummary)
  const classes = [
    'map-card',
    glow ? 'map-card--glow' : null,
    collapsible ? 'map-card--collapsible' : null,
    isCollapsed ? 'map-card--collapsed' : null,
    showCollapsedSummary ? 'map-card--collapsed-summary' : null,
    className ?? null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={classes}>
      <header className="map-card__header">
        {collapsible ? (
          <button
            type="button"
            className="map-card__collapse-btn"
            aria-expanded={!collapsed}
            aria-label={collapsed ? `Développer ${title}` : `Réduire ${title}`}
            onClick={() => setCollapsed((value) => !value)}
          >
            <h2 className="map-card__title">{title}</h2>
            <span className="map-card__toggle-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="m6 15 6-6 6 6" />
              </svg>
            </span>
          </button>
        ) : (
          <h2 className="map-card__title">{title}</h2>
        )}
        {action ? <div className="map-card__action">{action}</div> : null}
      </header>
      {collapsedSummary ? (
        <div
          className={
            showCollapsedSummary
              ? 'map-card__collapsed-summary is-visible'
              : 'map-card__collapsed-summary is-hidden'
          }
          aria-hidden={!showCollapsedSummary}
        >
          {collapsedSummary}
        </div>
      ) : null}
      {collapsible ? (
        <div
          className={
            isCollapsed ? 'map-card__body is-collapsed' : 'map-card__body'
          }
          aria-hidden={isCollapsed}
        >
          <div className="map-card__body-inner">{children}</div>
        </div>
      ) : (
        <div className="map-card__body">{children}</div>
      )}
    </section>
  )
}
