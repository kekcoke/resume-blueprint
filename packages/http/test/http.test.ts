import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { createServer } from '../dist/server.js'
import { loadConfig } from '../dist/config.js'
import { MAX_CONCURRENT_RENDERS } from '../dist/renderLimit.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(HERE, '..', '..', '..', 'fixtures')

async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(FIXTURES, name), 'utf8'))
}

/** Recursively lists every file under `dir`, relative to `dir`, sorted. */
async function listFilesRecursive(dir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  const out: string[] = []
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else {
        out.push(relative(dir, full))
      }
    }
  }
  await walk(dir)
  return out.sort()
}

interface Harness {
  baseUrl: string
  server: Server
  close: () => Promise<void>
}

/** Starts a server on an ephemeral port with the given env overrides applied for its lifetime. */
async function startServer(envOverrides: Record<string, string | undefined>): Promise<Harness> {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(envOverrides)) {
    saved[key] = process.env[key]
    const value = envOverrides[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  const config = loadConfig()
  const server = createServer(config)

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.on('error', rejectPromise)
    server.listen(config.port, config.bind, () => resolvePromise())
  })

  const address = server.address() as AddressInfo
  const baseUrl = `http://${config.bind}:${address.port}`

  const close = async (): Promise<void> => {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }

  return { baseUrl, server, close }
}

let dir: string
let harness: Harness

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'resume-blueprint-http-test-'))
})

afterEach(async () => {
  await harness?.close()
  await rm(dir, { recursive: true, force: true })
})

describe('POST /render', () => {
  test('renders a valid blueprint to PDF bytes', async () => {
    harness = await startServer({ RESUME_BLUEPRINT_HOME: dir, RESUME_BLUEPRINT_PORT: '0' })
    const sample = await readFixture('sample.json')

    const res = await fetch(`${harness.baseUrl}/render`, {
      method: 'POST',
      body: JSON.stringify(sample)
    })

    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'application/pdf')
    const buf = Buffer.from(await res.arrayBuffer())
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-')
  })
})

describe('CRUD + delete round-trip', () => {
  test('create, get, patch, list, delete', async () => {
    harness = await startServer({ RESUME_BLUEPRINT_HOME: dir, RESUME_BLUEPRINT_PORT: '0' })

    const createRes = await fetch(`${harness.baseUrl}/blueprints`, {
      method: 'POST',
      body: JSON.stringify({ id: 'x' })
    })
    assert.equal(createRes.status, 201)
    const created = (await createRes.json()) as { id: string; rev: string }
    assert.equal(created.id, 'x')
    assert.ok(created.rev)
    assert.equal(createRes.headers.get('location'), '/blueprints/x')

    const getRes = await fetch(`${harness.baseUrl}/blueprints/x`)
    assert.equal(getRes.status, 200)
    const got = (await getRes.json()) as { blueprint: unknown; rev: string }
    assert.equal(got.rev, created.rev)

    const patchRes = await fetch(`${harness.baseUrl}/blueprints/x`, {
      method: 'PATCH',
      body: JSON.stringify({ patch: { basics: { name: 'Ada Lovelace' } } })
    })
    assert.equal(patchRes.status, 200)
    const patched = (await patchRes.json()) as { id: string; rev: string }
    assert.notEqual(patched.rev, created.rev)

    const listRes = await fetch(`${harness.baseUrl}/blueprints`)
    assert.equal(listRes.status, 200)
    const list = (await listRes.json()) as Array<{ id: string }>
    assert.ok(list.some((b) => b.id === 'x'))

    const deleteRes = await fetch(`${harness.baseUrl}/blueprints/x`, { method: 'DELETE' })
    assert.equal(deleteRes.status, 200)
    const deleted = (await deleteRes.json()) as { id: string; rev: string }
    assert.equal(deleted.id, 'x')

    const getAfterRes = await fetch(`${harness.baseUrl}/blueprints/x`)
    assert.equal(getAfterRes.status, 404)
  })
})

