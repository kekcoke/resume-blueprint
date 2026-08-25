import type {
  BlueprintInput,
  Basics,
  Certificate,
  Education,
  Skill
} from '../schema.js'
import { stripCitations, countCitations } from './citations.js'

/**
 * Parses a "master profile" markdown document into a blueprint.
 *
 * Takes a string, never a path: core performs no I/O it was not handed, so the
 * adapter reads the file (CLAUDE.md invariant 3).
 *
 * The order of operations is load-bearing. Line endings are normalized, then
 * citation artifacts are stripped, then the text is parsed -- and what comes
 * out is RAW user text. Nothing here escapes anything; `blueprintToTex`
 * sanitizes on the way to the engine. Escaping at import time would write
 * escaped text into storage, and `sanitizeBlueprint` is not idempotent, so the
 * content would corrode on every subsequent edit (CLAUDE.md invariant 1).
 *
 * The parser is deliberately tolerant and reports rather than guesses silently.
 * The three real profiles this was written against are structurally isomorphic
 * but disagree with each other in three places, and `BlueprintSchema` has no
 * home for several things a profile can contain -- zod objects are non-strict,
 * so anything unmapped would vanish with no error anywhere. Every such case
 * appends a warning instead.
 */

/** The parse result. */
export interface ProfileImportResult {
  /** Un-defaulted blueprint: no `sections`, `selectedTemplate`, `headings`, or
   *  `document`. Those carry `.default()`s in `BlueprintSchema`, so the
   *  caller's `parseBlueprint` fills them in. */
  blueprint: BlueprintInput
  /** Everything the parser could not map, or mapped by assumption. Each entry
   *  names the 1-based source line so a human can go look. */
  warnings: string[]
}

/** Thrown for input that is not a profile document at all. Deliberately a plain
 *  Error, never a ZodError: adapters branch on `isValidationError`, and a
 *  malformed-markdown failure reported as a schema failure sends the caller to
 *  look at the wrong thing. */
export class ProfileParseError extends Error {
  override name = 'ProfileParseError'
}

/**
 * Section classification is by keyword, never by exact heading string.
 *
 * The three profiles use three different skills headings ("Core Technical Skill
 * Matrix", "Infrastructure & SRE Technical Skill Matrix", "Core Competencies &
 * Skills Matrix") and two different experience headings ("Professional
 * Experience", "Targeted Infrastructure & SRE Experience"). Only metadata,
 * summary, and education are stable strings. Matching exactly would silently
 * drop most of two of the three documents.
 *
 * Order matters: /certificat/ has to lose to nothing else, and `education`
 * covers the combined "Education & Certifications" heading, so it is tested
 * before the looser patterns.
 */
const SECTION_PATTERNS: ReadonlyArray<readonly [RegExp, ProfileSection]> = [
  [/metadata|contact|details/i, 'metadata'],
  [/education|certificat|credential/i, 'education'],
  [/skill|competenc|technolog/i, 'skills'],
  [/experience|employment|history/i, 'work'],
  [/summary|objective|profile/i, 'summary']
]

type ProfileSection = 'metadata' | 'summary' | 'skills' | 'work' | 'education'

/**
 * A work entry as it goes IN, not as it comes out.
 *
 * `WorkSchema` carries a `.transform()` that folds the legacy `company` alias
 * into `name`, so the exported `Work` type is the post-transform shape where
 * `name` is required (present, possibly undefined). The parser builds entries
 * incrementally and may legitimately hold a position before it has an employer
 * -- that is the inverted-heading case -- so it needs the input shape.
 */
type WorkInput = NonNullable<BlueprintInput['work']>[number]

/** `- **Label:** value` / `* **Label:** value`. The label is captured from
 *  between the bold markers rather than by splitting on the first colon,
 *  because labels contain commas AND colons are common in values. */
const LABELLED_BULLET = /^\s*[-*]\s+\*\*(.+?):\*\*\s*(.*)$/

/** A plain `- ` bullet with no bold label. */
const PLAIN_BULLET = /^\s*[-*]\s+(.*)$/

/** `**Job Title** *(Start - End)*`, the line under each `###`. The date group
 *  is optional; some entries omit it. */
const ROLE_LINE = /^\s*\*\*(.+?)\*\*(?:\s*\*\((.+?)\)\*)?\s*$/

/** Company/location and title/company separator. Em dash, en dash, or a
 *  spaced ASCII hyphen -- all three appear across the corpus. */
const NAME_LOCATION_SPLIT = /\s+[—–-]\s+/

