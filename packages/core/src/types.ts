import type {
  Award,
  Basics,
  Blueprint,
  Education,
  Project,
  Skill,
  Work
} from './schema.js'

export type { Award, Basics, Education, Project, Skill, Work }

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
  resumeHeader: () => string
  profileSection: (basics?: Basics) => string
  educationSection: (education?: Array<Education>, heading?: string) => string
  workSection: (work?: Array<Work>, heading?: string) => string
  skillsSection: (skills?: Array<Skill>, heading?: string) => string
  projectsSection: (projects?: Array<Project>, heading?: string) => string
  awardsSection: (awards?: Array<Award>, heading?: string) => string
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

export type TemplateData = {
  texDoc: string
  opts: LaTeXOpts
}
