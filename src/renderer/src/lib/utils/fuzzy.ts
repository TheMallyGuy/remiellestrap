/**
 * A small subsequence matcher for the command palette.
 *
 * Deliberately not a general fuzzy engine: it answers one question — "does this
 * query appear in this text, in order, and how well?" — with a score that ranks
 * the matches people actually meant above the ones that merely qualify.
 *
 * Ranking favours, in order: a prefix, then a word start, then a run of
 * consecutive characters, then anything else. Gaps cost a little, and a long
 * haystack costs a little more, so `home` beats `choreography` for "ho".
 */

export interface FuzzyHit {
  /** Higher is better. Never negative for a match. */
  score: number
  /** Indices in the original text that matched, for highlighting. */
  positions: number[]
}

/** Characters that begin a new word for scoring purposes. */
const WORD_BREAKS = new Set([' ', '-', '_', '/', '·', ':', '('])

export function fuzzyMatch(query: string, text: string): FuzzyHit | null {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return { score: 0, positions: [] }

  const haystack = text.toLowerCase()

  const positions: number[] = []
  let score = 0
  let index = 0
  let previous = -2

  for (const character of needle) {
    const found = haystack.indexOf(character, index)
    if (found === -1) return null

    positions.push(found)

    if (found === 0) score += 16
    else if (WORD_BREAKS.has(haystack[found - 1])) score += 12
    else if (found === previous + 1) score += 8
    else score += 2

    // A gap is cheaper than no match, but not free.
    if (previous >= 0 && found > previous + 1) score -= Math.min(found - previous - 1, 6)

    previous = found
    index = found + 1
  }

  // Mild preference for shorter text: the same query matching a two-word label
  // should outrank matching a paragraph.
  score -= Math.min(haystack.length, 60) / 20

  return { score, positions }
}

/** Best match across several fields of one item, e.g. title and keywords. */
export function bestMatch(
  query: string,
  fields: Array<string | null | undefined>
): FuzzyHit | null {
  let best: FuzzyHit | null = null

  for (const field of fields) {
    if (!field) continue
    const hit = fuzzyMatch(query, field)
    if (hit && (!best || hit.score > best.score)) best = hit
  }

  return best
}
