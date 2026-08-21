import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  stripCitations,
  countCitations,
  findCitations,
  citationWarnings
} from '../dist/import/citations.js'
import { parseBlueprint } from '../dist/schema.js'
import { escapeLatex } from '../dist/sanitize.js'

/**
 * Every literal in this file was lifted from the shape of the real corpus in
 * `profile_templates/` and `external_feedback.md`, with the content replaced.
 * Those files are gitignored (they carry real PII), so the marker syntax and
 * its surrounding whitespace are reproduced here instead -- that syntax is the
 * thing under test, and it is the thing that would silently change if the
 * upstream generator changed.
 */

describe('stripCitations', () => {
  test('removes every ref payload shape the corpus contains', () => {
    // Bare integer, comma list, hyphenated range, and a mix of the last two.
    assert.equal(stripCitations('SQL[cite: 5]'), 'SQL')
    assert.equal(stripCitations('SQL[cite: 1, 2, 3]'), 'SQL')
    assert.equal(stripCitations('SQL[cite: 104-107]'), 'SQL')
    assert.equal(stripCitations('SQL[cite: 121, 127-129, 137-139]'), 'SQL')
  })

  test('removes the bare [cite_start] marker', () => {
    assert.equal(stripCitations('[cite_start]Amazon Web Services'), 'Amazon Web Services')
  })

  test('leaves the period that follows a marker attached to the word', () => {
    // The generator puts the marker BEFORE the sentence-ending period, so a
    // stripper that only deleted the brackets would be fine here -- but one
    // that also ate a trailing space would produce "workflows ." instead.
    assert.equal(
      stripCitations('optimizing asynchronous workflows[cite: 1, 2, 3].'),
      'optimizing asynchronous workflows.'
    )
  })

  test('absorbs the space before a closing marker so punctuation is not stranded', () => {
    // external_feedback.md's convention: space before the marker, punctuation
    // after. Deleting only the brackets leaves `re-engineering"* .`
    assert.equal(
      stripCitations('*"business process re-engineering"* [cite: 64-65, 70, 76, 88].'),
      '*"business process re-engineering"*.'
    )
    assert.equal(
      stripCitations('maximize space [cite: 61-63, 113-114]:'),
      'maximize space:'
    )
  })

  test('does NOT absorb the space before an opening [cite_start]', () => {
    // The asymmetry this module exists for. Absorbing here would weld the list
    // marker to the bold run and markdown would read `***Targeted` as a
    // different construct entirely.
    assert.equal(
      stripCitations('* [cite_start]**Targeted Positioning:** Strong pivot language'),
      '* **Targeted Positioning:** Strong pivot language'
    )
    assert.equal(
      stripCitations('1. [cite_start]**Fix Fragmented Certifications Table:** The grid'),
      '1. **Fix Fragmented Certifications Table:** The grid'
    )
  })

  test('handles the two marker families adjacent on one line', () => {
    assert.equal(
      stripCitations('> London, UK | [cite_start][LinkedIn](https://example.com) [cite: 61-63]'),
      '> London, UK | [LinkedIn](https://example.com)'
    )
  })

  test('preserves a markdown hard line break made of trailing spaces', () => {
    // Two trailing spaces after a marker are a hard break, not slop. Trimming
    // the line would silently change how the document renders.
    assert.equal(
      stripCitations('**AWS Certified Cloud Practitioner** | Amazon Web Services (2025) [cite: 104-107]  '),
      '**AWS Certified Cloud Practitioner** | Amazon Web Services (2025)  '
    )
  })

  test('never joins two lines together', () => {
    // `[ \t]*` rather than `\s*`: a marker at end-of-line is followed by the
    // newline, and absorbing it would merge the bullet into the next one.
    const input = '- Redesigned an Azure-native API[cite: 1, 2, 3]\n- Engineered a platform[cite: 2]'
    assert.equal(
      stripCitations(input),
      '- Redesigned an Azure-native API\n- Engineered a platform'
    )
  })

  test('tolerates payload shapes the corpus does not currently produce', () => {
    // The generator is not under our control; a spacing change upstream should
    // not silently start typesetting markers into resumes.
    assert.equal(stripCitations('x[cite:1]'), 'x')
    assert.equal(stripCitations('x[cite:  7 , 9 ]'), 'x')
    assert.equal(stripCitations('x[cite_start: 5]'), 'x')
  })

  test('leaves an unterminated or unrelated bracket alone', () => {
    // The profiles have no trailing newline and end mid-bracket-free, but a
    // truncated file should lose text, not gain corruption.
    assert.equal(stripCitations('see [cite: 1, 2'), 'see [cite: 1, 2')
    assert.equal(stripCitations('a [citation] needed'), 'a [citation] needed')
    assert.equal(stripCitations('[LinkedIn](https://example.com)'), '[LinkedIn](https://example.com)')
  })

  test('is idempotent, unlike escapeLatex', () => {
    // The two passes sit next to each other in the import pipeline. Re-running
    // the escape corrodes user data (`R&D` -> `R\&D` -> `R\textbackslash{}\&D`);
    // re-running this one must do nothing. See CLAUDE.md invariant 1.
    const once = stripCitations('R&D throughput[cite: 1, 2, 3].')
    assert.equal(stripCitations(once), once)

    const escapedOnce = escapeLatex('R&D')
    assert.notEqual(escapeLatex(escapedOnce), escapedOnce)
  })

  test('leaves prose with no markers untouched', () => {
    const clean = '- **Languages:** C# (.NET Core), Go (Golang), TypeScript, SQL'
    assert.equal(stripCitations(clean), clean)
  })
})

