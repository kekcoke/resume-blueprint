import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, stat, writeFile, readdir, mkdir, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import { pruneOldRenders, renderDir, renderPath } from '../dist/render.js'
import { assertReasonableDepth } from '../dist/validate.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST_INDEX_PATH = resolve(HERE, '..', 'dist', 'index.js')
const FIXTURES = resolve(HERE, '..', '..', '..', 'fixtures')

const READ_ONLY_HINTS: Record<string, boolean> = {
  resume_list: true,
  resume_get: true,
  resume_create: false,
  resume_patch: false,
  resume_section_append: false,
  resume_section_update: false,
  resume_section_remove: false,
  resume_remove: false,
  resume_validate: true,
  resume_render: false,
  resume_tex: true,
  resume_text: true,
  resume_target: true,
  resume_history: true,
  resume_diff: true,
  resume_revert: false,
  resume_templates: true,
  resume_import: true
}

/** Harness A: SDK client/transport, for everything except stdout purity. */
async function startClient(home: string): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [DIST_INDEX_PATH],
    env: { ...(process.env as Record<string, string>), RESUME_BLUEPRINT_HOME: home }
  })
  const client = new Client({ name: 'mcp-test-client', version: '0.0.0' }, { capabilities: {} })
  await client.connect(transport)
  return { client, transport }
}

let dir: string
let client: Client
let transport: StdioClientTransport

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'resume-blueprint-mcp-test-'))
  ;({ client, transport } = await startClient(dir))
})

afterEach(async () => {
  await client.close()
  await rm(dir, { recursive: true, force: true })
})

describe('handshake', () => {
  test('initialize succeeds and reports server identity', async () => {
    const version = client.getServerVersion()
    assert.equal(version?.name, 'resume-blueprint')
    const caps = client.getServerCapabilities()
    assert.ok(caps?.tools, 'server should advertise tools capability')
  })
})

// Every tool that returns `structuredContent` should declare an outputSchema
// (see Gate 2 MCP review, finding 7) so the SDK's validateToolOutput actually
// checks the shape instead of being a no-op.
const TOOLS_WITHOUT_OUTPUT_SCHEMA = new Set<string>() // every tool has one now

describe('tools/list', () => {
  test('lists all 18 tools with descriptions and matching readOnlyHint', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    assert.deepEqual(names, Object.keys(READ_ONLY_HINTS).sort())

    for (const tool of tools) {
      assert.ok(tool.description && tool.description.length > 0, `${tool.name} needs a description`)
      assert.equal(
        tool.annotations?.readOnlyHint,
        READ_ONLY_HINTS[tool.name],
        `${tool.name} readOnlyHint mismatch`
      )
    }
  })

  test('every tool that returns structuredContent declares an outputSchema', async () => {
    const { tools } = await client.listTools()
    for (const tool of tools) {
      if (TOOLS_WITHOUT_OUTPUT_SCHEMA.has(tool.name)) continue
      assert.ok(tool.outputSchema, `${tool.name} is missing an outputSchema`)
      assert.equal(tool.outputSchema?.type, 'object', `${tool.name}'s outputSchema should describe an object`)
    }
  })
})

describe('create -> patch -> get -> remove round-trip', () => {
  test('patch is visible via get, and remove actually removes it', async () => {
    const create = await client.callTool({
      name: 'resume_create',
      arguments: { id: 'roundtrip', blueprint: { basics: { name: 'Ada Lovelace' } } }
    })
    assert.equal(create.isError, undefined)

    const patch = await client.callTool({
      name: 'resume_patch',
      arguments: { id: 'roundtrip', patch: { basics: { label: 'Mathematician' } } }
    })
    assert.equal(patch.isError, undefined)

    const got = await client.callTool({ name: 'resume_get', arguments: { id: 'roundtrip' } })
    assert.equal(got.isError, undefined)
    const structured = got.structuredContent as { blueprint: { basics?: { name?: string; label?: string } } }
    assert.equal(structured.blueprint.basics?.name, 'Ada Lovelace')
    assert.equal(structured.blueprint.basics?.label, 'Mathematician')

    const removed = await client.callTool({ name: 'resume_remove', arguments: { id: 'roundtrip' } })
    assert.equal(removed.isError, undefined)

    const gotAfterRemove = await client.callTool({ name: 'resume_get', arguments: { id: 'roundtrip' } })
    assert.equal(gotAfterRemove.isError, true)
  })
})

