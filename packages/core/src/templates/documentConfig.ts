import type { DocumentConfig, TEMPLATE_IDS } from '../schema.js'

/**
 * `document`, fully resolved: every field a template might consult has a
 * concrete value, merged from (in order of precedence) what the caller set,
 * this template's own default, and the global default.
 *
 * `accentColor` is the one field that can stay `undefined` — it only applies
 * to templates 2, 3, 7, and 9 (each thread it through their own preamble
 * code in `templateN.ts`), and there is no sensible global fallback color to
 * invent for the other five.
 */
export type ResolvedDocumentConfig = {
  fontFamily: NonNullable<DocumentConfig['fontFamily']>
  fontSize: 10 | 11 | 12
  paper: 'letter' | 'a4'
  margin: string
  lineSpacing: number
  sectionSpacing: number
  bulletSpacing: number
  accentColor?: string
  contactLayout: 'row' | 'stacked'
  linkStyle: 'hidden' | 'colored'
}

/**
 * Values used when neither the caller nor `TEMPLATE_DEFAULTS` supplies one.
 *
 * `fontSize` has no global default by design — the doc's variable table marks
 * it "per-template", and every template in `TEMPLATE_DEFAULTS` below supplies
 * one. `11` here is only reached if a template is ever added to `TEMPLATE_IDS`
 * without a matching `TEMPLATE_DEFAULTS` entry.
 */
export const GLOBAL_DEFAULTS: ResolvedDocumentConfig = {
  fontFamily: 'template',
  fontSize: 11,
  paper: 'letter',
  margin: '0.75in',
  lineSpacing: 1.0,
  sectionSpacing: 3,
  bulletSpacing: 2,
  contactLayout: 'row',
  linkStyle: 'hidden'
}

/**
 * Each template's *current* hardcoded values — read out of the template
 * source, not chosen fresh. This is F3's regression guard: resolving with an
 * empty `document` must reproduce exactly what each template already emits,
 * so golden `.tex` snapshots stay byte-identical.
 *
 * Two entries deviate from "current hardcoded value" and both are flagged in
 * `docs/next-features.md` conflict C4: templates 1 and 4 are recorded by the
 * F2 harness (`packages/core/test/ats.test.ts`) as breaching the 0.5in margin
 * floor at their *current* declared margins, because content in both — a
 * negative `\vspace`/`\hspace` run in template1's header, an unmeasured
 * vendored-class margin in template4 — pulls the effective text box in past
 * what the declared margin promises. The values below are picked to clear the
 * floor with room for that overrun, and are the one place golden `.tex` output
 * is knowingly allowed to change by this feature (see F3's exit criteria).
 */
