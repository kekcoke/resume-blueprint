import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseBlueprint } from '@resume-blueprint/core'
import type { Blueprint, SectionName } from '@resume-blueprint/core'

import { git, GitError } from './git.js'
import { ensureRepo } from './repo.js'
import { applyMergePatch } from './mergePatch.js'
import { withLock } from './lock.js'
import {
  resolveHome,
  blueprintPath,
  blueprintRelPath,
  assertValidRev
} from './paths.js'
import {
  ConflictError,
  NotFoundError,
  AlreadyExistsError,
  InvalidActorError
} from './errors.js'
import type { BlueprintSummary, Commit } from './types.js'

export {
  ConflictError,
  NotFoundError,
  InvalidIdError,
  InvalidRevError,
  AlreadyExistsError,
  InvalidActorError,
  LockTimeoutError
} from './errors.js'
export { GitError } from './git.js'
export type { BlueprintSummary, Commit } from './types.js'

export interface MutationOpts {
  /** Who is making this change, folded into the commit message. Defaults to `'store'`. */
  actor?: string
  /**
   * Optimistic concurrency guard: the caller's last-known rev. If the
   * blueprint has moved on since, the mutation is rejected with
   * {@link ConflictError} and nothing is written.
   */
  expectedRev?: string
}

const FIELD_SEP = '\x1f' // ASCII unit separator, unlikely to appear in a commit subject

function serialize(blueprint: Blueprint): string {
  return JSON.stringify(blueprint, null, 2) + '\n'
}

/** Reads and validates a blueprint file. Throws `NotFoundError` if it does not exist. */
async function readBlueprint(id: string, path: string): Promise<unknown> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NotFoundError(`blueprint "${id}" does not exist`)
    }
    throw error
  }
}

/**
 * The blueprint's current per-file rev: the SHA of the most recent commit that
 * touched `blueprints/<id>.json`. Throws `NotFoundError` if the file does not
 * currently exist (note a path-scoped `git log` alone can't tell "never
 * existed" apart from "existed, then was removed" — the removal commit still
 * shows up — so existence is checked on disk first).
 */
async function currentRev(
  home: string,
  id: string,
  path: string
): Promise<string> {
  try {
    await stat(path)
  } catch {
    throw new NotFoundError(`blueprint "${id}" does not exist`)
  }
  const out = await git(home, [
    'log',
    '-1',
    '--format=%H',
    '--',
    blueprintRelPath(id)
  ])
  const rev = out.trim()
  if (!rev) {
    throw new NotFoundError(`blueprint "${id}" does not exist`)
  }
  return rev
}

function checkExpectedRev(
  id: string,
  expectedRev: string | undefined,
  rev: string
): void {
  if (expectedRev !== undefined && expectedRev !== rev) {
    throw new ConflictError(
      `blueprint "${id}" changed since rev ${expectedRev} (now at ${rev})`
    )
  }
}

/**
 * `actor` is interpolated into commit messages that `history()` later parses
 * back apart using `FIELD_SEP` as a delimiter (see below). A control
 * character in `actor` — the `FIELD_SEP` byte itself, or a newline that
 * `git log --format` would emit as a literal line break — could desync that
 * parsing. Reject up front rather than trying to strip/escape.
 */
function assertValidActor(actor: string | undefined): void {
  if (actor !== undefined && /[\x00-\x1f\x7f]/.test(actor)) {
    throw new InvalidActorError(
      `invalid actor "${JSON.stringify(actor)}": must not contain control characters`
    )
  }
}

/** `git add` + `git commit` + `git rev-parse HEAD` for a single blueprint file. */
async function commitFile(
  home: string,
  id: string,
  message: string
): Promise<{ rev: string }> {
  const rel = blueprintRelPath(id)
  await git(home, ['add', rel])

  // "nothing to commit" (byte-identical content) is a legitimate no-op, not
  // an error: detect it before committing and return the current rev rather
  // than letting git's non-zero exit propagate as a raw GitError.
  const changed = await hasStagedChanges(home, rel)
  if (!changed) {
    const rev = (await git(home, ['rev-parse', 'HEAD'])).trim()
    return { rev }
  }

  await git(home, ['commit', '-m', message])
  const rev = (await git(home, ['rev-parse', 'HEAD'])).trim()
  return { rev }
}

/** True if `rel` has staged changes relative to HEAD (or relative to the empty tree, pre-first-commit). */
async function hasStagedChanges(home: string, rel: string): Promise<boolean> {
  try {
    await git(home, ['diff', '--cached', '--quiet', '--', rel])
    return false // exit 0: no differences
  } catch (error) {
    if (error instanceof GitError) return true // exit 1: differences staged
    throw error
  }
}

