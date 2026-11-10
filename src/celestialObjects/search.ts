import {
  compactCatalogToken,
  normalizeSearchText,
} from './normalize'
import type { CelestialObject, CelestialObjectType } from './types'

export type SearchHit = {
  object: CelestialObject
  score: number
  matchedOn: string
}

type IndexedObject = {
  object: CelestialObject
  nameN: string
  nameCompact: string
  aliasesN: string[]
  aliasesCompact: string[]
  tokens: string[]
}

const TYPE_PRIORITY: Record<CelestialObjectType, number> = {
  sun: 0,
  moon: 0,
  planet: 1,
  galactic_center: 1,
  constellation: 2,
  nebula: 3,
  galaxy: 3,
  cluster: 3,
  dso: 4,
  star: 5,
}

function catalogIdTokens(object: CelestialObject): string[] {
  const out: string[] = []
  const { hip, messier, ngc, ic, iau, body } = object.catalogIds
  if (hip != null) {
    out.push(`hip${hip}`, `hip ${hip}`)
  }
  if (messier != null) {
    out.push(`m${messier}`, `m ${messier}`, `messier${messier}`)
  }
  if (ngc) {
    const bare = ngc.replace(/\s+/g, '').toLowerCase()
    out.push(bare, bare.replace('ngc', 'ngc '))
  }
  if (ic) {
    const bare = ic.replace(/\s+/g, '').toLowerCase()
    out.push(bare, bare.replace('ic', 'ic '))
  }
  if (iau) out.push(normalizeSearchText(iau))
  if (body) out.push(body)
  return out.map(normalizeSearchText)
}

export function buildSearchIndex(
  catalog: readonly CelestialObject[],
): IndexedObject[] {
  return catalog.map((object) => {
    const nameN = normalizeSearchText(object.name)
    const aliasesN = object.aliases.map(normalizeSearchText)
    const idTokens = catalogIdTokens(object)
    return {
      object,
      nameN,
      nameCompact: compactCatalogToken(object.name),
      aliasesN,
      aliasesCompact: object.aliases.map(compactCatalogToken),
      tokens: [...new Set([nameN, ...aliasesN, ...idTokens])],
    }
  })
}

function scoreMatch(
  indexed: IndexedObject,
  query: string,
  queryCompact: string,
): SearchHit | null {
  const { object, nameN, nameCompact, aliasesN, aliasesCompact, tokens } =
    indexed

  if (!query) return null

  // Exact name
  if (nameN === query || nameCompact === queryCompact) {
    return { object, score: 1000, matchedOn: object.name }
  }
  for (let i = 0; i < aliasesN.length; i += 1) {
    if (aliasesN[i] === query || aliasesCompact[i] === queryCompact) {
      return { object, score: 960, matchedOn: object.aliases[i]! }
    }
  }

  // Exact catalog id token
  for (const token of tokens) {
    const tokC = compactCatalogToken(token)
    if (token === query || tokC === queryCompact) {
      return { object, score: 940, matchedOn: token }
    }
  }

  // Prefix name / alias
  if (nameN.startsWith(query) || nameCompact.startsWith(queryCompact)) {
    return { object, score: 820 - Math.min(nameN.length, 40), matchedOn: object.name }
  }
  for (let i = 0; i < aliasesN.length; i += 1) {
    if (
      aliasesN[i]!.startsWith(query) ||
      aliasesCompact[i]!.startsWith(queryCompact)
    ) {
      return {
        object,
        score: 800 - Math.min(aliasesN[i]!.length, 40),
        matchedOn: object.aliases[i]!,
      }
    }
  }

  // Word-boundary / includes
  if (nameN.includes(query) || nameCompact.includes(queryCompact)) {
    return { object, score: 700 - Math.min(nameN.length, 50), matchedOn: object.name }
  }
  for (let i = 0; i < aliasesN.length; i += 1) {
    if (
      aliasesN[i]!.includes(query) ||
      aliasesCompact[i]!.includes(queryCompact)
    ) {
      return {
        object,
        score: 680 - Math.min(aliasesN[i]!.length, 50),
        matchedOn: object.aliases[i]!,
      }
    }
  }

  for (const token of tokens) {
    if (token.includes(query) || compactCatalogToken(token).includes(queryCompact)) {
      return { object, score: 640, matchedOn: token }
    }
  }

  return null
}

export function searchCelestialObjects(
  index: IndexedObject[],
  rawQuery: string,
  limit = 12,
): SearchHit[] {
  const query = normalizeSearchText(rawQuery)
  if (query.length < 1) return []
  const queryCompact = compactCatalogToken(query)

  const hits: SearchHit[] = []
  for (const indexed of index) {
    const hit = scoreMatch(indexed, query, queryCompact)
    if (!hit) continue
    // Prefer brighter / more “famous” among equal-ish scores.
    const magBoost =
      hit.object.mag != null && Number.isFinite(hit.object.mag)
        ? Math.max(0, 6 - hit.object.mag) * 2
        : 0
    const typeBoost = 10 - TYPE_PRIORITY[hit.object.type]
    hits.push({
      ...hit,
      score: hit.score + magBoost + typeBoost,
    })
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const ta = TYPE_PRIORITY[a.object.type]
    const tb = TYPE_PRIORITY[b.object.type]
    if (ta !== tb) return ta - tb
    return a.object.name.localeCompare(b.object.name, 'fr')
  })

  return hits.slice(0, limit)
}