describe('error responses', () => {
  test('malformed JSON body returns 400 with readable error', async () => {
    harness = await startServer({ RESUME_BLUEPRINT_HOME: dir, RESUME_BLUEPRINT_PORT: '0' })

    const res = await fetch(`${harness.baseUrl}/blueprints`, {
      method: 'POST',
      body: '{not json'
    })
    assert.equal(res.status, 400)
    const body = (await res.json()) as { error: string }
    assert.ok(body.error.length > 0)
  })

  test('invalid blueprint returns 400 with validation error text', async () => {
    harness = await startServer({ RESUME_BLUEPRINT_HOME: dir, RESUME_BLUEPRINT_PORT: '0' })

    const res = await fetch(`${harness.baseUrl}/blueprints`, {
      method: 'POST',
      body: JSON.stringify({ id: 'bad', blueprint: { basics: { name: 123 } } })
    })
    assert.equal(res.status, 400)
    const body = (await res.json()) as { error: string }
    assert.notEqual(body.error, 'internal error')
    assert.ok(body.error.length > 0)
  })
})

describe('auth', () => {
  test('token gate rejects/accepts, healthz always exempt', async () => {
    harness = await startServer({
      RESUME_BLUEPRINT_HOME: dir,
      RESUME_BLUEPRINT_PORT: '0',
      RESUME_BLUEPRINT_TOKEN: 'secret-token'
    })

    const unauthedRes = await fetch(`${harness.baseUrl}/blueprints`)
    assert.equal(unauthedRes.status, 401)
    const unauthedBody = (await unauthedRes.json()) as { error: string }
    assert.equal(unauthedBody.error, 'unauthorized')

    const authedRes = await fetch(`${harness.baseUrl}/blueprints`, {
      headers: { Authorization: 'Bearer secret-token' }
    })
    assert.equal(authedRes.status, 200)

    const healthRes = await fetch(`${harness.baseUrl}/healthz`)
    assert.equal(healthRes.status, 200)

    // Trailing slash must be exempt too: the router is trailing-slash
    // tolerant (segments computed via split('/').filter(Boolean)), so
    // /healthz/ resolves to the same route and must not require auth.
    const healthSlashRes = await fetch(`${harness.baseUrl}/healthz/`, {
      headers: {} // deliberately no Authorization header
    })
    assert.equal(healthSlashRes.status, 200)
  })
})

describe('bind', () => {
  test('defaults to loopback', async () => {
    harness = await startServer({ RESUME_BLUEPRINT_HOME: dir, RESUME_BLUEPRINT_PORT: '0' })
    const address = harness.server.address() as AddressInfo
    assert.equal(address.address, '127.0.0.1')
  })
})

describe('security', () => {
  test('POST /render with injection fixture is stateless and neutralized', async () => {
    harness = await startServer({ RESUME_BLUEPRINT_HOME: dir, RESUME_BLUEPRINT_PORT: '0' })
    const injection = await readFixture('injection.json')

    const before = await listFilesRecursive(dir)

    const res = await fetch(`${harness.baseUrl}/render`, {
      method: 'POST',
      body: JSON.stringify(injection)
    })

    assert.equal(res.status, 200)
    const buf = Buffer.from(await res.arrayBuffer())
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-')

    const after = await listFilesRecursive(dir)
    assert.deepEqual(after, before, 'POST /render must not write to the store')
  })
})

