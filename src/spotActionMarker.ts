/** Radial spot-action marker — same chrome as Photo Sightline, Astro actions. */

export type SpotActionMarkerActions = {
  onMenuOpen?: () => void
  onOpenChange?: (open: boolean) => void
  /**
   * Select a saved spot before showing its actions. Return true when the
   * selection changed, so the opening click is not also used to open the menu.
   */
  onSelectSaved?: () => boolean
  shouldBlockOpen?: () => boolean
  onStreetView: () => void
  /** Open the Three.js immersive / tripod view. */
  onImmersive: () => void
  /** Return false when saving was cancelled / deferred to a dialog. */
  onAdd: () => boolean
  onEdit: () => void
}

export type SpotActionMarkerLabels = {
  group: string
  openMenu: string
  closeMenu: string
  street: string
  immersive: string
  save: string
  edit: string
}

export type SpotActionMarkerController = {
  element: HTMLDivElement
  setSaved: (saved: boolean) => void
  setLabel: (name: string | null) => void
  setLabels: (labels: SpotActionMarkerLabels) => void
  open: () => void
  close: () => void
  destroy: () => void
}

let closeOpenMarkerMenu: (() => void) | null = null

const icon = (
  name: 'pin' | 'camera' | 'close' | 'street' | 'immersive' | 'add' | 'edit',
): string => {
  if (name === 'pin') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>'
  }
  const paths: Record<Exclude<typeof name, 'pin'>, string> = {
    camera:
      '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
    close: '<path d="m18 6-12 12M6 6l12 12"/>',
    street:
      '<circle cx="12" cy="5" r="1"/><path d="m9 20 3-6 3 6M6 8l6 2 6-2M12 10v4"/>',
    immersive:
      '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
    add: '<path d="M19.914 11.105A7.298 7.298 0 0 0 20 10a8 8 0 0 0-16 0c0 4.993 5.539 10.193 7.399 11.799a1 1 0 0 0 1.202 0 32 32 0 0 0 .824-.738"/><circle cx="12" cy="10" r="3"/><path d="M16 18h6M19 15v6"/>',
    edit: '<path d="M17.97 9.304A8 8 0 0 0 2 10c0 4.69 4.887 9.562 7.022 11.468"/><path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/><circle cx="10" cy="10" r="3"/>',
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`
}

export const SPOT_ACTION_MARKER_LABELS_FR: SpotActionMarkerLabels = {
  group: 'Actions du spot',
  openMenu: 'Ouvrir les actions du marker',
  closeMenu: 'Fermer les actions du marker',
  street: 'Ouvrir Google Street View',
  immersive: 'Ouvrir la vue trépied (Three.js)',
  save: 'Enregistrer ce spot',
  edit: 'Modifier ce spot',
}

export function createSpotActionMarkerElement(
  initialSaved: boolean,
  actions: SpotActionMarkerActions,
  labels: SpotActionMarkerLabels = SPOT_ACTION_MARKER_LABELS_FR,
): SpotActionMarkerController {
  let currentLabels = labels
  const element = document.createElement('div')
  element.className = 'spot-action-marker'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', currentLabels.group)
  element.innerHTML = `
    <span class="spot-action-marker__veil" aria-hidden="true"></span>
    <div class="spot-action-marker__orbit">
      <span class="spot-action-marker__spoke spot-action-marker__spoke--street"><button type="button" data-action="street" title="${currentLabels.street}" aria-label="${currentLabels.street}">${icon('street')}</button></span>
      <span class="spot-action-marker__spoke spot-action-marker__spoke--immersive"><button type="button" data-action="immersive" title="${currentLabels.immersive}" aria-label="${currentLabels.immersive}">${icon('immersive')}</button></span>
      <span class="spot-action-marker__spoke spot-action-marker__spoke--save"><button type="button" data-action="save" title="${currentLabels.save}" aria-label="${currentLabels.save}"><span class="spot-action-marker__save-add">${icon('add')}</span><span class="spot-action-marker__save-edit">${icon('edit')}</span></button></span>
    </div>
    <button type="button" class="spot-action-marker__center" aria-label="${currentLabels.openMenu}" aria-expanded="false">
      <span class="spot-action-marker__pin">${icon('pin')}</span>
      <span class="spot-action-marker__camera">${icon('camera')}</span>
      <span class="spot-action-marker__close">${icon('close')}</span>
    </button>
    <span class="spot-action-marker__label" hidden></span>`

  const center = element.querySelector<HTMLButtonElement>(
    '.spot-action-marker__center',
  )!
  const nameLabel = element.querySelector<HTMLSpanElement>(
    '.spot-action-marker__label',
  )!
  const actionButtons = Array.from(
    element.querySelectorAll<HTMLButtonElement>('[data-action]'),
  )
  const streetButton = element.querySelector<HTMLButtonElement>(
    '[data-action="street"]',
  )!
  const immersiveButton = element.querySelector<HTMLButtonElement>(
    '[data-action="immersive"]',
  )!
  const saveButton = element.querySelector<HTMLButtonElement>(
    '[data-action="save"]',
  )!
  let open = false
  let saved = initialSaved
  let closeThisMenu: () => void = () => undefined

  const syncActionTabStops = (): void => {
    for (const button of actionButtons) {
      button.tabIndex = open ? 0 : -1
      button.setAttribute('aria-disabled', 'false')
    }
  }

  const applyLabels = (): void => {
    element.setAttribute('aria-label', currentLabels.group)
    streetButton.title = currentLabels.street
    streetButton.setAttribute('aria-label', currentLabels.street)
    immersiveButton.title = currentLabels.immersive
    immersiveButton.setAttribute('aria-label', currentLabels.immersive)
    center.setAttribute(
      'aria-label',
      open ? currentLabels.closeMenu : currentLabels.openMenu,
    )
    const saveLabel = saved ? currentLabels.edit : currentLabels.save
    saveButton.title = saveLabel
    saveButton.setAttribute('aria-label', saveLabel)
  }

  const setOpen = (next: boolean): void => {
    if (next === open) return
    if (next && closeOpenMarkerMenu && closeOpenMarkerMenu !== closeThisMenu) {
      closeOpenMarkerMenu()
    }
    if (next) actions.onMenuOpen?.()
    open = next
    element.classList.toggle('spot-action-marker--open', next)
    center.setAttribute('aria-expanded', String(next))
    center.setAttribute(
      'aria-label',
      next ? currentLabels.closeMenu : currentLabels.openMenu,
    )
    syncActionTabStops()
    if (next) closeOpenMarkerMenu = closeThisMenu
    else if (closeOpenMarkerMenu === closeThisMenu) closeOpenMarkerMenu = null
    actions.onOpenChange?.(next)
  }
  closeThisMenu = () => setOpen(false)

  const setSaved = (next: boolean): void => {
    saved = next
    element.classList.toggle('spot-action-marker--saved', saved)
    const label = saved ? currentLabels.edit : currentLabels.save
    saveButton.title = label
    saveButton.setAttribute('aria-label', label)
    syncActionTabStops()
  }

  const setLabel = (name: string | null): void => {
    const text = name?.trim() ?? ''
    if (!text) {
      nameLabel.textContent = ''
      nameLabel.hidden = true
      element.classList.remove('spot-action-marker--named')
      return
    }
    nameLabel.textContent = text
    nameLabel.hidden = false
    element.classList.add('spot-action-marker--named')
  }

  const setLabels = (next: SpotActionMarkerLabels): void => {
    currentLabels = next
    applyLabels()
  }

  const stopMapInteraction = (event: Event): void => event.stopPropagation()
  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (!element.contains(event.target as Node)) setOpen(false)
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    setOpen(false)
    center.focus()
  }
  const runAction = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
    const action = (event.currentTarget as HTMLElement).dataset.action
    if (action === 'street') actions.onStreetView()
    if (action === 'immersive') {
      actions.onImmersive()
      setOpen(false)
    }
    if (action === 'save') {
      if (saved) {
        actions.onEdit()
      } else if (actions.onAdd()) {
        setSaved(true)
      }
      setOpen(false)
    }
  }

  center.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!open && actions.shouldBlockOpen?.()) return
    if (!open && actions.onSelectSaved?.()) return
    setOpen(!open)
  })
  element.addEventListener('pointerdown', stopMapInteraction)
  element.addEventListener('click', stopMapInteraction)
  element.addEventListener('dblclick', stopMapInteraction)
  element.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!open && actions.shouldBlockOpen?.()) return
    if (!open && actions.onSelectSaved?.()) return
    setOpen(true)
  })
  for (const button of actionButtons) {
    button.addEventListener('click', runAction)
  }
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onKeyDown)
  setSaved(saved)

  return {
    element,
    setSaved,
    setLabel,
    setLabels,
    open: () => setOpen(true),
    close: closeThisMenu,
    destroy: () => {
      if (closeOpenMarkerMenu === closeThisMenu) closeOpenMarkerMenu = null
      document.removeEventListener('pointerdown', onDocumentPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    },
  }
}