export const TEMPLATE_DEFAULTS: Record<(typeof TEMPLATE_IDS)[number], Partial<ResolvedDocumentConfig>> = {
  1: {
    // a4paper was already the hardcoded value; margin rises from 0.8in to
    // clear the floor despite the header's -40pt/-18pt negative spacing.
    paper: 'a4',
    fontSize: 10,
    margin: '1.1in'
  },
  2: {
    // awesome-cv.cls owns its own page geometry and font size; nothing here
    // overrides them unless the caller explicitly sets `document`.
  },
  3: {
    // No page-size option in the current source, so plain `article`'s own
    // default (letterpaper) is what actually renders today — recorded
    // explicitly so paper can be compared-and-overridden the same safe way
    // as fontSize, rather than needing a raw-input check.
    paper: 'letter',
    fontSize: 11
  },
  4: {
    // deedy-resume-openfont.cls sets its own margins; F2 recorded it under
    // the floor. geometry, loaded after the class, wins regardless of what
    // the class declared — measured directly: at 0.75in the bottom edge
    // still only clears 0.303in (some fixed-offset content near the page
    // foot eats into geometry's declared margin, the same class of overrun
    // as template1's negative \vspace). 1.05in measured clean at 0.603in
    // bottom across all four F2 fixtures.
    margin: '1.05in'
  },
  5: {
    // res.cls's own `line,margin` class options own layout; left unset so a
    // caller-supplied override is the only thing that touches it.
  },
  6: {
    // Same reasoning as template 3: no page-size option present, so
    // letterpaper is the true current default, not a guess.
    paper: 'letter',
    fontSize: 10
  },
  7: {
    paper: 'letter',
    // moderncv's own comment documents '10pt'/'11pt'/'12pt' as valid class
    // options without saying which applies when none is given; moderncv is
    // built on the standard LaTeX size-option convention, whose default
    // absent an option is 10pt, same as every other class in this file that
    // omits a size option.
    fontSize: 10,
    // moderncv's own \address/\phone/\email/\homepage calls stack one per
    // line by class design (\makecvtitle, banking style) — recorded as this
    // template's current hardcoded behavior, same reasoning as templates
    // 1/4's margin entries, not a new preference. An explicit
    // document.contactLayout: 'row' still works: profileSection folds every
    // field into \extrainfo, moderncv's one free-text line.
    contactLayout: 'stacked'
  },
  8: {
    // mcdowellcv.cls owns its own geometry; left unset for the same reason
    // as templates 2 and 5.
    // \address{}/\contacts{} are this template's own macros, joined here
    // (not by the class) with explicit \linebreaks — recorded as the
    // current hardcoded behavior, same reasoning as template 7 above. An
    // explicit document.contactLayout: 'row' switches the join separator.
    contactLayout: 'stacked'
  },
  9: {
    paper: 'letter',
    margin: '0.75in',
    // NOT 11: template9's current `\documentclass[fontsize=11pt]{article}`
    // is a KOMA-Script option plain `article` silently ignores (dead code,
    // noted in docs/next-features.md). Recording the size this produces
    // today — 10pt, article's un-overridden default — rather than the
    // intended-but-inert 11 keeps `document` omitted byte-identical. Fixing
    // the dead option is out of scope here (see F12); an explicit
    // `document.fontSize` override still works correctly (Step 5 below).
    fontSize: 10
  },
  10: {
    // F7's Word-alike preset: the external feedback's universal rules
    // shipped as this template's *defaults*, not merely values it accepts.
    // Plain `article`, no vendored class and no negative-vspace header
    // tricks (the defect that forced templates 1 and 4 above the floor), so
    // margin/paper equal GLOBAL_DEFAULTS unchanged — recorded explicitly
    // here anyway, the same documentation style as every other template in
    // this table.
    fontFamily: 'calibri',
    fontSize: 11,
    paper: 'letter',
    margin: '0.75in',
    lineSpacing: 1.15,
    contactLayout: 'row'
  }
}

/** Resolves `document` for one template: caller value, then this template's
 * default, then the global default. */
export function resolveDocumentConfig(
  templateId: number,
  config: DocumentConfig = {}
): ResolvedDocumentConfig {
  const template = (TEMPLATE_DEFAULTS as Record<number, Partial<ResolvedDocumentConfig> | undefined>)[
    templateId
  ]

  return {
    fontFamily: config.fontFamily ?? template?.fontFamily ?? GLOBAL_DEFAULTS.fontFamily,
    fontSize: config.fontSize ?? template?.fontSize ?? GLOBAL_DEFAULTS.fontSize,
    paper: config.paper ?? template?.paper ?? GLOBAL_DEFAULTS.paper,
    margin: config.margin ?? template?.margin ?? GLOBAL_DEFAULTS.margin,
    lineSpacing: config.lineSpacing ?? template?.lineSpacing ?? GLOBAL_DEFAULTS.lineSpacing,
    sectionSpacing: config.sectionSpacing ?? template?.sectionSpacing ?? GLOBAL_DEFAULTS.sectionSpacing,
    bulletSpacing: config.bulletSpacing ?? template?.bulletSpacing ?? GLOBAL_DEFAULTS.bulletSpacing,
    accentColor: config.accentColor ?? template?.accentColor,
    contactLayout: config.contactLayout ?? template?.contactLayout ?? GLOBAL_DEFAULTS.contactLayout,
    linkStyle: config.linkStyle ?? template?.linkStyle ?? GLOBAL_DEFAULTS.linkStyle
  }
}

/**
 * Strips the `#` and uppercases a validated hex color for xcolor's `HTML`
 * model, which takes `4A90D9`, not `#4A90D9`.
 *
 * Takes only values that have already passed `DocumentConfigSchema`'s
 * `/^#[0-9A-Fa-f]{6}$/` — this is a formatter, not a second validation pass.
 */
