// Proves the cross-process store lock actually works, not just the
// in-process FIFO queue: every process spawned here is a genuine separate OS
// process, sharing only RESUME_BLUEPRINT_HOME with the parent — exactly the
// "long-lived MCP server plus a CLI/HTTP call" scenario F11 was written
// against. Kept in its own file, separate from lock.test.ts, because it
// spawns real processes and needs a materially larger per-test timeout.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import * as store from '../dist/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = join(__dirname, 'fixtures', 'child-mutate.mjs')

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'resume-blueprint-cross-process-test-'))
  process.env.RESUME_BLUEPRINT_HOME = dir
})

afterEach(async () => {
  delete process.env.RESUME_BLUEPRINT_HOME
  await rm(dir, { recursive: true, force: true })
})

interface ChildResult {
  code: number | null
  stdout: { ok: boolean; rev?: string; error?: string } | undefined
}

function runChild(args: string[]): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture, ...args], {
      env: { ...process.env, RESUME_BLUEPRINT_HOME: dir }
    })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const line = out.trim().split('\n').pop()
      let parsed: ChildResult['stdout']
      try {
        parsed = line ? JSON.parse(line) : undefined
      } catch {
        parsed = undefined
      }
      resolve({ code, stdout: parsed })
    })
  })
}

describe('conflicting concurrent patches from two real processes', () => {
  test('exactly one succeeds, the other conflicts, nothing is torn', { timeout: 20_000 }, async () => {
    const { rev: baseRev } = await store.create('default', {
      basics: { name: 'seed' },
      selectedTemplate: 1
    })

    // Fire both children before awaiting either, so they race for real.
    const childA = runChild(['patch', 'default', 'child-a', baseRev])
    const childB = runChild(['patch', 'default', 'child-b', baseRev])
    const [a, b] = await Promise.all([childA, childB])

    const results = [a, b]
    const succeeded = results.filter((r) => r.stdout?.ok)
    const failed = results.filter((r) => !r.stdout?.ok)

    assert.equal(succeeded.length, 1, `expected exactly one success, got ${JSON.stringify(results)}`)
    assert.equal(failed.length, 1)
    assert.equal(failed[0].code, 1)
    assert.equal(failed[0].stdout?.error, 'ConflictError')

    const { blueprint } = await store.get('default')
    assert.ok(
      blueprint.basics?.name === 'child-a' || blueprint.basics?.name === 'child-b',
      `expected the winner's name on disk, got ${JSON.stringify(blueprint.basics?.name)}`
    )

    const commits = await store.history('default')
    assert.equal(commits.length, 2, 'create + exactly one winning patch')
  })
})

describe('unconstrained concurrent appends from many real processes', () => {
  test('every append lands — no losses, no duplicates, no torn writes', { timeout: 20_000 }, async () => {
    const N = 8
    await store.create('stress', { basics: { name: 'seed' }, selectedTemplate: 1, work: [] })

    const children = Array.from({ length: N }, (_, i) => runChild(['append', 'stress', `worker-${i}`]))
    const results = await Promise.all(children)

    for (const [i, result] of results.entries()) {
      assert.equal(result.code, 0, `worker-${i} should succeed: ${JSON.stringify(result)}`)
      assert.equal(result.stdout?.ok, true, `worker-${i}: ${JSON.stringify(result)}`)
    }

    const { blueprint } = await store.get('stress')
    const names = (blueprint.work ?? []).map((entry) => entry.name)
    const expected = Array.from({ length: N }, (_, i) => `worker-${i}`)
    assert.equal(names.length, N, `expected ${N} entries, got ${JSON.stringify(names)}`)
    assert.deepEqual([...names].sort(), [...expected].sort(), 'every worker\'s append must land exactly once')

    const commits = await store.history('stress', N + 5)
    assert.equal(commits.length, N + 1, 'create + one commit per worker append')
  })
})
