import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { withLock, __configureLockTimingForTests } from '../dist/lock.js'
import { LockTimeoutError } from '../dist/errors.js'

let dir: string
const lockPath = () => join(dir, '.store.lock')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'resume-blueprint-lock-test-'))
  __configureLockTimingForTests({ timeoutMs: 35_000, pollInitialMs: 20, pollMaxMs: 200 })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function lockFileExists(): Promise<boolean> {
  try {
    await stat(lockPath())
    return true
  } catch {
    return false
  }
}

describe('round-trip cleanup', () => {
  test('the lock file is gone after withLock resolves', async () => {
    const result = await withLock(dir, async () => {
      assert.ok(await lockFileExists(), 'lock file should exist while held')
      return 'done'
    })
    assert.equal(result, 'done')
    assert.equal(await lockFileExists(), false)
  })
})

describe('cleanup on throw', () => {
  test('the lock file is gone even when fn rejects', async () => {
    await assert.rejects(
      withLock(dir, async () => {
        throw new Error('boom')
      }),
      /boom/
    )
    assert.equal(await lockFileExists(), false)
  })
})

describe('lock file content', () => {
  test('carries this process pid and a parseable timestamp while held', async () => {
    await withLock(dir, async () => {
      const contents = await readFile(lockPath(), 'utf8')
      assert.match(contents, new RegExp(`pid=${process.pid}\\n`))
      const match = contents.match(/started=(.+)\n/)
      assert.ok(match, 'expected a started= timestamp line')
      assert.ok(!Number.isNaN(Date.parse(match![1])), 'started= value should be a parseable date')
    })
  })
})

describe('different keys', () => {
  test('do not block each other', async () => {
    const otherDir = await mkdtemp(join(tmpdir(), 'resume-blueprint-lock-test-'))
    try {
      const order: string[] = []
      let releaseA: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        releaseA = resolve
      })

      const a = withLock(dir, async () => {
        order.push('a-start')
        await gate
        order.push('a-end')
      })
      const b = withLock(otherDir, async () => {
        order.push('b-start')
        order.push('b-end')
      })

      // b, keyed by an unrelated home dir, should be able to finish while a
      // is still waiting on its gate — proves the two locks don't share state.
      await b
      assert.deepEqual(order, ['a-start', 'b-start', 'b-end'])
      releaseA()
      await a
      assert.deepEqual(order, ['a-start', 'b-start', 'b-end', 'a-end'])
    } finally {
      await rm(otherDir, { recursive: true, force: true })
    }
  })
})

describe('in-process FIFO ordering', () => {
  test('is unchanged by the cross-process layer', async () => {
    const order: string[] = []
    const first = withLock(dir, async () => {
      order.push('first-start')
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('first-end')
    })
    const second = withLock(dir, async () => {
      order.push('second-start')
      order.push('second-end')
    })
    await Promise.all([first, second])
    assert.deepEqual(order, ['first-start', 'first-end', 'second-start', 'second-end'])
  })
})

describe('stale-lock timeout', () => {
  test('withLock rejects with LockTimeoutError naming the file, and fn never runs', async () => {
    __configureLockTimingForTests({ timeoutMs: 200, pollInitialMs: 10, pollMaxMs: 20 })
    // Simulate a lock orphaned by a killed process.
    await writeFile(lockPath(), 'pid=1\nstarted=1970-01-01T00:00:00.000Z\n')

    let ran = false
    await assert.rejects(
      withLock(dir, async () => {
        ran = true
      }),
      (error: unknown) => {
        assert.ok(error instanceof LockTimeoutError)
        assert.equal((error as InstanceType<typeof LockTimeoutError>).lockFile, lockPath())
        return true
      }
    )
    assert.equal(ran, false)
  })
})