/** A date range inside the `*(...)*` wrapper. Anchored to that wrapper by the
 *  caller and never applied to prose: the corpus contains `4–7% YoY`, which uses
 *  the SAME en dash codepoint as a date range. */
const DATE_RANGE_SPLIT = /\s+[—–-]\s+/

/** A trailing `(2025)` on an education or certificate line. */
const TRAILING_YEAR = /\s*\((\d{4}(?:\s*[—–-]\s*(?:\d{4}|Present))?)\)\s*$/i

/** Words that identify a string as the institution rather than the credential.
 *  Needed because two profiles write `**<credential>:** <school>` and the third
 *  inverts it. */
const INSTITUTION_WORDS =
  /\b(universit|college|institute?|school|polytechnic|academy|seminary|conservatory)/i

/** Words that mark a string as the CREDENTIAL rather than the institution.
 *  Tested first, because it is the more reliable signal: "Data Engineering
 *  Community Bootcamp Certificate" contains an institution-ish word but is
 *  plainly the credential, and the institution is the `Dataexpert.io` beside
 *  it. Checking institution words first got that one backwards, silently. */
const CREDENTIAL_WORDS =
  /\b(certificat|certified|credential|diploma|degree|bachelor|master'?s|doctora|phd|associate|bootcamp|course|training|nanodegree|b\.?sc|m\.?sc|b\.?a\b|m\.?a\b)/i

/** A bare all-caps token like `MIT` or `UCL`. Schools abbreviate to one of
 *  these; credentials ("Technical Diploma in Computer Systems Technology") do
 *  not. Only consulted when the other side is a multi-word phrase, so
 *  `AWS Certified Cloud Practitioner` vs `Amazon Web Services` -- where both
 *  sides are phrases -- still falls through to the warning. */
const INSTITUTION_ACRONYM = /^[A-Z0-9&.]{2,8}$/

/** Hostname fragment -> the network name a human would recognize. Anything not
 *  listed falls back to the hostname itself, which reads acceptably for
 *  `linktr.ee` and `labs.example.com` alike. */
/** Metadata labels that name a social network rather than a generic link
 *  field. Tested BEFORE the portfolio/website branch, because "LinkedIn"
 *  contains "link" and would otherwise be swallowed by it -- and since the
 *  portfolio line comes after LinkedIn in every profile, the URL was not just
 *  misfiled but overwritten and lost. */
const NETWORK_LABEL =
  /linkedin|github|gitlab|stack\s*overflow|twitter|mastodon|medium|dribbble|behance|^x$/i

const NETWORK_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/linkedin\./i, 'LinkedIn'],
  [/github\./i, 'GitHub'],
  [/gitlab\./i, 'GitLab'],
  [/stackoverflow\./i, 'Stack Overflow'],
  [/x\.com|twitter\./i, 'X'],
  [/medium\./i, 'Medium'],
  [/linktr\./i, 'Linktree']
]

/**
 * Splits on `separator` but only at bracket depth zero.
 *
 * Naively splitting the corpus on `, ` is wrong in both directions: values
 * contain parenthesized comma lists (`AWS (EKS, Lambda, SQS)` is ONE skill),
 * and category labels contain commas (`**DevOps, IaC & Observability:**`).
 * The label case is handled by capturing it from the bold markers; this handles
 * the value case.
 */
function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (const char of value) {
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1)

    if (char === separator && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current)

  return parts.map((part) => part.trim()).filter(Boolean)
}

/** Drops keys whose value is undefined or an empty string/array, so the result
 *  does not carry `{ position: undefined }` noise into stored JSON. The
 *  sanitizer prunes at render time, but the blueprint is persisted raw and a
 *  human reads it. */
function compact<T extends object>(object: T): T {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && !value.trim()) continue
    if (Array.isArray(value) && value.length === 0) continue
    result[key] = value
  }
  return result as T
}

