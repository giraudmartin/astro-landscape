export type TranslateParams = Record<string, string | number>

/**
 * Resolve a dotted path in a nested messages object.
 * Leaf must be a string; arrays are not resolved here (use message lists).
 */
export function getMessage(
  messages: unknown,
  key: string,
): string | undefined {
  if (!key) return undefined
  let cur: unknown = messages
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

export function getMessageList(
  messages: unknown,
  key: string,
): readonly string[] | undefined {
  if (!key) return undefined
  let cur: unknown = messages
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return Array.isArray(cur) && cur.every((item) => typeof item === 'string')
    ? (cur as readonly string[])
    : undefined
}

/** Replace `{name}` placeholders. Missing params leave the token as-is. */
export function interpolate(
  template: string,
  params?: TranslateParams,
): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined || value === null ? match : String(value)
  })
}

export function translate(
  messages: unknown,
  key: string,
  params?: TranslateParams,
): string {
  const raw = getMessage(messages, key)
  if (raw === undefined) {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] missing key: ${key}`)
    }
    return key
  }
  return interpolate(raw, params)
}
