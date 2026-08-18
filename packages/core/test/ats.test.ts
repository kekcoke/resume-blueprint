import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderBlueprint, parseBlueprint, TEMPLATE_IDS } from '../dist/index.js'

/**
 * Parse-fidelity harness.
 *
 * The golden `.tex` snapshots in render.test.ts assert what the templates DO
 * emit. They cannot catch the bug this project keeps shipping: content that is
 * validated, stored, and then silently never reaches the PDF. `work[].company`
 * was that bug; so were `basics.label`, `basics.summary`, `basics.profiles`, and
 * the skill lists that run off the right edge of the page.
 *
 * This file renders a deliberately dense blueprint, extracts the text back out
 * with pdftotext, and asserts the round trip. That is also how an ATS reads a
 * resume — it never sees the LaTeX, only the extracted text layer — so the same
 * harness doubles as the parse-fidelity gate that assigns each template its tier.
 */

const execFileAsync = promisify(execFile)

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures')

/** Tectonic's first run for a given document class downloads packages. */
const COMPILE_TIMEOUT_MS = 180_000

/**
 * pdftotext ships with poppler (`brew install poppler`). It is a test-only
 * dependency: skipping is better than failing a suite on a machine that renders
 * PDFs perfectly well but cannot read them back.
 */
function hasPdftotext(): boolean {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const PDFTOTEXT = hasPdftotext()

// ---------------------------------------------------------------------------
// Text normalization
//
// A PDF's text layer is not the string that went in. TeX applies ligatures and
// smart quotes, breaks lines mid-string, and hyphenates. None of that is content
// loss, so all of it has to be folded away before comparing — otherwise the
// harness cries wolf on every long field and gets switched off.
// ---------------------------------------------------------------------------

const SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/ﬀ/g, 'ff'],
  [/ﬁ/g, 'fi'],
  [/ﬂ/g, 'fl'],
  [/ﬃ/g, 'ffi'],
  [/ﬄ/g, 'ffl'],
  [/[‘’ʼ]/g, "'"],
  [/[“”]/g, '"'],
  [/—/g, '---'],
  [/–/g, '--'],
  [/…/g, '...'],
  [/­/g, ''],
  [/ /g, ' ']
]

function normalize(text: string): string {
  let out = text
  for (const [pattern, replacement] of SUBSTITUTIONS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

/**
 * Whitespace carries no meaning once TeX has broken a line, so compare with it
 * removed entirely. This is what makes a wrap indistinguishable from a space
 * while leaving a truncation plainly visible.
 *
 * Case goes too. Templates set headings in small caps and names in all caps, and
 * several letterspace their headings, which pdftotext faithfully reports as
 * `E XP ERI EN CE`. Rendering "Ada Lovelace" as "ADA LOVELACE" is a typographic
 * choice, not content loss.
 */
function squash(text: string): string {
  return normalize(text).replace(/\s+/g, '').toLowerCase()
}

/**
 * A line broken at a hyphen is reported two different ways: `pdftotext -layout`
 * keeps the hyphen, its default mode applies the usual de-hyphenation heuristic
 * and drops it — which is also what a real parser does. Neither reading is
 * content loss, and neither is reliably the right one: joining
 * "Analyt-\nical Engine Works" recovers the employer, joining
 * "Trunk-\nBased Development" destroys a hyphen that was really there. So both
 * readings go into the haystack and a string only has to survive into one.
 */
function dehyphenate(text: string): string {
  return text.replace(/-[ \t]*\r?\n[ \t]*/g, '')
}

/** Every reading of one extraction that a parser might plausibly arrive at. */
function readings({ layout, raw }: Extraction): string[] {
  return [layout, raw, dehyphenate(layout), dehyphenate(raw)].map(squash)
}

/** A rendered URL may legitimately drop its scheme; that is not content loss. */
function squashUrl(text: string): string {
  return squash(text)
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')
}

// ---------------------------------------------------------------------------
// Walking the blueprint
// ---------------------------------------------------------------------------

type Extraction = { layout: string; raw: string }

type Leaf = { path: string; value: string; isUrl: boolean }

const URL_KEYS = new Set(['url', 'website'])

/**
 * `sections` holds enum names that are routing instructions, not content, and
 * `headings` is checked separately by the reading-order test.
 */
const SKIPPED_ROOT_KEYS = new Set(['sections', 'headings', 'selectedTemplate'])

function collectLeaves(value: unknown, path: string, key: string): Leaf[] {
  if (typeof value === 'string') {
    return value.trim() ? [{ path, value, isUrl: URL_KEYS.has(key) }] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, i) => collectLeaves(item, `${path}[${i}]`, key))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([childKey, child]) => {
      if (!path && SKIPPED_ROOT_KEYS.has(childKey)) return []
      return collectLeaves(child, path ? `${path}.${childKey}` : childKey, childKey)
    })
  }

  return []
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/**
 * `clipped` and `missing` are different bugs and get different verdicts.
 *
 * A template that never renders `education[].score` is making a design choice.
 * A template that renders `GitHub Copilo` has run its content off the edge of
 * the page and lost the rest — always a bug, in every template, with no
 * legitimate reason to allow it.
 */
