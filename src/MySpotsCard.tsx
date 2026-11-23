import { useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import { useT } from './i18n'
import { MobileRailChrome } from './MobileRailChrome'
import type { PersonalSpot, PersonalSpotFolder } from './personalSpots'

type MySpotsToggleProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type MySpotsRailProps = {
  open: boolean
  onClose: () => void
  spots: PersonalSpot[]
  folders: PersonalSpotFolder[]
  selectedId: string | null
  onSelect: (spot: PersonalSpot) => void
  onRename: (spot: PersonalSpot) => void
  onToggleSpotVisible: (spotId: string) => void
  onCreateFolder: () => void
  onRenameFolder: (folder: PersonalSpotFolder) => void
  onToggleFolderVisible: (folderId: string) => void
  onMoveSpotToFolder: (spotId: string, folderId: string | null) => void
  railWidthPx?: number
  onRailWidthChange?: (widthPx: number) => void
}

const SPOT_DRAG_MIME = 'application/x-astro-spot-id'

function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
      <path d="M15 5.764v15" />
      <path d="M9 3.236v15" />
    </svg>
  )
}

function SquarePenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  )
}

function FolderPlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 10v6" />
      <path d="M9 13h6" />
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={
        open
          ? 'my-spots-folder__chevron my-spots-folder__chevron--open'
          : 'my-spots-folder__chevron'
      }
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function readDraggedSpotId(event: DragEvent): string | null {
  const typed = event.dataTransfer.getData(SPOT_DRAG_MIME)
  if (typed) return typed
  const plain = event.dataTransfer.getData('text/plain')
  return plain || null
}

function stopRowSideEffect(event: MouseEvent) {
  event.stopPropagation()
}

export function MySpotsToggle({ open, onOpenChange }: MySpotsToggleProps) {
  const t = useT()
  return (
    <div className="my-spots-control">
      <button
        type="button"
        className={
          open
            ? 'my-spots-control__toggle my-spots-control__toggle--active'
            : 'my-spots-control__toggle'
        }
        aria-expanded={open}
        aria-controls="my-spots-rail"
        aria-label={t('spots.title')}
        title={t('spots.title')}
        onClick={() => onOpenChange(!open)}
      >
        <MapIcon />
      </button>
    </div>
  )
}

function SpotRow({
  spot,
  selected,
  mapHidden,
  onSelect,
  onRename,
  onToggleVisible,
  onDragStart,
  onDragEnd,
}: {
  spot: PersonalSpot
  selected: boolean
  mapHidden: boolean
  onSelect: () => void
  onRename: () => void
  onToggleVisible: () => void
  onDragStart: (event: DragEvent) => void
  onDragEnd: () => void
}) {
  const t = useT()
  const altitude =
    spot.heightM != null ? `${Math.round(spot.heightM)} m` : null

  return (
    <li
      className={
        selected ? 'my-spots-row my-spots-row--selected' : 'my-spots-row'
      }
      draggable
      onDragStart={(event) => {
        const target = event.target as HTMLElement | null
        if (target?.closest('.my-spots-row__actions')) {
          event.preventDefault()
          return
        }
        onDragStart(event)
      }}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        className="my-spots-row__select"
        aria-pressed={selected}
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
      >
        <span className="my-spots-row__pin" aria-hidden="true">
          <PinIcon />
        </span>
        <span className="my-spots-row__info">
          <span className="my-spots-row__name">{spot.name}</span>
          <span className="my-spots-row__meta">
            <span>
              {spot.lat.toFixed(4)}, <wbr />
              {spot.lon.toFixed(4)}
            </span>
            {altitude ? (
              <span className="my-spots-row__alt">{altitude}</span>
            ) : null}
          </span>
        </span>
      </button>
      <div className="my-spots-row__actions">
        <button
          type="button"
          className={
            mapHidden
              ? 'my-spots-row__edit my-spots-row__edit--visibility my-spots-row__edit--off'
              : 'my-spots-row__edit my-spots-row__edit--visibility'
          }
          aria-label={t('spots.visibilitySpot', { name: spot.name })}
          aria-pressed={!mapHidden}
          title={
            mapHidden
              ? t('spots.showOnMap', { name: spot.name })
              : t('spots.hideOnMap', { name: spot.name })
          }
          onMouseDown={stopRowSideEffect}
          onClick={(event) => {
            stopRowSideEffect(event)
            onToggleVisible()
          }}
        >
          {mapHidden ? <EyeOffIcon /> : <EyeIcon />}
        </button>
        <button
          type="button"
          className="my-spots-row__edit"
          aria-label={t('spots.editSpot', { name: spot.name })}
          title={t('spots.editSpot', { name: spot.name })}
          onMouseDown={stopRowSideEffect}
          onClick={(event) => {
            stopRowSideEffect(event)
            onRename()
          }}
        >
          <SquarePenIcon />
        </button>
      </div>
    </li>
  )
}