function networkFor(url: string): string {
  for (const [pattern, name] of NETWORK_ALIASES) {
    if (pattern.test(url)) return name
  }
  // Bare hostname. Good enough as a link label, and better than guessing.
  return url.replace(/^https?:\/\//i, '').split('/')[0] ?? url
}

/** Splits `*(October 2025 - Present)*`'s inner text into start and end.
 *  Returns `endDate` verbatim, including the literal "Present": the schema
 *  enforces no date format and every template interpolates the string straight
 *  into the document, so normalizing to `YYYY-MM` would typeset "2025-10".
 *  `fixtures/sample.json` already uses this style. */
function parseDateRange(range: string): {
  startDate?: string
  endDate?: string
} {
  const parts = range
    .split(DATE_RANGE_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length >= 2)
    return { startDate: parts[0], endDate: parts[parts.length - 1] }
  if (parts.length === 1) return { startDate: parts[0] }
  return {}
}

export function profileToBlueprint(markdown: string): ProfileImportResult {
  if (typeof markdown !== 'string') {
    throw new ProfileParseError('profileToBlueprint expects a markdown string')
  }

  const warnings: string[] = []
  const removed = countCitations(markdown)
  const lines = stripCitations(markdown.replace(/\r\n?/g, '\n')).split('\n')

  const basics: Basics = {}
  const profiles: NonNullable<Basics['profiles']> = []
  const work: WorkInput[] = []
  const education: Education[] = []
  const skills: Skill[] = []
  const certificates: Certificate[] = []
  const summaryLines: string[] = []

  let section: ProfileSection | undefined
  /** Set when a `##` heading matched nothing: its whole body is skipped rather
   *  than leaking into whichever section happened to be open. */
  let skipping = false
  let current: WorkInput | undefined

  const warn = (line: number, message: string) =>
    warnings.push(`line ${line}: ${message}`)

  for (const [index, raw] of lines.entries()) {
    const lineNumber = index + 1
    const line = raw.trimEnd()
    if (!line.trim()) continue

    // --- headings -------------------------------------------------------
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      const text = heading[2]!.trim()

      if (level === 1) {
        // "# Master Profile: Software Engineer & .NET Specialist" -- the part
        // after the colon is a targeting label, which is what basics.label is.
        const label =
          /(?:master\s+profile|profile|resume|cv)\s*:\s*(.+)$/i.exec(text)
        if (label) basics.label = label[1]!.trim()
        else
          warn(
            lineNumber,
            `title "${text}" has no "Profile:" prefix; not used as basics.label`
          )
        continue
      }

      if (level === 2) {
        current = undefined
        const matched = SECTION_PATTERNS.find(([pattern]) => pattern.test(text))
        section = matched?.[1]
        skipping = !matched
        if (!matched) {
          // BlueprintSchema has no volunteer/publications/languages/references,
          // and zod objects are non-strict -- so anything here would disappear
          // without a trace if it were not reported.
          warn(
            lineNumber,
            `unrecognized section "${text}" -- skipped, it has no home in the schema`
          )
        }
        continue
      }

      if (skipping) continue

      if (level === 3 && section === 'work') {
        current = compact(
          parseWorkHeading(text, lines[index + 1], lineNumber, warn)
        )
        work.push(current)
        continue
      }

      warn(
        lineNumber,
        `unexpected heading "${text}" in the ${section ?? 'preamble'} section -- skipped`
      )
      continue
    }

    if (skipping || !section) continue

    // --- section bodies -------------------------------------------------
    switch (section) {
      case 'metadata':
        readMetadata(line, lineNumber, basics, profiles, warn)
        break

      case 'summary':
        summaryLines.push(line.trim())
        break

      case 'skills': {
        const labelled = LABELLED_BULLET.exec(line)
        if (labelled) {
          skills.push(
            compact({
              name: labelled[1]!.trim(),
              keywords: splitTopLevel(labelled[2]!, ',')
            })
          )
          break
        }
        const plain = PLAIN_BULLET.exec(line)
        if (plain) {
          // A bullet with no "Category:" prefix. Still skills, just uncategorized.
          skills.push(compact({ keywords: splitTopLevel(plain[1]!, ',') }))
          warn(
            lineNumber,
            'skill bullet has no "**Category:**" label; imported without a category name'
          )
          break
        }
        warn(
          lineNumber,
          `unparsed line in the skills section: "${truncate(line)}"`
        )
        break
      }

      case 'work': {
        if (!current) {
          warn(
            lineNumber,
            `"${truncate(line)}" appears before any "###" entry -- skipped`
          )
          break
        }

        const role = ROLE_LINE.exec(line)
        if (role) {
          applyRoleLine(current, role[1]!.trim(), role[2], lineNumber, warn)
          break
        }

        const bullet = PLAIN_BULLET.exec(line)
        if (bullet) {
          current.highlights = [
            ...(current.highlights ?? []),
            bullet[1]!.trim()
          ]
          break
        }

        warn(
          lineNumber,
          `unparsed line in work entry "${current.name ?? current.position ?? '?'}": "${truncate(line)}"`
        )
        break
      }

      case 'education':
        readEducation(line, lineNumber, education, certificates, warn)
        break
    }
  }

  if (summaryLines.length) basics.summary = summaryLines.join(' ')
  if (profiles.length) basics.profiles = profiles

  const blueprint: BlueprintInput = compact({
    basics: Object.keys(compact(basics)).length ? compact(basics) : undefined,
    work,
    education,
    skills,
    certificates
  })

  if (!Object.keys(blueprint).length) {
    throw new ProfileParseError(
      'no resume content found -- expected a markdown document with "## Candidate Metadata", ' +
        '"## Executive Summary", "## Skills", "## Experience", or "## Education" sections'
    )
  }

  if (removed) {
    warnings.unshift(
      `removed ${removed} citation artifact${removed === 1 ? '' : 's'} before parsing`
    )
  }

  return { blueprint, warnings }
}

