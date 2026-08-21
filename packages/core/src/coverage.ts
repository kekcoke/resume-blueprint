import { parseBlueprint, type Blueprint, type SectionName } from './schema.js'
import { sectionBodies } from './text.js'

/**
 * Job-description keyword coverage.
 *
 * Everything else in this repo that says "ATS" means parse fidelity — does the
 * rendered PDF survive text extraction. This module is the other half: does the
 * CONTENT match what the posting asked for. The two are independent, and a
 * resume can score perfectly on one while failing the other.
 *
 * Three hard constraints shape what follows.
 *
 * It REPORTS ONLY. Nothing here mutates the blueprint or returns a rewritten
 * one. The agent reads the report, decides, and patches through the normal
 * validated path so the change lands in git history — see docs/next-features.md
 * F10. A function that helpfully rewrote `skills` would put a mutation outside
 * that history.
 *
 * It DOES NOT SANITIZE, for the same reason `text.ts` does not: `escapeLatex` is
 * non-idempotent and nothing here reaches a TeX engine. A term extracted from a
 * job description comes back as the job description wrote it. CLAUDE.md's rule
 * that new blueprint-accepting surfaces route through sanitize is about surfaces
 * that feed the renderer; this one feeds a report.
 *
 * It ADDS NO DEPENDENCY. Core's runtime deps are `zod` and `common-tags`, and a
 * stemmer or NLP package would be a third for a feature that does not need one.
 * So the tokenizer, the stopword lists, and the plural fold below are all
 * hand-rolled — and every weight is a named constant, so the ranking is
 * explainable rather than magic.
 */

/** One term as the job description uses it. */
export interface CoverageTerm {
  /** The term in the job description's own wording and casing. */
  term: string
  /** How many times it occurs in the job description. */
  count: number
  /** Character offset of the first occurrence. Job postings front-load. */
  firstIndex: number
  /** Composite rank — see `PHRASE_BONUS`, `LEAD_BONUS`, `BULLET_BONUS`. */
  prominence: number
}

export interface MatchedTerm extends CoverageTerm {
  /** Every section of the resume the term already appears in. */
  sections: SectionName[]
  /**
   * The resume's wording, when the match came through the plural fold rather
   * than verbatim — `microservice` for a posting that said `microservices`.
   * Absent on an exact match. Present so the fold is visible rather than
   * silent: a caller that disagrees with a fold can see it happened.
   */
  matchedAs?: string
}

/** Where a missing term would plausibly go. A suggestion, never an edit. */
export interface PlacementSuggestion {
  section: SectionName
  reason: string
}

export interface MissingTerm extends CoverageTerm {
  /** Best first, and only sections this blueprint actually renders. */
  suggestions: PlacementSuggestion[]
}

export interface CoverageReport {
  /**
   * Share of the reported terms already present, 0–1.
   *
   * Named `coverage` rather than `score` on purpose: `education[].score` is a
   * GPA in this schema, and two different `score`s in one payload is a trap.
   */
  coverage: number
  matched: MatchedTerm[]
  /** Ranked by prominence in the job description, highest first. */
  missing: MissingTerm[]
  /** Matched-term count per section, for "where is my coverage concentrated". */
  sections: Array<{ section: SectionName; matched: number }>
  /**
   * Why the report may be thinner than expected — an empty posting, a blueprint
   * with no text, a truncated term list.
   *
   * Called `notes`, not `warnings`, because every adapter already carries a
   * `warnings` channel for citation artifacts (see `import/citations.ts`) and
   * collapsing the two would merge unrelated signals.
   */
  notes: string[]
}

export interface CoverageOptions {
  /** How many terms to report, by prominence. Default 40, clamped 1–200. */
  maxTerms?: number
}

const DEFAULT_MAX_TERMS = 40
const MIN_MAX_TERMS = 1
const MAX_MAX_TERMS = 200

/** Longest n-gram considered. Beyond three, phrases stop recurring often enough
 * for a count to mean anything. */
const MAX_NGRAM = 3

/**
 * Multiplied into prominence by n-gram length. A phrase is more specific than
 * either of its words, so `distributed systems` outranks a bare `systems` at
 * equal frequency. Index is the n-gram length; slot 0 is unused.
 *
 * Kept small on purpose. At the 1.4/1.6 these started at, a trigram mentioned
 * ONCE in a bullet outranked a technology named twice — frequency has to
 * dominate specificity, or the top of the report fills with one-off phrasings
 * while the stack the posting actually keeps repeating sits below the fold.
 */
