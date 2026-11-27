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

/** Match BugReportCard `maxLength` — enforced here too (console / alternate callers). */
export const BUG_REPORT_MAX_TITLE_CHARS = 120
export const BUG_REPORT_MAX_DESCRIPTION_CHARS = 4000

export class BugReportSubmitError extends Error {
  readonly code: 'activation' | 'validation' | 'generic'

  constructor(
    message: string,
    code: 'activation' | 'validation' | 'generic' = 'generic',
  ) {
    super(message)
    this.name = 'BugReportSubmitError'
    this.code = code
  }
}

function assertBugReportLimits(payload: BugReportPayload): void {
  const title = payload.title.trim()
  const description = payload.description.trim()
  if (!title) {
    throw new BugReportSubmitError('Bug report title required', 'validation')
  }
  if (!description) {
    throw new BugReportSubmitError('Bug report description required', 'validation')
  }
  if (title.length > BUG_REPORT_MAX_TITLE_CHARS) {
    throw new BugReportSubmitError(
      `Bug report title exceeds ${BUG_REPORT_MAX_TITLE_CHARS} chars`,
      'validation',
    )
  }
  if (description.length > BUG_REPORT_MAX_DESCRIPTION_CHARS) {
    throw new BugReportSubmitError(
      `Bug report description exceeds ${BUG_REPORT_MAX_DESCRIPTION_CHARS} chars`,
      'validation',
    )
  }
  if (payload.screenshot) {
    if (!payload.screenshot.type.startsWith('image/')) {
      throw new BugReportSubmitError(
        'Bug report attachment must be an image',
        'validation',
      )
    }
    if (payload.screenshot.size > BUG_REPORT_MAX_IMAGE_BYTES) {
      throw new BugReportSubmitError(
        `Bug report image exceeds ${BUG_REPORT_MAX_IMAGE_BYTES} bytes`,
        'validation',
      )
    }
  }
}

/**
 * POST title + description (+ optional image) via FormSubmit → bugs@sadr3d.com
 * (opaque form id in the client; OVH redirect to the personal mailbox).
 * First live origin still needs a one-time FormSubmit “Activate Form” click.
 *
 * Spam: FormSubmit honeypot (`_honey`). Interactive reCAPTCHA stays off —
 * classic multipart + `fetch` cannot complete a captcha challenge page.
 */
export async function submitBugReport(payload: BugReportPayload): Promise<void> {
  assertBugReportLimits(payload)

  const title = payload.title.trim()
  const description = payload.description.trim()

  const form = new FormData()
  form.append('_subject', `[${APP_NAME}] ${title}`)
  form.append('_template', 'table')
  // Required for SPA fetch: captcha HTML challenge is not completable in-app.
  form.append('_captcha', 'false')
  // FormSubmit silently drops the submission if a bot fills this field.
  form.append('_honey', '')
  form.append('title', title)
  form.append('description', description)
  form.append('message', description)
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
