import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import {
  blueprintToTex,
  renderBlueprint,
  countPages,
  TEMPLATE_IDS,
  TEMPLATE_PROFILES,
  UNSUPPORTED_FONTS,
  type FontFamily
} from '../dist/index.js'

const execFileAsync = promisify(execFile)

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

// F4 — font families. One representative combo per distinct mechanism, not
// all 45 non-default combos (the matrix below covers breadth; these cover
// the preamble text is actually right): template1×calibri and
// template1×georgia exercise nfssFontPreamble's two branches (an NFSS
// package swap, and the fontspec+Path= fallback on a template that never
// loaded fontspec); template2×georgia and template6×georgia exercise the
// \renewfontfamily-redefinition route; template4×georgia exercises the
// indirection-macro route (plus its line-56 Path=fonts/raleway/ bug fix);
// template8×calibri confirms it reuses the plain NFSS route rather than
// needing its own special-cased override.
describe('TeX generation is stable across font family overrides', () => {
  const CASES: Array<{ id: number; fontFamily: FontFamily }> = [
    { id: 1, fontFamily: 'calibri' },
    { id: 1, fontFamily: 'georgia' },
    { id: 2, fontFamily: 'georgia' },
    { id: 4, fontFamily: 'georgia' },
    { id: 6, fontFamily: 'georgia' },
    { id: 8, fontFamily: 'calibri' }
  ]

  for (const { id, fontFamily } of CASES) {
    test(`template${id} with fontFamily '${fontFamily}' matches its golden snapshot`, async () => {
      const { texDoc } = blueprintToTex({
        ...sample,
        selectedTemplate: id,
        document: { fontFamily }
      })
      const goldenPath = resolve(GOLDEN, `template${id}-${fontFamily}.tex`)

      if (UPDATE_GOLDEN || !existsSync(goldenPath)) {
        await writeFile(goldenPath, texDoc, 'utf8')
        return
      }

      const expected = await readFile(goldenPath, 'utf8')
      assert.equal(
        texDoc,
        expected,
        `template${id}+${fontFamily} TeX output drifted. Re-run with UPDATE_GOLDEN=1 if intended.`
      )
    })
  }
})

// F5 — contactLayout. One golden case per template exercising its
// *non-default* branch: templates 1-6 and 9 default to 'row' (see
// documentConfig.ts's GLOBAL_DEFAULTS), so 'stacked' is their new behavior;
// templates 7 and 8 are recorded with contactLayout: 'stacked' as their
// TEMPLATE_DEFAULTS (moderncv/mcdowellcv's own per-field contact macros),
// so 'row' is theirs.
describe('TeX generation is stable across contactLayout overrides', () => {
  const CASES: Array<{ id: number; contactLayout: 'row' | 'stacked' }> = [
    { id: 1, contactLayout: 'stacked' },
    { id: 2, contactLayout: 'stacked' },
    { id: 3, contactLayout: 'stacked' },
    { id: 4, contactLayout: 'stacked' },
    { id: 5, contactLayout: 'stacked' },
    { id: 6, contactLayout: 'stacked' },
    { id: 7, contactLayout: 'row' },
    { id: 8, contactLayout: 'row' },
    { id: 9, contactLayout: 'stacked' }
  ]

  for (const { id, contactLayout } of CASES) {
    test(`template${id} with contactLayout '${contactLayout}' matches its golden snapshot`, async () => {
      const { texDoc } = blueprintToTex({
        ...sample,
        selectedTemplate: id,
        document: { contactLayout }
      })
      const goldenPath = resolve(GOLDEN, `template${id}-contact-${contactLayout}.tex`)

      if (UPDATE_GOLDEN || !existsSync(goldenPath)) {
        await writeFile(goldenPath, texDoc, 'utf8')
        return
      }

      const expected = await readFile(goldenPath, 'utf8')
      assert.equal(
        texDoc,
        expected,
        `template${id}+contactLayout:${contactLayout} TeX output drifted. Re-run with UPDATE_GOLDEN=1 if intended.`
      )
    })
  }
})

