import getTemplateData from './templates/index.js'
import { parseBlueprint } from './schema.js'
import { sanitizeBlueprint } from './sanitize.js'
import { renderText } from './text.js'
import { compileTex, type CompileOptions } from './render/tectonic.js'
import type { TemplateData } from './types.js'

export {
  BlueprintSchema,
  DocumentConfigSchema,
  parseBlueprint,
  formatValidationError,
  isValidationError,
  SECTION_NAMES,
  TEMPLATE_IDS
} from './schema.js'
export type { Blueprint, BlueprintInput, DocumentConfig, SectionName } from './schema.js'

export { escapeLatex, sanitizeUrl, sanitizeBlueprint } from './sanitize.js'
export { compileTex, assetRoot, TectonicError } from './render/tectonic.js'
export type { CompileOptions } from './render/tectonic.js'
export type {
  FormValues,
  Generator,
  LaTeXOpts,
  ResolvedDocumentConfig,
  TemplateData
} from './types.js'
export { default as getTemplateData } from './templates/index.js'
export { TEMPLATE_PROFILES, ATS_TEMPLATE_IDS } from './templates/catalog.js'
export type { TemplateProfile } from './templates/catalog.js'
export {
  GLOBAL_DEFAULTS as DOCUMENT_GLOBAL_DEFAULTS,
  TEMPLATE_DEFAULTS as DOCUMENT_TEMPLATE_DEFAULTS,
  HONOURED_DOCUMENT_FIELDS,
  resolveDocumentConfig
} from './templates/documentConfig.js'
export { FONT_FAMILIES, UNSUPPORTED_FONTS, isFontSupported } from './templates/fonts.js'
export type { FontFamily } from './templates/fonts.js'
export { stripCitations, countCitations, findCitations, citationWarnings } from './import/citations.js'
export type { CitationSite } from './import/citations.js'
export { profileToBlueprint, ProfileParseError } from './import/profile.js'
export type { ProfileImportResult } from './import/profile.js'

/**
 * Validates, sanitizes, and renders a blueprint to LaTeX source.
 *
 * This is the seam every caller should use rather than reaching for
 * `getTemplateData` directly — it is what guarantees the document handed to the
 * engine has been escaped.
 *
 * @param input an unvalidated blueprint, e.g. parsed JSON from an agent.
 * @throws {z.ZodError} if the blueprint fails validation.
 */
export function blueprintToTex(input: unknown): TemplateData {
  return getTemplateData(sanitizeBlueprint(parseBlueprint(input)))
}

/**
 * Validates and renders a blueprint to plain text, honouring `sections` and
 * `headings`. The sibling of `blueprintToTex` at the same seam, but with no
 * sanitization step: plain text is not TeX, and running `escapeLatex` over it
 * would show a human reader a literal `\&`.
 *
 * @param input an unvalidated blueprint, e.g. parsed JSON from an agent.
 * @throws {z.ZodError} if the blueprint fails validation.
 */
export function blueprintToText(input: unknown): string {
  return renderText(parseBlueprint(input))
}

/**
 * Validates, sanitizes, and renders a blueprint all the way to PDF bytes.
 *
 * @param input an unvalidated blueprint, e.g. parsed JSON from an agent.
 * @throws {z.ZodError} if the blueprint fails validation.
 * @throws {TectonicError} if compilation fails, with the engine log attached.
 */
export async function renderBlueprint(
  input: unknown,
  options: CompileOptions = {}
): Promise<Buffer> {
  const { texDoc, opts } = blueprintToTex(input)
  return compileTex(texDoc, opts, options)
}
