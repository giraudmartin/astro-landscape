import type { fr } from './fr'

/**
 * Widen literal string leaves so other locales can satisfy the same key tree
 * (`fr` is `as const`; without widening, `en` would have to match French text).
 * Arrays become `readonly string[]` (tips may differ in length only by accident —
 * keep order/length aligned).
 */
type Widen<T> = T extends string
  ? string
  : T extends readonly unknown[]
    ? readonly string[]
    : { [K in keyof T]: Widen<T[K]> }

/** Message catalog shape — French is the source of truth for keys. */
export type Messages = Widen<typeof fr>