// Coarse, cheap regression guard alongside the golden cases above: every
// template's rendered TeX must actually change between 'row' and 'stacked',
// not silently ignore the override the way all nine did before F5.
describe('every template branches on contactLayout', () => {
  for (const id of TEMPLATE_IDS) {
    test(`template${id} renders differently for 'row' vs 'stacked'`, () => {
      const row = blueprintToTex({
        ...sample,
        selectedTemplate: id,
        document: { contactLayout: 'row' }
      }).texDoc
      const stacked = blueprintToTex({
        ...sample,
        selectedTemplate: id,
        document: { contactLayout: 'stacked' }
      }).texDoc

      assert.notEqual(row, stacked, `template${id} ignores document.contactLayout`)
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

    // basics.profiles went the same way: schema, store, and then nowhere. The
    // visible text is the address rather than the network name, because a parser
    // reads the text layer and never the link annotation.
    test(`template${id} renders basics.profiles`, () => {
      const { texDoc } = blueprintToTex({ ...sample, selectedTemplate: id })

      assert.ok(
        texDoc.includes('\\href{https://linkedin.com/in/ada-lovelace}{linkedin.'),
        `template${id} dropped basics.profiles[0], or rendered it without linking it`
      )
    })

    // The second profile's network carries an ampersand, so this doubles as a
    // check that the label routes through escapeLatex like any other text.
    test(`template${id} escapes LaTeX specials in a profile label`, () => {
      const { texDoc } = blueprintToTex({ ...sample, selectedTemplate: id })

      assert.ok(
        texDoc.includes('Personal \\& Lab Notes'),
        `template${id} emitted an unescaped & in a profile network name`
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

// F4's exit criterion: every supported template x fontFamily combination
// compiles and extracts clean, checked with a loop over the matrix rather
// than one committed golden per combination (the golden-snapshot describe
// above already covers preamble-text correctness for one combo per
// mechanism). `fontFamily` is a closed 6-literal enum, never interpolated
// as free text into any template (every call site in templates/fonts.ts and
// templateN.ts switches on it through FONT_FAMILIES's fixed keys), so this
// needs no companion entry in fixtures/injection.json — there is no new
// free-text surface to probe.
describe('font family overrides compile and extract clean', () => {
  function hasBinary(name: string): boolean {
    try {
      execFileSync(name, ['-v'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  const POPPLER = hasBinary('pdftotext')
  const FAMILIES: FontFamily[] = ['calibri', 'arial', 'helvetica', 'garamond', 'georgia']

  for (const id of TEMPLATE_IDS) {
    const families = FAMILIES.filter((f) => !UNSUPPORTED_FONTS[id]?.includes(f))

    test(
      `template${id} (${families.join(', ')})`,
      {
        timeout: COMPILE_TIMEOUT_MS * families.length + 30_000,
        skip: !POPPLER && 'pdftotext not on PATH'
      },
      async () => {
        for (const fontFamily of families) {
          const pdf = await renderBlueprint(
            { ...sample, selectedTemplate: id, document: { fontFamily } },
            { timeoutMs: COMPILE_TIMEOUT_MS }
          )
          assert.equal(
            pdf.subarray(0, 5).toString(),
            '%PDF-',
            `template${id}+${fontFamily}: missing PDF magic bytes`
          )

          const dir = await mkdtemp(join(tmpdir(), 'rb-fonts-'))
          try {
            const pdfPath = join(dir, `template${id}-${fontFamily}.pdf`)
            await writeFile(pdfPath, pdf)
            const { stdout: text } = await execFileAsync('pdftotext', [pdfPath, '-'], {
              maxBuffer: 8 << 20
            })

            const PRIVATE_USE_AREA_RE = /[\uE000-\uF8FF]/
            const iconLabeled = TEMPLATE_PROFILES.find((p) => p.id === id)?.iconLabeledContacts

            // Private-use-area codepoints are how an icon font (template2's
            // FontAwesome, template7's moderncv icons — see catalog.ts's
            // iconLabeledContacts) leaks into the text layer, independent of
            // the body/header font family -- confirmed by checking template2's
            // *default* output separately, which already carries the same
            // codepoints. Only a template not already known for this defect
            // could have a font swap introduce it fresh.
            if (!iconLabeled) {
              assert.ok(
                !PRIVATE_USE_AREA_RE.test(text),
                `template${id}+${fontFamily}: private-use-area glyphs in extracted text`
              )
            }

            // Case-insensitive: several templates (e.g. template6's \personal)
            // uppercase the name for display, matching ats.test.ts's squash()
            // convention rather than a defect a font override introduced.
            assert.ok(
              text.replace(/\s+/g, '').toLowerCase().includes('adalovelace'),
              `template${id}+${fontFamily}: candidate name did not round-trip`
            )
          } finally {
            await rm(dir, { recursive: true, force: true })
          }
        }
      }
    )
  }
})
