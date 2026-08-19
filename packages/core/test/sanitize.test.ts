import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { escapeLatex, sanitizeUrl, sanitizeBlueprint } from '../dist/sanitize.js'
import { BlueprintSchema, parseBlueprint, isValidationError } from '../dist/schema.js'
import { blueprintToTex } from '../dist/index.js'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures')

describe('escapeLatex', () => {
  test('neutralizes every LaTeX special character', () => {
    assert.equal(escapeLatex('\\'), '\\textbackslash{}')
    assert.equal(escapeLatex('{}'), '\\{\\}')
    assert.equal(escapeLatex('$'), '\\$')
    assert.equal(escapeLatex('&'), '\\&')
    assert.equal(escapeLatex('#'), '\\#')
    assert.equal(escapeLatex('^'), '\\textasciicircum{}')
    assert.equal(escapeLatex('_'), '\\_')
    assert.equal(escapeLatex('~'), '\\textasciitilde{}')
    assert.equal(escapeLatex('%'), '\\%')
  })

  test('turns command injection into literal text', () => {
    assert.equal(
      escapeLatex('\\input{/etc/passwd}'),
      '\\textbackslash{}input\\{/etc/passwd\\}'
    )
    assert.equal(
      escapeLatex('\\write18{id}'),
      '\\textbackslash{}write18\\{id\\}'
    )
  })

  test('does not double-escape the braces its own replacements introduce', () => {
    // A sequential-replace implementation would produce
    // "\textbackslash\{\}" here. Single-pass is what keeps this correct.
    const escaped = escapeLatex('\\')
    assert.equal(escaped, '\\textbackslash{}')
    assert.ok(!escaped.includes('\\{\\}'))
  })

  test('strips control characters but preserves tab and newline', () => {
    const input = `a${String.fromCharCode(1)}b\tc\nd`
    assert.equal(escapeLatex(input), 'ab\tc\nd')
  })

  test('leaves ordinary prose untouched', () => {
    const prose = 'Cut latency by 45 percent across the pipeline'
    assert.equal(escapeLatex(prose), prose)
  })
})

describe('sanitizeUrl', () => {
  test('rejects dangerous protocols', () => {
    assert.equal(sanitizeUrl('javascript:alert(1)'), undefined)
    assert.equal(sanitizeUrl('file:///etc/passwd'), undefined)
    assert.equal(sanitizeUrl('data:text/html,<script>'), undefined)
  })

  test('accepts http, https, and mailto', () => {
    assert.ok(sanitizeUrl('https://example.com/a'))
    assert.ok(sanitizeUrl('http://example.com/a'))
    assert.ok(sanitizeUrl('mailto:ada@example.com'))
  })

  test('assumes https for bare domains', () => {
    assert.equal(sanitizeUrl('github.com/ada'), 'https://github.com/ada')
  })

  test('escapes characters that would break the href or its label', () => {
    // Both \href arguments receive this value, so it must be simultaneously
    // valid as a target and safe as typeset text.
    assert.equal(
      sanitizeUrl('https://example.com/a_b#frag'),
      'https://example.com/a\\_b\\#frag'
    )
  })

  test('percent-encodes the tilde rather than escaping it', () => {
    // "~" is legal in a URL but active in LaTeX; \textasciitilde{} would
    // corrupt the link target, so it is percent-encoded instead.
    const result = sanitizeUrl('https://example.com/~ada')
    assert.equal(result, 'https://example.com/\\%7Eada')
  })
})

describe('sanitizeBlueprint', () => {
  test('prunes empty strings, arrays, and objects', () => {
    const result = sanitizeBlueprint(
      parseBlueprint({
        basics: { name: 'Ada', email: '   ' },
        work: [],
        selectedTemplate: 1
      })
    )
    assert.equal(result.basics?.name, 'Ada')
    assert.ok(!('email' in (result.basics ?? {})), 'whitespace-only email should be pruned')
    assert.ok(!('work' in result), 'empty work array should be pruned')
  })

  test('leaves control fields unescaped', () => {
    const result = sanitizeBlueprint(
      parseBlueprint({ basics: { name: 'Ada' }, selectedTemplate: 3 })
    )
    assert.equal(result.selectedTemplate, 3)
    assert.deepEqual(result.sections, [
      'profile',
      'education',
      'work',
      'skills',
      'projects',
      'awards'
    ])
  })

  test('collapses runs of whitespace', () => {
    const result = sanitizeBlueprint(
      parseBlueprint({ basics: { name: '  Ada   Byron  ' }, selectedTemplate: 1 })
    )
    assert.equal(result.basics?.name, 'Ada Byron')
  })

  // sanitizeBlueprint builds its result from an explicit allowlist
  // (sections, selectedTemplate, document, then CONTENT_KEYS). A `document`
  // block that isn't copied there never reaches getTemplateData at all —
  // silently, with no error anywhere in the chain, and no type error either,
  // since the function's return is cast to `Blueprint`. This is the
  // regression test for that trap: it must fail if the `document:
  // blueprint.document` line in sanitize.ts is ever removed.
  test('does not drop the document block', () => {
    const result = sanitizeBlueprint(
      parseBlueprint({
        basics: { name: 'Ada' },
        selectedTemplate: 1,
        document: { fontSize: 12, sectionSpacing: 0, accentColor: '#4A90D9' }
      })
    )
    assert.equal(result.document?.fontSize, 12)
    // 0 is falsy but not empty — isEmpty()'s numeric branch only treats NaN
    // as empty, so a deliberate zero must survive pruning intact.
    assert.equal(result.document?.sectionSpacing, 0)
    assert.equal(result.document?.accentColor, '#4A90D9')
  })

  test('leaves document values unescaped', () => {
    // accentColor is a regex-validated hex string; if it were routed through
    // escapeLatex like free text, the '#' would come back as '\#'.
    const result = sanitizeBlueprint(
      parseBlueprint({ selectedTemplate: 1, document: { accentColor: '#4A90D9' } })
    )
    assert.equal(result.document?.accentColor, '#4A90D9')
  })
})

