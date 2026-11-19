import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'

export type BugReportPayload = {
  title: string
  description: string
  screenshot: File | null
}

type BugReportCardProps = {
  open: boolean
  onClose: () => void
  /** Wire to email / Formspree / Resend later. Defaults to a no-op stub. */
  onSubmit?: (payload: BugReportPayload) => void | Promise<void>
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function CloseIcon() {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

function isImageFile(file: File | null | undefined): file is File {
  return Boolean(file && file.type.startsWith('image/'))
}

/**
 * Bug report dialog — same glass card language as SpotSaveCard.
 * Submit is stubbed until a mail / feedback endpoint is wired.
 */
export function BugReportCard({ open, onClose, onSubmit }: BugReportCardProps) {
  const titleId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setScreenshot(null)
    setError(null)
    setSending(false)
    setSent(false)
  }, [open])

  useEffect(() => {
    if (!screenshot) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(screenshot)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [screenshot])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const applyFile = (file: File | null | undefined) => {
    if (!file) return
    if (!isImageFile(file)) {
      setError('Ajoute une image (PNG, JPG, WebP…).')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image trop lourde (max 8 Mo).')
      return
    }
    setError(null)
    setScreenshot(file)
  }

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragOver(false)
    applyFile(event.dataTransfer.files?.[0])
  }

  const handleSubmit = async () => {
    const trimmedTitle = title.trim()
    const trimmedDescription = description.trim()
    if (!trimmedTitle) {
      setError('Ajoute un titre.')
      return
    }
    if (!trimmedDescription) {
      setError('Décris le bug.')
      return
    }

    const payload: BugReportPayload = {
      title: trimmedTitle,
      description: trimmedDescription,
      screenshot,
    }

    setSending(true)
    setError(null)
    try {
      if (onSubmit) {
        await onSubmit(payload)
      } else {
        // Stub until mail / Formspree / Resend is connected.
        console.info('[bug-report]', {
          title: payload.title,
          description: payload.description,
          screenshot: payload.screenshot
            ? {
                name: payload.screenshot.name,
                size: payload.screenshot.size,
                type: payload.screenshot.type,
              }
            : null,
        })
      }
      setSent(true)
      window.setTimeout(() => onClose(), 900)
    } catch {
      setError("Envoi impossible pour l'instant. Réessaie plus tard.")
    } finally {
      setSending(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="spot-save-card-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        className="spot-save-card bug-report-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit()
        }}
      >
        <div className="map-card map-card--spot-save">
          <header className="map-card__header">
            <h2 className="map-card__title" id={titleId}>
              Signaler un bug
            </h2>
            <button
              type="button"
              className="spot-save-card__close"
              aria-label="Fermer"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </header>

          <div className="map-card__body">
            <p className="spot-save-card__intro">
              Décris ce qui ne marche pas. Une capture aide beaucoup.
            </p>

            <label className="spot-save-card__field">
              <span>Titre</span>
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ex. Carte figée en 3D"
                maxLength={120}
                disabled={sending || sent}
              />
            </label>

            <label className="spot-save-card__field spot-save-card__field--textarea">
              <span>Description</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Que s’est-il passé ? Sur quel appareil / navigateur ?"
                rows={4}
                maxLength={4000}
                disabled={sending || sent}
              />
            </label>

            <label
              className={
                dragOver
                  ? 'bug-report-card__dropzone is-dragover'
                  : previewUrl
                    ? 'bug-report-card__dropzone has-preview'
                    : 'bug-report-card__dropzone'
              }
              onDragEnter={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={(event) => {
                event.preventDefault()
                if (event.currentTarget.contains(event.relatedTarget as Node)) {
                  return
                }
                setDragOver(false)
              }}
              onDrop={onDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="bug-report-card__file-input"
                disabled={sending || sent}
                onChange={(event) => {
                  applyFile(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
              {previewUrl ? (
                <span className="bug-report-card__preview">
                  <img src={previewUrl} alt="" />
                  <span className="bug-report-card__preview-meta">
                    <span className="bug-report-card__preview-name">
                      {screenshot?.name ?? 'Capture'}
                    </span>
                    <button
                      type="button"
                      className="bug-report-card__remove"
                      disabled={sending || sent}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setScreenshot(null)
                        setError(null)
                      }}
                    >
                      Retirer
                    </button>
                  </span>
                </span>
              ) : (
                <span className="bug-report-card__dropzone-copy">
                  <span className="bug-report-card__dropzone-title">
                    Glisse une capture ici
                  </span>
                  <span className="bug-report-card__dropzone-hint">
                    ou clique pour choisir une image
                  </span>
                </span>
              )}
            </label>

            {error ? (
              <p className="bug-report-card__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="spot-save-card__actions">
              <button
                type="submit"
                className="control-panel__primary"
                disabled={sending || sent}
              >
                {sent ? 'Envoyé' : sending ? 'Envoi…' : 'Envoyer'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  )
}