/**
 * Decides whether a `### ...` heading names the company or the job title.
 *
 * Two of the three profiles write `### <Company> - <Location>` with the title on
 * the following bold line. The third inverts it for one entry:
 * `### Freelance Full-Stack Developer & Integration Consultant`, with the
 * company and location on the bold line instead. Assigning by position would
 * silently put a job title in `work[].name` for that entry.
 *
 * The separator is the tell: whichever of the two lines carries a ` - ` is the
 * one holding company and location.
 */
function parseWorkHeading(
  text: string,
  next: string | undefined,
  lineNumber: number,
  warn: (line: number, message: string) => void
): WorkInput {
  const parts = text.split(NAME_LOCATION_SPLIT)
  if (parts.length >= 2) {
    return {
      name: parts[0]!.trim(),
      location: parts.slice(1).join(' - ').trim()
    }
  }

  const role = next ? ROLE_LINE.exec(next.trimEnd()) : null
  if (role && NAME_LOCATION_SPLIT.test(role[1]!)) {
    // Inverted entry: the heading is the title, the bold line is company+location.
    warn(
      lineNumber,
      `"${truncate(text)}" has no " - " separator and the line below does; ` +
        'read as the job title, with company and location taken from that line'
    )
    return { position: text }
  }

  warn(
    lineNumber,
    `"${truncate(text)}" has no " - " separator; read as the employer name with no location`
  )
  return { name: text }
}

/**
 * Applies a `**Title** *(Start - End)*` line to the open work entry.
 *
 * When `parseWorkHeading` decided the heading was the title, the bold run here
 * is company+location instead -- detected the same way, by the separator.
 */
function applyRoleLine(
  entry: WorkInput,
  bold: string,
  range: string | undefined,
  lineNumber: number,
  warn: (line: number, message: string) => void
): void {
  if (entry.position && !entry.name) {
    const parts = bold.split(NAME_LOCATION_SPLIT)
    entry.name = parts[0]!.trim()
    if (parts.length >= 2) entry.location = parts.slice(1).join(' - ').trim()
  } else if (entry.position) {
    warn(
      lineNumber,
      `work entry "${entry.name ?? entry.position}" has a second role line; "${truncate(bold)}" ignored`
    )
  } else {
    entry.position = bold
  }

  if (!range) return

  const { startDate, endDate } = parseDateRange(range)
  if (!startDate) {
    warn(lineNumber, `could not read a date range from "(${truncate(range)})"`)
    return
  }
  entry.startDate = startDate
  if (endDate) entry.endDate = endDate
}

function readMetadata(
  line: string,
  lineNumber: number,
  basics: Basics,
  profiles: NonNullable<Basics['profiles']>,
  warn: (line: number, message: string) => void
): void {
  const bullet = LABELLED_BULLET.exec(line)
  if (!bullet) {
    warn(
      lineNumber,
      `unparsed line in the metadata section: "${truncate(line)}"`
    )
    return
  }

  const label = bullet[1]!.trim()
  const value = bullet[2]!.trim()
  if (!value) return

  // URLs are stored scheme-less exactly as written. `sanitizeUrl` prefixes
  // https:// for bare domains at render time, and invariant 1 says storage
  // holds raw user text.
  if (/^name$/i.test(label)) basics.name = value
  else if (/location|address|city/i.test(label))
    basics.location = { address: value }
  else if (/e-?mail/i.test(label)) basics.email = value
  else if (/phone|mobile|tel/i.test(label)) basics.phone = value
  else if (NETWORK_LABEL.test(label)) {
    // The label is the network name a human wrote; trust it over the hostname.
    for (const url of splitTopLevel(value, '|'))
      profiles.push({ network: label, url })
  } else if (/portfolio|website|links?|labs|site|blog/i.test(label)) {
    // The "Portfolio / Labs" field is the one multi-value entry: two URLs
    // joined by " | ". First becomes the website, the rest become profiles.
    const [first, ...rest] = splitTopLevel(value, '|')
    if (first) basics.website = first
    for (const url of rest) profiles.push({ network: networkFor(url), url })
  } else {
    warn(
      lineNumber,
      `unrecognized metadata label "${truncate(label)}" -- kept as a profile link`
    )
    for (const url of splitTopLevel(value, '|'))
      profiles.push({ network: label, url })
  }
}