const PHRASE_BONUS = [0, 1.0, 1.25, 1.4]

/** A term first seen in the leading slice of a posting is usually in the title
 * or the opening summary, which is where the role's actual subject lives. */
const LEAD_FRACTION = 0.15
const LEAD_BONUS = 1.3

/** Requirements are bulleted far more often than they are prose. */
const BULLET_BONUS = 1.2

/**
 * Deliberately tolerant of the tokens a naive `[a-z]+` splitter destroys:
 * `C++`, `.NET`, `CI/CD`, `Node.js`, `A/B`, `end-to-end`. Those are exactly the
 * terms a job description is most specific about, so losing them would gut the
 * feature.
 *
 * The trailing class excludes punctuation, so a sentence-final `Node.js.` yields
 * `Node.js`. The lookbehind keeps a missing space (`sentence.Next`) from
 * producing a phantom `.Next` token. The lone-character alternative catches a
 * bare `R` or `C`, which are real language names.
 *
 * Apostrophes are interior characters so `Bachelor's` stays one token. Without
 * that it split into `Bachelor` + `s`, and the orphaned `s` went on to anchor
 * the phrase `s degree` — a term the posting never contained.
 */
const TOKEN_PATTERN = /(?<![A-Za-z0-9])[.#]?[A-Za-z0-9][A-Za-z0-9+#._/'\u2019-]*[A-Za-z0-9+#]|[A-Za-z0-9]/g

/** Any of these between two tokens ends a phrase. An n-gram that spans a comma
 * or a line break is a coincidence of adjacency, not a phrase: `TypeScript,
 * React` is a list, and `TypeScript React` is not a thing anyone wrote. */
const PHRASE_BREAK = /[\n\r.,;:!?()[\]{}|"'`•–—/\\]/

/** A line that looks like a requirement bullet. */
const BULLET_LINE = /^\s*(?:[-*•‣▪·]|\d+[.)])\s+/

/**
 * Stopwords allowed INSIDE a phrase.
 *
 * The first cut allowed any interior stopword, on the strength of `proof of
 * concept`. Run against a real posting it produced `Engineer to build`,
 * `Design and ship`, `Kubernetes and Docker`, `C++ or Rust` — conjunctions
 * welding unrelated items into phrases nobody wrote, which then outranked the
 * items themselves. Only `of` earns its place; the rest are list separators
 * wearing a phrase's clothes.
 */
const INTERIOR_STOPWORDS = new Set(['of'])

/** A token carrying no information on its own: `5`, `2025`, `10+`. Kept out of
 * candidates, but still allowed to sit inside a phrase (`5 years`). */
const NUMERIC_ONLY = /^[\d+.#/-]+$/

/**
 * General English function words.
 *
 * Hand-listed rather than pulled from a package: core takes no new runtime
 * dependency, and a coverage report is one of the places where a surprising
 * omission ("why is `React` missing from my report?") is worse than a list
 * anyone can read and amend.
 */
const STOPWORDS = new Set([
  'a', 'about', 'above', 'across', 'after', 'again', 'against', 'all', 'almost', 'also',
  'although', 'always', 'am', 'among', 'an', 'and', 'another', 'any', 'anyone', 'are',
  'around', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'best',
  'better', 'between', 'both', 'but', 'by', 'can', 'cannot', 'could', 'did', 'do', 'does',
  'doing', 'done', 'down', 'during', 'each', 'either', 'else', 'enough', 'especially',
  'etc', 'even', 'every', 'few', 'for', 'from', 'further', 'get', 'give', 'good', 'great',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'him', 'his', 'how',
  'however', 'i', 'if', 'in', 'include', 'includes', 'including', 'into', 'is', 'it',
  'its', 'itself', 'just', 'keep', 'like', 'made', 'make', 'makes', 'making', 'many',
  'may', 'me', 'might', 'more', 'most', 'much', 'multiple', 'must', 'my', 'need', 'needs',
  'neither',
  'never', 'new', 'no', 'nor', 'not', 'of', 'off', 'often', 'on', 'once', 'one', 'only',
  'or', 'other', 'others', 'our', 'ours', 'out', 'over', 'per', 'perhaps',
  'please', 'same', 'shall', 'she', 'should', 'since', 'so', 'some', 'such', 'take',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'then', 'there', 'these', 'they',
  'this', 'those', 'though', 'through', 'to', 'together', 'too', 'toward', 'towards',
  'under', 'until', 'up', 'upon', 'us', 'use', 'used', 'using', 'very', 'via', 'want',
  'was', 'we', 'well', 'were', 'what', 'when', 'where', 'whether', 'which', 'while',
  'who', 'whom', 'whose', 'why', 'will', 'with', 'within', 'without', 'would', 'you',
  'your', 'yours'
])

/**
 * Words that are everywhere in job descriptions and nowhere useful in a report.
 *
 * Kept separate from `STOPWORDS` because these are not function words — they are
 * perfectly good English nouns that happen to be posting furniture. Someone
 * reusing this tokenizer for another corpus would want the first list and not
 * this one.
 *
 * `experience` and `skills` are here for the same reason: every posting says
 * both, and "you are missing the term `experience`" is advice no one can act on.
 */
const JD_BOILERPLATE = new Set([
  'ability', 'applicant', 'applicants', 'application', 'apply', 'benefits', 'candidate',
  'candidates', 'career', 'company', 'compensation', 'department', 'description',
  'desired', 'diverse', 'diversity', 'employee', 'employees', 'employer', 'employment',
  'equal', 'experience', 'experiences', 'ideal', 'inclusion', 'job', 'join', 'looking',
  'must-have', 'nice-to-have', 'offer', 'opportunity', 'organization', 'plus',
  'position', 'preferred', 'qualification', 'qualifications', 'qualified', 'range',
  'relevant', 'requirement', 'requirements', 'required', 'responsibilities',
  'responsibility', 'role', 'salary', 'skill', 'skills', 'strong', 'successful', 'team',
  'teams', 'us', 'work', 'working', 'year', 'years',

  // Verbs and nouns every posting reaches for regardless of the role. Dropping
  // them cleans up the report twice over: the bare verb stops occupying a row,
  // AND the phrase it led loses its dead first word, because a candidate cannot
  // start or end on a stopword. `Operate Kubernetes clusters` becomes
  // `Kubernetes clusters`; `Deep familiarity` disappears in favour of what it
  // was introducing.
  //
  // `design`, `develop`, and `architecture` are deliberately absent despite
  // being just as common -- `system design` and `design systems` are terms an
  // applicant is genuinely measured on, and edge-stopword rejection would take
  // them out with the noise.
  'background', 'build', 'building', 'built', 'collaborate', 'comfort', 'contribute',
  'deliver', 'drive', 'ensure', 'expertise', 'familiarity', 'help', 'hire', 'hiring',
  'knowledge', 'lead', 'maintain', 'manage', 'mindset', 'operate', 'own', 'passion',
  'proficiency', 'provide', 'review', 'ship', 'support', 'understanding', 'write'
])

function isStopword(normalized: string): boolean {
  return STOPWORDS.has(normalized) || JD_BOILERPLATE.has(normalized)
}

/**
 * A single lowercase letter cannot start or end a term.
 *
 * Uppercase is exempt because `R` and `C` are language names a resume is
 * genuinely asked about; a lone lowercase letter is always debris left by a
 * split the tokenizer could not avoid.
 */
function isWeakEdge(token: Token): boolean {
  return token.raw.length === 1 && token.raw !== token.raw.toUpperCase()
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Conservative plural fold — the one piece of morphology this module does.
 *
 * A full stemmer would fold `engineering` to `engineer` and `application` to
 * `applic`, which buys recall at the cost of matches no reader would accept.
 * Plurals are the case that actually bites (`microservices` vs `microservice`),
 * they are unambiguous, and every fold that fires is reported as `matchedAs` so
 * it can be second-guessed.
 */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && /(?:ss|sh|ch|x|z)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1)
  return word
}

function foldKey(key: string): string {
  return key.split(' ').map(singular).join(' ')
}

interface Token {
  /** As written. */
  raw: string
  /** Lowercased, for comparison. */
  norm: string
  /** Character offset in the source text. */
  index: number
  /** End offset, exclusive. */
  end: number
  /** True when a phrase-breaking character sits between this token and the previous one. */
  breaksBefore: boolean
  /** True when this token is on a bullet-like line. */
  bullet: boolean
}

/** Offsets at which each line starts, for the bullet-line lookup below. */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1)
  }
  return starts
}