describe('countCitations', () => {
  test('counts both marker families', () => {
    assert.equal(countCitations('a[cite: 1, 2, 3] b[cite: 5] c[cite_start]d'), 3)
  })

  test('returns 0 for clean text rather than throwing', () => {
    assert.equal(countCitations('no markers here'), 0)
    assert.equal(countCitations(''), 0)
  })

  test('does not mutate shared regex state across calls', () => {
    // The module holds one /g regex used by both functions. A `lastIndex` leak
    // would make every other call silently undercount.
    const text = 'a[cite: 1] b[cite: 2]'
    assert.equal(countCitations(text), 2)
    assert.equal(countCitations(text), 2)
    assert.equal(stripCitations(text), 'a b')
    assert.equal(countCitations(text), 2)
  })
})

describe('findCitations', () => {
  /** Parsed, because that is what the adapters detect on -- and it is what
   *  actually reaches a template. */
  const dirty = () =>
    parseBlueprint({
      basics: { name: 'Ada[cite: 1, 2, 3]', summary: '[cite_start]Led the group.' },
      work: [{ name: 'Clean Co', highlights: ['a[cite: 5]', 'clean', 'b[cite: 1][cite: 2]'] }],
      headings: { work: 'Experience[cite: 5]' },
      document: { margin: '0.75in', accentColor: '#4A90D9' }
    })

  test('reports a path per contaminated string, with array indices in brackets', () => {
    assert.deepEqual(findCitations(dirty()), [
      { path: 'basics.name', count: 1 },
      { path: 'basics.summary', count: 1 },
      { path: 'work[0].highlights[0]', count: 1 },
      { path: 'work[0].highlights[2]', count: 2 },
      { path: 'headings.work', count: 1 }
    ])
  })

  test('walks headings, which the ATS harness skips', () => {
    // Heading overrides are free user text that renders into the document, so
    // they are the one control-adjacent key worth checking.
    const sites = findCitations(parseBlueprint({ headings: { work: 'Experience[cite: 5]' } }))
    assert.deepEqual(sites, [{ path: 'headings.work', count: 1 }])
  })

  test('skips sections, selectedTemplate, and document', () => {
    // Routing enums and validated config: no free text, so nothing to find.
    // Walking them would be harmless but is pointless, and the skip documents
    // which fields are closed by construction.
    const sites = findCitations(
      parseBlueprint({ selectedTemplate: 3, document: { margin: '0.75in', accentColor: '#4A90D9' } })
    )
    assert.deepEqual(sites, [])
  })

  test('skips those keys only at the root', () => {
    // A nested key that happens to be named `document` is ordinary content.
    const sites = findCitations({ work: [{ document: 'Spec sheet[cite: 5]' }] })
    assert.deepEqual(sites, [{ path: 'work[0].document', count: 1 }])
  })

  test('returns nothing for a clean blueprint', () => {
    assert.deepEqual(findCitations(parseBlueprint({ basics: { name: 'Ada Lovelace' } })), [])
  })

  test('tolerates non-object input rather than throwing', () => {
    // Callers include MCP handlers whose try/catch would turn an exception into
    // a tool error rather than a warning.
    for (const value of [undefined, null, 42, 'a string[cite: 1]', [], {}]) {
      assert.doesNotThrow(() => findCitations(value))
    }
    assert.deepEqual(findCitations(null), [])
  })

  test('agrees with stripCitations: everything it reports is removable', () => {
    // The property that makes the warning actionable. A detector with its own,
    // broader regex would flag things the stripper leaves alone -- an
    // unterminated `see [cite: 1, 2` -- and the user could do nothing about it.
    const blueprint = dirty()
    for (const { path } of findCitations(blueprint)) {
      const value = path
        .split(/\.|\[(\d+)\]/)
        .filter(Boolean)
        .reduce<any>((node, step) => node[step], blueprint)
      assert.notEqual(stripCitations(value), value, `${path} was reported but is not strippable`)
      assert.equal(countCitations(stripCitations(value)), 0)
    }
  })

  test('does not report what stripCitations deliberately leaves alone', () => {
    assert.deepEqual(findCitations({ basics: { summary: 'see [cite: 1, 2' } }), [])
    assert.deepEqual(findCitations({ basics: { summary: 'a [citation] needed' } }), [])
  })
})

describe('citationWarnings', () => {
  test('renders one sentence per site, singular and plural', () => {
    assert.deepEqual(
      citationWarnings({ basics: { name: 'Ada[cite: 1]' }, work: [{ summary: 'x[cite: 1][cite: 2]' }] }),
      ['basics.name carries 1 citation artifact', 'work[0].summary carries 2 citation artifacts']
    )
  })

  test('is empty for clean content, so callers can branch on length', () => {
    assert.deepEqual(citationWarnings({ basics: { name: 'Ada Lovelace' } }), [])
  })
})
