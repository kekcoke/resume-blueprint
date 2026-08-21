import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { profileToBlueprint, ProfileParseError } from '../dist/import/profile.js'
import { parseBlueprint, formatValidationError, isValidationError } from '../dist/schema.js'
import { blueprintToTex } from '../dist/index.js'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures')

/**
 * `fixtures/profile.md` is a synthetic stand-in for `profile_templates/*.md`,
 * which are gitignored because they carry real PII and are not in core's
 * `files` array. It reproduces the generator's grammar exactly -- every marker
 * shape, the missing trailing newline, and both of the inversions the three
 * real profiles disagree on -- with invented content.
 */
let fixture: string
let injection: string

before(async () => {
  fixture = await readFile(resolve(FIXTURES, 'profile.md'), 'utf8')
  injection = await readFile(resolve(FIXTURES, 'profile-injection.md'), 'utf8')
})

const parse = () => profileToBlueprint(fixture)

describe('profileToBlueprint', () => {
  test('produces a blueprint that validates', () => {
    const { blueprint } = parse()
    try {
      parseBlueprint(blueprint)
    } catch (error) {
      assert.fail(
        `importer emitted an invalid blueprint:\n${
          isValidationError(error) ? formatValidationError(error) : String(error)
        }`
      )
    }
  })

  test('leaves no citation artifact anywhere in the output', () => {
    // The whole reason F8 exists: these are plain text, so without the strip
    // pass the sanitizer escapes them faithfully into the PDF.
    const json = JSON.stringify(parse().blueprint)
    assert.ok(!json.includes('[cite'), `citation artifact survived: ${json}`)
    assert.ok(!json.includes('cite_start'))
  })

  test('omits the fields that carry schema defaults', () => {
    // Returning BlueprintInput, not Blueprint: sections/selectedTemplate/
    // headings/document all have .default()s, and the caller's parseBlueprint
    // fills them. Emitting them here would freeze today's defaults into every
    // imported blueprint.
    const { blueprint } = parse()
    assert.equal(blueprint.sections, undefined)
    assert.equal(blueprint.selectedTemplate, undefined)
    assert.equal(blueprint.headings, undefined)
    assert.equal(blueprint.document, undefined)
  })

  test('does not escape anything -- storage holds raw text', () => {
    // CLAUDE.md invariant 1. `R&D` must stay `R&D` here; blueprintToTex is what
    // turns it into `R\&D`, and doing it twice corrodes the data.
    const { blueprint } = parse()
    assert.match(blueprint.work![0]!.position!, /R&D/)
    assert.ok(!JSON.stringify(blueprint).includes('\\&'))
  })
})

describe('profileToBlueprint basics', () => {
  test('reads the H1 suffix as the targeting label', () => {
    assert.equal(parse().blueprint.basics!.label, 'Numerical Analyst & Computing Pioneer')
  })

  test('maps the metadata bullets onto basics', () => {
    const basics = parse().blueprint.basics!
    assert.equal(basics.name, 'Ada Lovelace')
    assert.equal(basics.email, 'ada@example.com')
    assert.equal(basics.phone, '+44 555 010 1843')
    assert.deepEqual(basics.location, { address: 'London, UK' })
  })

  test('keeps LinkedIn as a profile instead of losing it to the website field', () => {
    // "LinkedIn" contains "link". A portfolio/website pattern matching `links?`
    // swallows it, and because the portfolio line comes afterwards in every
    // profile, the URL was not merely misfiled -- it was overwritten and lost.
    const basics = parse().blueprint.basics!
    assert.deepEqual(basics.profiles?.[0], {
      network: 'LinkedIn',
      url: 'linkedin.com/in/ada-lovelace'
    })
  })

  test('splits the multi-value portfolio field into website plus profiles', () => {
    const basics = parse().blueprint.basics!
    assert.equal(basics.website, 'example.com/ada')
    assert.ok(basics.profiles!.some((p) => p.network === 'GitHub' && p.url === 'github.com/ada'))
  })

  test('stores URLs scheme-less, exactly as written', () => {
    // sanitizeUrl prefixes https:// for bare domains at render time. Adding a
    // scheme here would be the importer editing user data on the way in.
    const basics = parse().blueprint.basics!
    assert.ok(!JSON.stringify(basics.profiles).includes('https://'))
  })

  test('joins the summary into one paragraph', () => {
    const summary = parse().blueprint.basics!.summary!
    assert.match(summary, /^Engineer with a decade/)
    assert.match(summary, /made it practical\.$/)
    // The `[cite_start]` opener sat at the head of this paragraph; absorbing
    // the space after it would have produced a leading space.
    assert.equal(summary, summary.trim())
  })
})

