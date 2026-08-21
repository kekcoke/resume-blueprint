import type {
  Award,
  Basics,
  Blueprint,
  Certificate,
  Education,
  Project,
  SectionName,
  Skill,
  Work
} from './schema.js'

/**
 * Plain-text rendering — the sibling of `templates/index.ts`, at the same
 * seam `blueprintToText` in `index.ts` occupies relative to `blueprintToTex`.
 *
 * Deliberately independent of the nine TeX templates rather than sharing code
 * with them: their section renderers are built around `\href{}{}`,
 * `\textbf{}`, `\vspace{}`, and similar LaTeX markup that has no plain-text
 * equivalent worth threading through a shared abstraction for one caller.
 * What IS shared is the *shape* — the same `sections`-driven dispatch, the
 * same default heading wording (8 of 9 templates agree; template5 alone
 * uppercases for style), and the same fields per section — so the text view
 * and the PDF stay in sync on content even though nothing here imports from
 * `templates/`.
 *
 * No escaping happens anywhere below. `blueprintToTex` sanitizes because its
 * output reaches a TeX engine; this output reaches a human or an ATS parser
 * as literal text, so `\&` would be wrong here, not safe.
 */

/** No shared default-heading table exists for the TeX templates either —
 * each inlines its own `heading || 'Education'` fallback at its call site.
 * This mirrors the 8-template consensus (template5 alone uppercases for
 * visual style, which the heading rule below achieves for every section
 * regardless of the stored casing). */
const DEFAULT_HEADINGS: Partial<Record<SectionName, string>> = {
  education: 'Education',
  work: 'Experience',
  skills: 'Skills',
  projects: 'Projects',
  awards: 'Awards',
  certificates: 'Certificates'
}

/**
 * Trims a field and treats whitespace-only as absent.
 *
 * `sanitizeBlueprint`'s recursive pruning does this for the TeX path, but
 * this renderer skips `sanitizeBlueprint` entirely (it also escapes, which
 * this output must not do). Blank-field hygiene and LaTeX-escaping are two
 * different concerns that happen to live in the same function over there;
 * only the first one belongs here.
 */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function presentAll(values: Array<string> | undefined): string[] {
  return (values ?? []).map(present).filter((v): v is string => v !== undefined)
}

/** `"START - END"`, falling back to `"START - Present"` for an open-ended
 * range — the reading convention `work` entries almost always intend. */
function formatDateRange(startDate?: string, endDate?: string): string {
  const start = present(startDate)
  const end = present(endDate)
  if (start && end) return `${start} - ${end}`
  if (start) return `${start} - Present`
  return end ?? ''
}

/**
 * Underlines a heading in plain-text-resume convention (`HEADING` over a
 * rule of `-`) so it reads as a section boundary without relying on any
 * styling a plain-text channel can't carry.
 */
function formatHeading(text: string): string {
  const upper = text.toUpperCase()
  return `${upper}\n${'-'.repeat(upper.length)}`
}

/** Wraps a section body with its heading, or drops the section entirely if
 * the body came back empty — matching every template's own
 * `if (!education) return ''` guard, just decided after formatting instead
 * of before, since "every field is blank" is a real way to end up empty. */
function withHeading(body: string, heading: string | undefined, defaultHeading: string): string {
  if (!body) return ''
  return `${formatHeading(heading || defaultHeading)}\n\n${body}`
}