describe('document override', () => {
  test('resume_tex merges the document override rather than replacing it', async () => {
    const create = await client.callTool({
      name: 'resume_create',
      arguments: {
        id: 'doc-override',
        blueprint: {
          basics: { name: 'Ada Lovelace' },
          selectedTemplate: 3,
          document: { accentColor: '#4A90D9' }
        }
      }
    })
    assert.equal(create.isError, undefined)

    // Overriding only fontSize must not wipe the stored accentColor — a
    // plain object spread would, since resume_tex's `document` argument
    // replaces nothing on its own; it's `withOverrides` in tools.ts that
    // merges field by field.
    const tex = await client.callTool({
      name: 'resume_tex',
      arguments: { id: 'doc-override', document: { fontSize: 12 } }
    })
    assert.equal(tex.isError, undefined)

    const structured = tex.structuredContent as { texDoc: string }
    assert.ok(structured.texDoc.includes('12pt'), 'the fontSize override should reach the TeX source')
    assert.ok(
      structured.texDoc.includes('4A90D9'),
      'the stored accentColor should survive an unrelated document override'
    )
  })

  test('resume_templates reports resolved document defaults and honoured fields', async () => {
    const result = await client.callTool({ name: 'resume_templates', arguments: {} })
    assert.equal(result.isError, undefined)

    const structured = result.structuredContent as {
      templates: Array<{
        id: number
        document: { defaults: Record<string, unknown>; honours: string[] }
      }>
    }
    const template1 = structured.templates.find((t) => t.id === 1)
    assert.ok(template1, 'expected template 1 in the list')
    assert.ok(template1.document.honours.includes('margin'))
    assert.ok(!template1.document.honours.includes('accentColor'))
    assert.equal(typeof template1.document.defaults.margin, 'string')
  })
})

describe('resume_text', () => {
  test('renders a stored blueprint to plain text, honouring headings, with no LaTeX escaping', async () => {
    const create = await client.callTool({
      name: 'resume_create',
      arguments: {
        id: 'plain-text',
        blueprint: {
          basics: { name: 'Ada Lovelace', label: 'R&D Lead' },
          headings: { work: 'Employment' },
          work: [{ name: 'Acme', position: 'Engineer', summary: 'Shipped things.' }],
          sections: ['profile', 'work']
        }
      }
    })
    assert.equal(create.isError, undefined)

    const result = await client.callTool({ name: 'resume_text', arguments: { id: 'plain-text' } })
    assert.equal(result.isError, undefined)

    const structured = result.structuredContent as { text: string }
    assert.match(structured.text, /^Ada Lovelace$/m)
    // Unescaped, unlike resume_tex -- "R&D" would come back "R\&D" over there.
    assert.match(structured.text, /R&D Lead/)
    assert.match(structured.text, /^EMPLOYMENT$/m)
    assert.doesNotMatch(structured.text, /EXPERIENCE/)
    assert.match(structured.text, /Shipped things\./)
  })
})

