import { z } from 'zod'
import { clampMarginFloor } from './length.js'

/**
 * The blueprint schema — JSON Resume (https://jsonresume.org) plus the small set
 * of extensions the templates actually consume.
 *
 * Replaces the hand-written `types.ts` from the original repo. Types are derived
 * from the schema via `z.infer` so validation and typing can never drift apart.
 *
 * Two deliberate departures from the original type definitions:
 *
 *  - `work[].company` is accepted as a legacy alias and normalized to
 *    `work[].name`. The original form wrote `company` while every template read
 *    `name`, so employer names silently never rendered.
 *
 *  - `Volunteer` and `Publication` are omitted. They existed in the original
 *    `types.ts` but no template consumes them, and carrying dead schema surface
 *    into a new project invites callers to populate fields that go nowhere.
 */

/**
 * Text fields accept any string, including empty and whitespace-only.
 *
 * Emptiness is deliberately NOT a validation error: `sanitizeBlueprint` prunes
 * blank values recursively, matching the original server's behavior. An agent
 * building a blueprint incrementally will routinely leave fields blank, and
 * failing the whole document over a `"   "` would make the service hostile to
 * exactly the callers it exists for. Validation polices structure and types;
 * sanitization handles emptiness.
 */
const text = z.string()

export const LocationSchema = z
  .object({
    address: text.optional(),
    postalCode: text.optional(),
    city: text.optional(),
    countryCode: text.optional(),
    region: text.optional()
  })
  .partial()

export const ProfileSchema = z.object({
  network: text.optional(),
  username: text.optional(),
  url: text.optional()
})

export const BasicsSchema = z.object({
  name: text.optional(),
  label: text.optional(),
  email: text.optional(),
  phone: text.optional(),
  summary: text.optional(),
  location: LocationSchema.optional(),
  profiles: z.array(ProfileSchema).optional(),
  /** Non-standard, but every template renders it. */
  website: text.optional()
})

export const WorkSchema = z
  .object({
    name: text.optional(),
    /** Legacy alias for `name`; normalized below. */
    company: text.optional(),
    position: text.optional(),
    url: text.optional(),
    location: text.optional(),
    startDate: text.optional(),
    endDate: text.optional(),
    /** Rendered as a paragraph above `highlights` by every template. */
    summary: text.optional(),
    highlights: z.array(text).optional()
  })
  .transform(({ company, ...work }) => ({
    ...work,
    name: work.name ?? company
  }))

export const EducationSchema = z.object({
  institution: text.optional(),
  area: text.optional(),
  studyType: text.optional(),
  location: text.optional(),
  startDate: text.optional(),
  endDate: text.optional(),
  score: text.optional()
})

export const SkillSchema = z.object({
  name: text.optional(),
  level: text.optional(),
  keywords: z.array(text).optional()
})

export const ProjectSchema = z.object({
  name: text.optional(),
  description: text.optional(),
  url: text.optional(),
  startDate: text.optional(),
  endDate: text.optional(),
  highlights: z.array(text).optional(),
  keywords: z.array(text).optional()
})

export const AwardSchema = z.object({
  title: text.optional(),
  date: text.optional(),
  awarder: text.optional(),
  summary: text.optional()
})

export const SECTION_NAMES = [
  'profile',
  'education',
  'work',
  'skills',
  'projects',
  'awards'
] as const

export const SectionSchema = z.enum(SECTION_NAMES)

/** Templates are numbered 1..9; `index.ts` falls back to 1 for anything else. */
export const TEMPLATE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

/**
 * Clamps a number into `[min, max]` rather than rejecting it.
 *
 * `document` values tune visual density, often by an agent iterating toward a
 * one-page fit. A validation error it cannot interpret is worse than a value
 * silently pulled back into range — see `DocumentConfigSchema` below.
 */
function clamp(min: number, max: number) {
  return (n: number) => Math.min(max, Math.max(min, n))
}

/** `500px`-style units are rejected outright: pdfTeX and XeTeX disagree on `px`,
 * and Tectonic (XeTeX-derived) does not accept it. See `templates/documentConfig.ts`
 * for the parsing/formatting half of this — this regex only shapes the input. */
const LENGTH_PATTERN = /^\d+(\.\d+)?(in|cm|mm|pt)$/

/** Every value here is enum, clamped-number, or regex-validated string — no
 * free text. Nothing in this schema may take the `escapeLatex` path; see
 * `sanitize.ts`, which passes `document` through unescaped by design. */
