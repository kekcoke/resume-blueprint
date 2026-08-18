import { TEMPLATE_IDS } from '../schema.js'

/**
 * What a caller needs to choose a template, rather than a bare list of numbers.
 *
 * `atsGrade` is not an opinion. It is the recorded result of the parse-fidelity
 * harness in `packages/core/test/ats.test.ts`, which renders a deliberately
 * dense blueprint, extracts the text back out with pdftotext — the only thing an
 * applicant tracking system ever sees — and checks four things: nothing clipped
 * mid-string, every critical field present, sections in the declared order, and
 * name/email/phone contiguous enough to read as one contact block. A fifth check
 * asserts this table against what is actually measured, so the two cannot drift.
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
}

export const TEMPLATE_PROFILES: readonly TemplateProfile[] = [
  { id: 1, name: 'Classic (article)', atsGrade: true, iconLabeledContacts: false },
  { id: 2, name: 'Awesome CV', atsGrade: false, iconLabeledContacts: true },
  { id: 3, name: 'Compact (article)', atsGrade: true, iconLabeledContacts: false },
  { id: 4, name: 'Deedy', atsGrade: true, iconLabeledContacts: false },
  { id: 5, name: 'res.cls', atsGrade: true, iconLabeledContacts: false },
  { id: 6, name: 'Minimal', atsGrade: true, iconLabeledContacts: false },
  { id: 7, name: 'ModernCV (banking)', atsGrade: false, iconLabeledContacts: true },
  { id: 8, name: 'McDowell', atsGrade: true, iconLabeledContacts: false },
  { id: 9, name: 'Contrast (article)', atsGrade: true, iconLabeledContacts: false }
]

/** The templates to reach for when the resume has to survive a parser. */
export const ATS_TEMPLATE_IDS: readonly number[] = TEMPLATE_PROFILES.filter(
  (profile) => profile.atsGrade
).map((profile) => profile.id)
