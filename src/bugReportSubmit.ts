import {
  APP_BUG_REPORT_FORMSUBMIT_ID,
  APP_NAME,
  APP_VERSION,
} from './appMeta'
import { getActiveLocale } from './i18n'

export type BugReportPayload = {
  title: string
  description: string
  screenshot: File | null
}

/**
 * Non-AJAX FormSubmit endpoint. `/ajax/` drops file attachments;
 * classic multipart POST keeps images as real email attachments.
 */
const FORMSUBMIT_BASE = 'https://formsubmit.co/'

/** FormSubmit caps total uploads at 10 MB per submission. */
export const BUG_REPORT_MAX_IMAGE_BYTES = 10 * 1024 * 1024

export class BugReportSubmitError extends Error {
  readonly code: 'activation' | 'generic'

  constructor(
    message: string,
    code: 'activation' | 'generic' = 'generic',
  ) {
    super(message)
    this.name = 'BugReportSubmitError'
    this.code = code
  }
}

/**
 * POST title + description (+ optional image) via FormSubmit → bugs@sadr3d.com
 * (opaque form id in the client; OVH redirect to the personal mailbox).
 * First live origin still needs a one-time FormSubmit “Activate Form” click.
 */
export async function submitBugReport(payload: BugReportPayload): Promise<void> {
  const form = new FormData()
  form.append('_subject', `[${APP_NAME}] ${payload.title}`)
  form.append('_template', 'table')
  form.append('_captcha', 'false')
  form.append('title', payload.title)
  form.append('description', payload.description)
  form.append('message', payload.description)
  form.append('app', APP_NAME)
  form.append('app_version', APP_VERSION)
  form.append('locale', getActiveLocale())
  form.append(
    'page_url',
    typeof window !== 'undefined' ? window.location.href : '',
  )
  form.append(
    'user_agent',
    typeof navigator !== 'undefined' ? navigator.userAgent : '',
  )
  if (payload.screenshot) {
    form.append('attachment', payload.screenshot, payload.screenshot.name)
  }

  // Do not set Content-Type: the browser must add the multipart boundary.
  const response = await fetch(
    `${FORMSUBMIT_BASE}${encodeURIComponent(APP_BUG_REPORT_FORMSUBMIT_ID)}`,
    {
      method: 'POST',
      headers: { Accept: 'text/html,application/json' },
      body: form,
    },
  )

  const raw = await response.text()
  let json: { success?: string | boolean; message?: string } | null = null
  try {
    json = JSON.parse(raw) as { success?: string | boolean; message?: string }
  } catch {
    json = null
  }

  const blob = `${json?.message ?? ''} ${raw}`
  if (/activation|activate form/i.test(blob)) {
    throw new BugReportSubmitError(
      json?.message?.trim() || 'FormSubmit activation required',
      'activation',
    )
  }

  if (json) {
    const ok = json.success === true || json.success === 'true'
    if (!response.ok || !ok) {
      throw new BugReportSubmitError(
        json.message?.trim() || `FormSubmit HTTP ${response.status}`,
      )
    }
    return
  }

  // Classic endpoint answers with an HTML “Thanks!” page on success.
  if (
    !response.ok ||
    !/submitted successfully|thanks!/i.test(raw)
  ) {
    throw new BugReportSubmitError(
      `FormSubmit HTTP ${response.status}`,
    )
  }
}