export function accentColorToTeX(hex: string): string {
  return hex.slice(1).toUpperCase()
}

/**
 * Which `document` fields each template actually reads, read out of
 * `templateN.ts`'s preamble code rather than declared aspirationally — an
 * agent calling `resume_templates` can use this to know an override will do
 * something before spending a render on it, rather than guessing.
 *
 * `fontFamily` is honoured by all nine as of F4, though not every value of
 * it: templates 2, 4, and 6 only render a change for `'georgia'` — `carlito`/
 * `arimo`/`tgheros`/`ebgaramond` can't be resolved by fontspec's name lookup
 * where those three build their text from literal `\newfontfamily`/
 * `\fontspec` calls rather than `\rmfamily`/`\sffamily` (see
 * `templates/fonts.ts`'s `UNSUPPORTED_FONTS` and its header comment,
 * finding 4). This list stays per-field, not per-value, matching every
 * other entry here (`accentColor` is listed for 2/3/7/9 the same way even
 * though it's a free hex value, not a fixed set).
 *
 * `sectionSpacing`, `bulletSpacing`, and `contactLayout` are honoured by all
 * nine as of F5: `sectionSpacing` reaches every section heading (either a
 * macro defined in `resumeHeader` or an additive `\vspace` at the call
 * site), `bulletSpacing` reaches every list environment a template opens,
 * and `contactLayout` reaches the contact block built in `profileSection`
 * (or `summarySection`, for the three templates that route it there).
 * `accentColor` only ever appears for 2, 3, 7, and 9, matching the doc's
 * variable table in docs/next-features.md.
 */
export const HONOURED_DOCUMENT_FIELDS: Record<
  (typeof TEMPLATE_IDS)[number],
  ReadonlyArray<keyof ResolvedDocumentConfig>
> = {
  1: [
    'paper',
    'fontSize',
    'margin',
    'lineSpacing',
    'sectionSpacing',
    'bulletSpacing',
    'contactLayout',
    'linkStyle',
    'fontFamily'
  ],
  2: [
    'paper',
    'margin',
    'accentColor',
    'lineSpacing',
    'sectionSpacing',
    'bulletSpacing',
    'contactLayout',
    'linkStyle',
    'fontFamily'
  ],
  3: [
    'paper',
    'fontSize',
    'margin',
    'accentColor',
    'lineSpacing',
    'sectionSpacing',
    'bulletSpacing',
    'contactLayout',
    'linkStyle',
    'fontFamily'
  ],
  4: [
    'margin',
    'lineSpacing',
    'sectionSpacing',
    'bulletSpacing',
    'contactLayout',
    'linkStyle',
    'fontFamily'
  ],
  5: [
    'paper',
    'margin',
    'lineSpacing',
    'sectionSpacing',
    'bulletSpacing',
    'contactLayout',
    'linkStyle',
    'fontFamily'
  ],
  6: [
    'paper',
    'fontSize',
    'margin',
    'lineSpacing',
    'sectionSpacing',
    'bulletSpacing',
    'contactLayout',
    'linkStyle',
    'fontFamily'
  ],
  7: [
    'paper',
    'fontSize',
    'margin',
    'accentColor',
    'lineSpacing',
    'sectionSpacing',
    'bulletSpacing',
    'contactLayout',
    'linkStyle',
    'fontFamily'
  ],
  8: [
    'paper',
    'margin',
    'lineSpacing',
    'sectionSpacing',
    'bulletSpacing',
    'contactLayout',
    'linkStyle',
    'fontFamily'
  ],
  9: [
    'paper',
    'fontSize',
    'margin',
    'accentColor',
    'lineSpacing',
    'sectionSpacing',
    'bulletSpacing',
    'contactLayout',
    'linkStyle',
    'fontFamily'
  ],
  // No accentColor: F3's variable table scopes it to templates 2, 3, 7, 9
  // only. Otherwise identical to template1's list — plain article, no
  // vendored-class quirks to carve out.
  10: [
    'paper',
    'fontSize',
    'margin',
    'lineSpacing',
    'sectionSpacing',
    'bulletSpacing',
    'contactLayout',
    'linkStyle',
    'fontFamily'
  ]
}
