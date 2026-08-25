/**
 * Removal of `[cite: ...]` / `[cite_start]` artifacts from generated markdown.
 *
 * The master profiles in `profile_templates/` come out of an upstream generator
 * that leaves citation markers in the prose. They are plain text, so nothing in
 * the render path treats them as anything special: `sanitizeBlueprint` escapes
 * them faithfully and the engine typesets them into the PDF. A correct
 * sanitizer producing a wrong document.
 *
 * This is a CONTENT NORMALIZER, not an escape step. It runs before validation
 * and never after sanitization -- see CLAUDE.md invariant 1. Its output is raw
 * user text, still unescaped, and is what gets persisted.
 */

/**
 * The two marker families, and why they are not treated the same.
 *
 * `[cite: <refs>]` CLOSES a span. It is usually preceded by a space, so the
 * space has to be absorbed with it or a period is left stranded:
 * `...re-engineering"* [cite: 64-65].` would become `...re-engineering"* .`
 *
 * `[cite_start]` OPENS one and is glued to what follows, sitting immediately
 * before bold or link markup. Absorbing the space in front of it would weld a
 * list marker to the content: `* [cite_start]**Bold**` -> `***Bold**`, which
 * markdown then reads as an entirely different construct.
 *
 * Hence the asymmetry -- it is the whole reason this is one alternation rather
 * than one pattern.
 *
 * `[ \t]` rather than `\s`: absorbing a newline would join two lines. Both
 * arms are deliberately more tolerant than the corpus needs (optional payload
 * on `cite_start`, any payload shape on `cite:`) because the generator is not
 * under our control -- the observed refs are already a mix of bare integers
 * (`[cite: 5]`), comma lists (`[cite: 1, 2, 3]`), and hyphenated ranges
 * (`[cite: 121, 127-129, 137-139]`).
 */
const CITATION_MARKER = /\[cite_start(?::[^\]\n]*)?\]|[ \t]*\[cite:[^\]\n]*\]/g

/**
 * Strips every citation artifact from `text`.
 *
 * Unlike `escapeLatex`, this IS idempotent: after one pass no markers remain,
 * so a second pass is a no-op. The two functions sit next to each other in the
 * pipeline and the distinction matters -- re-running the escape corrodes user
 * data, re-running this one does nothing.
 *
 * Trailing whitespace is deliberately left alone. A markdown hard line break is
 * two trailing spaces, and at least one line in the observed corpus ends with a
 * marker followed by exactly that.
 */
export function stripCitations(text: string): string {
  return text.replace(CITATION_MARKER, '')
}

/**
 * Counts the citation artifacts in `text`, without removing them.
 *
 * Exists so the importer can tell the caller how much it cleaned up. "Removed
 * 98 citation artifacts" is the signal that the input came from the generator
 * at all, which is worth surfacing when nothing else about the parse looks
 * unusual.
 */
export function countCitations(text: string): number {
  return text.match(CITATION_MARKER)?.length ?? 0
}

/** One place in a blueprint that carries citation artifacts. */
export interface CitationSite {
  /** `basics.summary`, `work[0].highlights[1]` — bracket notation for indices. */
  path: string
  count: number
}

/**
 * Root keys that cannot contain a citation marker and are not user prose.
 *
 * `sections` and `selectedTemplate` are routing values, and `document` is enums,
 * clamped numbers, and a validated hex string. Walking them would be harmless
 * but pointless.
 *
 * `headings` is deliberately NOT here, unlike the equivalent skip-list in the
 * ATS harness: heading overrides are free user text that renders into the
 * document, so `{ work: 'Experience[cite: 5]' }` is a real thing to catch.
 */
const SKIPPED_ROOT_KEYS = new Set(['sections', 'selectedTemplate', 'document'])

function walk(value: unknown, path: string, sites: CitationSite[]): void {
  if (typeof value === 'string') {
    const count = countCitations(value)
    if (count) sites.push({ path, count })
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, sites))
    return
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (!path && SKIPPED_ROOT_KEYS.has(key)) continue
      walk(child, path ? `${path}.${key}` : key, sites)
    }
  }
}

/**
 * Reports every string in a blueprint that still carries citation artifacts.
 *
 * The counterpart to `stripCitations`, for the surfaces that must not mutate.
 * `stripCitations` guards the import path; anything that reaches a blueprint
 * another way — an agent assembling JSON by hand, a workflow POSTing a body —
 * keeps its markers, and they typeset into the PDF.
 *
 * Two things about where this runs.
 *
 * It must run on the BLUEPRINT, never on generated TeX. The two marker families
 * survive `escapeLatex` differently: `[cite: 1, 2, 3]` contains no LaTeX special
 * and passes through byte-identical, while `[cite_start]` contains an underscore
 * and comes out as `[cite\_start]`. Both are visible in the PDF, but a scan of
 * the `.tex` would only find one of them.
 *
 * And it is built on `countCitations` rather than its own regex, so the detector
 * and the stripper agree by construction. Reporting something `stripCitations`
 * cannot remove — the deliberately-ignored unterminated `see [cite: 1, 2`, say —
 * would be a warning with no action behind it.
 *
 * Never throws: callers include MCP handlers whose try/catch would turn any
 * exception into a tool error.
 */
export function findCitations(value: unknown): CitationSite[] {
  const sites: CitationSite[] = []
  walk(value, '', sites)
  return sites
}

/**
 * `findCitations`, rendered for the string `warnings` channel.
 *
 * Lives here rather than in each adapter so the wording cannot drift across the
 * CLI and MCP call sites.
 */
export function citationWarnings(value: unknown): string[] {
  return findCitations(value).map(
    ({ path, count }) =>
      `${path} carries ${count} citation artifact${count === 1 ? '' : 's'}`
  )
}
