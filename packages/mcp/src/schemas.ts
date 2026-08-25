import { z } from 'zod'
import {
  DocumentConfigSchema,
  SECTION_NAMES,
  TEMPLATE_IDS
} from '@resume-blueprint/core'

export const SectionEnum = z.enum(SECTION_NAMES)

/** Mirrors core's `selectedTemplate` construct — see the note there on why this
 * is `z.literal` over the tuple rather than a refined number under zod 4. */
export const TemplateId = z.literal(TEMPLATE_IDS, {
  error: `template must be one of ${TEMPLATE_IDS.join(', ')}`
})

export const RevOpt = { expectedRev: z.string().optional() }

export const ResumeListInput = z.object({})

export const ResumeGetInput = z.object({ id: z.string() })

export const ResumeCreateInput = z.object({
  id: z.string(),
  blueprint: z.record(z.string(), z.unknown()).optional()
})

export const ResumePatchInput = z.object({
  id: z.string(),
  patch: z.record(z.string(), z.unknown()),
  ...RevOpt
})

export const ResumeSectionAppendInput = z.object({
  id: z.string(),
  section: SectionEnum,
  item: z.record(z.string(), z.unknown()),
  ...RevOpt
})

export const ResumeSectionUpdateInput = z.object({
  id: z.string(),
  section: SectionEnum,
  index: z.number().int().nonnegative(),
  item: z.record(z.string(), z.unknown()),
  ...RevOpt
})

export const ResumeSectionRemoveInput = z.object({
  id: z.string(),
  section: SectionEnum,
  index: z.number().int().nonnegative(),
  ...RevOpt
})

export const ResumeRemoveInput = z.object({
  id: z.string(),
  ...RevOpt
})

export const ResumeValidateInput = z.object({
  blueprint: z.record(z.string(), z.unknown())
})

// 300_000ms (5 minutes) is generous enough for a cold-cache first Tectonic
// compile — core's own tests budget up to 180s for that — while ruling out
// a caller pipelining renders with multi-day timeouts to hold subprocesses
// alive indefinitely (see Gate 2 MCP review, finding 1).
const MAX_RENDER_TIMEOUT_MS = 300_000

export const ResumeRenderInput = z.object({
  id: z.string(),
  template: TemplateId.optional(),
  /** Merged over the stored blueprint's own `document`, field by field — see
   * `tools.ts`'s `withOverrides` — not a wholesale replacement. */
  document: DocumentConfigSchema.optional(),
  timeoutMs: z.number().int().positive().max(MAX_RENDER_TIMEOUT_MS).optional()
})

export const ResumeTexInput = z.object({
  id: z.string(),
  template: TemplateId.optional(),
  document: DocumentConfigSchema.optional()
})

/** No `template`/`document` here, unlike `ResumeTexInput` — `blueprintToText`
 * doesn't consume `ResolvedDocumentConfig` at all, so there is nothing for
 * either override to change. */
export const ResumeTextInput = z.object({
  id: z.string()
})

/**
 * A long posting is a few thousand characters; 60k is roughly a book chapter.
 *
 * Capped at the boundary for the same reason as `timeoutMs` and
 * `MAX_HISTORY_LIMIT`: `analyzeCoverage` builds every 1-, 2-, and 3-gram of its
 * input, so an unbounded string is an unbounded allocation inside a long-lived
 * server process.
 */
const MAX_JD_CHARS = 60_000

/** Matches core's own clamp. Declared here so the boundary rejects an absurd
 * request outright rather than silently pulling it into range. */
const MAX_COVERAGE_TERMS = 200

export const ResumeTargetInput = z.object({
  id: z.string(),
  /** The posting itself, not a path -- same reasoning as ResumeImportInput. */
  jobDescription: z.string().min(1).max(MAX_JD_CHARS),
  maxTerms: z.number().int().positive().max(MAX_COVERAGE_TERMS).optional()
})

// Capped for the same reason as timeoutMs above: an unbounded `limit` lets a
// caller force an arbitrarily large `git log` read.
const MAX_HISTORY_LIMIT = 500

export const ResumeHistoryInput = z.object({
  id: z.string(),
  limit: z.number().int().positive().max(MAX_HISTORY_LIMIT).optional()
})

export const ResumeDiffInput = z.object({
  id: z.string(),
  revA: z.string(),
  revB: z.string().optional()
})

export const ResumeRevertInput = z.object({
  id: z.string(),
  rev: z.string(),
  ...RevOpt
})

export const ResumeTemplatesInput = z.object({})

/**
 * Takes the markdown itself, not a path.
 *
 * No other tool on this server reads a caller-supplied path, and adding one
 * would hand an agent an arbitrary local-file read through a resume tool --
 * a capability class this server does not otherwise have, and one nothing
 * here is positioned to guard (store's `ID_PATTERN` is the only traversal
 * defense in the repo, and it guards generated filenames, not user input).
 * The agent already has file-reading tools; the CLI is the adapter that reads
 * from a path.
 */
export const ResumeImportInput = z.object({
  markdown: z.string()
})