function commitMessage(
  op: string,
  id: string,
  actor: string | undefined
): string {
  return `${op}(${id}) via ${actor ?? 'store'}`
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Same as `ensureRepo`, but under the repo-wide lock — used by read paths so a
 * concurrent first-use read and write can't both race `git init`. */
async function ensureRepoLocked(home: string): Promise<void> {
  await withLock(home, () => ensureRepo(home))
}

/** Reads the array a section name addresses. `'profile'` maps to `basics.profiles`. */
function readSectionArray(
  blueprint: Record<string, unknown>,
  section: SectionName
): unknown[] {
  if (section === 'profile') {
    const basics =
      (blueprint.basics as Record<string, unknown> | undefined) ?? {}
    return [...((basics.profiles as unknown[] | undefined) ?? [])]
  }
  return [...((blueprint[section] as unknown[] | undefined) ?? [])]
}

/** Writes a mutated section array back into a (shallow-copied) blueprint object. */
function writeSectionArray(
  blueprint: Record<string, unknown>,
  section: SectionName,
  arr: unknown[]
): Record<string, unknown> {
  if (section === 'profile') {
    const basics =
      (blueprint.basics as Record<string, unknown> | undefined) ?? {}
    return { ...blueprint, basics: { ...basics, profiles: arr } }
  }
  return { ...blueprint, [section]: arr }
}

/**
 * Runs the whole read -> mutate -> validate -> write -> commit sequence for a
 * mutating call, inside the repo-wide lock. `expectedRev` is checked against a
 * rev read fresh from disk *after* the lock is acquired (not one captured
 * before entering the queue), which is what makes two concurrent mutations
 * against the same starting rev resolve deterministically: whichever runs
 * first inside the lock wins, and the second sees the moved rev and conflicts.
 */
async function mutate(
  id: string,
  op: string,
  opts: MutationOpts,
  transform: (current: unknown) => unknown
): Promise<{ rev: string }> {
  assertValidActor(opts.actor)
  const home = resolveHome()
  return withLock(home, async () => {
    await ensureRepo(home)
    const path = blueprintPath(home, id)

    const rev = await currentRev(home, id, path)
    checkExpectedRev(id, opts.expectedRev, rev)

    const current = await readBlueprint(id, path)
    const merged = transform(current)
    const parsed = parseBlueprint(merged) // throws on invalid; nothing written yet

    await writeFile(path, serialize(parsed), 'utf8')
    return commitFile(home, id, commitMessage(op, id, opts.actor))
  })
}

export async function list(): Promise<BlueprintSummary[]> {
  const home = resolveHome()
  await ensureRepoLocked(home)

  const dir = join(home, 'blueprints')
  const entries = await readdir(dir).catch(() => [] as string[])

  const summaries: BlueprintSummary[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const id = entry.slice(0, -'.json'.length)
    // One malformed file shouldn't take down the whole listing.
    try {
      const raw = await readFile(join(dir, entry), 'utf8')
      const blueprint = parseBlueprint(JSON.parse(raw))
      const [latest] = await history(id, 1)
      summaries.push({
        id,
        name: blueprint.basics?.name,
        updatedAt: latest?.date ?? '',
        rev: latest?.rev ?? ''
      })
    } catch {
      continue
    }
  }
  return summaries
}

export async function get(
  id: string
): Promise<{ blueprint: Blueprint; rev: string }> {
  const home = resolveHome()
  // Locked so the (blueprint, rev) pair read back is always consistent — a
  // mutation can't land between the content read and the rev read.
  return withLock(home, async () => {
    await ensureRepo(home)
    const path = blueprintPath(home, id)

    const raw = await readBlueprint(id, path)
    const rev = await currentRev(home, id, path)
    return { blueprint: parseBlueprint(raw), rev }
  })
}

export async function create(
  id: string,
  blueprint: unknown = {},
  opts: MutationOpts = {}
): Promise<{ rev: string }> {
  assertValidActor(opts.actor)
  const home = resolveHome()
  return withLock(home, async () => {
    await ensureRepo(home)
    const path = blueprintPath(home, id)
    if (await fileExists(path)) {
      throw new AlreadyExistsError(`blueprint "${id}" already exists`)
    }
    const parsed = parseBlueprint(blueprint)
    await writeFile(path, serialize(parsed), 'utf8')
    return commitFile(home, id, commitMessage('create', id, opts.actor))
  })
}

export function patch(
  id: string,
  mergePatch: unknown,
  opts: MutationOpts = {}
): Promise<{ rev: string }> {
  return mutate(id, 'patch', opts, (current) =>
    applyMergePatch(current, mergePatch)
  )
}

export function sectionAppend(
  id: string,
  section: SectionName,
  item: unknown,
  opts: MutationOpts = {}
): Promise<{ rev: string }> {
  return mutate(id, 'sectionAppend', opts, (current) => {
    const blueprint = current as Record<string, unknown>
    const arr = readSectionArray(blueprint, section)
    arr.push(item)
    return writeSectionArray(blueprint, section, arr)
  })
}

export function sectionUpdate(
  id: string,
  section: SectionName,
  index: number,
  item: unknown,
  opts: MutationOpts = {}
): Promise<{ rev: string }> {
  return mutate(id, 'sectionUpdate', opts, (current) => {
    const blueprint = current as Record<string, unknown>
    const arr = readSectionArray(blueprint, section)
    if (index < 0 || index >= arr.length) {
      throw new NotFoundError(
        `section "${section}" of blueprint "${id}" has no item at index ${index}`
      )
    }
    arr[index] = item
    return writeSectionArray(blueprint, section, arr)
  })
}

export function sectionRemove(
  id: string,
  section: SectionName,
  index: number,
  opts: MutationOpts = {}
): Promise<{ rev: string }> {
  return mutate(id, 'sectionRemove', opts, (current) => {
    const blueprint = current as Record<string, unknown>
    const arr = readSectionArray(blueprint, section)
    if (index < 0 || index >= arr.length) {
      throw new NotFoundError(
        `section "${section}" of blueprint "${id}" has no item at index ${index}`
      )
    }
    arr.splice(index, 1)
    return writeSectionArray(blueprint, section, arr)
  })
}

export async function remove(
  id: string,
  opts: MutationOpts = {}
): Promise<{ rev: string }> {
  assertValidActor(opts.actor)
  const home = resolveHome()
  return withLock(home, async () => {
    await ensureRepo(home)
    const path = blueprintPath(home, id)
    const rev = await currentRev(home, id, path) // throws NotFoundError if it doesn't exist
    checkExpectedRev(id, opts.expectedRev, rev)
    await git(home, ['rm', '--quiet', blueprintRelPath(id)])
    await git(home, ['commit', '-m', commitMessage('remove', id, opts.actor)])
    const newRev = (await git(home, ['rev-parse', 'HEAD'])).trim()
    return { rev: newRev }
  })
}

/**
 * Throws `NotFoundError` if `id` was never created — distinguished from
 * "exists but has zero commits" (unreachable: `create` always commits) by
 * whether the path-scoped `git log` produced any output at all. A removed
 * blueprint still has commits under this path (create + remove), so its
 * history remains retrievable even though the file no longer exists on disk.
 */
export async function history(id: string, limit = 50): Promise<Commit[]> {
  const home = resolveHome()
  await ensureRepoLocked(home)
  const rel = blueprintRelPath(id)

  let out: string
  try {
    out = await git(home, [
      'log',
      `-n${limit}`,
      `--format=%H${FIELD_SEP}%cI${FIELD_SEP}%s`,
      '--',
      rel
    ])
  } catch (error) {
    if (error instanceof GitError) {
      throw new NotFoundError(`blueprint "${id}" does not exist`)
    }
    throw error
  }

  const commits = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [rev, date, message] = line.split(FIELD_SEP)
      return { rev, date, message }
    })

  if (commits.length === 0) {
    throw new NotFoundError(`blueprint "${id}" does not exist`)
  }

  return commits
}