describe('resume_target', () => {
  const JD = [
    'Senior Platform Engineer',
    '',
    'Responsibilities:',
    '- Operate Kubernetes clusters in production',
    '- Own Terraform modules',
    '',
    'Required:',
    '- Rust, or a willingness to learn it',
    '- AWS Certified Solutions Architect certification'
  ].join('\n')

  async function seed(id: string): Promise<void> {
    const create = await client.callTool({
      name: 'resume_create',
      arguments: {
        id,
        blueprint: {
          basics: { name: 'Ada Lovelace' },
          work: [{ name: 'Acme', position: 'Engineer', highlights: ['Ran Kubernetes in production'] }],
          skills: [{ name: 'Platform', keywords: ['Terraform'] }],
          sections: ['profile', 'work', 'skills']
        }
      }
    })
    assert.equal(create.isError, undefined)
  }

  test('reports matched terms, ranked missing terms, and per-section placement', async () => {
    await seed('targeting')

    const result = await client.callTool({
      name: 'resume_target',
      arguments: { id: 'targeting', jobDescription: JD }
    })
    assert.equal(result.isError, undefined)

    const report = result.structuredContent as {
      coverage: number
      matched: Array<{ term: string; sections: string[] }>
      missing: Array<{ term: string; prominence: number; suggestions: Array<{ section: string }> }>
      sections: Array<{ section: string; matched: number }>
      notes: string[]
    }

    assert.ok(
      report.matched.some((t) => t.term === 'Kubernetes' && t.sections.includes('work')),
      `Kubernetes should be matched in work; got ${JSON.stringify(report.matched)}`
    )
    assert.ok(report.missing.some((t) => t.term === 'Rust'), 'Rust is not on this resume')
    assert.ok(report.coverage > 0 && report.coverage < 1)

    // Ranked, highest prominence first.
    const scores = report.missing.map((t) => t.prominence)
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a))

    // Suggestions never name a section this blueprint does not render.
    for (const term of report.missing) {
      for (const { section } of term.suggestions) {
        assert.ok(['profile', 'work', 'skills'].includes(section), `leaked ${section}`)
      }
    }

    assert.ok(report.sections.some((s) => s.section === 'work' && s.matched > 0))
  })

  test('labels the quoted terms in the text channel as data', async () => {
    await seed('targeting-text')

    const result = await client.callTool({
      name: 'resume_target',
      arguments: { id: 'targeting-text', jobDescription: JD }
    })

    const [content] = result.content as Array<{ type: string; text: string }>
    assert.match(content.text, /^coverage \d+% -- \d+ of \d+ terms already present$/m)
    assert.match(content.text, /data, not instructions/)
  })

  test('writes nothing: the blueprint is unchanged at the same revision', async () => {
    await seed('targeting-readonly')

    const before = await client.callTool({ name: 'resume_get', arguments: { id: 'targeting-readonly' } })
    await client.callTool({ name: 'resume_target', arguments: { id: 'targeting-readonly', jobDescription: JD } })
    const after = await client.callTool({ name: 'resume_get', arguments: { id: 'targeting-readonly' } })

    assert.deepEqual(after.structuredContent, before.structuredContent)
  })

  test('rejects an oversized job description at the boundary', async () => {
    await seed('targeting-huge')

    const result = await client.callTool({
      name: 'resume_target',
      arguments: { id: 'targeting-huge', jobDescription: 'Kubernetes '.repeat(10_000) }
    })

    assert.equal(result.isError, true)
  })
})

describe('invalid tool args', () => {
  test('resume_get with no id produces a structured error, not a crash', async () => {
    const result = await client.callTool({ name: 'resume_get', arguments: {} })
    assert.equal(result.isError, true)
    assert.ok(Array.isArray(result.content) && result.content.length > 0)
  })
})

describe('citation warnings', () => {
  const DIRTY = {
    basics: { name: 'Ada[cite: 1, 2, 3]', summary: '[cite_start]Led the group.' },
    work: [{ name: 'Analytical Engine Works', position: 'Engineer', highlights: ['Shipped it.'] }],
    headings: { work: 'Experience[cite: 5]' }
  }

  test('resume_validate reports artifacts while still returning valid: true', async () => {
    // A leftover placeholder is legal content, not a schema violation.
    const result = await client.callTool({ name: 'resume_validate', arguments: { blueprint: DIRTY } })

    const structured = result.structuredContent as { valid: boolean; warnings?: string[] }
    assert.equal(structured.valid, true)
    assert.deepEqual(structured.warnings, [
      'basics.name carries 1 citation artifact',
      'basics.summary carries 1 citation artifact',
      'headings.work carries 1 citation artifact'
    ])

    // The text channel carries them too -- structuredContent is what a
    // schema-aware client reads, the text is what an agent looks at.
    const text = (result.content as Array<{ text: string }>)[0]!.text
    assert.match(text, /blueprint is valid/)
    assert.match(text, /citation artifacts at 3 sites/)
  })

  test('a clean blueprint omits the field entirely rather than sending []', async () => {
    // `warnings` is optional on the output schema on purpose: the SDK enforces
    // these schemas, and a required field would reject every clean response
    // unless each handler remembered to emit an empty array.
    const result = await client.callTool({
      name: 'resume_validate',
      arguments: { blueprint: { basics: { name: 'Ada Lovelace' } } }
    })

    const structured = result.structuredContent as { valid: boolean; warnings?: string[] }
    assert.deepEqual(structured, { valid: true })
  })

  test('resume_tex carries warnings in structuredContent but never in the TeX', async () => {
    // The text channel IS the document here. Appending a warning to it would
    // corrupt the file the caller is about to write to disk.
    await client.callTool({ name: 'resume_create', arguments: { id: 'dirty-tex', blueprint: DIRTY } })
    const result = await client.callTool({ name: 'resume_tex', arguments: { id: 'dirty-tex' } })

    const { texDoc, warnings } = result.structuredContent as { texDoc: string; warnings?: string[] }
    assert.ok(warnings && warnings.length === 3)
    assert.ok(!texDoc.includes('warning:'), 'the TeX document must stay uncontaminated')
    assert.equal((result.content as Array<{ text: string }>)[0]!.text, texDoc)
  })

  test('resume_text carries warnings in structuredContent but never in the text', async () => {
    await client.callTool({ name: 'resume_create', arguments: { id: 'dirty-text', blueprint: DIRTY } })
    const result = await client.callTool({ name: 'resume_text', arguments: { id: 'dirty-text' } })

    const { text, warnings } = result.structuredContent as { text: string; warnings?: string[] }
    assert.ok(warnings && warnings.length === 3)
    assert.ok(!text.includes('warning:'), 'the rendered text must stay uncontaminated')
    // Unlike resume_tex, the markers themselves are neither stripped nor
    // escaped -- they typeset (or here, print) as literal text either way.
    assert.match(text, /\[cite: 1, 2, 3\]/)
    assert.equal((result.content as Array<{ text: string }>)[0]!.text, text)
  })

  test('an invalid blueprint reports the schema error without piling on', async () => {
    const result = await client.callTool({
      name: 'resume_validate',
      arguments: { blueprint: { basics: { name: 123 }, work: [{ summary: 'x[cite: 1]' }] } }
    })

    const structured = result.structuredContent as { valid: boolean; warnings?: string[] }
    assert.equal(structured.valid, false)
    assert.equal(structured.warnings, undefined)
  })
})