function tokenize(text: string): Token[] {
  const starts = lineStarts(text)
  const bulletLine = starts.map((start) => {
    const end = text.indexOf('\n', start)
    return BULLET_LINE.test(text.slice(start, end === -1 ? undefined : end))
  })

  const tokens: Token[] = []
  let line = 0
  let previousEnd = -1

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index
    const raw = match[0]

    // Tokens arrive in order, so the line pointer only ever moves forward.
    while (line + 1 < starts.length && starts[line + 1] <= index) line += 1

    tokens.push({
      raw,
      norm: raw.toLowerCase(),
      index,
      end: index + raw.length,
      breaksBefore: previousEnd < 0 || PHRASE_BREAK.test(text.slice(previousEnd, index)),
      bullet: bulletLine[line]
    })

    previousEnd = index + raw.length
  }

  return tokens
}

interface Occurrence {
  index: number
  /** End offset, exclusive — the span this occurrence claims. See `dropOverlapping`. */
  end: number
  bullet: boolean
}

interface Candidate {
  /** Normalized, space-joined — the identity used for every comparison. */
  key: string
  /** The source text of the first occurrence, punctuation and casing intact. */
  display: string
  /** Number of tokens. */
  n: number
  occurrences: Occurrence[]
}

/**
 * Every n-gram of length 1..3 worth reporting on, with where each one occurs.
 *
 * A candidate never spans a phrase break, never starts or ends on a stopword
 * — `and React` and `React or` are not terms, but `React Native` is — and
 * carries no interior stopword beyond `of` (see `INTERIOR_STOPWORDS`).
 */
