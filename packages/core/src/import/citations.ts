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
