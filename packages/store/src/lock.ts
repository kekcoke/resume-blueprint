import { mkdir, open, unlink } from 'node:fs/promises'
import { unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { LockTimeoutError } from './errors.js'

/**
 * A per-key mutex over the repo at `key` (the resolved `RESUME_BLUEPRINT_HOME`
 * absolute path, not per-blueprint id — the shared resource is the repo's
 * index/HEAD, so two concurrent mutations to *different* blueprint ids still
 * both touch `git add`/`git commit` against the same repo state).
 *
 * Two layers, composed:
 *
 * 1. An in-process FIFO queue (`queues`, below). Free — no syscalls — so N
 *    same-process callers serialize in memory before any of them touches the
 *    filesystem.
 * 2. A cross-process exclusive-file lock at `<home>/.store.lock`, entered only
 *    by whichever call the in-process queue lets run next. Implemented as
 *    `open(path, 'wx')` (`O_CREAT|O_EXCL`) — the same atomic test-and-create
 *    primitive git's own `index.lock` uses, chosen deliberately over `flock`:
 *    `flock(1)` is a Linux util-linux tool absent on macOS, and `flock(2)` has
 *    no Node binding without a native addon. This file is distinct from git's
 *    real `.git/index.lock` (which `commitFile()`'s `git add`/`git commit`
 *    calls already touch) so the two never race each other.
 *
 * Contention waits with capped exponential backoff up to `LOCK_TIMEOUT_MS`,
 * then throws `LockTimeoutError`. There is deliberately no stale-lock
 * auto-recovery (no PID-liveness check, no mtime-based steal): if a process is
 * killed while holding the lock, every later caller waits out the timeout and
 * gets a `LockTimeoutError` naming the exact file to inspect and, if genuinely
 * orphaned, delete — the same fail-fast UX git itself has for a stuck
 * `index.lock`. A best-effort `process.on('exit', ...)` hook below covers
 * graceful termination (e.g. Ctrl-C mid-commit); it cannot and does not try to
 * cover `SIGKILL` or a hard crash.
 */
const queues = new Map<string, Promise<unknown>>()

const LOCK_FILE_NAME = '.store.lock'
const LOCK_POLL_INITIAL_MS = 20 // common-case contention resolves in tens of ms
const LOCK_POLL_MAX_MS = 200 // cap growth so a longer wait doesn't busy-loop the filesystem
const LOCK_TIMEOUT_MS = 35_000 // ~5s margin over git.ts's own 30_000ms per-subprocess timeout

let lockTiming = {
  timeoutMs: LOCK_TIMEOUT_MS,
  pollInitialMs: LOCK_POLL_INITIAL_MS,
  pollMaxMs: LOCK_POLL_MAX_MS
}

/**
 * Test-only: shrinks the timing constants so the contention/timeout paths can
 * be exercised without a real ~35s wait. Not part of the package's public
 * surface — never re-exported from `index.ts`.
 */
export function __configureLockTimingForTests(overrides: {
  timeoutMs?: number
  pollInitialMs?: number
  pollMaxMs?: number
}): void {
  lockTiming = { ...lockTiming, ...overrides }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Lock files this process currently holds, drained on exit as a best-effort
// cleanup for graceful termination paths (see doc comment above).
const activeLocks = new Set<string>()

process.on('exit', () => {
  for (const lockPath of activeLocks) {
    try {
      unlinkSync(lockPath)
    } catch {
      // Best-effort: nothing more to do at exit time.
    }
  }
})

async function acquireLock(lockPath: string): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true })
  const deadline = Date.now() + lockTiming.timeoutMs
  let delay = lockTiming.pollInitialMs
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx')
      try {
        await handle.writeFile(
          `pid=${process.pid}\nstarted=${new Date().toISOString()}\n`
        )
      } finally {
        await handle.close()
      }
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new LockTimeoutError(
          `timed out after ${lockTiming.timeoutMs}ms waiting for the store lock at ${lockPath}. ` +
            `If no other resume-blueprint process is running, this is a stale lock left ` +
            `behind by a killed process — delete the file and retry.`,
          lockPath
        )
      }
      await sleep(Math.min(delay, remaining))
      delay = Math.min(delay * 2, lockTiming.pollMaxMs)
    }
  }
}

async function releaseLock(lockPath: string): Promise<void> {
  await unlink(lockPath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  })
}

async function withProcessLock<T>(
  home: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockPath = join(home, LOCK_FILE_NAME)
  await acquireLock(lockPath)
  activeLocks.add(lockPath)
  try {
    return await fn()
  } finally {
    activeLocks.delete(lockPath)
    await releaseLock(lockPath)
  }
}

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const run = previous.then(() => withProcessLock(key, fn))
  // The queued continuation must never itself be a rejected promise, or every
  // later caller waiting on this key would inherit this call's failure instead
  // of getting its own turn.
  queues.set(
    key,
    run.catch(() => undefined)
  )
  return run
}
