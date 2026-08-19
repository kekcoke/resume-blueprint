import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  renderBlueprint,
  parseBlueprint,
  TEMPLATE_IDS,
  TEMPLATE_PROFILES
} from '../dist/index.js'

/**
 * Parse-fidelity harness.
 *
 * The golden `.tex` snapshots in render.test.ts assert what the templates DO
 * emit. They cannot catch the bug this project keeps shipping: content that is
 * validated, stored, and then silently never reaches the PDF. `work[].company`
 * was that bug; so were `basics.label`, `basics.summary`, `basics.profiles`, and
 * the skill lists that run off the right edge of the page.
 *
 * This file renders blueprints, extracts the text back out with pdftotext, and
 * asserts the round trip. That is also how an ATS reads a resume — it never sees
 * the LaTeX, only the extracted text layer — so the same harness doubles as the
 * parse-fidelity gate that assigns each template its tier.
 *
 * Four fixtures, not one. A single dense resume cannot exhibit a page-break
 * clip, a merged skill column, a split award record, or an orphaned bullet, so
 * for as long as this file measured only `dense.json` it was blind to every
 * defect the external review actually reported. Each fixture below exists to
 * make one of those visible.
 */

const execFileAsync = promisify(execFile)

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures')

/** Tectonic's first run for a given document class downloads packages. */
const COMPILE_TIMEOUT_MS = 180_000

/**
 * A gate that loops fixtures inside one test compiles up to four documents
 * before its first assertion, so it gets the whole budget rather than a quarter
 * of it.
 */
const SUITE_TIMEOUT_MS = COMPILE_TIMEOUT_MS * 4

/**
 * The fixtures every gate below runs against.
 *
 *  - `dense`     one entry per section, every field populated, long values.
 *                Catches clipping and dropped fields.
 *  - `multipage` eight jobs and a 450-character summary. Catches content lost
 *                at a page break, and is the only fixture that exercises page 2
 *                geometry.
 *  - `grid`      ten skill categories of two to four short keywords, and eight
 *                short award records of exactly name/issuer/date. Reproduces
 *                the two column defects the external review reported.
 *  - `sparse`    near-empty. Entries that carry a name and nothing else, which
 *                is what produces a bullet with no text after it.
 */
const FIXTURE_NAMES = ['dense', 'multipage', 'grid', 'sparse'] as const

type FixtureName = (typeof FIXTURE_NAMES)[number]

/**
 * pdftotext and pdfinfo both ship with poppler (`brew install poppler`). They
 * are test-only dependencies: skipping is better than failing a suite on a
 * machine that renders PDFs perfectly well but cannot read them back.
 */
