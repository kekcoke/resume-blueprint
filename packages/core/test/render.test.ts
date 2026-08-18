import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { blueprintToTex, renderBlueprint, TEMPLATE_IDS } from '../dist/index.js'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures')
const GOLDEN = resolve(FIXTURES, 'golden')

/** Set UPDATE_GOLDEN=1 to rewrite the snapshots after an intentional change. */
const UPDATE_GOLDEN = process.env.UPDATE_GOLDEN === '1'

/** Tectonic's first run for a given document class downloads packages. */
const COMPILE_TIMEOUT_MS = 180_000

let sample: Record<string, unknown>

before(async () => {
  sample = JSON.parse(await readFile(resolve(FIXTURES, 'sample.json'), 'utf8'))
  await mkdir(GOLDEN, { recursive: true })
})

/**
 * Counts pages in a PDF.
 *
 * Tectonic writes the page tree into compressed object streams, so the markers
 * are not visible in the raw bytes — every `stream`/`endstream` block has to be
 * inflated before `/Type /Page` can be counted.
 */
function countPages(pdf: Buffer): number {
  const haystacks: string[] = [pdf.toString('latin1')]

  const raw = pdf.toString('latin1')
  const streamRe = /stream\r?\n/g
  let match: RegExpExecArray | null

  while ((match = streamRe.exec(raw)) !== null) {
    const start = match.index + match[0].length
    const end = raw.indexOf('endstream', start)
    if (end === -1) continue
    try {
      haystacks.push(inflateSync(pdf.subarray(start, end)).toString('latin1'))
    } catch {
      // Not a zlib stream (fonts, images); nothing to read here.
    }
  }

  const combined = haystacks.join('\n')
  const pages = combined.match(/\/Type\s*\/Page(?![s])/g)
  return pages ? pages.length : 0
}

describe('TeX generation is stable across all templates', () => {
  for (const id of TEMPLATE_IDS) {
    test(`template${id} matches its golden snapshot`, async () => {
      const { texDoc } = blueprintToTex({ ...sample, selectedTemplate: id })
      const goldenPath = resolve(GOLDEN, `template${id}.tex`)

      if (UPDATE_GOLDEN || !existsSync(goldenPath)) {
        await writeFile(goldenPath, texDoc, 'utf8')
        return
      }

      const expected = await readFile(goldenPath, 'utf8')
      assert.equal(
        texDoc,
        expected,
        `template${id} TeX output drifted. Re-run with UPDATE_GOLDEN=1 if intended.`
      )
    })
  }
})

describe('every template compiles to a valid PDF', () => {
  for (const id of TEMPLATE_IDS) {
    test(
      `template${id} compiles`,
      { timeout: COMPILE_TIMEOUT_MS + 30_000 },
      async () => {
        const pdf = await renderBlueprint(
          { ...sample, selectedTemplate: id },
          { timeoutMs: COMPILE_TIMEOUT_MS }
        )

        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', 'missing PDF magic bytes')
        assert.ok(
          pdf.subarray(-1024).toString('latin1').includes('%%EOF'),
          'PDF is truncated'
        )
        assert.ok(pdf.length > 5_000, `PDF suspiciously small: ${pdf.length} bytes`)

        const pages = countPages(pdf)
        assert.ok(pages >= 1, 'could not find any page in the PDF')
        assert.ok(
          pages <= 3,
          `template${id} produced ${pages} pages for a one-job fixture; layout likely broke`
        )
      }
    )
  }
})

describe('content the original silently dropped now renders', () => {
  // The form wrote work[].company while every template read work[].name, so
  // employer names never appeared in the output. The schema now aliases them.
  for (const id of TEMPLATE_IDS) {
    test(`template${id} renders employer names`, () => {
      const { texDoc } = blueprintToTex({ ...sample, selectedTemplate: id })
      assert.ok(
        texDoc.includes('Analytical Engine Works'),
        `template${id} dropped the employer name from work[0]`
      )
      assert.ok(
        texDoc.includes('Royal Society'),
        `template${id} dropped the employer name from work[1]`
      )
    })
  }

  // Same bug class as work[].company: basics.label and basics.summary are valid,
  // validated, and stored, but every template's header destructured only
  // { name, email, phone, location, website }, so both silently vanished.
  // Only template2 has been fixed so far — it reuses awesome-cv.cls's own
  // \headerpositionstyle and \headerquotestyle rather than inventing LaTeX.
  test('template2 renders basics.label and basics.summary', () => {
    const { texDoc } = blueprintToTex({ ...sample, selectedTemplate: 2 })

    assert.ok(
      texDoc.includes('\\headerpositionstyle{Principal Engineer \\& Numerical Analyst}'),
      'template2 dropped basics.label from the header'
    )
    assert.ok(
      texDoc.includes('\\headerquotestyle{'),
      'template2 dropped basics.summary from the header'
    )
    assert.ok(
      texDoc.includes('first algorithm intended for one'),
      'template2 dropped the body of basics.summary'
    )
  })

  // The label carries an ampersand, so this doubles as a check that header
  // fields route through escapeLatex like any other text (they are not in
  // sanitize.ts's URL_KEYS).
  test('template2 escapes LaTeX specials in basics.label', () => {
    const { texDoc } = blueprintToTex({ ...sample, selectedTemplate: 2 })

    assert.ok(
      !/\\headerpositionstyle\{[^}]*[^\\]&/.test(texDoc),
      'template2 emitted an unescaped & inside \\headerpositionstyle'
    )
  })

  // This started life as the inverse: a pin asserting the other eight templates
  // still dropped these fields, so the gap would fail loudly rather than drift.
  // It did exactly that, and the assertion is now the positive one.
  for (const id of TEMPLATE_IDS) {
    test(`template${id} renders basics.label and basics.summary`, () => {
      const { texDoc } = blueprintToTex({ ...sample, selectedTemplate: id })

      assert.ok(
        texDoc.includes('Numerical Analyst'),
        `template${id} dropped basics.label`
      )
      assert.ok(
        texDoc.includes('first algorithm intended for one'),
        `template${id} dropped basics.summary`
      )
    })

    // work[].summary was valid JSON Resume that no template rendered at all.
    test(`template${id} renders work[].summary`, () => {
      const { texDoc } = blueprintToTex({ ...sample, selectedTemplate: id })

      assert.ok(
        texDoc.includes('Led the numerical methods group'),
        `template${id} dropped work[0].summary`
      )
    })
  }
})

describe('adversarial input still compiles safely', () => {
  test(
    'injection fixture produces a PDF without executing anything',
    { timeout: COMPILE_TIMEOUT_MS + 30_000 },
    async () => {
      const fixture = JSON.parse(
        await readFile(resolve(FIXTURES, 'injection.json'), 'utf8')
      )

      const pdf = await renderBlueprint(fixture, { timeoutMs: COMPILE_TIMEOUT_MS })
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')

      // If \write18 had executed, this is where the evidence would be.
      assert.ok(!existsSync('/tmp/pwned'), 'shell escape executed')
      assert.ok(!existsSync('/tmp/escape.txt'), 'file write executed')
    }
  )
})