function candidates(text: string, tokens: Token[]): Map<string, Candidate> {
  const found = new Map<string, Candidate>()

  for (let i = 0; i < tokens.length; i += 1) {
    for (let n = 1; n <= MAX_NGRAM && i + n <= tokens.length; n += 1) {
      // Extending across a break is impossible, and so is every longer n-gram
      // from this start.
      if (n > 1 && tokens[i + n - 1].breaksBefore) break

      const span = tokens.slice(i, i + n)
      const first = span[0]
      const last = span[n - 1]

      if (isStopword(first.norm) || isStopword(last.norm)) continue
      if (isWeakEdge(first) || isWeakEdge(last)) continue
      if (n === 1 && (first.norm.length < 2 || NUMERIC_ONLY.test(first.norm))) continue
      if (span.slice(1, -1).some((t) => isStopword(t.norm) && !INTERIOR_STOPWORDS.has(t.norm))) continue

      const key = span.map((t) => t.norm).join(' ')
      const existing = found.get(key)

      const occurrence: Occurrence = {
        index: first.index,
        end: last.end,
        bullet: span.some((t) => t.bullet)
      }

      if (existing) {
        existing.occurrences.push(occurrence)
      } else {
        found.set(key, { key, display: text.slice(first.index, last.end), n, occurrences: [occurrence] })
      }
    }
  }

  return found
}

/**
 * Drops any PHRASE fully contained in a longer phrase it always co-occurs with.
 *
 * `machine learning` appearing exactly as often as `applied machine learning`
 * tells the reader nothing the longer phrase did not already, and reporting
 * both spends two of the caller's `maxTerms` slots on one fact.
 *
 * Single words are deliberately exempt, and that exemption was bought with a
 * failing test. Suppressing them too meant a posting that said `Kubernetes
 * clusters` exactly once reported `Kubernetes clusters` as missing from a
 * resume that says `Ran Kubernetes in production` -- technically true, and it
 * buried the fact the reader needed, which is that Kubernetes itself is
 * covered. A bare technology name is the atom an applicant lists under skills;
 * it is the most actionable row in the report and it stays.
 */