function hasBinary(name: string): boolean {
  try {
    execFileSync(name, ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const POPPLER = hasBinary('pdftotext') && hasBinary('pdfinfo')

/**
 * Locally, skipping is the right call — see above. In CI it is the worst
 * possible outcome: every gate below would skip, the run would go green, and it
 * would have verified none of the parse-fidelity claims this project is built
 * on. A green tick that means nothing is worse than no CI at all, so under CI
 * the absence of poppler is a hard failure rather than a quiet skip.
 *
 * A dedicated test rather than a throw at module load: this names the problem in
 * the runner output instead of surfacing as an opaque file-level error.
 */
test('poppler is installed', { skip: !process.env.CI && 'not CI: skipping is allowed locally' }, () => {
  assert.ok(
    POPPLER,
    'pdftotext and pdfinfo are not both on PATH, so every parse-fidelity gate in this file would skip and the suite would pass having checked none of them. Install poppler.'
  )
})

const NO_POPPLER = !POPPLER && 'poppler not on PATH'

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
  [/ /g, ' ']
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
 * "Trunk-\nBased Development" destroys a hyphen that was really there. So the
 * de-hyphenated form of every mode goes into the haystack alongside the mode
 * itself, and a string only has to survive into one of them.
 */
function dehyphenate(text: string): string {
  return text.replace(/-[ \t]*\r?\n[ \t]*/g, '')
}

/** Every reading of one extraction that a parser might plausibly arrive at. */
function readings({ layout, raw, stream }: Extraction): string[] {
  const modes = [layout, raw, stream]
  return [...modes, ...modes.map(dehyphenate)].map(squash)
}

/**
 * The same text squashed one line at a time, so a gate can ask *which* line
 * something landed on. `readings` throws line structure away deliberately, but
 * the skill-row and award-record gates below are entirely about it.
 */
function squashedLines(text: string): string[] {
  return normalize(text)
    .split('\n')
    .map((line) => line.replace(/\s+/g, '').toLowerCase())
    .filter(Boolean)
}

/**
 * Line-structured readings of the two parser-shaped modes.
 *
 * `-layout` is excluded on purpose. It reconstructs the visual arrangement,
 * which is the human's view: a two-column tabular reads back as one tidy line
 * because pdftotext pads the gap with spaces, so every column defect below
 * would measure as clean. The default mode and `-raw` are the parser's views,
 * and are where a column break shows up as a line break.
 */
function lineReadings({ raw, stream }: Extraction): string[][] {
  return [raw, stream, dehyphenate(raw), dehyphenate(stream)].map(squashedLines)
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

type Extraction = {
  /** `-layout`: the visual arrangement, i.e. what a human sees. */
  layout: string
  /** Default mode: pdftotext's reading-order heuristic, de-hyphenating as it goes. */
  raw: string
  /** `-raw`: strings in content-stream order, no reflow and no de-hyphenation. */
  stream: string
  /** `-bbox`: per-word geometry as XHTML. */
  bbox: string
  /** pdfinfo: page count and page size. */
  info: string
}

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
// Rendering, cached
//
// Thirty-six Tectonic compiles is the expensive part of this file, so the cache
// is keyed by fixture AND template. Keying it by template alone — which is what
// it did when there was only one fixture — would silently hand every gate the
// dense reading and quietly stop measuring the other three.
// ---------------------------------------------------------------------------

const fixtures = new Map<FixtureName, Promise<Record<string, unknown>>>()

function fixtureFor(name: FixtureName): Promise<Record<string, unknown>> {
  let pending = fixtures.get(name)
  if (!pending) {
    pending = readFile(resolve(FIXTURES, `${name}.json`), 'utf8').then(
      (text) => JSON.parse(text) as Record<string, unknown>
    )
    fixtures.set(name, pending)
  }
  return pending
}

const extractions = new Map<string, Promise<Extraction>>()

async function extract(fixture: FixtureName, templateId: number): Promise<Extraction> {
  const blueprint = await fixtureFor(fixture)
  const pdf = await renderBlueprint({ ...blueprint, selectedTemplate: templateId })

  const dir = await mkdtemp(join(tmpdir(), 'rb-ats-'))
  const pdfPath = join(dir, `${fixture}-template${templateId}.pdf`)

  try {
    await writeFile(pdfPath, pdf)

    // Three text modes, because parsers disagree and each one loses something
    // the others keep. -layout preserves the visual arrangement but interleaves
    // parallel columns, so a label that wraps inside a narrow column comes back
    // cut in half by the column beside it. The default mode reflows into
    // reading order but applies pdftotext's de-hyphenation heuristic, which
    // silently eats a hyphen that was really part of an email address or a URL.
    // -raw does neither: strings in content-stream order, exactly as written. A
    // field only has to survive into one of them.
    //
    // -bbox adds per-word geometry, and pdfinfo the page size that geometry is
    // measured against. One compile, five reads, cached together.
    const opts = { maxBuffer: 8 << 20 } as const
    const [layout, raw, stream, bbox, info] = await Promise.all([
      execFileAsync('pdftotext', ['-layout', pdfPath, '-'], opts),
      execFileAsync('pdftotext', [pdfPath, '-'], opts),
      execFileAsync('pdftotext', ['-raw', pdfPath, '-'], opts),
      execFileAsync('pdftotext', ['-bbox', pdfPath, '-'], opts),
      execFileAsync('pdfinfo', [pdfPath], opts)
    ])

    return {
      layout: layout.stdout,
      raw: raw.stdout,
      stream: stream.stdout,
      bbox: bbox.stdout,
      info: info.stdout
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function extractionFor(fixture: FixtureName, templateId: number): Promise<Extraction> {
  const key = `${fixture}:${templateId}`
  let pending = extractions.get(key)
  if (!pending) {
    pending = extract(fixture, templateId)
    extractions.set(key, pending)
  }
  return pending
}

async function findingsFor(fixture: FixtureName, templateId: number): Promise<Finding[]> {
  const blueprint = await fixtureFor(fixture)
  const haystack = readings(await extractionFor(fixture, templateId)).join('\n')

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
// The original four gates, now over every fixture
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

describe('no template clips content off the page', { skip: NO_POPPLER }, () => {
  for (const fixture of FIXTURE_NAMES) {
    for (const id of TEMPLATE_IDS) {
      test(`template${id} wraps long content instead of truncating it (${fixture})`, { timeout: COMPILE_TIMEOUT_MS }, async () => {
        const clipped = (await findingsFor(fixture, id)).filter((f) => f.kind === 'clipped')

        assert.deepEqual(
          clipped,
          [],
          `template${id} truncated ${clipped.length} field(s) mid-string on ${fixture}.json:\n${describeFindings(clipped)}`
        )
      })
    }
  }
})

describe('critical resume fields survive into the PDF', { skip: NO_POPPLER }, () => {
  for (const fixture of FIXTURE_NAMES) {
    for (const id of TEMPLATE_IDS) {
      test(`template${id} renders every critical field (${fixture})`, { timeout: COMPILE_TIMEOUT_MS }, async () => {
        const lost = (await findingsFor(fixture, id)).filter((f) => isCritical(f.path))

        assert.deepEqual(
          lost,
          [],
          `template${id} lost ${lost.length} critical field(s) on ${fixture}.json:\n${describeFindings(lost)}`
        )
      })
    }
  }
})

describe('extracted text preserves the blueprint reading order', { skip: NO_POPPLER }, () => {
  for (const fixture of FIXTURE_NAMES) {
    for (const id of TEMPLATE_IDS) {
      test(`template${id} emits sections in the declared order (${fixture})`, { timeout: COMPILE_TIMEOUT_MS }, async () => {
        const blueprint = await fixtureFor(fixture)
        const extraction = await extractionFor(fixture, id)

        const headings = (blueprint.headings ?? {}) as Record<string, string>

        // A fixture only declares headings for the sections it populates. Asking
        // for the rest would have the gate hunting the text layer for the string
        // "undefined".
        const expected: string[] = (blueprint.sections as string[])
          .filter((section) => section !== 'profile' && headings[section])
          .map((section) => squash(headings[section]))

        // Positions are only comparable inside a single reading, so each of the
        // two parser-shaped modes is scored whole and the section order has to
        // hold in one of them. Both are readings a real parser arrives at, and
        // a heading that wraps inside a narrow label column survives only one:
        // the default mode interleaves the column beside it, `-raw` does not.
        const scored = [extraction.raw, extraction.stream].map((mode) => {
          const haystack = squash(mode)
          const positions = expected.map((heading) => ({ heading, at: haystack.indexOf(heading) }))
          const absent = positions.filter((p) => p.at === -1).map((p) => p.heading)
          const order = positions.map((p) => p.heading)
          const sorted = [...positions].sort((a, b) => a.at - b.at).map((p) => p.heading)

          return { absent, order, sorted, ok: absent.length === 0 && sorted.join() === order.join() }
        })

        if (scored.some((reading) => reading.ok)) return

        const worst = scored[0]

        assert.deepEqual(
          worst.absent,
          [],
          `template${id} omitted section heading(s) on ${fixture}.json: ${worst.absent.join(', ')}`
        )

        assert.deepEqual(
          worst.sorted,
          worst.order,
          `template${id} extracts sections on ${fixture}.json as [${worst.sorted.join(', ')}] but the blueprint declared [${worst.order.join(', ')}] — a parser reads them in the wrong order`
        )
      })
    }
  }
})

describe('the contact block is contiguous enough for a parser to find', { skip: NO_POPPLER }, () => {
  /** Roughly a header's worth of text. Beyond this the fields are not one block. */
  const WINDOW_CHARS = 400

  for (const fixture of FIXTURE_NAMES) {
    for (const id of TEMPLATE_IDS) {
      test(`template${id} keeps name, email, and phone together (${fixture})`, { timeout: COMPILE_TIMEOUT_MS }, async () => {
        const blueprint = await fixtureFor(fixture)
        const basics = (blueprint.basics ?? {}) as Record<string, string>
        const all = readings(await extractionFor(fixture, id))

        // Only fields the fixture actually carries. `sparse.json` deliberately
        // has no website or address; a gate that failed on their absence would
        // be measuring the fixture, not the template.
        const needles = ['name', 'email', 'phone']
          .filter((key) => basics[key])
          .map((key) => ({ key, needle: squash(basics[key]) }))

        if (needles.length < 2) return

        // Positions only mean anything within a single reading, so measure the
        // spread in the first one that carries all the fields.
        const haystack =
          all.find((text) => needles.every((n) => text.includes(n.needle))) ?? all[0]

        const fields = needles.map(({ key, needle }) => ({
          key,
          at: haystack.indexOf(needle)
        }))

        const absent = fields.filter((f) => f.at === -1).map((f) => f.key)
        assert.deepEqual(absent, [], `template${id} did not render contact field(s) on ${fixture}.json: ${absent.join(', ')}`)

        const at = fields.map((f) => f.at)
        const spread = Math.max(...at) - Math.min(...at)

        assert.ok(
          spread <= WINDOW_CHARS,
          `template${id} spread name/email/phone across ${spread} characters on ${fixture}.json (limit ${WINDOW_CHARS}) — a parser will not read them as one contact block`
        )
      })
    }
  }
})

// ---------------------------------------------------------------------------
// Skill rows
//
// The external review's second concrete defect: category headers sit adjacent to
// their skill blocks in parallel columns, and legacy parsers merge the text.
// Five of the nine templates build `skillsSection` out of a two-column
// `tabular` (template7's `\cvitem` is moderncv's hint-column tabular under
// another name), so the label and its values are separate cells that the
// content stream emits as separate lines.
// ---------------------------------------------------------------------------

type SkillRow = { name: string; label: string; probe: string }

/**
 * The keyword to look for beside the label.
 *
 * The first one, usually — but a two-character keyword like `Go` matches inside
 * half the English language once whitespace is squashed out, so the first
 * keyword of four characters or more wins, and the longest is the fallback.
 */
function probeKeyword(keywords: string[]): string {
  const squashed = keywords.map(squash).filter(Boolean)
  return (
    squashed.find((keyword) => keyword.length >= 4) ??
    squashed.slice().sort((a, b) => b.length - a.length)[0] ??
    ''
  )
}

function skillRowsOf(blueprint: Record<string, unknown>): SkillRow[] {
  const skills = (blueprint.skills ?? []) as Array<{ name?: string; keywords?: string[] }>

  return skills
    .map((skill) => ({
      name: skill.name ?? '',
      label: squash(skill.name ?? ''),
      probe: probeKeyword(skill.keywords ?? [])
    }))
    .filter((row) => row.label && row.probe)
}

/** What is wrong with one reading of one PDF's skills section, if anything. */
function skillRowDefects(rows: SkillRow[], lines: string[]): string[] {
  const defects: string[] = []

  for (const row of rows) {
    const together = lines.some((line) => line.includes(row.label) && line.includes(row.probe))
    if (!together) {
      defects.push(
        `"${row.name}" and its keywords extract onto different lines — a parser reads the category as a value of its own`
      )
    }
  }

  for (const line of lines) {
    const present = rows.filter((row) => line.includes(row.label))
    if (present.length > 1) {
      defects.push(
        `${present.map((row) => `"${row.name}"`).join(' and ')} merged onto one extracted line`
      )
    }
  }

  return defects
}

/** Fixtures whose skills sections are shaped to exercise the column defect. */
const SKILL_FIXTURES: FixtureName[] = ['grid', 'dense']

describe('a skill category and its keywords extract as one row', { skip: NO_POPPLER }, () => {
  for (const profile of TEMPLATE_PROFILES) {
    test(`template${profile.id} cohesiveSkillRows is ${profile.cohesiveSkillRows}`, { timeout: SUITE_TIMEOUT_MS }, async () => {
      const reported: string[] = []

      for (const fixture of SKILL_FIXTURES) {
        const rows = skillRowsOf(await fixtureFor(fixture))
        if (!rows.length) continue

        // A row only has to survive into one plausible reading, so the fixture
        // is clean if any reading is clean, and the shortest defect list is the
        // one worth reporting.
        const perReading = lineReadings(await extractionFor(fixture, profile.id)).map((lines) =>
          skillRowDefects(rows, lines)
        )
        const best = perReading.sort((a, b) => a.length - b.length)[0]

        reported.push(...best.map((defect) => `    ${fixture}.json: ${defect}`))
      }

      assert.equal(
        reported.length === 0,
        profile.cohesiveSkillRows,
        profile.cohesiveSkillRows
          ? `template${profile.id} is recorded as keeping skill rows together but does not:\n${reported.join('\n')}`
          : `template${profile.id} is recorded as merging skill columns, but every row now extracts cleanly — update TEMPLATE_PROFILES`
      )
    })
  }
})

// ---------------------------------------------------------------------------
// Award records
//
// The external review's first concrete defect: a certifications grid whose
// issuer and date break onto lines separate from the credential name, so a
// parser reads three unrelated fragments instead of one record. `awards` is
// where certifications live until F6 gives them a section of their own, and
// `grid.json` shapes them as exactly name/issuer/date to match.
//
// The measure is the line span in the parser's reading. Zero means the three
// fields extract as one record; anything above zero is the reported defect,
// and the number says how badly.
// ---------------------------------------------------------------------------

type AwardRecord = { title: string; awarder: string; date: string; needles: string[] }

function awardRecordsOf(blueprint: Record<string, unknown>): AwardRecord[] {
  const awards = (blueprint.awards ?? []) as Array<{
    title?: string
    awarder?: string
    date?: string
  }>

  return awards
    .filter((award) => award.title && award.awarder && award.date)
    .map((award) => ({
      title: award.title as string,
      awarder: award.awarder as string,
      date: award.date as string,
      needles: [award.title, award.awarder, award.date].map((value) => squash(value as string))
    }))
}

/**
 * The line a needle lands on, choosing the occurrence closest to `anchor`.
 *
 * Nearest rather than first because a date like `2018` may legitimately appear
 * in the work section as well; the one that matters is the one beside its own
 * record.
 */
function nearestLine(lines: string[], needle: string, anchor: number): number {
  let best = -1

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(needle)) continue
    if (best === -1 || Math.abs(i - anchor) < Math.abs(best - anchor)) best = i
  }

  return best
}

/** How many lines apart an award's three fields land. `-1` if one is absent. */
function recordSpan(record: AwardRecord, lines: string[]): number {
  const [title, awarder, date] = record.needles
  const anchor = lines.findIndex((line) => line.includes(title))
  if (anchor === -1) return -1

  const at = [anchor, nearestLine(lines, awarder, anchor), nearestLine(lines, date, anchor)]
  if (at.includes(-1)) return -1

  return Math.max(...at) - Math.min(...at)
}

describe('an award extracts as one record, not three fragments', { skip: NO_POPPLER }, () => {
  for (const profile of TEMPLATE_PROFILES) {
    test(`template${profile.id} cohesiveRecords is ${profile.cohesiveRecords}`, { timeout: COMPILE_TIMEOUT_MS }, async () => {
      // `grid.json` only. Its awards are exactly name/issuer/date, which is the
      // shape the review asked for; dense.json's single award carries a prose
      // summary that legitimately wraps, and measuring line spans across a
      // wrapped paragraph would report the fixture rather than the template.
      const records = awardRecordsOf(await fixtureFor('grid'))
      const perReading = lineReadings(await extractionFor('grid', profile.id))

      const reported: string[] = []

      for (const record of records) {
        const spans = perReading.map((lines) => recordSpan(record, lines))
        const best = spans.filter((span) => span >= 0).sort((a, b) => a - b)[0]

        if (best === undefined) {
          reported.push(`    "${record.title}": one of title/awarder/date never reached the text layer`)
        } else if (best > 0) {
          reported.push(
            `    "${record.title}": title, "${record.awarder}", and ${record.date} span ${best + 1} extracted lines`
          )
        }
      }

      assert.equal(
        reported.length === 0,
        profile.cohesiveRecords,
        profile.cohesiveRecords
          ? `template${profile.id} is recorded as keeping award records whole but does not:\n${reported.join('\n')}`
          : `template${profile.id} is recorded as splitting award records, but every record now extracts on one line — update TEMPLATE_PROFILES`
      )
    })
  }
})

// ---------------------------------------------------------------------------
// Orphan bullets
//
// An entry that carries a name and nothing else still gets its `\item`, and the
// bullet prints with no text after it. A human skims past it; a parser reads a
// value that is a bullet character. `sparse.json` is built to provoke exactly
// this, which is why its education entry has an institution and no degree.
// ---------------------------------------------------------------------------

/**
 * Deliberately not the dashes. An en dash alone on a line is a date range that
 * wrapped, not a bullet, and including it would make this gate cry wolf on
 * every template. template3's `\item[]` prints no glyph at all — an empty
 * optional label — so it is correctly invisible here.
 */
const BARE_BULLET = /^[\s•·‣▪◦∙*]+$/

function bareBulletLines(text: string): string[] {
  return normalize(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && BARE_BULLET.test(line))
}

describe('no extracted line is a bullet with nothing after it', { skip: NO_POPPLER }, () => {
  for (const profile of TEMPLATE_PROFILES) {
    test(`template${profile.id} orphanBullets is ${profile.orphanBullets}`, { timeout: SUITE_TIMEOUT_MS }, async () => {
      const reported: string[] = []

      for (const fixture of FIXTURE_NAMES) {
        const { layout, raw, stream } = await extractionFor(fixture, profile.id)
        const orphans = [layout, raw, stream].flatMap(bareBulletLines)

        if (orphans.length) {
          reported.push(`    ${fixture}.json: ${orphans.length} line(s) reading only ${JSON.stringify(orphans[0])}`)
        }
      }

      assert.equal(
        reported.length > 0,
        profile.orphanBullets,
        profile.orphanBullets
          ? `template${profile.id} is recorded as emitting orphan bullets but none appeared — update TEMPLATE_PROFILES`
          : `template${profile.id} is recorded as bullet-clean but emits bullets with no text:\n${reported.join('\n')}`
      )
    })
  }
})

// ---------------------------------------------------------------------------
// Page geometry
//
// The lowest-scoring axis of the external review, and the one the harness could
// not see at all: margins, measured rather than asserted. `pdftotext -bbox`
// gives a box per word in PDF points at 72 to the inch, origin top left;
// pdfinfo gives the page size those boxes are measured against.
//
// This is the text bounding box, not the declared `geometry` margin. That is
// the point — it is what a reader and a parser actually get, it accounts for a
// class whose defaults nothing in this repo sets, and an overfull box that runs
// into the margin shows up here as a number rather than as a warning nobody
// reads.
// ---------------------------------------------------------------------------

/** The external review's universal rule, and F3's hard schema floor. */
const MARGIN_FLOOR_IN = 0.5

const PDF_POINTS_PER_INCH = 72

type PageBox = {
  width: number
  height: number
  words: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function parsePageBoxes(bbox: string): PageBox[] {
  const pages: PageBox[] = []
  const pageRe = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g

  let page: RegExpExecArray | null
  while ((page = pageRe.exec(bbox)) !== null) {
    const wordRe = /<word xMin="(-?[\d.]+)" yMin="(-?[\d.]+)" xMax="(-?[\d.]+)" yMax="(-?[\d.]+)"/g

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let words = 0

    let word: RegExpExecArray | null
    while ((word = wordRe.exec(page[3])) !== null) {
      words++
      minX = Math.min(minX, Number(word[1]))
      minY = Math.min(minY, Number(word[2]))
      maxX = Math.max(maxX, Number(word[3]))
      maxY = Math.max(maxY, Number(word[4]))
    }

    pages.push({ width: Number(page[1]), height: Number(page[2]), words, minX, maxX, minY, maxY })
  }

  return pages
}

function pageCountFromInfo(info: string): number {
  const match = info.match(/^Pages:\s+(\d+)/m)
  return match ? Number(match[1]) : 0
}

function paperFromInfo(info: string): string {
  const match = info.match(/^Page size:\s+(.+)$/m)
  return match ? match[1].trim() : 'unknown'
}

type MarginReading = { inches: number; where: string }

function tightestMargin(fixture: FixtureName, pages: PageBox[]): MarginReading | undefined {
  let tightest: MarginReading | undefined

  pages.forEach((page, index) => {
    // A page with no words has no text box to measure. Blank trailing pages are
    // a layout smell, but they are not a margin violation.
    if (!page.words) return

    const edges: Array<[string, number]> = [
      ['left', page.minX],
      ['right', page.width - page.maxX],
      ['top', page.minY],
      ['bottom', page.height - page.maxY]
    ]

    for (const [edge, points] of edges) {
      const inches = points / PDF_POINTS_PER_INCH
      if (!tightest || inches < tightest.inches) {
        tightest = { inches, where: `${fixture}.json page ${index + 1} ${edge}` }
      }
    }
  })

  return tightest
}

describe('text stays clear of the page edges', { skip: NO_POPPLER }, () => {
  for (const profile of TEMPLATE_PROFILES) {
    test(`template${profile.id} clearsMarginFloor is ${profile.clearsMarginFloor}`, { timeout: SUITE_TIMEOUT_MS }, async () => {
      let tightest: MarginReading | undefined
      const papers = new Set<string>()

      for (const fixture of FIXTURE_NAMES) {
        const { bbox, info } = await extractionFor(fixture, profile.id)
        const pages = parsePageBoxes(bbox)

        // Cross-check the two tools against each other. A bbox extraction that
        // silently stopped short would otherwise measure a document that is not
        // the one that was rendered.
        assert.equal(
          pages.length,
          pageCountFromInfo(info),
          `template${profile.id} on ${fixture}.json: pdftotext -bbox reported ${pages.length} page(s) but pdfinfo reported ${pageCountFromInfo(info)}`
        )

        papers.add(paperFromInfo(info))

        const reading = tightestMargin(fixture, pages)
        if (reading && (!tightest || reading.inches < tightest.inches)) tightest = reading
      }

      assert.ok(tightest, `template${profile.id} produced no measurable text on any fixture`)

      const measured = tightest.inches.toFixed(3)

      assert.equal(
        tightest.inches >= MARGIN_FLOOR_IN,
        profile.clearsMarginFloor,
        profile.clearsMarginFloor
          ? `template${profile.id} is recorded as clearing the ${MARGIN_FLOOR_IN}in floor but its text comes within ${measured}in of the edge (${tightest.where}; paper ${[...papers].join(', ')})`
          : `template${profile.id} is recorded as breaching the ${MARGIN_FLOOR_IN}in floor but its tightest margin is now ${measured}in (${tightest.where}) — update TEMPLATE_PROFILES`
      )
    })
  }
})

// ---------------------------------------------------------------------------
// The catalog has to match what is measured, or it is just a claim
// ---------------------------------------------------------------------------

/** Everything TeX may introduce on its own without it meaning icon-font glyphs. */
const TYPOGRAPHIC = new Set([...'–—‘’“”…•·−­ ', ...'ﬀﬁﬂﬃﬄ'])

function isPrivateUse(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return code >= 0xe000 && code <= 0xf8ff
}

/**
 * Characters in the text layer that came from neither the blueprint nor ordinary
 * typography — which in practice means an icon font.
 *
 * template2 labels its contacts with FontAwesome, which extracts as private-use
 * characters; template7 gets moderncv's icons, which extract as mis-mapped Latin
 * (U+0232, U+0307). Either way a parser reads a stray token immediately before
 * the email address.
 */
function strayGlyphs(text: string, blueprint: unknown): Set<string> {
  const source = new Set(JSON.stringify(blueprint).toLowerCase())

  return new Set(
    [...text].filter((char) => {
      if (isPrivateUse(char)) return true
      if ((char.codePointAt(0) ?? 0) <= 127) return false
      return !source.has(char.toLowerCase()) && !TYPOGRAPHIC.has(char)
    })
  )
}

/**
 * These two assertions read TEMPLATE_PROFILES and nothing else — no compile, no
 * extraction, no binaries. They lived inside the guarded describe below, which
 * meant a machine without poppler silently stopped checking the catalog's
 * internal consistency as well as its measured claims. Nothing about them needs
 * a guard, so they no longer have one.
 */
describe('the template catalog is internally consistent', () => {
  test('every template id has exactly one profile', () => {
    assert.deepEqual(
      TEMPLATE_PROFILES.map((profile) => profile.id),
      [...TEMPLATE_IDS]
    )
  })

  for (const profile of TEMPLATE_PROFILES) {
    // atsGrade is the conjunction of the four original gates and a clean text
    // layer. Those gates are asserted per template already, so what is left to
    // check here is that the flag agrees with the icon finding. The four fields
    // added by the harness v2 work — clearsMarginFloor, cohesiveSkillRows,
    // cohesiveRecords, orphanBullets — deliberately do NOT feed atsGrade yet:
    // they record defects F3 and F5 have not fixed, and folding them in now
    // would shrink ATS_TEMPLATE_IDS for problems nobody has addressed.
    test(`template${profile.id} atsGrade is ${profile.atsGrade}`, () => {
      assert.equal(
        profile.atsGrade,
        !profile.iconLabeledContacts,
        `template${profile.id}'s atsGrade disagrees with its own iconLabeledContacts`
      )
    })
  }
})

describe('the template catalog matches what the harness measures', { skip: NO_POPPLER }, () => {
  for (const profile of TEMPLATE_PROFILES) {
    test(`template${profile.id} iconLabeledContacts is ${profile.iconLabeledContacts}`, { timeout: COMPILE_TIMEOUT_MS }, async () => {
      const blueprint = await fixtureFor('dense')
      const { raw } = await extractionFor('dense', profile.id)
      const stray = strayGlyphs(raw, parseBlueprint(blueprint))

      assert.equal(
        stray.size > 0,
        profile.iconLabeledContacts,
        profile.iconLabeledContacts
          ? `template${profile.id} is marked as icon-labeled but its text layer is clean — update TEMPLATE_PROFILES`
          : `template${profile.id} is marked as icon-free but its text layer carries ${[...stray]
              .map((c) => `U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`)
              .join(' ')} — update TEMPLATE_PROFILES`
      )
    })
  }
})