export const DocumentConfigSchema = z
  .object({
    fontFamily: z.enum(['template', 'calibri', 'arial', 'helvetica', 'garamond', 'georgia']).optional(),
    /** `10.5`/`11.5` are dropped from the range `\documentclass` accepts only
     * `10pt`/`11pt`/`12pt` natively; see docs/next-features.md's F3 write-up. */
    fontSize: z.union([z.literal(10), z.literal(11), z.literal(12)]).optional(),
    paper: z.enum(['letter', 'a4']).optional(),
    /** Clamped to a hard floor of `0.5in` by `clampMarginFloor` (length.ts),
     * which converts through inches so `1cm`, `10mm`, and `0.5in` all compare
     * on the same footing before the floor is applied. */
    margin: z
      .string()
      .regex(LENGTH_PATTERN, 'margin must look like "0.75in", "2cm", "20mm", or "18pt"')
      .transform(clampMarginFloor)
      .optional(),
    lineSpacing: z.number().transform(clamp(1.0, 1.15)).optional(),
    sectionSpacing: z.number().transform(clamp(0, 12)).optional(),
    bulletSpacing: z.number().transform(clamp(0, 12)).optional(),
    accentColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'accentColor must be a 6-digit hex color like "#4A90D9"')
      .optional(),
    contactLayout: z.enum(['row', 'stacked']).optional(),
    linkStyle: z.enum(['hidden', 'colored']).optional()
  })
  .partial()

export const BlueprintSchema = z.object({
  basics: BasicsSchema.optional(),
  work: z.array(WorkSchema).optional(),
  education: z.array(EducationSchema).optional(),
  skills: z.array(SkillSchema).optional(),
  projects: z.array(ProjectSchema).optional(),
  awards: z.array(AwardSchema).optional(),

  /** Per-section heading overrides, e.g. `{ work: 'Experience' }`. */
  headings: z.record(SectionSchema, z.string()).default({}),

  /** Section render order. Defaults to the full set so agents need not supply it. */
  sections: z.array(SectionSchema).default([...SECTION_NAMES]),

  selectedTemplate: z
    .number()
    .int()
    .refine((n): n is (typeof TEMPLATE_IDS)[number] => TEMPLATE_IDS.includes(n as never), {
      message: `selectedTemplate must be one of ${TEMPLATE_IDS.join(', ')}`
    })
    .default(1),

  /**
   * Visual configuration, resolved against per-template defaults by
   * `templates/documentConfig.ts`. Deliberately sparse: every field here is
   * `.optional()` with no field-level default, so `resolveDocumentConfig` can
   * tell "the caller omitted this" from "the caller chose the global default"
   * — the distinction that makes per-template defaults possible at all.
   */
  document: DocumentConfigSchema.default({})
})

export type Location = z.infer<typeof LocationSchema>
export type Profile = z.infer<typeof ProfileSchema>
export type Basics = z.infer<typeof BasicsSchema>
export type Work = z.infer<typeof WorkSchema>
export type Education = z.infer<typeof EducationSchema>
export type Skill = z.infer<typeof SkillSchema>
export type Project = z.infer<typeof ProjectSchema>
export type Award = z.infer<typeof AwardSchema>
export type SectionName = z.infer<typeof SectionSchema>

/** The `document` block as the caller may supply it: sparse, every field optional. */
export type DocumentConfig = z.input<typeof DocumentConfigSchema>

/** A validated, normalized blueprint. Not yet LaTeX-escaped — see `sanitize.ts`. */
export type Blueprint = z.infer<typeof BlueprintSchema>

/** What the blueprint looks like on the way in, before defaults and normalization. */
export type BlueprintInput = z.input<typeof BlueprintSchema>

/**
 * Validates and normalizes a blueprint, throwing a `ZodError` on failure.
 * Callers wanting a result object rather than an exception should use
 * `BlueprintSchema.safeParse` directly.
 */
export function parseBlueprint(input: unknown): Blueprint {
  return BlueprintSchema.parse(input)
}

/**
 * Type guard for validation failures.
 *
 * Exported so adapters (CLI, MCP, HTTP) can distinguish bad input from a genuine
 * failure without taking their own direct dependency on zod.
 */
export function isValidationError(error: unknown): error is z.ZodError {
  return error instanceof z.ZodError
}

/** Formats a `ZodError` into readable `path: message` lines for CLI and agent output. */
export function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : '(root)'
      return `  ${path}: ${issue.message}`
    })
    .join('\n')
}