type Finding = {
  path: string
  expected: string
  kind: 'clipped' | 'missing'
  found: string
}

/** Length below which a prefix match is more likely coincidence than a clip. */
const MIN_PREFIX_CHARS = 8

/** A prefix shorter than this fraction of the whole reads as "never rendered". */
const MIN_PREFIX_RATIO = 0.4

function longestPrefixPresent(needle: string, haystack: string): number {
  let low = 0
  let high = needle.length

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (haystack.includes(needle.slice(0, mid))) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return low
}

function classify(leaf: Leaf, haystack: string): Finding | undefined {
  const needle = leaf.isUrl ? squashUrl(leaf.value) : squash(leaf.value)
  if (!needle || haystack.includes(needle)) return undefined

  const matched = longestPrefixPresent(needle, haystack)
  const clipped = matched >= MIN_PREFIX_CHARS && matched >= needle.length * MIN_PREFIX_RATIO

  return {
    path: leaf.path,
    expected: leaf.value,
    kind: clipped ? 'clipped' : 'missing',
    found: needle.slice(0, matched)
  }
}

// ---------------------------------------------------------------------------
// Rendering, cached — nine Tectonic compiles is the expensive part of this file
// ---------------------------------------------------------------------------

const extractions = new Map<number, Promise<Extraction>>()

