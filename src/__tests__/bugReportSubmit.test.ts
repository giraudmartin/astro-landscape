import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../appMeta', () => ({
  APP_NAME: 'Sadr3D Sphere',
  APP_VERSION: '0.0.0-test',
  APP_BUG_REPORT_FORMSUBMIT_ID: 'bd277273e7d841eeadd4173be52b42a8',
}))

vi.mock('../i18n', () => ({
  getActiveLocale: () => 'fr',
}))

import {
  BugReportSubmitError,
  submitBugReport,
} from '../bugReportSubmit'

describe('submitBugReport', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  it('POSTs multipart FormData to the classic FormSubmit endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        '<html><h1>Thanks!</h1><p>The form was submitted successfully.</p></html>',
    })

    const shot = new File([new Uint8Array([1, 2, 3])], 'shot.png', {
      type: 'image/png',
    })

    await submitBugReport({
      title: 'Map frozen',
      description: 'Pitch down in stereo',
      screenshot: shot,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://formsubmit.co/bd277273e7d841eeadd4173be52b42a8',
    )
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get('title')).toBe('Map frozen')
    expect(form.get('attachment')).toBeInstanceOf(File)
  })

  it('rejects with activation code when FormSubmit asks to activate', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: 'false',
          message: "This form needs Activation. We've sent you an email…",
        }),
    })

    const err = await submitBugReport({
      title: 't',
      description: 'd',
      screenshot: null,
    }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(BugReportSubmitError)
    expect((err as BugReportSubmitError).code).toBe('activation')
  })
})