describe('injection fixture end to end', () => {
  test('no TeX command from the fixture survives into the generated document', async () => {
    const fixture = JSON.parse(await readFile(resolve(FIXTURES, 'injection.json'), 'utf8'))
    const { texDoc } = blueprintToTex(fixture)

    // The document legitimately contains \input for its own preamble, so assert
    // on the exact injected payloads rather than on the command names alone.
    const payloads = [
      '\\input{/etc/passwd}',
      '\\write18{id > /tmp/pwned}',
      '\\immediate\\write18',
      '\\openin1=/etc/hosts',
      '\\openout',
      '\\include{../../../../etc/shadow}',
      '\\catcode`\\@=11'
    ]

    for (const payload of payloads) {
      assert.ok(
        !texDoc.includes(payload),
        `injected payload survived into the TeX document: ${payload}`
      )
    }
  })

  test('injected text is preserved as visible literal content', async () => {
    const fixture = JSON.parse(await readFile(resolve(FIXTURES, 'injection.json'), 'utf8'))
    const { texDoc } = blueprintToTex(fixture)

    // Escaped, not silently dropped — the user should see what was submitted.
    assert.ok(texDoc.includes('\\textbackslash{}input\\{/etc/passwd\\}'))
  })

  test('unsafe URLs are dropped rather than rendered', async () => {
    const fixture = JSON.parse(await readFile(resolve(FIXTURES, 'injection.json'), 'utf8'))
    const { texDoc } = blueprintToTex(fixture)

    assert.ok(!texDoc.includes('javascript:'), 'javascript: URL reached the document')
    assert.ok(!texDoc.includes('file:///'), 'file:// URL reached the document')
  })
})

// `document` values are enums, clamped numbers, and a regex-validated hex
// string — none free text, so per CLAUDE.md's security posture, nothing here
// may take the escapeLatex path. The correct behavior for an adversarial
// value is outright rejection at validation, not escaping.
describe('document injection fixture is rejected outright', () => {
  test('the adversarial document fixture fails validation, not silent escaping', async () => {
    const fixture = JSON.parse(await readFile(resolve(FIXTURES, 'injection-document.json'), 'utf8'))
    const result = BlueprintSchema.safeParse(fixture)

    assert.equal(result.success, false, 'adversarial document block should fail validation')
  })

  test('accentColor rejects a TeX-injection payload rather than escaping it', () => {
    const result = BlueprintSchema.safeParse({
      selectedTemplate: 1,
      document: { accentColor: '}\\input{/etc/passwd}%' }
    })
    assert.equal(result.success, false)
  })

  test('margin rejects a TeX-injection payload rather than escaping it', () => {
    const result = BlueprintSchema.safeParse({
      selectedTemplate: 1,
      document: { margin: '0.75in}\\input{/etc/passwd}%' }
    })
    assert.equal(result.success, false)
  })

  test('fontFamily and linkStyle reject values outside their closed enum', () => {
    assert.equal(
      BlueprintSchema.safeParse({
        selectedTemplate: 1,
        document: { fontFamily: '\\write18{id}' }
      }).success,
      false
    )
    assert.equal(
      BlueprintSchema.safeParse({
        selectedTemplate: 1,
        document: { linkStyle: '\\input{/etc/passwd}' }
      }).success,
      false
    )
  })

  test('a validation failure is reported as a ZodError, not thrown as something opaque', () => {
    try {
      parseBlueprint({ selectedTemplate: 1, document: { accentColor: 'not-a-color' } })
      assert.fail('expected parseBlueprint to throw')
    } catch (error) {
      assert.ok(isValidationError(error))
    }
  })
})

describe('document clamping', () => {
  test('margin below the 0.5in floor is silently raised, not rejected', () => {
    const blueprint = parseBlueprint({ selectedTemplate: 1, document: { margin: '0.2in' } })
    assert.equal(blueprint.document.margin, '0.5in')
  })

  test('margin above the floor, and in other units, passes through unchanged', () => {
    assert.equal(
      parseBlueprint({ selectedTemplate: 1, document: { margin: '1in' } }).document.margin,
      '1in'
    )
    assert.equal(
      parseBlueprint({ selectedTemplate: 1, document: { margin: '20mm' } }).document.margin,
      '20mm'
    )
  })

  test('lineSpacing is clamped into [1.0, 1.15]', () => {
    assert.equal(
      parseBlueprint({ selectedTemplate: 1, document: { lineSpacing: 0.5 } }).document.lineSpacing,
      1.0
    )
    assert.equal(
      parseBlueprint({ selectedTemplate: 1, document: { lineSpacing: 3 } }).document.lineSpacing,
      1.15
    )
  })

  test('sectionSpacing and bulletSpacing are clamped into [0, 12]', () => {
    assert.equal(
      parseBlueprint({ selectedTemplate: 1, document: { sectionSpacing: -5 } }).document
        .sectionSpacing,
      0
    )
    assert.equal(
      parseBlueprint({ selectedTemplate: 1, document: { bulletSpacing: 99 } }).document
        .bulletSpacing,
      12
    )
  })
})
