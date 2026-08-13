import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

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

describe('stdout purity', () => {
  test('stdout carries only JSON-RPC frames across a session', async () => {
    const purityHome = await mkdtemp(join(tmpdir(), 'resume-blueprint-mcp-purity-'))
    try {
      const child: ChildProcessWithoutNullStreams = spawn('node', [DIST_INDEX_PATH], {
        env: { ...process.env, RESUME_BLUEPRINT_HOME: purityHome },
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stdout = ''
      child.stdout.on('data', (chunk) => (stdout += chunk.toString('utf8')))

      const send = (message: unknown) => {
        child.stdin.write(JSON.stringify(message) + '\n')
      }

      const waitForResponses = (count: number, timeoutMs = 15_000): Promise<void> =>
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

      child.kill()

      const lines = stdout.split('\n').filter((l) => l.trim().length > 0)
      assert.ok(lines.length >= 2, 'expected at least two response lines')
      for (const line of lines) {
        const parsed = JSON.parse(line) // throws if a non-JSON line ever appears
        assert.equal(parsed.jsonrpc, '2.0')
      }
    } finally {
      await rm(purityHome, { recursive: true, force: true })
    }
  })
})