describe('resume_import', () => {
  const PROFILE = [
    '# Master Profile: Numerical Analyst',
    '',
    '## Candidate Metadata',
    '- **Name:** Ada Lovelace[cite: 1, 2, 3]',
    '- **LinkedIn:** linkedin.com/in/ada-lovelace[cite: 1, 2]',
    '',
    '## Professional Experience',
    '',
    '### Analytical Engine Works — London, UK',
    '**Principal Engineer** *(January 2019 – Present)*[cite: 1, 2, 3]',
    '- Designed the first published algorithm for a computing machine[cite: 1, 2, 3].',
    '',
    '## Volunteer Work',
    '- Tutored students in the calculus of finite differences[cite: 5]'
  ].join('\n')

  test('parses a profile and returns it without storing anything', async () => {
    const result = await client.callTool({ name: 'resume_import', arguments: { markdown: PROFILE } })
    assert.equal(result.isError, undefined)

    const { blueprint } = result.structuredContent as { blueprint: Record<string, any> }
    assert.equal(blueprint.basics.name, 'Ada Lovelace')
    assert.equal(blueprint.work[0].name, 'Analytical Engine Works')
    assert.equal(blueprint.work[0].endDate, 'Present')

    // readOnlyHint is not decoration: nothing may have appeared in the store.
    const list = await client.callTool({ name: 'resume_list', arguments: {} })
    assert.deepEqual((list.structuredContent as { blueprints: unknown[] }).blueprints, [])
  })

  test('strips citation artifacts before they can reach a document', async () => {
    const result = await client.callTool({ name: 'resume_import', arguments: { markdown: PROFILE } })
    assert.ok(!JSON.stringify(result.structuredContent).includes('[cite'))
  })

  test('reports a section the schema has no home for', async () => {
    // BlueprintSchema has no `volunteer`, and zod objects are non-strict, so
    // without the warning this content vanishes with no error anywhere.
    const result = await client.callTool({ name: 'resume_import', arguments: { markdown: PROFILE } })
    const { warnings } = result.structuredContent as { warnings: string[] }
    assert.ok(warnings.some((w) => /unrecognized section "Volunteer Work"/.test(w)))
    // And the warnings must be readable in the text channel too — an agent that
    // only reads `content` should still see them.
    const text = (result.content as Array<{ text: string }>)[0]!.text
    assert.match(text, /Volunteer Work/)
  })

  test('the imported blueprint is valid input for resume_create', async () => {
    const imported = await client.callTool({ name: 'resume_import', arguments: { markdown: PROFILE } })
    const { blueprint } = imported.structuredContent as { blueprint: Record<string, unknown> }

    const created = await client.callTool({
      name: 'resume_create',
      arguments: { id: 'imported-ada', blueprint }
    })
    assert.equal(created.isError, undefined)
  })

  test('unparseable markdown is a readable error, not an "unexpected" one', async () => {
    // ProfileParseError has its own case in toToolError; without it this falls
    // to the catch-all, which dumps a stack to stderr and tells the caller to
    // go looking for a server bug.
    const result = await client.callTool({
      name: 'resume_import',
      arguments: { markdown: 'just prose, no headings anywhere' }
    })
    assert.equal(result.isError, true)
    const text = (result.content as Array<{ text: string }>)[0]!.text
    assert.match(text, /Could not parse the profile/)
    assert.ok(!/Unexpected error/.test(text))
  })
})