describe('resource limits', () => {
  test('body over 5MB returns 413', async () => {
    harness = await startServer({ RESUME_BLUEPRINT_HOME: dir, RESUME_BLUEPRINT_PORT: '0' })

    const big = Buffer.alloc(6 * 1024 * 1024, 'a').toString()
    const res = await fetch(`${harness.baseUrl}/blueprints`, {
      method: 'POST',
      body: JSON.stringify({ id: 'big', blueprint: { basics: { summary: big } } })
    })
    assert.equal(res.status, 413)
    await res.text() // drain the body, matching every other test in this file
  })

  test('deeply nested patch is rejected cleanly, not a crash', async () => {
    harness = await startServer({ RESUME_BLUEPRINT_HOME: dir, RESUME_BLUEPRINT_PORT: '0' })

    await fetch(`${harness.baseUrl}/blueprints`, {
      method: 'POST',
      body: JSON.stringify({ id: 'deep' })
    })

    let deep: unknown = { value: 1 }
    for (let i = 0; i < 1000; i++) {
      deep = { nested: deep }
    }

    const res = await fetch(`${harness.baseUrl}/blueprints/deep`, {
      method: 'PATCH',
      body: JSON.stringify({ patch: deep })
    })
    assert.equal(res.status, 400)
    const body = (await res.json()) as { error: string }
    assert.match(body.error, /nested too deeply/)
  })
})

describe('render concurrency cap', () => {
  test('excess concurrent renders get 503, the rest still produce valid PDFs', async () => {
    harness = await startServer({ RESUME_BLUEPRINT_HOME: dir, RESUME_BLUEPRINT_PORT: '0' })
    const sample = await readFixture('sample.json')

    const totalRequests = MAX_CONCURRENT_RENDERS + 11 // 15 when the cap is 4
    const responses = await Promise.all(
      Array.from({ length: totalRequests }, () =>
        fetch(`${harness.baseUrl}/render`, { method: 'POST', body: JSON.stringify(sample) })
      )
    )

    const succeeded = responses.filter((res) => res.status === 200)
    const throttled = responses.filter((res) => res.status === 503)

    assert.ok(succeeded.length > 0, 'expected at least one 200')
    assert.ok(throttled.length > 0, 'expected at least one 503 once the cap is exceeded')
    assert.equal(succeeded.length + throttled.length, totalRequests, 'no other status codes expected')
    assert.ok(succeeded.length <= totalRequests, 'sanity: cannot succeed more than requested')

    for (const res of throttled) {
      assert.equal(res.headers.get('retry-after'), '5')
      const body = (await res.json()) as { error: string }
      assert.equal(body.error, 'too many concurrent renders, try again shortly')
    }

    for (const res of succeeded) {
      assert.equal(res.headers.get('content-type'), 'application/pdf')
      const buf = Buffer.from(await res.arrayBuffer())
      assert.equal(buf.subarray(0, 5).toString(), '%PDF-')
    }
  })
})

describe('conflicts', () => {
  test('stale expectedRev on patch returns 409', async () => {
    harness = await startServer({ RESUME_BLUEPRINT_HOME: dir, RESUME_BLUEPRINT_PORT: '0' })

    const createRes = await fetch(`${harness.baseUrl}/blueprints`, {
      method: 'POST',
      body: JSON.stringify({ id: 'conf' })
    })
    const created = (await createRes.json()) as { rev: string }

    const firstPatch = await fetch(`${harness.baseUrl}/blueprints/conf`, {
      method: 'PATCH',
      body: JSON.stringify({ patch: { basics: { name: 'First' } } })
    })
    assert.equal(firstPatch.status, 200)

    const stalePatch = await fetch(`${harness.baseUrl}/blueprints/conf`, {
      method: 'PATCH',
      body: JSON.stringify({ patch: { basics: { name: 'Second' } }, expectedRev: created.rev })
    })
    assert.equal(stalePatch.status, 409)
  })

  test('creating a duplicate id returns 409', async () => {
    harness = await startServer({ RESUME_BLUEPRINT_HOME: dir, RESUME_BLUEPRINT_PORT: '0' })

    const first = await fetch(`${harness.baseUrl}/blueprints`, {
      method: 'POST',
      body: JSON.stringify({ id: 'dup' })
    })
    assert.equal(first.status, 201)

    const second = await fetch(`${harness.baseUrl}/blueprints`, {
      method: 'POST',
      body: JSON.stringify({ id: 'dup' })
    })
    assert.equal(second.status, 409)
  })
})
