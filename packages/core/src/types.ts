import type {
  Award,
  Basics,
  Blueprint,
  Education,
  Project,
  Skill,
  Work
} from './schema.js'
import type { ResolvedDocumentConfig } from './templates/documentConfig.js'

export type { Award, Basics, Education, Project, Skill, Work }
export type { ResolvedDocumentConfig }

/**
 * The nine template generators were written against a type named `FormValues`,
 * back when the input came from a web form. The input is now a validated,
 * sanitized blueprint, but the shape is compatible, so the alias is kept rather
 * than editing nine files to rename a type.
 */
export type FormValues = Blueprint

/**
 * The interface every template's section renderer implements. This is the clean
 * seam in the original code and is worth preserving — adding a template means
 * implementing this and registering it in `templates/index.ts`.
 */
export type Generator = {
  /**
   * Required, not optional, on every template — an optional parameter would
   * let a future template silently ignore `document`, the same bug class
   * that once lost `basics.label` and `work[].summary`. Not every template
   * uses `config` inside this method's own body: several (templates 4 and 8)
   * emit config-driven preamble lines from their outer `templateN()`
   * function instead, at the point after `\documentclass` where a
   * `\usepackage` line is actually legal — `resumeHeader` on those runs
   * before the class. The signature still takes `config` on all nine so a
   * caller can never forget to resolve and pass it.
   */
  resumeHeader: (config: ResolvedDocumentConfig) => string
  /**
   * `config` is required here too, and for every method below except the
   * optional `summarySection` override on `GeneratorWithSummary` — F5 needed
   * `contactLayout` inside the functions that build the contact block
   * (`profileSection`/`summarySection`) and `bulletSpacing` inside every
   * function that opens a list environment. An optional parameter would let a
   * future template silently ignore `document` the same way `resumeHeader`'s
   * comment already warns about; not every template's body of every method
   * uses `config` (several route `sectionSpacing` through a macro defined in
   * `resumeHeader` instead, and consume `config` here only for
   * `bulletSpacing`, if at all), but the seam stays uniform across all nine.
   */
  profileSection: (basics: Basics | undefined, config: ResolvedDocumentConfig) => string
  /**
   * `basics.label` and `basics.summary` belong to the profile, but templates 5,
   * 7, and 8 emit their headers from the preamble through class-level macros
   * (`\name{}`, `\address{}`, `\contacts{}`), where a prose paragraph cannot
   * go. Those three implement this instead, and their body calls it directly
   * below the header. Every other template renders both inside `profileSection`.
   */
  summarySection?: (basics: Basics | undefined, config: ResolvedDocumentConfig) => string
  educationSection: (
    education: Array<Education> | undefined,
    heading: string | undefined,
    config: ResolvedDocumentConfig
  ) => string
  workSection: (
    work: Array<Work> | undefined,
    heading: string | undefined,
    config: ResolvedDocumentConfig
  ) => string
  skillsSection: (
    skills: Array<Skill> | undefined,
    heading: string | undefined,
    config: ResolvedDocumentConfig
  ) => string
  projectsSection: (
    projects: Array<Project> | undefined,
    heading: string | undefined,
    config: ResolvedDocumentConfig
  ) => string
  awardsSection: (
    awards: Array<Award> | undefined,
    heading: string | undefined,
    config: ResolvedDocumentConfig
  ) => string
}

/**
 * Compilation requirements declared by a template.
 *
 * `inputs` and `fonts` were browser URLs in the original (`/templates/foo.cls`)
 * because the app fetched them into an in-memory filesystem. They are now paths
 * relative to the packaged asset root, resolved and staged by the renderer.
 */
export type LaTeXOpts = {
  /**
   * The engine the template's document class expects. Tectonic is XeTeX-derived
   * and handles both, so this is a compatibility hint rather than a binary name.
   */
  cmd: 'pdflatex' | 'xelatex'
  /** `.cls` / `.sty` / `.tex` files, relative to the asset root. */
  inputs?: string[]
  /** Font files, staged into a `fonts/` subdirectory of the compile directory. */
  fonts?: string[]
}

/**
 * A template whose header is emitted from the preamble through class-level
 * macros, so `basics.label` and `basics.summary` have to render in the body.
 * Templates 5, 7, and 8 are the three; declaring it makes `summarySection`
 * required for them while it stays optional for everyone else.
 */
export type GeneratorWithSummary = Generator & {
  summarySection: (basics: Basics | undefined, config: ResolvedDocumentConfig) => string
}

export type TemplateData = {
  texDoc: string
  opts: LaTeXOpts
}