/**
 * Reads one bullet from the combined "Education & Certifications" section.
 *
 * Two problems live here. A `**Certifications:**` bullet packs several
 * credentials into one comma-separated line and belongs in `certificates[]`,
 * not `education[]`. And the remaining bullets invert between profiles:
 * `**<credential>:** <school> (year)` in two of them, `**<school>:**
 * <credential> (year)` in the third. Position cannot decide it, so an
 * institution-word heuristic does, and says so when it has to fall back.
 */
function readEducation(
  line: string,
  lineNumber: number,
  education: Education[],
  certificates: Certificate[],
  warn: (line: number, message: string) => void
): void {
  const bullet = LABELLED_BULLET.exec(line)
  if (!bullet) {
    const plain = PLAIN_BULLET.exec(line)
    if (plain) {
      education.push(
        compact(
          splitYear(plain[1]!.trim(), (institution, endDate) => ({
            institution,
            endDate
          }))
        )
      )
      return
    }
    warn(
      lineNumber,
      `unparsed line in the education section: "${truncate(line)}"`
    )
    return
  }

  const label = bullet[1]!.trim()
  let rest = bullet[2]!.trim()

  if (/^certificat|^licen[cs]e|^credential/i.test(label)) {
    for (const item of splitTopLevel(rest, ',')) {
      const year = TRAILING_YEAR.exec(item)
      const name = year ? item.slice(0, year.index).trim() : item
      if (!year)
        warn(
          lineNumber,
          `certificate "${truncate(name)}" has no year in parentheses`
        )
      certificates.push(compact({ name, date: year?.[1] }))
    }
    return
  }

  // A trailing " - *italic descriptor*" (course list, honours) has no honest
  // home in EducationSchema -- area and score both mean something else. Dropped
  // loudly rather than jammed into the wrong field.
  const descriptor = /\s+[—–-]\s+\*(.+?)\*\s*$/.exec(rest)
  if (descriptor) {
    rest = rest.slice(0, descriptor.index).trim()
    warn(
      lineNumber,
      `dropped "${truncate(descriptor[1]!)}" -- EducationSchema has no field for it`
    )
  }

  const year = TRAILING_YEAR.exec(rest)
  const endDate = year?.[1]
  const tail = year ? rest.slice(0, year.index).trim() : rest

  // Three signals, weakest last. Each is only decisive when exactly one side
  // carries it -- when both do, or neither does, it tells us nothing and we
  // fall through to the next.
  const acronym = (a: string, b: string) =>
    INSTITUTION_ACRONYM.test(a) && /\s/.test(b)
  const decided =
    decide(CREDENTIAL_WORDS.test(tail), CREDENTIAL_WORDS.test(label)) ??
    decide(INSTITUTION_WORDS.test(label), INSTITUTION_WORDS.test(tail)) ??
    decide(acronym(label, tail), acronym(tail, label))

  if (decided !== undefined) {
    const [institution, studyType] = decided ? [label, tail] : [tail, label]
    education.push(compact({ institution, studyType, endDate }))
    return
  }

  // Neither side (or both) looks like a school. Fall back to the form two of
  // the three profiles use, and name the assumption so it can be corrected.
  warn(
    lineNumber,
    `could not tell the institution from the credential in "${truncate(label)}: ${truncate(tail)}"; ` +
      'assumed "**credential:** institution"'
  )
  education.push(compact({ institution: tail, studyType: label, endDate }))
}

/** Returns true if only `labelWins` holds, false if only `tailWins` does, and
 *  undefined when the signal cannot separate them. */
function decide(labelWins: boolean, tailWins: boolean): boolean | undefined {
  if (labelWins === tailWins) return undefined
  return labelWins
}

/** Pulls a trailing `(year)` off a string and hands both to `build`. */
function splitYear<T>(
  text: string,
  build: (head: string, year?: string) => T
): T {
  const year = TRAILING_YEAR.exec(text)
  return year ? build(text.slice(0, year.index).trim(), year[1]) : build(text)
}

/** Keeps warning messages readable when the offending line is a 500-character
 *  paragraph, which the executive summary always is. */
function truncate(text: string, limit = 60): string {
  const flat = text.trim().replace(/\s+/g, ' ')
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat
}
