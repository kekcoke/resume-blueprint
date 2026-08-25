import { mkdir, writeFile, readdir, stat, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** `renders/`, sibling to `blueprints/`, under the store's home directory. */
export function renderDir(home: string): string {
  return join(home, 'renders')
}

/** Filename (not a full path) for a render — join with `renderDir(home)`. */
export function renderPath(id: string, rev: string, template: number): string {
  return `${id}-${rev.slice(0, 7)}-t${template}.pdf`
}

/**
 * Writes PDF bytes to `path`, creating the `renders/` directory (and a
 * `.gitignore` inside it, on first use) if needed. `renders/` sits outside
 * anything the store's git operations touch — store only ever `git add
 * blueprints/<id>.json`, never `-A` — but the `.gitignore` keeps `git status`
 * clean for a human inspecting the store repo by hand.
 */
export async function writeRenderFile(
  pdf: Buffer,
  path: string
): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })

  const gitignore = join(dir, '.gitignore')
  if (!existsSync(gitignore)) {
    await writeFile(gitignore, '*\n', 'utf8')
  }

  await writeFile(path, pdf)
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

/**
 * Keeps only the `keep` most-recently-modified renders for `id`, deleting the
 * rest. `stat`/`unlink` on a candidate that's already gone (e.g. removed by a
 * concurrent prune of the same id) is not a failure for "keep the last N" —
 * ENOENT is swallowed rather than propagated. Callers should still prefer
 * serializing calls for the same `id` via {@link withRenderLock} so this
 * doesn't need to rely on ENOENT-swallowing alone.
 */
export async function pruneOldRenders(
  home: string,
  id: string,
  keep = 10
): Promise<void> {
  const dir = renderDir(home)

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }

  const prefix = `${id}-`
  const candidates = entries.filter(
    (entry) => entry.startsWith(prefix) && entry.endsWith('.pdf')
  )

  const stated = await Promise.all(
    candidates.map(async (name) => {
      const path = join(dir, name)
      try {
        const stats = await stat(path)
        return { path, mtimeMs: stats.mtimeMs }
      } catch (error) {
        if (isEnoent(error)) return null
        throw error
      }
    })
  )
  const withMtime = stated.filter(
    (entry): entry is { path: string; mtimeMs: number } => entry !== null
  )

  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const stale = withMtime.slice(keep)
  await Promise.all(
    stale.map(async (entry) => {
      try {
        await unlink(entry.path)
      } catch (error) {
        if (isEnoent(error)) return
        throw error
      }
    })
  )
}

/**
 * A per-id, in-process FIFO async mutex, same shape as store's own
 * `withLock` (`packages/store/src/lock.ts`) but implemented locally here —
 * `packages/store` is out of scope for this gate. Keyed by blueprint id
 * (not by home, unlike store's lock, which is keyed by home because it
 * guards the shared repo index/HEAD) because renders for different ids never
 * touch the same files on disk; only concurrent renders of the *same* id can
 * race `pruneOldRenders`'s readdir -> stat -> unlink sequence.
 */
const renderQueues = new Map<string, Promise<unknown>>()

export function withRenderLock<T>(
  id: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = renderQueues.get(id) ?? Promise.resolve()
  const run = previous.then(fn)
  // The queued continuation must never itself be a rejected promise, or every
  // later caller waiting on this id would inherit this call's failure
  // instead of getting its own turn.
  renderQueues.set(
    id,
    run.catch(() => undefined)
  )
  return run
}