describe('profileToBlueprint skills', () => {
  test('does not split inside parentheses', () => {
    // `AWS (EKS, Lambda, SQS)` is one skill. Splitting on ", " makes it four.
    const skills = parse().blueprint.skills!
    const cloud = skills.find((s) => s.name === 'Cloud, IaC & Observability')!
    assert.deepEqual(cloud.keywords, ['AWS (EKS, Lambda, SQS)', 'Terraform', 'Datadog'])
  })

  test('keeps a category label that contains a comma intact', () => {
    // The label comes from between the bold markers, never from splitting on
    // the first comma or colon.
    const names = parse().blueprint.skills!.map((s) => s.name)
    assert.ok(names.includes('Cloud, IaC & Observability'))
  })

  test('imports an unlabelled bullet as an uncategorized group, and says so', () => {
    const { blueprint, warnings } = parse()
    const uncategorized = blueprint.skills!.find((s) => s.name === undefined)!
    assert.deepEqual(uncategorized.keywords, ['Mechanical Tabulation', 'Punched Cards'])
    assert.ok(warnings.some((w) => /no "\*\*Category:\*\*" label/.test(w)))
  })
})

describe('profileToBlueprint work', () => {
  test('splits "Company — Location" from the heading', () => {
    const first = parse().blueprint.work![0]!
    assert.equal(first.name, 'Analytical Engine Works')
    assert.equal(first.location, 'London, UK')
    assert.equal(first.position, 'Principal Engineer | R&D')
  })

  test('keeps dates verbatim, including the literal "Present"', () => {
    // Templates interpolate these straight into the document, so normalizing
    // to YYYY-MM would typeset "2019-01" in the PDF.
    const first = parse().blueprint.work![0]!
    assert.equal(first.startDate, 'January 2019')
    assert.equal(first.endDate, 'Present')
  })

  test('collects bullets as highlights', () => {
    const first = parse().blueprint.work![0]!
    assert.equal(first.highlights!.length, 2)
    assert.match(first.highlights![0]!, /^Designed the first published algorithm/)
    assert.match(first.highlights![0]!, /machine\.$/)
  })

  test('detects the inverted entry where the heading is the job title', () => {
    // One of the three real profiles writes the title in the `###` and puts
    // company and location on the bold line below. Assigning by position puts
    // a job title in work[].name and nobody notices.
    const { blueprint, warnings } = parse()
    const second = blueprint.work![1]!
    assert.equal(second.position, 'Research Fellow, Symbolic Computation')
    assert.equal(second.name, 'Royal Society')
    assert.equal(second.location, 'London, UK')
    assert.ok(warnings.some((w) => /read as the job title/.test(w)))
  })

  test('warns about a continuation line it cannot place', () => {
    assert.ok(parse().warnings.some((w) => /unparsed line in work entry/.test(w)))
  })
})

describe('profileToBlueprint education and certificates', () => {
  const education = () => parse().blueprint.education!

  test('reads the majority form: **credential:** institution (year)', () => {
    const bsc = education().find((e) => e.studyType === 'BSc in Mathematics')!
    assert.equal(bsc.institution, 'University of London')
    assert.equal(bsc.endDate, '2015')
  })

  test('reads the inverted form when the label is an institution acronym', () => {
    // `**UCL:** Advanced Diploma...` -- position cannot decide this, and one of
    // the three real profiles writes every education line this way.
    const ucl = education().find((e) => e.institution === 'UCL')!
    assert.equal(ucl.studyType, 'Advanced Diploma in Analytical Geometry')
    assert.equal(ucl.endDate, '2011')
  })

  test('lets credential words outrank institution words', () => {
    // "Note G Study Programme" contains an institution-ish word but is plainly
    // the credential; the institution is the "Bernoulli Institute" beside it.
    // Checking institution words first got this backwards, silently.
    const noteG = education().find((e) => e.studyType === 'Note G Study Programme')!
    assert.equal(noteG.institution, 'Bernoulli Institute')
  })

  test('drops a trailing italic descriptor loudly rather than misfiling it', () => {
    const noteG = education().find((e) => e.studyType === 'Note G Study Programme')!
    assert.ok(!JSON.stringify(noteG).includes('Recurrence Relations'))
    assert.ok(parse().warnings.some((w) => /EducationSchema has no field for it/.test(w)))
  })

  test('splits a packed **Certifications:** bullet into separate certificates', () => {
    const certs = parse().blueprint.certificates!
    assert.equal(certs.length, 3)
    assert.deepEqual(certs[0], { name: 'Certified Engine Operator', date: '2020' })
    assert.deepEqual(certs[1], { name: 'Punched Card Systems', date: '2018' })
  })

  test('keeps a certificate with no year, and warns', () => {
    const { blueprint, warnings } = parse()
    assert.deepEqual(blueprint.certificates![2], { name: 'Difference Engine Maintenance' })
    assert.ok(warnings.some((w) => /has no year in parentheses/.test(w)))
  })
})