// --- Output schemas -----------------------------------------------------
//
// Declared so the SDK's validateToolOutput actually checks structuredContent
// rather than being a no-op (see docs/phase-2-plan-b.md's Gate 3 note and
// Gate 2 MCP review, finding 7). Kept as loose as the underlying data itself
// is loosely-typed, matching the philosophy already used for input schemas
// above — a blueprint's shape is `z.record(z.string(), z.unknown())` on the way in, so
// it stays that way on the way out too.

/** Shared by every mutation tool that returns just the new `{ id, rev }`. */
const IdRevOutput = { id: z.string(), rev: z.string() }

export const ResumeListOutput = z.object({
  blueprints: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      updatedAt: z.string(),
      rev: z.string()
    })
  )
})

export const ResumeGetOutput = z.object({
  blueprint: z.record(z.string(), z.unknown()),
  rev: z.string()
})

/** Deliberately does not include an `id` or `rev`: this tool writes nothing.
 *  `warnings` is the load-bearing half -- the parser reports every section it
 *  could not map and every reading it had to assume, and an agent that ignores
 *  it will store a blueprint with a job title in the employer field. */
export const ResumeImportOutput = z.object({
  blueprint: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string())
})

export const ResumeCreateOutput = z.object(IdRevOutput)
export const ResumePatchOutput = z.object(IdRevOutput)
export const ResumeSectionAppendOutput = z.object(IdRevOutput)
export const ResumeSectionUpdateOutput = z.object(IdRevOutput)
export const ResumeSectionRemoveOutput = z.object(IdRevOutput)
export const ResumeRemoveOutput = z.object(IdRevOutput)
export const ResumeRevertOutput = z.object(IdRevOutput)

/** Citation artifacts left in the content by a profile generator. Present only
 *  when there are any, never an empty array: these output schemas are enforced
 *  by the SDK's validateToolOutput, and a required field would reject every
 *  clean response unless each handler remembered to emit `[]`. */
const CitationWarnings = { warnings: z.array(z.string()).optional() }

export const ResumeValidateOutput = z.object({
  valid: z.boolean(),
  errors: z.string().optional(),
  ...CitationWarnings
})

export const ResumeRenderOutput = z.object({
  path: z.string(),
  pageCount: z.number().int().nonnegative(),
  byteSize: z.number().int().nonnegative(),
  /** Which core build produced this PDF. See buildStamp.ts. */
  coreBuild: z.string(),
  ...CitationWarnings
})

export const ResumeTexOutput = z.object({
  texDoc: z.string(),
  ...CitationWarnings
})

export const ResumeTextOutput = z.object({
  text: z.string(),
  ...CitationWarnings
})

/** Shared by matched and missing terms alike -- see CoverageTerm in
 * packages/core/src/coverage.ts. */
const CoverageTermFields = {
  term: z.string(),
  count: z.number().int().nonnegative(),
  firstIndex: z.number().int().nonnegative(),
  prominence: z.number()
}

/**
 * `notes` rather than a second `warnings`: the citation channel already owns
 * that name on every other tool here, and folding two unrelated signals into
 * one array would make neither readable.
 */
export const ResumeTargetOutput = z.object({
  coverage: z.number(),
  matched: z.array(
    z.object({
      ...CoverageTermFields,
      sections: z.array(SectionEnum),
      /** Present only when the match came through the plural fold. */
      matchedAs: z.string().optional()
    })
  ),
  missing: z.array(
    z.object({
      ...CoverageTermFields,
      suggestions: z.array(
        z.object({ section: SectionEnum, reason: z.string() })
      )
    })
  ),
  sections: z.array(
    z.object({ section: SectionEnum, matched: z.number().int().nonnegative() })
  ),
  notes: z.array(z.string()),
  ...CitationWarnings
})

export const ResumeHistoryOutput = z.object({
  commits: z.array(
    z.object({
      rev: z.string(),
      date: z.string(),
      message: z.string()
    })
  )
})

export const ResumeDiffOutput = z.object({
  diff: z.string()
})

/** A template's fully-resolved `document` defaults, as `resolveDocumentConfig`
 * returns them with an empty override — see packages/core/src/templates/documentConfig.ts. */
const ResolvedDocumentOutput = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  paper: z.string(),
  margin: z.string(),
  lineSpacing: z.number(),
  sectionSpacing: z.number(),
  bulletSpacing: z.number(),
  accentColor: z.string().optional(),
  contactLayout: z.string(),
  linkStyle: z.string()
})

export const ResumeTemplatesOutput = z.object({
  templates: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      /** Measured, not asserted — see packages/core/src/templates/catalog.ts. */
      atsGrade: z.boolean(),
      iconLabeledContacts: z.boolean(),
      clearsMarginFloor: z.boolean(),
      cohesiveSkillRows: z.boolean(),
      cohesiveRecords: z.boolean(),
      orphanBullets: z.boolean(),
      document: z.object({
        /** This template's resolved `document` values with nothing overridden. */
        defaults: ResolvedDocumentOutput,
        /** Which `document` fields actually change this template's output —
         * an agent can check here before spending a render on an override
         * that would silently do nothing. */
        honours: z.array(z.string())
      })
    })
  )
})
