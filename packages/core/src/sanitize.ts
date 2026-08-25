import type { Blueprint } from './schema.js'

/**
 * LaTeX escaping and empty-value pruning.
 *
 * Ported from `app/server/src/middleware/sanitizer.js` on the original repo's
 * `v2-(old)` branch, which wrapped the `sanitize-latex` package. The 2024 rewrite
 * dropped sanitization entirely — a repo-wide grep for `sanitiz|escape|valid`
 * returned only TODO comments.
 *
 * Why this matters more here than it did for the website: in this service the
 * blueprint content may be written by an LLM or scraped from a job posting, and
 * it is interpolated into a document handed to a TeX engine. TeX is a programming
 * language. Unescaped, `\input{/etc/passwd}` reads a local file into the rendered
 * PDF and `\write18{...}` shells out where shell-escape is enabled. Escaping here
 * is the primary defense; the renderer disabling shell-escape is the second.
 *
 * Two behaviors are load-bearing and must not be "simplified" away:
 *
 *  1. Escaping is a SINGLE regex pass with a lookup table. Sequential
 *     `.replace()` calls would re-scan the braces introduced by replacements
 *     like `\textbackslash{}` and double-escape them.
 *
 *  2. Empty-value pruning is recursive and removes empty strings, arrays, and
 *     objects. The templates decide whether to emit a section by testing
 *     truthiness (`if (!education) return ''`), so pruning is what keeps blank
 *     sections out of the output rather than emitting an empty header.
 */

const LATEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '^': '\\textasciicircum{}',
  _: '\\_',
  '~': '\\textasciitilde{}',
  '%': '\\%'
}

const LATEX_SPECIALS = /[\\{}$&#^_~%]/g

/**
 * Control characters that have no business in a resume and can confuse the engine.
 * Tab, newline, and carriage return are deliberately excluded — `normalizeWhitespace`
 * collapses those into single spaces rather than deleting them and welding words together.
 */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

/** Keys whose values are URLs and need URL-aware handling rather than plain escaping. */
const URL_KEYS = new Set(['url', 'website'])

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * Escapes every LaTeX special character in a string so it typesets as literal text.
 *
 * After this, `\input{x}` becomes `\textbackslash{}input\{x\}` — visible text, not
 * a command.
 */
export function escapeLatex(text: string): string {
  return text
    .replace(CONTROL_CHARS, '')
    .replace(LATEX_SPECIALS, (char) => LATEX_ESCAPES[char] ?? char)
}

/**
 * Validates and escapes a URL for use inside `\href{...}{...}`.
 *
 * The templates interpolate the same value into both arguments — the link target
 * and the visible label — so the result must be simultaneously valid as a URL and
 * safe as typeset text. That rules out the `\textbackslash{}` style replacements,
 * which would corrupt the target.
 *
 * The approach: normalize through the URL parser (which percent-encodes
 * backslashes, braces, and carets), percent-encode the tilde by hand (legal in a
 * URL, an active character in LaTeX), then apply only backslash-prefixed escapes
 * that hyperref accepts in both arguments.
 *
 * @returns the escaped URL, or `undefined` if it is unparseable or uses a
 *   protocol other than http/https/mailto — `javascript:` and `file:` are
 *   rejected rather than passed through.
 */
export function sanitizeUrl(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    // Bare domains like "github.com/user" are common in resumes; assume https.
    try {
      parsed = new URL(`https://${trimmed}`)
    } catch {
      return undefined
    }
  }

  if (!SAFE_URL_PROTOCOLS.has(parsed.protocol)) return undefined

  const normalized = parsed.href.replace(/~/g, '%7E')

  // Belt and braces: nothing here should survive URL normalization anyway.
  if (/[\\{}^]/.test(normalized)) return undefined

  return normalized.replace(/[%#&_$]/g, (char) => `\\${char}`)
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'number') return Number.isNaN(value)
  if (typeof value === 'string') return !/\S/.test(value)
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object')
    return Object.keys(value as object).length === 0
  return false
}

/** Collapses runs of whitespace and trims, matching the original sanitizer. */
function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s\s+/g, ' ')
}

function sanitizeValue(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    const normalized = normalizeWhitespace(value)
    if (!normalized) return undefined
    return key && URL_KEYS.has(key)
      ? sanitizeUrl(normalized)
      : escapeLatex(normalized)
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => sanitizeValue(item, key))
      .filter((item) => !isEmpty(item))
    return items.length ? items : undefined
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      const sanitized = sanitizeValue(childValue, childKey)
      if (!isEmpty(sanitized)) result[childKey] = sanitized
    }
    return Object.keys(result).length ? result : undefined
  }

  return value
}

/** Content sections that carry user text and must be escaped. */
const CONTENT_KEYS = [
  'basics',
  'work',
  'education',
  'skills',
  'projects',
  'awards',
  'certificates',
  'headings'
] as const

/**
 * Escapes and prunes a validated blueprint, returning a value safe to hand to
 * `getTemplateData`.
 *
 * The control fields `sections`, `selectedTemplate`, and `document` are passed
 * through untouched. `sections` and `selectedTemplate` are a closed enum and a
 * validated integer; escaping them would corrupt the section dispatch.
 * `document` is entirely enums, clamped numbers, and a regex-validated hex
 * string — no free text reaches it, by construction of `DocumentConfigSchema`
 * — so nothing here may take the `escapeLatex` path. This line is load-bearing:
 * `sanitizeBlueprint`'s result object is built from an explicit allowlist, so
 * a `document` block that is not copied here never reaches `getTemplateData`
 * at all, silently, with no error anywhere in the chain. See
 * `sanitize.test.ts`'s "does not drop the document block" case.
 */
export function sanitizeBlueprint(blueprint: Blueprint): Blueprint {
  const result: Record<string, unknown> = {
    sections: blueprint.sections,
    selectedTemplate: blueprint.selectedTemplate,
    document: blueprint.document,
    headings: {}
  }

  for (const key of CONTENT_KEYS) {
    const sanitized = sanitizeValue(blueprint[key], key)
    if (!isEmpty(sanitized)) result[key] = sanitized
  }

  return result as Blueprint
}