describe('resume_render', () => {
  test('renders a real PDF with no base64 in the response', async () => {
    const sample = JSON.parse(await readFile(resolve(FIXTURES, 'sample.json'), 'utf8'))

    const create = await client.callTool({
      name: 'resume_create',
      arguments: { id: 'render-me', blueprint: sample }
    })
    assert.equal(create.isError, undefined)

    const rendered = await client.callTool({
      name: 'resume_render',
      arguments: { id: 'render-me', timeoutMs: 180_000 }
    })
    assert.equal(rendered.isError, undefined, JSON.stringify(rendered.content))

    const text = (rendered.content as Array<{ type: string; text?: string }>)
      .map((c) => c.text ?? '')
      .join('\n')
    // A base64-encoded PDF would be long stretches of base64 alphabet with no
    // spaces; a human-readable one-liner never looks like that.
    assert.ok(!/[A-Za-z0-9+/]{200,}={0,2}/.test(text), 'response text looks like a base64 blob')

    const structured = rendered.structuredContent as {
      path: string
      pageCount: number
      byteSize: number
      coreBuild: string
    }
    assert.ok(existsSync(structured.path), `expected a file at ${structured.path}`)
    assert.ok(structured.pageCount >= 1)

    const stats = await stat(structured.path)
    assert.equal(structured.byteSize, stats.size)

    // A long-running server serves whatever core it loaded at startup, so every
    // render says which build produced it. Without this, a template fix looks
    // like it did not work until someone thinks to restart the client.
    assert.match(
      structured.coreBuild,
      /^core built \d{4}-/,
      `expected a core build stamp, got ${JSON.stringify(structured.coreBuild)}`
    )
    assert.ok(
      text.includes(structured.coreBuild),
      'the human-readable render line should carry the build stamp too'
    )
  })
})

describe('security', () => {
  test('injection fixture is neutralized end-to-end through resume_render', async () => {
    const injection = JSON.parse(await readFile(resolve(FIXTURES, 'injection.json'), 'utf8'))

    const create = await client.callTool({
      name: 'resume_create',
      arguments: { id: 'injected', blueprint: injection }
    })
    assert.equal(create.isError, undefined)

    const rendered = await client.callTool({
      name: 'resume_render',
      arguments: { id: 'injected', timeoutMs: 180_000 }
    })
    assert.equal(rendered.isError, undefined, JSON.stringify(rendered.content))

    const structured = rendered.structuredContent as { path: string }
    const pdf = await readFile(structured.path)
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', 'missing PDF magic bytes')

    assert.ok(!existsSync('/tmp/pwned'), 'shell escape executed')
    assert.ok(!existsSync('/tmp/escape.txt'), 'file write executed')
  })
})

describe('resource limits', () => {
  test('resume_render rejects a timeoutMs above the 300_000ms ceiling', async () => {
    const result = await client.callTool({
      name: 'resume_render',
      arguments: { id: 'whatever', timeoutMs: 300_001 }
    })
    assert.equal(result.isError, true)
  })

  test('resume_render accepts a timeoutMs at the ceiling', async () => {
    // Only checks the schema doesn't reject the boundary value itself — the
    // id doesn't exist, so this still fails, but with a NotFoundError, not
    // an input-validation error.
    const result = await client.callTool({
      name: 'resume_render',
      arguments: { id: 'whatever', timeoutMs: 300_000 }
    })
    assert.equal(result.isError, true)
    const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? '').join('\n')
    assert.ok(/NotFoundError/.test(text), `expected a NotFoundError, not an input-validation error: ${text}`)
  })

  test('resume_history rejects a limit above the 500 ceiling', async () => {
    const result = await client.callTool({
      name: 'resume_history',
      arguments: { id: 'whatever', limit: 501 }
    })
    assert.equal(result.isError, true)
  })
})

