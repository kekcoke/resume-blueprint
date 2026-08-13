import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { escapeLatex, sanitizeUrl, sanitizeBlueprint } from '../dist/sanitize.js'
import { parseBlueprint } from '../dist/schema.js'
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
