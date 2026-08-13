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
  resume_history: true,
  resume_diff: true,
  resume_revert: false,
  resume_templates: true
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
  test('lists all 15 tools with descriptions and matching readOnlyHint', async () => {
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

describe('invalid tool args', () => {
  test('resume_get with no id produces a structured error, not a crash', async () => {
    const result = await client.callTool({ name: 'resume_get', arguments: {} })
    assert.equal(result.isError, true)
    assert.ok(Array.isArray(result.content) && result.content.length > 0)
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

    const structured = rendered.structuredContent as { path: string; pageCount: number; byteSize: number }
    assert.ok(existsSync(structured.path), `expected a file at ${structured.path}`)
    assert.ok(structured.pageCount >= 1)

    const stats = await stat(structured.path)
    assert.equal(structured.byteSize, stats.size)
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
