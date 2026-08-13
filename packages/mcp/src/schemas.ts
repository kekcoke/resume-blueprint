import { z } from 'zod'
import { SECTION_NAMES, TEMPLATE_IDS } from '@resume-blueprint/core'

export const SectionEnum = z.enum(SECTION_NAMES)

export const TemplateId = z
  .number()
  .int()
  .refine((n) => (TEMPLATE_IDS as readonly number[]).includes(n), {
    message: `template must be one of ${TEMPLATE_IDS.join(', ')}`
  })

export const RevOpt = { expectedRev: z.string().optional() }

export const ResumeListInput = z.object({})

export const ResumeGetInput = z.object({ id: z.string() })

export const ResumeCreateInput = z.object({
  id: z.string(),
  blueprint: z.record(z.unknown()).optional()
})

export const ResumePatchInput = z.object({
  id: z.string(),
  patch: z.record(z.unknown()),
  ...RevOpt
})

export const ResumeSectionAppendInput = z.object({
  id: z.string(),
  section: SectionEnum,
  item: z.record(z.unknown()),
  ...RevOpt
})

export const ResumeSectionUpdateInput = z.object({
  id: z.string(),
  section: SectionEnum,
  index: z.number().int().nonnegative(),
  item: z.record(z.unknown()),
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
  blueprint: z.record(z.unknown())
})

export const ResumeRenderInput = z.object({
  id: z.string(),
  template: TemplateId.optional(),
  timeoutMs: z.number().int().positive().optional()
})

export const ResumeTexInput = z.object({
  id: z.string(),
  template: TemplateId.optional()
})

export const ResumeHistoryInput = z.object({
  id: z.string(),
  limit: z.number().int().positive().optional()
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