describe('resume_patch depth guard', () => {
  test('assertReasonableDepth throws a plain Error, not a RangeError, on deep input', () => {
    let deep: unknown = { a: 1 }
    for (let i = 0; i < 5000; i++) deep = { nested: deep }
    assert.throws(() => assertReasonableDepth(deep), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.ok(!(error instanceof RangeError), 'should not be a raw RangeError (stack overflow)')
      assert.match(error.message, /nested too deeply/)
      return true
    })
  })

  test('shallow input passes through without throwing', () => {
    assert.doesNotThrow(() => assertReasonableDepth({ basics: { name: 'Ada' }, work: [{ name: 'X' }] }))
  })

  test('resume_patch with a ~1000-level-deep patch is a clean isError response, not a crash', async () => {
    const create = await client.callTool({
      name: 'resume_create',
      arguments: { id: 'deep-patch', blueprint: {} }
    })
    assert.equal(create.isError, undefined)

    let deep: unknown = { a: 1 }
    for (let i = 0; i < 1000; i++) deep = { nested: deep }

    const result = await client.callTool({
      name: 'resume_patch',
      arguments: { id: 'deep-patch', patch: deep }
    })
    assert.equal(result.isError, true)
    const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? '').join('\n')
    assert.match(text, /nested too deeply/)
    assert.ok(!/RangeError/.test(text), 'a raw RangeError leaked into the response')
  })
})

