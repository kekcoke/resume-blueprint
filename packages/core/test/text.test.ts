import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { blueprintToText } from '../dist/index.js'
import { parseBlueprint } from '../dist/schema.js'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures')

describe('blueprintToText', () => {
  test('honours section order and omits sections not listed', () => {
    const text = blueprintToText({
      sections: ['skills', 'profile'],
      basics: { name: 'Ada Lovelace' },
      skills: [{ name: 'Languages', keywords: ['TypeScript'] }],
      work: [{ name: 'Should not appear', position: 'x' }]
    })

    assert.ok(text.indexOf('SKILLS') < text.indexOf('Ada Lovelace'), 'skills should render before profile')
    assert.doesNotMatch(text, /EXPERIENCE/, 'work is not in `sections`, so it must not render')
    assert.doesNotMatch(text, /Should not appear/)
  })

  test('honours heading overrides, falling back to defaults', () => {
    const text = blueprintToText({
      sections: ['work', 'education'],
      headings: { work: 'Employment History' },
      work: [{ name: 'Acme', position: 'Engineer' }],
      education: [{ institution: 'MIT' }]
    })

    assert.match(text, /^EMPLOYMENT HISTORY$/m)
    assert.doesNotMatch(text, /^EXPERIENCE$/m)
    // No override was given for education, so the built-in default applies.
    assert.match(text, /^EDUCATION$/m)
  })

  test('drops whitespace-only fields rather than emitting blank lines', () => {
    const text = blueprintToText({
      sections: ['profile'],
      basics: { name: '  Ada Lovelace  ', label: '   ', email: '', summary: '\n\t ' }
    })

    assert.equal(text, 'Ada Lovelace')
  })

  test('does not drop basics.label or work[].summary', () => {
    // Regression guard: the exact two fields the code comments in schema.ts
    // and sanitize.ts flag as historically lost.
    const text = blueprintToText({
      sections: ['profile', 'work'],
      basics: { name: 'Ada Lovelace', label: 'Principal Engineer' },
      work: [{ name: 'Acme', summary: 'Led the numerical methods group.' }]
    })

    assert.match(text, /Principal Engineer/)
    assert.match(text, /Led the numerical methods group\./)
  })

  test('formats certificates as "Name | Issuer (Date) | url"', () => {
    const text = blueprintToText({
      sections: ['certificates'],
      certificates: [
        {
          name: 'AWS Certified Cloud Practitioner',
          issuer: 'Amazon Web Services',
          date: '2025',
          url: 'https://example.com/verify/aws-ccp'
        }
      ]
    })

    assert.match(
      text,
      /AWS Certified Cloud Practitioner \| Amazon Web Services \(2025\) \| https:\/\/example\.com\/verify\/aws-ccp/
    )
  })

  test('renders the sample fixture end to end without throwing', async () => {
    const sample = JSON.parse(await readFile(resolve(FIXTURES, 'sample.json'), 'utf8'))
    const text = blueprintToText(sample)

    assert.match(text, /^Ada Lovelace$/m)
    assert.match(text, /^EDUCATION$/m)
    assert.match(text, /^EXPERIENCE$/m)
    assert.match(text, /^SKILLS$/m)
    assert.match(text, /^PROJECTS$/m)
    assert.match(text, /^AWARDS$/m)
    assert.match(text, /^CERTIFICATES$/m)
  })

  test('throws a ZodError on an invalid blueprint, same as blueprintToTex', () => {
    assert.throws(() => blueprintToText({ selectedTemplate: 'not-a-number' }))
  })

  test('never sanitizes: LaTeX specials pass through unescaped', async () => {
    const injection = JSON.parse(await readFile(resolve(FIXTURES, 'injection.json'), 'utf8'))
    const text = blueprintToText(injection)

    // The concrete difference from blueprintToTex: nothing here goes through
    // escapeLatex, so a literal backslash command survives byte-for-byte and
    // its escaped form never appears.
    assert.match(text, /\\input\{\/etc\/passwd\}/)
    assert.doesNotMatch(text, /textbackslash/)
  })

  test('accepts unvalidated input the same way blueprintToTex does', () => {
    // `blueprintToText` runs `parseBlueprint` itself; a pre-parsed `Blueprint`
    // is still valid `unknown` input.
    const blueprint = parseBlueprint({ basics: { name: 'Ada Lovelace' }, sections: ['profile'] })
    assert.equal(blueprintToText(blueprint), 'Ada Lovelace')
  })
})