export async function diff(
  id: string,
  revA: string,
  revB?: string
): Promise<string> {
  assertValidRev(revA)
  if (revB !== undefined) assertValidRev(revB)

  const home = resolveHome()
  await ensureRepoLocked(home)
  const path = blueprintPath(home, id)
  const rel = blueprintRelPath(id)
  const targetB = revB ?? (await currentRev(home, id, path))
  assertValidRev(targetB) // re-validate the default too: belt-and-suspenders
  return git(home, ['diff', revA, targetB, '--', rel])
}

/**
 * Restores a blueprint to its content at `rev`, as a **new** commit — never
 * rewrites history. Implemented as read-old-content-then-write-then-commit
 * rather than `git revert`, which is built for three-way-merging a commit's
 * *changes* and handles conflicts this simple restore doesn't need.
 */
export async function revert(
  id: string,
  rev: string,
  opts: MutationOpts = {}
): Promise<{ rev: string }> {
  assertValidRev(rev)
  assertValidActor(opts.actor)
  const home = resolveHome()
  return withLock(home, async () => {
    await ensureRepo(home)
    const path = blueprintPath(home, id)
    const rel = blueprintRelPath(id)

    const current = await currentRev(home, id, path) // throws NotFoundError if it doesn't exist
    checkExpectedRev(id, opts.expectedRev, current)

    let raw: string
    try {
      raw = await git(home, ['show', `${rev}:${rel}`])
    } catch (error) {
      if (error instanceof GitError) {
        throw new NotFoundError(
          `revision "${rev}" of blueprint "${id}" not found`
        )
      }
      throw error
    }

    const parsed = parseBlueprint(JSON.parse(raw))
    await writeFile(path, serialize(parsed), 'utf8')
    return commitFile(home, id, commitMessage('revert', id, opts.actor))
  })
}