function dropRedundant(found: Map<string, Candidate>): Candidate[] {
  const redundant = new Set<string>()

  for (const candidate of found.values()) {
    if (candidate.n < 3) continue
    const parts = candidate.key.split(' ')

    for (let n = 2; n < candidate.n; n += 1) {
      for (let i = 0; i + n <= parts.length; i += 1) {
        const sub = parts.slice(i, i + n).join(' ')
        const inner = found.get(sub)
        if (inner && inner.occurrences.length === candidate.occurrences.length) redundant.add(sub)
      }
    }
  }

  return [...found.values()].filter((c) => !redundant.has(c.key))
}

interface Ranked {
  candidate: Candidate
  prominence: number
}

/**
 * Suppresses same-length phrases that describe the same stretch of text.
 *
 * `AWS Certified Solutions Architect certification` yields three overlapping
 * trigrams, each occurring once, each ranked identically — three slots of the
 * caller's budget spent restating one line of the posting. Walking in rank
 * order and dropping any phrase whose every occurrence sits on ground a
 * better-ranked phrase already claimed leaves the first one standing.
 *
 * Restricted to candidates of the SAME length, and that restriction is
 * load-bearing. Across lengths the unigrams `distributed` and `systems` outrank
 * the bigram `distributed systems` on raw count and would suppress it — losing
 * the more specific term to its own parts. Sub-phrase redundancy is
 * `dropRedundant`'s job, and it decides on counts rather than position.
 */
function dropOverlapping(ranked: Ranked[]): Ranked[] {
  const claimed = new Map<number, Array<[number, number]>>()

  return ranked.filter(({ candidate }) => {
    if (candidate.n < 2) return true

    const spans = claimed.get(candidate.n) ?? []
    const taken = candidate.occurrences.every(({ index, end }) =>
      spans.some(([start, stop]) => index < stop && start < end)
    )
    if (taken) return false

    spans.push(...candidate.occurrences.map(({ index, end }): [number, number] => [index, end]))
    claimed.set(candidate.n, spans)
    return true
  })
}

function prominence(candidate: Candidate, textLength: number): number {
  const count = candidate.occurrences.length
  const firstIndex = candidate.occurrences[0].index

  const lead = firstIndex <= textLength * LEAD_FRACTION ? LEAD_BONUS : 1
  const bullet = candidate.occurrences.some((o) => o.bullet) ? BULLET_BONUS : 1

  return round2(count * PHRASE_BONUS[candidate.n] * lead * bullet)
}

/**
 * One section's searchable index: every n-gram it contains, mapped to the
 * wording the resume actually used.
 *
 * Two maps rather than one, because an exact hit and a folded hit are different
 * answers — only the second one needs `matchedAs`.
 */
interface SectionIndex {
  section: SectionName
  exact: Map<string, string>
  folded: Map<string, string>
}

function indexSection(section: SectionName, text: string): SectionIndex {
  const tokens = tokenize(text)
  const exact = new Map<string, string>()
  const folded = new Map<string, string>()

  for (let i = 0; i < tokens.length; i += 1) {
    for (let n = 1; n <= MAX_NGRAM && i + n <= tokens.length; n += 1) {
      if (n > 1 && tokens[i + n - 1].breaksBefore) break

      const span = tokens.slice(i, i + n)
      const key = span.map((t) => t.norm).join(' ')
      const surface = text.slice(span[0].index, span[n - 1].end)

      if (!exact.has(key)) exact.set(key, surface)

      const fold = foldKey(key)
      if (!folded.has(fold)) folded.set(fold, surface)
    }
  }

  return { section, exact, folded }
}

const CREDENTIAL = /\b(?:certified|certification|certifications|certificate|certificates|licen[cs]ed?|credential|credentials)\b/i
const DEGREE = /\b(?:bachelors?|masters?|phd|doctorate|undergraduate|degree|bsc|msc|b\.?s\.?|b\.?a\.?|m\.?s\.?)\b/i

/**
 * Where a missing term would plausibly go, best first.
 *
 * Filtered to the sections this blueprint actually renders: suggesting
 * `certificates` to a blueprint whose `sections` omits it is advice that would
 * produce content nobody sees.
 */