describe('pruneOldRenders', () => {
  test('swallows ENOENT when a candidate is removed out from under it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'resume-blueprint-prune-test-'))
    try {
      const rdir = renderDir(home)
      await mkdir(rdir, { recursive: true })
      const id = 'ghost'
      // 12 candidates, one more than `keep` (10), so pruneOldRenders has a
      // real stale tail to unlink.
      for (let i = 0; i < 12; i++) {
        await writeFile(join(rdir, `${id}-r${i}-t1.pdf`), `fake-${i}`)
      }

      // Two concurrent, un-serialized prune calls race the same stale tail:
      // both list the same 12 candidates, both compute the same 2 stale
      // entries, and whichever runs second hits ENOENT unlinking what the
      // first already removed. Without the ENOENT swallow, this rejects.
      await assert.doesNotReject(Promise.all([pruneOldRenders(home, id, 10), pruneOldRenders(home, id, 10)]))

      const remaining = (await readdir(rdir)).filter((f) => f.startsWith(`${id}-`))
      assert.equal(remaining.length, 10, `expected exactly 10 files to remain, got ${remaining.length}`)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})

describe('resume_render concurrency and prune failures', () => {
  test('two concurrent resume_render calls for the same id both succeed', async () => {
    const sample = JSON.parse(await readFile(resolve(FIXTURES, 'sample.json'), 'utf8'))
    const id = 'concurrent-render'

    const create = await client.callTool({ name: 'resume_create', arguments: { id, blueprint: sample } })
    assert.equal(create.isError, undefined)

    // Build up to exactly `keep` (10) distinct render files sequentially —
    // no pruning triggered yet.
    for (let i = 0; i < 10; i++) {
      const patch = await client.callTool({
        name: 'resume_patch',
        arguments: { id, patch: { basics: { label: `seed-${i}` } } }
      })
      assert.equal(patch.isError, undefined)
      const rendered = await client.callTool({
        name: 'resume_render',
        arguments: { id, template: 1, timeoutMs: 180_000 }
      })
      assert.equal(rendered.isError, undefined, JSON.stringify(rendered.content))
    }

    // One more rev, then two *concurrent* renders of it at different
    // templates — each writes a brand-new distinct file, taking the
    // directory to 12 candidates and forcing a real prune on both sides.
    // Serialized only by the per-id lock in render.ts's withRenderLock.
    const finalPatch = await client.callTool({
      name: 'resume_patch',
      arguments: { id, patch: { basics: { label: 'final' } } }
    })
    assert.equal(finalPatch.isError, undefined)

    const [r1, r2] = await Promise.all([
      client.callTool({ name: 'resume_render', arguments: { id, template: 2, timeoutMs: 180_000 } }),
      client.callTool({ name: 'resume_render', arguments: { id, template: 3, timeoutMs: 180_000 } })
    ])

    assert.equal(r1.isError, undefined, JSON.stringify(r1.content))
    assert.equal(r2.isError, undefined, JSON.stringify(r2.content))

    for (const result of [r1, r2]) {
      const structured = result.structuredContent as { path: string; byteSize: number }
      assert.ok(existsSync(structured.path), `expected a file at ${structured.path}`)
      const pdf = await readFile(structured.path)
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', 'missing PDF magic bytes')
      const stats = await stat(structured.path)
      assert.equal(structured.byteSize, stats.size)
    }

    // Prune should have run to completion on both sides without error,
    // leaving exactly `keep` (10) files for this id.
    const rdir = renderDir(dir)
    const remaining = (await readdir(rdir)).filter((f) => f.startsWith(`${id}-`) && f.endsWith('.pdf'))
    assert.equal(remaining.length, 10, `expected exactly 10 retained render files, got ${remaining.length}`)
  })

  test('a forced prune failure does not fail an otherwise-successful resume_render', async () => {
    const sample = JSON.parse(await readFile(resolve(FIXTURES, 'sample.json'), 'utf8'))
    const id = 'prune-fails'

    const create = await client.callTool({ name: 'resume_create', arguments: { id, blueprint: sample } })
    assert.equal(create.isError, undefined)

    const got = await client.callTool({ name: 'resume_get', arguments: { id } })
    const { rev } = got.structuredContent as { rev: string }
    const template = 1

    const rdir = renderDir(dir)
    await mkdir(rdir, { recursive: true })
    // writeRenderFile only creates .gitignore on first use (existsSync
    // guard) — pre-create it so that guard short-circuits once the
    // directory goes read-only below; by the time a real deployment has
    // accumulated >10 renders for an id, this file already exists too.
    await writeFile(join(rdir, '.gitignore'), '*\n')

    // The path this render call will write to — pre-seeded so writing to it
    // is an in-place overwrite (needs only the file's own write permission)
    // rather than a new directory entry (which a read-only directory would
    // also block, and which would falsely "fix" the write step too).
    const expectedPath = join(rdir, renderPath(id, rev, template))
    await writeFile(expectedPath, 'placeholder')

    // 10 further stale candidates, so pruneOldRenders has real work to do
    // once this call's write makes 11 candidates for this id.
    for (let i = 0; i < 10; i++) {
      await writeFile(join(rdir, `${id}-stale${i}-t1.pdf`), `stale-${i}`)
    }

    await chmod(rdir, 0o555) // read + execute only: readdir/stat still work, unlink does not
    try {
      const rendered = await client.callTool({
        name: 'resume_render',
        arguments: { id, template, timeoutMs: 180_000 }
      })

      assert.equal(rendered.isError, undefined, JSON.stringify(rendered.content))
      const structured = rendered.structuredContent as { path: string; pageCount: number; byteSize: number }
      assert.equal(structured.path, expectedPath)
      assert.ok(structured.pageCount >= 1)

      const pdf = await readFile(structured.path)
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', 'missing PDF magic bytes — write step did not succeed')
      assert.equal(structured.byteSize, pdf.length)
    } finally {
      await chmod(rdir, 0o755) // restore, so afterEach's rm(dir, { recursive: true }) can clean up
    }
  })
})

describe('render pruning', () => {
  test('keeps only the last 10 renders for an id', async () => {
    const sample = JSON.parse(await readFile(resolve(FIXTURES, 'sample.json'), 'utf8'))
    const id = 'many-renders'

    const create = await client.callTool({ name: 'resume_create', arguments: { id, blueprint: sample } })
    assert.equal(create.isError, undefined)

    const revs: string[] = []
    for (let i = 0; i < 11; i++) {
      const patch = await client.callTool({
        name: 'resume_patch',
        arguments: { id, patch: { basics: { label: `v${i}` } } }
      })
      assert.equal(patch.isError, undefined)
      const { rev } = patch.structuredContent as { rev: string }
      revs.push(rev)

      const rendered = await client.callTool({
        name: 'resume_render',
        arguments: { id, template: 1, timeoutMs: 180_000 }
      })
      assert.equal(rendered.isError, undefined, JSON.stringify(rendered.content))
    }

    const rdir = renderDir(dir)
    const files = (await readdir(rdir)).filter((f) => f.startsWith(`${id}-`) && f.endsWith('.pdf'))
    assert.equal(files.length, 10, `expected exactly 10 retained render files, got ${files.length}`)

    // The retained files should be exactly the last 10 revs' files — i.e.
    // the most recent by mtime, matching "keep the last 10".
    const expectedNames = new Set(revs.slice(-10).map((rev) => renderPath(id, rev, 1)))
    assert.deepEqual(new Set(files), expectedNames)
  })
})

describe('actor attribution', () => {
  test('resume_patch commits are attributed to the mcp actor in history', async () => {
    const create = await client.callTool({
      name: 'resume_create',
      arguments: { id: 'actor-check', blueprint: {} }
    })
    assert.equal(create.isError, undefined)

    const patch = await client.callTool({
      name: 'resume_patch',
      arguments: { id: 'actor-check', patch: { basics: { label: 'via mcp?' } } }
    })
    assert.equal(patch.isError, undefined)

    const history = await client.callTool({ name: 'resume_history', arguments: { id: 'actor-check' } })
    assert.equal(history.isError, undefined)
    const { commits } = history.structuredContent as { commits: Array<{ message: string }> }
    assert.ok(
      commits.some((c) => c.message.includes('via mcp')),
      `expected a commit message containing "via mcp", got: ${JSON.stringify(commits)}`
    )
  })
})

describe('stdout purity', () => {
  // Harness B: a raw spawn(), not the SDK's Client/StdioClientTransport,
  // because the SDK client only ever reads stdout as framed JSON-RPC and
  // would hide a leaked non-JSON line rather than let the test see it.
  //
  // Drives three separate sources of a potential stdout leak, not just the
  // pure in-memory resume_templates call: a real `git` subprocess
  // (resume_create), a real `tectonic` subprocess (resume_render), and the
  // generic-error fallback in errors.ts's toToolError — triggered here via a
  // deeply-nested resume_patch (validate.ts's assertReasonableDepth throws a
  // plain Error, which is not one of toToolError's specifically-handled
  // classes, so it falls to the branch that calls `console.error`). That
  // branch logs to stderr, so this also confirms stderr logging never
  // bleeds into stdout.
  test('stdout carries only JSON-RPC frames across create, render, and an error path', async () => {
    const purityHome = await mkdtemp(join(tmpdir(), 'resume-blueprint-mcp-purity-'))
    try {
      const sample = JSON.parse(await readFile(resolve(FIXTURES, 'sample.json'), 'utf8'))

      const child: ChildProcessWithoutNullStreams = spawn('node', [DIST_INDEX_PATH], {
        env: { ...process.env, RESUME_BLUEPRINT_HOME: purityHome },
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stdout = ''
      child.stdout.on('data', (chunk) => (stdout += chunk.toString('utf8')))

      const send = (message: unknown) => {
        child.stdin.write(JSON.stringify(message) + '\n')
      }

      const waitForResponses = (count: number, timeoutMs = 60_000): Promise<void> =>
        new Promise((resolvePromise, rejectPromise) => {
          const timer = setTimeout(() => rejectPromise(new Error('timed out waiting for responses')), timeoutMs)
          const check = () => {
            const lines = stdout.split('\n').filter((l) => l.trim().length > 0)
            if (lines.length >= count) {
              clearTimeout(timer)
              resolvePromise()
            } else {
              setTimeout(check, 50)
            }
          }
          check()
        })

      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'purity-test', version: '0.0.0' }
        }
      })
      await waitForResponses(1)

      send({ jsonrpc: '2.0', method: 'notifications/initialized' })

      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'resume_templates', arguments: {} } })
      await waitForResponses(2)

      // Real `git` subprocess, via the store.
      send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'resume_create', arguments: { id: 'purity', blueprint: sample } }
      })
      await waitForResponses(3)

      // Real `tectonic` subprocess.
      send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'resume_render', arguments: { id: 'purity', timeoutMs: 180_000 } }
      })
      await waitForResponses(4)

      // toToolError's generic fallback, via assertReasonableDepth — logs to stderr.
      let deep: unknown = { a: 1 }
      for (let i = 0; i < 1000; i++) deep = { nested: deep }
      send({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'resume_patch', arguments: { id: 'purity', patch: deep } }
      })
      await waitForResponses(5)

      child.kill()

      const lines = stdout.split('\n').filter((l) => l.trim().length > 0)
      assert.ok(lines.length >= 5, 'expected at least five response lines')
      for (const line of lines) {
        const parsed = JSON.parse(line) // throws if a non-JSON line ever appears
        assert.equal(parsed.jsonrpc, '2.0')
      }
    } finally {
      await rm(purityHome, { recursive: true, force: true })
    }
  })
})