function alphanumeric(text?: string): string {
  return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Plain-text counterpart to `templates/profiles.ts#profileLinks`: same
 * "show the URL as visible text, prefix the network name only when the host
 * doesn't already say it" logic, without the `\href{}{}` wrapper a text
 * channel has no use for.
 */
function formatProfileLinks(profiles: Basics['profiles']): string[] {
  return (profiles ?? []).flatMap(({ network, username, url }) => {
    const cleanUrl = present(url)

    if (!cleanUrl) {
      const text = [present(network), present(username)].filter(Boolean).join(': ')
      return text ? [text] : []
    }

    const shown = cleanUrl.replace(/^(?:https?:\/\/|mailto:)/i, '').replace(/\/$/, '')
    const host = shown.split('/')[0]
    const key = alphanumeric(network)
    const label = key && !alphanumeric(host).includes(key) ? `${network}: ` : ''

    return [`${label}${shown}`]
  })
}

/**
 * No heading, matching every template — `resumeHeader`/`profileSection`
 * render `basics` without a `\header{}` call, so `headings.profile` (legal
 * in the schema) is accepted but silently unused there too. Reproduced here
 * rather than "fixed", since fixing it would make this the only renderer
 * that honours a field none of the nine templates do.
 */
function formatProfile(basics: Basics | undefined): string {
  if (!basics) return ''

  const name = present(basics.name)
  const label = present(basics.label)
  const summary = present(basics.summary)
  const address = present(basics.location?.address)
  const email = present(basics.email)
  const phone = present(basics.phone)
  const website = present(basics.website)
  const links = formatProfileLinks(basics.profiles)

  const nameLine = [name, label].filter(Boolean).join('\n')
  const contactLine = [address, email, phone, website, ...links].filter(Boolean).join(' | ')

  return [nameLine, contactLine, summary].filter(Boolean).join('\n\n')
}

function formatEducation(education: Array<Education> | undefined): string {
  const blocks = (education ?? []).map(({ institution, location, studyType, area, score, startDate, endDate }) => {
    const line1 = [present(institution), present(location)].filter(Boolean).join(' — ')

    const studyPresent = present(studyType)
    const areaPresent = present(area)
    const degree = studyPresent && areaPresent ? `${studyPresent}, ${areaPresent}` : studyPresent || (areaPresent ? `Degree in ${areaPresent}` : '')
    const gpa = present(score) ? `GPA: ${present(score)}` : ''
    const dates = formatDateRange(startDate, endDate)
    const line2 = [degree, gpa, dates].filter(Boolean).join(' | ')

    return [line1, line2].filter(Boolean).join('\n')
  })

  return blocks.filter(Boolean).join('\n\n')
}

function formatWork(work: Array<Work> | undefined): string {
  const blocks = (work ?? []).map(({ name, location, position, startDate, endDate, summary, highlights }) => {
    const line1 = [present(name), present(location)].filter(Boolean).join(' — ')
    const line2 = [present(position), formatDateRange(startDate, endDate)].filter(Boolean).join(' | ')
    const bullets = presentAll(highlights).map((h) => `- ${h}`)

    return [line1, line2, present(summary), ...bullets].filter(Boolean).join('\n')
  })

  return blocks.filter(Boolean).join('\n\n')
}

function formatSkills(skills: Array<Skill> | undefined): string {
  const lines = (skills ?? []).map(({ name, keywords }) => {
    const label = present(name)
    const values = presentAll(keywords)
    if (!label && !values.length) return ''
    return `${label ?? 'Misc'}: ${values.join(', ')}`
  })

  return lines.filter(Boolean).join('\n')
}

/**
 * Unlike every TeX template, this includes `project.highlights` — a schema
 * field with real user content that none of the nine templates render (a
 * pre-existing gap, not introduced or fixed here). Plain text has no page
 * budget forcing that omission, so there is no reason to repeat it.
 */
function formatProjects(projects: Array<Project> | undefined): string {
  const blocks = (projects ?? []).map(({ name, description, url, keywords, highlights }) => {
    const line1 = [present(name), present(url)].filter(Boolean).join(' — ')
    const line2 = presentAll(keywords).join(', ')
    const bullets = presentAll(highlights).map((h) => `- ${h}`)

    return [line1, line2, present(description), ...bullets].filter(Boolean).join('\n')
  })

  return blocks.filter(Boolean).join('\n\n')
}

function formatAwards(awards: Array<Award> | undefined): string {
  const blocks = (awards ?? []).map(({ title, awarder, date, summary }) => {
    const line1 = [present(title), present(awarder)].filter(Boolean).join(' — ')

    return [line1, present(date), present(summary)].filter(Boolean).join('\n')
  })

  return blocks.filter(Boolean).join('\n\n')
}

/** "Name | Issuer (Date) | url" — the same flat shape F6 introduced for the
 * TeX templates (`templates/certificates.ts#certificateLine`), reimplemented
 * without the `\href{}{}` wrapper. */
function formatCertificates(certificates: Array<Certificate> | undefined): string {
  const lines = (certificates ?? []).map(({ name, issuer, date, url }) => {
    const meta = [present(issuer), present(date) ? `(${present(date)})` : ''].filter(Boolean).join(' ')
    return [present(name), meta, present(url)].filter(Boolean).join(' | ')
  })

  return lines.filter(Boolean).join('\n')
}

/**
 * Renders a validated blueprint to plain text, honouring `sections` (order
 * and inclusion) and `headings` (per-section overrides) — the same two
 * control fields every TeX template dispatches on.
 */
export function renderText(blueprint: Blueprint): string {
  const { headings } = blueprint

  const blocks = blueprint.sections.map((section) => {
    switch (section) {
      case 'profile':
        return formatProfile(blueprint.basics)

      case 'education':
        return withHeading(formatEducation(blueprint.education), headings.education, DEFAULT_HEADINGS.education!)

      case 'work':
        return withHeading(formatWork(blueprint.work), headings.work, DEFAULT_HEADINGS.work!)

      case 'skills':
        return withHeading(formatSkills(blueprint.skills), headings.skills, DEFAULT_HEADINGS.skills!)

      case 'projects':
        return withHeading(formatProjects(blueprint.projects), headings.projects, DEFAULT_HEADINGS.projects!)

      case 'awards':
        return withHeading(formatAwards(blueprint.awards), headings.awards, DEFAULT_HEADINGS.awards!)

      case 'certificates':
        return withHeading(
          formatCertificates(blueprint.certificates),
          headings.certificates,
          DEFAULT_HEADINGS.certificates!
        )

      default:
        return ''
    }
  })

  return blocks.filter(Boolean).join('\n\n')
}
