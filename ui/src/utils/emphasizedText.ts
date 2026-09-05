export type EmphasizedSegment = {
  text: string
  emphasize: boolean
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'on', 'in', 'of', 'to', 'for', 'and', 'or', 'at', 'by',
  'from', 'with', 'who', 'which', 'what', 'when', 'where', 'how', 'does',
  'has', 'have', 'is', 'are', 'was', 'were', 'map', 'most', 'more', 'than',
])

const PERIOD_RE =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b|(?<=\b(?:In|During) )\d{4}\b/g

function isWordChar(ch: string): boolean {
  return /\p{L}|\p{N}/u.test(ch)
}

function isBounded(text: string, start: number, end: number): boolean {
  const before = start === 0 || !isWordChar(text[start - 1]!)
  const after = end >= text.length || !isWordChar(text[end]!)
  return before && after
}

function collectPeriodTerms(text: string): string[] {
  const out: string[] = []
  PERIOD_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PERIOD_RE.exec(text)) !== null) {
    out.push(match[0])
  }
  return out
}

export function splitEmphasizedText(
  text: string,
  terms: Array<string | null | undefined>
): EmphasizedSegment[] {
  if (!text) return []

  const unique = [...new Set(
    [...terms, ...collectPeriodTerms(text)]
      .map(term => term?.trim() ?? '')
      .filter(term => term.length >= 2 && !STOPWORDS.has(term.toLowerCase()))
  )].sort((a, b) => b.length - a.length)

  const hits: { start: number; end: number }[] = []
  for (const term of unique) {
    let from = 0
    while (from <= text.length - term.length) {
      const index = text.indexOf(term, from)
      if (index < 0) break
      const end = index + term.length
      const overlaps = hits.some(hit => index < hit.end && end > hit.start)
      if (!overlaps && isBounded(text, index, end)) {
        hits.push({ start: index, end })
      }
      from = index + 1
    }
  }

  hits.sort((a, b) => a.start - b.start)

  const segments: EmphasizedSegment[] = []
  let cursor = 0
  for (const hit of hits) {
    if (hit.start > cursor) {
      segments.push({ text: text.slice(cursor, hit.start), emphasize: false })
    }
    segments.push({ text: text.slice(hit.start, hit.end), emphasize: true })
    cursor = hit.end
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), emphasize: false })
  }

  return segments.length > 0 ? segments : [{ text, emphasize: false }]
}