export function MySpotsRail({
  open,
  onClose,
  spots,
  folders,
  selectedId,
  onSelect,
  onRename,
  onToggleSpotVisible,
  onCreateFolder,
  onRenameFolder,
  onToggleFolderVisible,
  onMoveSpotToFolder,
  railWidthPx,
  onRailWidthChange,
}: MySpotsRailProps) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [draggingSpotId, setDraggingSpotId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null)

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const searching = normalizedQuery.length > 0

  const folderById = useMemo(() => {
    const map = new Map<string, PersonalSpotFolder>()
    for (const folder of folders) map.set(folder.id, folder)
    return map
  }, [folders])

  const matchingSpots = useMemo(() => {
    if (!searching) return spots
    return spots.filter((spot) =>
      spot.name.toLocaleLowerCase().includes(normalizedQuery),
    )
  }, [spots, searching, normalizedQuery])

  const spotsByFolder = useMemo(() => {
    const grouped = new Map<string | null, PersonalSpot[]>()
    grouped.set(null, [])
    for (const folder of folders) grouped.set(folder.id, [])
    for (const spot of matchingSpots) {
      const key =
        spot.folderId && folderById.has(spot.folderId) ? spot.folderId : null
      const list = grouped.get(key)
      if (list) list.push(spot)
      else grouped.set(null, [...(grouped.get(null) ?? []), spot])
    }
    return grouped
  }, [matchingSpots, folders, folderById])

  const rootSpots = spotsByFolder.get(null) ?? []

  const visibleFolders = useMemo(() => {
    if (!searching) return folders
    return folders.filter((folder) => {
      if (folder.name.toLocaleLowerCase().includes(normalizedQuery)) return true
      return (spotsByFolder.get(folder.id) ?? []).length > 0
    })
  }, [folders, searching, normalizedQuery, spotsByFolder])

  const allSpotsVisible =
    spots.length > 0 && spots.every((spot) => spot.visible)

  if (!open) return null

  const beginSpotDrag = (event: DragEvent, spotId: string) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(SPOT_DRAG_MIME, spotId)
    event.dataTransfer.setData('text/plain', spotId)
    setDraggingSpotId(spotId)
  }

  const endSpotDrag = () => {
    setDraggingSpotId(null)
    setDropTarget(null)
  }

  const allowSpotDrop = (event: DragEvent) => {
    const types = Array.from(event.dataTransfer.types)
    if (
      !draggingSpotId &&
      !types.includes(SPOT_DRAG_MIME) &&
      !types.includes('text/plain')
    ) {
      return false
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    return true
  }

  const dropOnFolder = (event: DragEvent, folderId: string | null) => {
    event.preventDefault()
    event.stopPropagation()
    const spotId = readDraggedSpotId(event)
    endSpotDrag()
    if (!spotId) return
    onMoveSpotToFolder(spotId, folderId)
  }

  const toggleFolderCollapsed = (folderId: string) => {
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  const toggleAllMapVisible = () => {
    const nextVisible = !allSpotsVisible
    for (const spot of spots) {
      if (spot.visible !== nextVisible) onToggleSpotVisible(spot.id)
    }
  }

  const renderSpot = (spot: PersonalSpot) => {
    const folder = spot.folderId ? folderById.get(spot.folderId) : null
    const mapHidden = !spot.visible || (folder != null && !folder.visible)
    return (
      <SpotRow
        key={spot.id}
        spot={spot}
        selected={spot.id === selectedId}
        mapHidden={mapHidden}
        onSelect={() => onSelect(spot)}
        onRename={() => onRename(spot)}
        onToggleVisible={() => onToggleSpotVisible(spot.id)}
        onDragStart={(event) => beginSpotDrag(event, spot.id)}
        onDragEnd={endSpotDrag}
      />
    )
  }

  const showToolbar = spots.length > 0 || folders.length > 0
  const showAllLabel = allSpotsVisible ? t('spots.hideAll') : t('spots.showAll')

  return (
    <aside
      id="my-spots-rail"
      className="my-spots-rail"
      role="complementary"
      aria-label={t('spots.title')}
    >
      <MobileRailChrome
        onClose={onClose}
        sheetClassName="my-spots-rail__sheet"
        desktopWidthPx={railWidthPx}
        onDesktopWidthChange={onRailWidthChange}
      >
        <header className="my-spots-rail__header">
          <div>
            <h2 className="my-spots-rail__title">
              {t('spots.title')}
              <span
                className="my-spots-rail__count"
                aria-label={t('spots.countAria', { n: spots.length })}
              >
                {spots.length}
              </span>
            </h2>
            <p className="my-spots-rail__sub">
              {t('spots.sub')}
              {searching && spots.length > 0 ? (
                <> {t('spots.visibleCount', { n: matchingSpots.length })}</>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            className="my-spots-rail__close"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="my-spots-rail__body">
          <div className="my-spots-panel">
            {showToolbar ? (
              <div className="my-spots-panel__toolbar">
                <div className="my-spots-panel__actions">
                  {spots.length > 0 ? (
                    <button
                      type="button"
                      className="my-spots-panel__tool"
                      aria-label={showAllLabel}
                      title={showAllLabel}
                      onClick={toggleAllMapVisible}
                    >
                      <EyeIcon />
                      <span className="my-spots-panel__tool-label">
                        {showAllLabel}
                      </span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="my-spots-panel__tool"
                    aria-label={t('spots.newFolder')}
                    title={t('spots.newFolder')}
                    onClick={onCreateFolder}
                  >
                    <FolderPlusIcon />
                    <span className="my-spots-panel__tool-label">
                      {t('spots.newFolder')}
                    </span>
                  </button>
                </div>
                <label className="my-spots-panel__search">
                  <span className="my-spots-panel__search-label">
                    {t('spots.search')}
                  </span>
                  <SearchIcon />
                  <input
                    type="search"
                    value={query}
                    placeholder={t('spots.search')}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={t('spots.search')}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </div>
            ) : (
              <button
                type="button"
                className="my-spots-panel__tool my-spots-panel__tool--block"
                aria-label={t('spots.newFolder')}
                title={t('spots.newFolder')}
                onClick={onCreateFolder}
              >
                <FolderPlusIcon />
                <span>{t('spots.newFolder')}</span>
              </button>
            )}

            {spots.length === 0 && folders.length === 0 ? (
              <p className="my-spots-rail__empty">{t('spots.empty')}</p>
            ) : matchingSpots.length === 0 && visibleFolders.length === 0 ? (
              <p className="my-spots-rail__empty">{t('spots.noResults')}</p>
            ) : (
              <div className="my-spots-tree">
                {visibleFolders.map((folder) => {
                  const children = spotsByFolder.get(folder.id) ?? []
                  const expanded =
                    searching || !collapsedFolderIds.has(folder.id)
                  const isDrop =
                    dropTarget === folder.id && draggingSpotId != null
                  const folderSpotsListId = `my-spots-folder-${folder.id}`
                  return (
                    <section
                      key={folder.id}
                      className={[
                        'my-spots-folder',
                        !folder.visible ? 'my-spots-folder--hidden' : '',
                        isDrop ? 'my-spots-folder--drop' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-labelledby={`my-spots-folder-title-${folder.id}`}
                      onDragOver={(event) => {
                        if (!allowSpotDrop(event)) return
                        setDropTarget(folder.id)
                      }}
                      onDragLeave={(event) => {
                        if (
                          event.currentTarget.contains(
                            event.relatedTarget as Node | null,
                          )
                        ) {
                          return
                        }
                        setDropTarget((current) =>
                          current === folder.id ? null : current,
                        )
                      }}
                      onDrop={(event) => dropOnFolder(event, folder.id)}
                    >
                      <header className="my-spots-folder__row">
                        <h3
                          className="my-spots-folder__title"
                          id={`my-spots-folder-title-${folder.id}`}
                        >
                          <button
                            type="button"
                            className="my-spots-folder__toggle"
                            aria-expanded={expanded}
                            aria-controls={folderSpotsListId}
                            disabled={searching}
                            onClick={() => toggleFolderCollapsed(folder.id)}
                          >
                            <ChevronIcon open={expanded} />
                            <span className="my-spots-folder__icon">
                              <FolderIcon />
                            </span>
                            <span className="my-spots-folder__name">
                              {folder.name}
                            </span>
                            <span className="my-spots-folder__count">
                              {children.length}
                            </span>
                          </button>
                        </h3>
                        <div className="my-spots-folder__actions">
                          <button
                            type="button"
                            className={
                              !folder.visible
                                ? 'my-spots-row__edit my-spots-row__edit--visibility my-spots-row__edit--off'
                                : 'my-spots-row__edit my-spots-row__edit--visibility'
                            }
                            aria-label={t('spots.folderVisibility', { name: folder.name })}
                            aria-pressed={folder.visible}
                            title={
                              folder.visible
                                ? t('spots.hideFolder', { name: folder.name })
                                : t('spots.showFolder', { name: folder.name })
                            }
                            onClick={() => onToggleFolderVisible(folder.id)}
                          >
                            {folder.visible ? <EyeIcon /> : <EyeOffIcon />}
                          </button>
                          <button
                            type="button"
                            className="my-spots-row__edit"
                            aria-label={t('spots.renameFolder', { name: folder.name })}
                            title={t('spots.renameFolder', { name: folder.name })}
                            onClick={() => onRenameFolder(folder)}
                          >
                            <SquarePenIcon />
                          </button>
                        </div>
                      </header>
                      <div id={folderSpotsListId} hidden={!expanded}>
                        {children.length === 0 ? (
                          <p className="my-spots-folder__empty">
                            {t('spots.dropHere')}
                          </p>
                        ) : (
                          <ul className="my-spots-list">
                            {children.map(renderSpot)}
                          </ul>
                        )}
                      </div>
                    </section>
                  )
                })}

                <section
                  className={[
                    'my-spots-root',
                    dropTarget === 'root' && draggingSpotId
                      ? 'my-spots-root--drop'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onDragOver={(event) => {
                    if (!allowSpotDrop(event)) return
                    setDropTarget('root')
                  }}
                  onDragLeave={(event) => {
                    if (
                      event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                      )
                    ) {
                      return
                    }
                    setDropTarget((current) =>
                      current === 'root' ? null : current,
                    )
                  }}
                  onDrop={(event) => dropOnFolder(event, null)}
                >
                  {folders.length > 0 ? (
                    <header className="my-spots-folder__row my-spots-root__header">
                      <h3 className="my-spots-folder__title">
                        <span className="my-spots-root__label">
                          {t('spots.ungrouped')}
                          <span className="my-spots-folder__count">
                            {rootSpots.length}
                          </span>
                        </span>
                      </h3>
                    </header>
                  ) : null}
                  {rootSpots.length === 0 && folders.length > 0 ? (
                    <p className="my-spots-folder__empty">
                      {t('spots.dropToRoot')}
                    </p>
                  ) : rootSpots.length > 0 ? (
                    <ul className="my-spots-list">{rootSpots.map(renderSpot)}</ul>
                  ) : null}
                </section>
              </div>
            )}
          </div>
        </div>
      </MobileRailChrome>
    </aside>
  )
}