describe('profileToBlueprint warnings', () => {
  test('reports a section with no home in the schema instead of dropping it', () => {
    // BlueprintSchema has no volunteer/publications/languages/references, and
    // zod objects are non-strict -- so "## Notes to Self" would disappear with
    // no error anywhere in the chain.
    const { blueprint, warnings } = parse()
    assert.ok(warnings.some((w) => /unrecognized section "Notes to Self"/.test(w)))
    assert.ok(!JSON.stringify(blueprint).includes('graph paper'))
  })

  test('does not leak a skipped section body into the next section', () => {
    // "## Notes to Self" sits between experience and education. Skipping only
    // the heading would file its bullet under whichever section was still open.
    const { blueprint } = parse()
    assert.ok(!blueprint.education!.some((e) => /graph paper/.test(JSON.stringify(e))))
    assert.equal(blueprint.work!.length, 2)
  })

  test('reports an unrecognized metadata label but keeps the value', () => {
    const { blueprint, warnings } = parse()
    assert.ok(warnings.some((w) => /unrecognized metadata label "Carrier Pigeon"/.test(w)))
    assert.ok(blueprint.basics!.profiles!.some((p) => p.network === 'Carrier Pigeon'))
  })

  test('leads with the citation count', () => {
    assert.match(parse().warnings[0]!, /^removed \d+ citation artifacts before parsing$/)
  })

  test('every other warning names its source line', () => {
    for (const warning of parse().warnings.slice(1)) {
      assert.match(warning, /^line \d+: /, `warning has no line number: ${warning}`)
    }
  })
})

describe('profileToBlueprint failure modes', () => {
  test('throws ProfileParseError, not a ZodError, for input that is not a profile', () => {
    // Adapters branch on isValidationError. A malformed-markdown failure
    // reported as a schema failure points the caller at the wrong thing.
    assert.throws(() => profileToBlueprint('just some prose\n\nwith no headings'), (error: unknown) => {
      assert.ok(error instanceof ProfileParseError)
      assert.ok(!isValidationError(error))
      return true
    })
  })

  test('throws on an empty document', () => {
    assert.throws(() => profileToBlueprint(''), ProfileParseError)
  })

  test('accepts CRLF line endings', () => {
    const { blueprint } = profileToBlueprint(fixture.replace(/\n/g, '\r\n'))
    assert.equal(blueprint.basics!.name, 'Ada Lovelace')
    assert.ok(!JSON.stringify(blueprint).includes('\\r'))
  })

  test('tolerates a document with no trailing newline', () => {
    // Every real profile ends mid-line, on the closing bracket of a marker.
    assert.ok(!fixture.endsWith('\n'))
    assert.equal(parse().blueprint.certificates!.length, 3)
  })
})

describe('profileToBlueprint routes through the sanitize path', () => {
  test('imported TeX payloads are escaped, not executed', () => {
    // CLAUDE.md: any new surface that accepts blueprints must route through the
    // same sanitize path and be tested against the adversarial fixture. The
    // importer is such a surface -- its output goes straight to a TeX engine.
    const { blueprint } = profileToBlueprint(injection)
    const { texDoc } = blueprintToTex(blueprint)

    assert.ok(!texDoc.includes('\\input{/etc/passwd}'), 'raw \\input survived into the document')
    assert.ok(!texDoc.includes('\\write18{'), 'raw \\write18 survived into the document')
    assert.ok(texDoc.includes('\\textbackslash{}input'), 'payload should typeset as literal text')
  })

  test('the importer itself leaves the payload unescaped', () => {
    // The escape belongs to blueprintToTex. If the importer did it too, the
    // stored blueprint would be double-escaped on the next edit-render cycle.
    const { blueprint } = profileToBlueprint(injection)
    assert.equal(blueprint.basics!.name, '\\input{/etc/passwd}')
  })
})