async function extract(templateId: number): Promise<Extraction> {
  const blueprint = JSON.parse(await readFile(resolve(FIXTURES, 'dense.json'), 'utf8'))
  const pdf = await renderBlueprint({ ...blueprint, selectedTemplate: templateId })

  const dir = await mkdtemp(join(tmpdir(), 'rb-ats-'))
  const pdfPath = join(dir, `template${templateId}.pdf`)

  try {
    await writeFile(pdfPath, pdf)

    // -layout preserves the visual arrangement; the default mode is closer to
    // how a naive parser walks the content stream. A template that reads well
    // one way and scrambles the other is exactly what the order test is for.
    const [layout, raw] = await Promise.all([
      execFileAsync('pdftotext', ['-layout', pdfPath, '-'], { maxBuffer: 8 << 20 }),
      execFileAsync('pdftotext', [pdfPath, '-'], { maxBuffer: 8 << 20 })
    ])

    return { layout: layout.stdout, raw: raw.stdout }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function extractionFor(templateId: number): Promise<Extraction> {
  let pending = extractions.get(templateId)
  if (!pending) {
    pending = extract(templateId)
    extractions.set(templateId, pending)
  }
  return pending
}

async function findingsFor(templateId: number): Promise<Finding[]> {
  const blueprint = JSON.parse(await readFile(resolve(FIXTURES, 'dense.json'), 'utf8'))
  const haystack = readings(await extractionFor(templateId)).join('\n')

  return collectLeaves(parseBlueprint(blueprint), '', '')
    .map((leaf) => classify(leaf, haystack))
    .filter((finding): finding is Finding => finding !== undefined)
}

function describeFindings(findings: Finding[]): string {
  return findings
    .map((f) => `    ${f.path}: expected ${JSON.stringify(f.expected)}, PDF had ${JSON.stringify(f.found)}`)
    .join('\n')
}

// ---------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------

/**
 * Fields a resume is not a resume without. A template may reasonably decline to
 * render `education[].score`; none may decline to render where you worked.
 */
const CRITICAL = [
  /^basics\.(name|label|summary|email|phone|website)$/,
  /^basics\.location\.address$/,
  /^basics\.profiles\[\d+\]\.(url|network)$/,
  /^work\[\d+\]\.(name|position|summary|startDate|endDate)$/,
  /^work\[\d+\]\.highlights\[\d+\]$/,
  /^skills\[\d+\]\.(name|keywords\[\d+\])$/,
  /^education\[\d+\]\.institution$/,
  /^projects\[\d+\]\.name$/,
  /^awards\[\d+\]\.title$/
]

function isCritical(path: string): boolean {
  return CRITICAL.some((pattern) => pattern.test(path))
}

describe('no template clips content off the page', { skip: !PDFTOTEXT && 'pdftotext not on PATH' }, () => {
  for (const id of TEMPLATE_IDS) {
    test(`template${id} wraps long content instead of truncating it`, { timeout: COMPILE_TIMEOUT_MS }, async () => {
      const clipped = (await findingsFor(id)).filter((f) => f.kind === 'clipped')

      assert.deepEqual(
        clipped,
        [],
        `template${id} truncated ${clipped.length} field(s) mid-string:\n${describeFindings(clipped)}`
      )
    })
  }
})

describe('critical resume fields survive into the PDF', { skip: !PDFTOTEXT && 'pdftotext not on PATH' }, () => {
  for (const id of TEMPLATE_IDS) {
    test(`template${id} renders every critical field`, { timeout: COMPILE_TIMEOUT_MS }, async () => {
      const lost = (await findingsFor(id)).filter((f) => isCritical(f.path))

      assert.deepEqual(
        lost,
        [],
        `template${id} lost ${lost.length} critical field(s):\n${describeFindings(lost)}`
      )
    })
  }
})

describe('extracted text preserves the blueprint reading order', { skip: !PDFTOTEXT && 'pdftotext not on PATH' }, () => {
  for (const id of TEMPLATE_IDS) {
    test(`template${id} emits sections in the declared order`, { timeout: COMPILE_TIMEOUT_MS }, async () => {
      const blueprint = JSON.parse(await readFile(resolve(FIXTURES, 'dense.json'), 'utf8'))
      const { raw } = await extractionFor(id)
      const haystack = squash(raw)

      const expected: string[] = blueprint.sections
        .filter((section: string) => section !== 'profile')
        .map((section: string) => squash(String(blueprint.headings[section])))

      const positions = expected.map((heading) => ({
        heading,
        at: haystack.indexOf(heading)
      }))

      const absent = positions.filter((p) => p.at === -1).map((p) => p.heading)
      assert.deepEqual(absent, [], `template${id} omitted section heading(s): ${absent.join(', ')}`)

      const order = positions.map((p) => p.heading)
      const sorted = [...positions].sort((a, b) => a.at - b.at).map((p) => p.heading)

      assert.deepEqual(
        sorted,
        order,
        `template${id} extracts sections as [${sorted.join(', ')}] but the blueprint declared [${order.join(', ')}] — a parser reads them in the wrong order`
      )
    })
  }
})

describe('the contact block is contiguous enough for a parser to find', { skip: !PDFTOTEXT && 'pdftotext not on PATH' }, () => {
  /** Roughly a header's worth of text. Beyond this the fields are not one block. */
  const WINDOW_CHARS = 400

  for (const id of TEMPLATE_IDS) {
    test(`template${id} keeps name, email, and phone together`, { timeout: COMPILE_TIMEOUT_MS }, async () => {
      const blueprint = JSON.parse(await readFile(resolve(FIXTURES, 'dense.json'), 'utf8'))
      const all = readings(await extractionFor(id))
      const needles = ['name', 'email', 'phone'].map((key) => ({
        key,
        needle: squash(blueprint.basics[key])
      }))

      // Positions only mean anything within a single reading, so measure the
      // spread in the first one that carries all three fields.
      const haystack =
        all.find((text) => needles.every((n) => text.includes(n.needle))) ?? all[0]

      const fields = needles.map(({ key, needle }) => ({
        key,
        at: haystack.indexOf(needle)
      }))

      const absent = fields.filter((f) => f.at === -1).map((f) => f.key)
      assert.deepEqual(absent, [], `template${id} did not render contact field(s): ${absent.join(', ')}`)

      const at = fields.map((f) => f.at)
      const spread = Math.max(...at) - Math.min(...at)

      assert.ok(
        spread <= WINDOW_CHARS,
        `template${id} spread name/email/phone across ${spread} characters (limit ${WINDOW_CHARS}) — a parser will not read them as one contact block`
      )
    })
  }
})
