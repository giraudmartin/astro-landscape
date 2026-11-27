import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  BUG_REPORT_MAX_DESCRIPTION_CHARS,
  BUG_REPORT_MAX_IMAGE_BYTES,
  BUG_REPORT_MAX_TITLE_CHARS,
  BugReportSubmitError,
  submitBugReport,
  type BugReportPayload,
} from './bugReportSubmit'
import { useT } from './i18n'

export type { BugReportPayload }

type BugReportCardProps = {
  open: boolean
  onClose: () => void
  /** Override submit (tests). Defaults to FormSubmit → bugs@sadr3d.com. */
  onSubmit?: (payload: BugReportPayload) => void | Promise<void>
}

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
 * Title + description + optional image (FormSubmit, max 10 Mo).
 */
export function BugReportCard({ open, onClose, onSubmit }: BugReportCardProps) {
  const t = useT()
  const titleId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  /** i18n key of the current error (re-translated if the locale changes). */
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
      setError('settings.bug.errImageType')
      return
    }
    if (file.size > BUG_REPORT_MAX_IMAGE_BYTES) {
      setError('settings.bug.errImageSize')
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
      setError('settings.bug.errNeedTitle')
      return
    }
    if (!trimmedDescription) {
      setError('settings.bug.errNeedDesc')
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
        await submitBugReport(payload)
      }
      setSent(true)
      window.setTimeout(() => onClose(), 900)
    } catch (err) {
      setError(
        err instanceof BugReportSubmitError && err.code === 'activation'
          ? 'settings.bug.errActivate'
          : 'settings.bug.errSend',
      )
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
              {t('settings.bug.title')}
            </h2>
            <button
              type="button"
              className="spot-save-card__close"
              aria-label={t('common.close')}
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </header>

          <div className="map-card__body">
            <p className="spot-save-card__intro">{t('settings.bug.intro')}</p>

            <label className="spot-save-card__field">
              <span>{t('settings.bug.fieldTitle')}</span>
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('settings.bug.phTitle')}
                maxLength={BUG_REPORT_MAX_TITLE_CHARS}
                disabled={sending || sent}
              />
            </label>

            <label className="spot-save-card__field spot-save-card__field--textarea">
              <span>{t('settings.bug.fieldDesc')}</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('settings.bug.phDesc')}
                rows={4}
                maxLength={BUG_REPORT_MAX_DESCRIPTION_CHARS}
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
                      {screenshot?.name ?? t('settings.bug.captureFallback')}
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
                      {t('settings.bug.remove')}
                    </button>
                  </span>
                </span>
              ) : (
                <span className="bug-report-card__dropzone-copy">
                  <span className="bug-report-card__dropzone-title">
                    {t('settings.bug.dropTitle')}
                  </span>
                  <span className="bug-report-card__dropzone-hint">
                    {t('settings.bug.dropHint')}
                  </span>
                </span>
              )}
            </label>

            {error ? (
              <p className="bug-report-card__error" role="alert">
                {t(error)}
              </p>
            ) : null}

            <div className="spot-save-card__actions">
              <button
                type="submit"
                className="control-panel__primary"
                disabled={sending || sent}
              >
                {sent
                  ? t('settings.bug.sent')
                  : sending
                    ? t('settings.bug.sending')
                    : t('settings.bug.send')}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  )
}
