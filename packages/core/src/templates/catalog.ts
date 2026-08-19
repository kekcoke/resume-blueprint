import { TEMPLATE_IDS } from '../schema.js'

/**
 * What a caller needs to choose a template, rather than a bare list of numbers.
 *
 * Nothing here is an opinion. Every flag is a recorded result of the
 * parse-fidelity harness in `packages/core/test/ats.test.ts`, which renders four
 * blueprints of deliberately different shapes — dense, multipage, grid, and
 * sparse — extracts the text back out with pdftotext, and asserts this table
 * against what it measures, so the two cannot drift.
 *
 * `atsGrade` is the conjunction of the four original gates — nothing clipped
 * mid-string, every critical field present, sections in the declared order, and
 * name/email/phone contiguous enough to read as one contact block — with a text
 * layer free of icon-font glyphs.
 *
 * The four fields below it record defects the harness can now see but nothing
 * has yet fixed: margins under the 0.5in floor, skill categories that extract
 * apart from their keywords, award records that arrive as three fragments, and
 * bullets with no text after them. They deliberately do NOT feed `atsGrade`.
 * Folding them in would shrink `ATS_TEMPLATE_IDS` for problems no one has
 * addressed; they are the evidence base for the layout work, not its verdict.
 */
export type TemplateProfile = {
  id: (typeof TEMPLATE_IDS)[number]
  /** The document class or style the template is built on. */
  name: string
  /** Passes every parse-fidelity gate, and labels its contacts in words. */
  atsGrade: boolean
  /**
   * The contact block is labeled with icon-font glyphs instead of words.
   *
   * Those glyphs land in the text layer: template2's FontAwesome icons extract
   * as private-use characters (U+F0E0 and friends) and template7's moderncv
   * icons as mis-mapped Latin (U+0232, U+0307). A parser reads a stray token
   * immediately before the email address, and some will take it as part of the
   * value. Both still render beautifully — this is a machine-readability cost,
   * not a visual defect.
   */
  iconLabeledContacts: boolean

  /**
   * Text stays at least 0.5in from every page edge, on every fixture and every
   * page.
   *
   * Measured from `pdftotext -bbox`, so this is the real text box rather than
   * the margin a template declares — it accounts for vendored classes that set
   * their own geometry, and for an overfull box that runs into the margin.
   * 0.5in is the floor the external review asks for and the floor F3 will
   * clamp `document.margin` to.
   */
  clearsMarginFloor: boolean

  /**
   * A skill category label and its keywords extract onto the same line.
   *
   * Five templates build `skillsSection` from a two-column `tabular`, so the
   * label and its values are separate cells and a parser reads the category as
   * a value of its own. F5 converts those to single-column rows.
   */
  cohesiveSkillRows: boolean

  /**
   * An award's title, awarder, and date extract onto one line.
   *
   * The external review's first concrete defect: a credential whose issuer and
   * year break away from its name, leaving a parser three fragments instead of
   * one record. F6 gives certifications their own flat section.
   */
  cohesiveRecords: boolean

  /**
   * Emits at least one extracted line that is nothing but a bullet glyph.
   *
   * An entry carrying a name and no detail still gets its `\item`. F5 guards
   * those list items on content.
   */
  orphanBullets: boolean
}

export const TEMPLATE_PROFILES: readonly TemplateProfile[] = [
  {
    id: 1,
    name: 'Classic (article)',
    atsGrade: true,
    iconLabeledContacts: false,
    // F3's TEMPLATE_DEFAULTS[1].margin raised the declared margin from
    // 0.8in to 1.1in to absorb the header's \vspace*{-40pt}/\hspace*{-18pt}
    // pull — measured clearing the floor at 0.753in (multipage.json, page 1
    // top) after that change.
    clearsMarginFloor: true,
    cohesiveSkillRows: false,
    cohesiveRecords: false,
    orphanBullets: false
  },
  {
    id: 2,
    name: 'Awesome CV',
    atsGrade: false,
    iconLabeledContacts: true,
    clearsMarginFloor: true,
    cohesiveSkillRows: false,
    cohesiveRecords: false,
    orphanBullets: false
  },
  {
    id: 3,
    name: 'Compact (article)',
    atsGrade: true,
    iconLabeledContacts: false,
    clearsMarginFloor: true,
    cohesiveSkillRows: true,
    cohesiveRecords: true,
    orphanBullets: false
  },
  {
    id: 4,
    name: 'Deedy',
    atsGrade: true,
    iconLabeledContacts: false,
    // F3's TEMPLATE_DEFAULTS[4].margin raised the declared margin to 1.05in
    // to clear a fixed-offset overrun near the page foot — measured
    // clearing the floor at 0.603in bottom across all four F2 fixtures.
    clearsMarginFloor: true,
    cohesiveSkillRows: false,
    // Regressed from true by the margin fix directly above: the wider
    // margin narrows the text column (this template has one `margin` value
    // for all four sides, not a per-side one), and "Distinguished
    // Engineering Award" now wraps its award line across two extracted
    // lines instead of one. A genuine trade-off, not an oversight — the
    // alternative was leaving the page-bottom overrun unfixed. Left for F5,
    // which already owns this template's layout work.
    cohesiveRecords: false,
    orphanBullets: false
  },
  {
    id: 5,
    name: 'res.cls',
    atsGrade: true,
    iconLabeledContacts: false,
    clearsMarginFloor: true,
    cohesiveSkillRows: false,
    cohesiveRecords: true,
    orphanBullets: false
  },
  {
    id: 6,
    name: 'Minimal',
    atsGrade: true,
    iconLabeledContacts: false,
    clearsMarginFloor: true,
    cohesiveSkillRows: true,
    cohesiveRecords: false,
    orphanBullets: false
  },
  {
    id: 7,
    name: 'ModernCV (banking)',
    atsGrade: false,
    iconLabeledContacts: true,
    clearsMarginFloor: true,
    cohesiveSkillRows: true,
    cohesiveRecords: false,
    orphanBullets: false
  },
  {
    id: 8,
    name: 'McDowell',
    atsGrade: true,
    iconLabeledContacts: false,
    clearsMarginFloor: true,
    cohesiveSkillRows: true,
    cohesiveRecords: true,
    orphanBullets: true
  },
  {
    id: 9,
    name: 'Contrast (article)',
    atsGrade: true,
    iconLabeledContacts: false,
    clearsMarginFloor: true,
    cohesiveSkillRows: false,
    cohesiveRecords: true,
    orphanBullets: false
  }
]

/** The templates to reach for when the resume has to survive a parser. */
export const ATS_TEMPLATE_IDS: readonly number[] = TEMPLATE_PROFILES.filter(
  (profile) => profile.atsGrade
).map((profile) => profile.id)