function suggestPlacement(candidate: Candidate, rendered: Set<SectionName>): PlacementSuggestion[] {
  const all: PlacementSuggestion[] = CREDENTIAL.test(candidate.display)
    ? [
        { section: 'certificates', reason: 'names a credential, and certificates carries the issuer and date' },
        { section: 'skills', reason: 'the subject of the credential also reads as a skill keyword' }
      ]
    : DEGREE.test(candidate.display)
      ? [{ section: 'education', reason: 'names a degree, which belongs in education' }]
      : candidate.n === 1
        ? [
            { section: 'skills', reason: 'a single-token term reads as a skill keyword' },
            { section: 'work', reason: 'a work highlight is where a skill gets its evidence' }
          ]
        : [
            { section: 'work', reason: 'a multi-word phrase reads as a responsibility' },
            { section: 'skills', reason: 'or as a skill keyword, if it names a technology' },
            { section: 'projects', reason: 'a project highlight is the alternative when no role covers it' }
          ]

  return all.filter(({ section }) => rendered.has(section))
}

function clampMaxTerms(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_MAX_TERMS
  return Math.min(MAX_MAX_TERMS, Math.max(MIN_MAX_TERMS, Math.trunc(requested)))
}

/**
 * Scores a blueprint against a job description.
 *
 * Validates the blueprint the same way `blueprintToText` does — a `ZodError` on
 * bad input, no sanitization on the way through — and never touches the object
 * it was handed.
 *
 * @param input an unvalidated blueprint, e.g. parsed JSON from an agent.
 * @param jobDescription the posting, as plain text or markdown.
 * @throws {z.ZodError} if the blueprint fails validation.
 */
export function analyzeCoverage(
  input: unknown,
  jobDescription: string,
  options: CoverageOptions = {}
): CoverageReport {
  const blueprint: Blueprint = parseBlueprint(input)
  const maxTerms = clampMaxTerms(options.maxTerms)
  const notes: string[] = []

  const bodies = sectionBodies(blueprint)
  const indexes = bodies.map(({ section, text }) => indexSection(section, text))
  if (!indexes.length) notes.push('the blueprint renders no text, so every term is reported missing')

  const jd = jobDescription ?? ''
  const scored: Ranked[] = dropRedundant(candidates(jd, tokenize(jd)))
    .map((candidate) => ({ candidate, prominence: prominence(candidate, jd.length) }))
    // Ties broken deterministically: more occurrences, then earlier in the
    // posting, then alphabetically. A report that reshuffles between identical
    // runs is one nobody can diff.
    .sort(
      (a, b) =>
        b.prominence - a.prominence ||
        b.candidate.occurrences.length - a.candidate.occurrences.length ||
        a.candidate.occurrences[0].index - b.candidate.occurrences[0].index ||
        a.candidate.key.localeCompare(b.candidate.key)
    )

  const ranked = dropOverlapping(scored)

  if (!ranked.length) notes.push('the job description yielded no terms after stopword filtering')
  if (ranked.length > maxTerms) {
    notes.push(`reporting the top ${maxTerms} of ${ranked.length} terms by prominence`)
  }

  const rendered = new Set(blueprint.sections)
  const matched: MatchedTerm[] = []
  const missing: MissingTerm[] = []

  for (const { candidate, prominence: score } of ranked.slice(0, maxTerms)) {
    const base: CoverageTerm = {
      term: candidate.display,
      count: candidate.occurrences.length,
      firstIndex: candidate.occurrences[0].index,
      prominence: score
    }

    const fold = foldKey(candidate.key)
    const sections: SectionName[] = []
    let matchedAs: string | undefined
    let exactly = false

    for (const index of indexes) {
      if (index.exact.has(candidate.key)) {
        sections.push(index.section)
        exactly = true
      } else if (index.folded.has(fold)) {
        sections.push(index.section)
        matchedAs ??= index.folded.get(fold)
      }
    }

    if (sections.length) {
      // An exact hit anywhere means the resume already uses the posting's own
      // wording, so there is no alternative wording worth reporting.
      matched.push({ ...base, sections, ...(!exactly && matchedAs && { matchedAs }) })
    } else {
      missing.push({ ...base, suggestions: suggestPlacement(candidate, rendered) })
    }
  }

  const total = matched.length + missing.length
  const counted = new Map(bodies.map(({ section }) => [section, 0]))
  for (const term of matched) {
    for (const section of term.sections) counted.set(section, (counted.get(section) ?? 0) + 1)
  }

  return {
    coverage: total ? round2(matched.length / total) : 0,
    matched,
    missing,
    sections: [...counted].map(([section, count]) => ({ section, matched: count })),
    notes
  }
}
