import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseBlueprint } from '@resume-blueprint/core'
import type { Blueprint, SectionName } from '@resume-blueprint/core'

import { git, GitError } from './git.js'
import { ensureRepo } from './repo.js'
import { applyMergePatch } from './mergePatch.js'
import { withLock } from './lock.js'
import { resolveHome, blueprintPath, blueprintRelPath } from './paths.js'
import { ConflictError, NotFoundError, InvalidIdError } from './errors.js'
import type { BlueprintSummary, Commit } from './types.js'

export { ConflictError, NotFoundError, InvalidIdError } from './errors.js'
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
async function currentRev(home: string, id: string, path: string): Promise<string> {
  try {
    await stat(path)
  } catch {
    throw new NotFoundError(`blueprint "${id}" does not exist`)
  }
  const out = await git(home, ['log', '-1', '--format=%H', '--', blueprintRelPath(id)])
  const rev = out.trim()
  if (!rev) {
    throw new NotFoundError(`blueprint "${id}" does not exist`)
  }
  return rev
}

function checkExpectedRev(id: string, expectedRev: string | undefined, rev: string): void {
  if (expectedRev !== undefined && expectedRev !== rev) {
    throw new ConflictError(
      `blueprint "${id}" changed since rev ${expectedRev} (now at ${rev})`
    )
  }
}

/** `git add` + `git commit` + `git rev-parse HEAD` for a single blueprint file. */
async function commitFile(home: string, id: string, message: string): Promise<{ rev: string }> {
  await git(home, ['add', blueprintRelPath(id)])
  await git(home, ['commit', '-m', message])
  const rev = (await git(home, ['rev-parse', 'HEAD'])).trim()
  return { rev }
}

function commitMessage(op: string, id: string, actor: string | undefined): string {
  return `${op}(${id}) via ${actor ?? 'store'}`
}

/** Reads the array a section name addresses. `'profile'` maps to `basics.profiles`. */
function readSectionArray(blueprint: Record<string, unknown>, section: SectionName): unknown[] {
  if (section === 'profile') {
    const basics = (blueprint.basics as Record<string, unknown> | undefined) ?? {}
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
    const basics = (blueprint.basics as Record<string, unknown> | undefined) ?? {}
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
  await ensureRepo(home)

  const dir = join(home, 'blueprints')
  const entries = await readdir(dir).catch(() => [] as string[])

  const summaries: BlueprintSummary[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const id = entry.slice(0, -'.json'.length)
    const raw = await readFile(join(dir, entry), 'utf8')
    const blueprint = parseBlueprint(JSON.parse(raw))
    const [latest] = await history(id, 1)
    summaries.push({
      id,
      name: blueprint.basics?.name,
      updatedAt: latest?.date ?? '',
      rev: latest?.rev ?? ''
    })
  }
  return summaries
}

export async function get(id: string): Promise<{ blueprint: Blueprint; rev: string }> {
  const home = resolveHome()
  await ensureRepo(home)
  const path = blueprintPath(home, id)

  const raw = await readBlueprint(id, path)
  const rev = await currentRev(home, id, path)
  return { blueprint: parseBlueprint(raw), rev }
}

export async function create(
  id: string,
  blueprint: unknown = {},
  opts: MutationOpts = {}
): Promise<{ rev: string }> {
  const home = resolveHome()
  return withLock(home, async () => {
    await ensureRepo(home)
    const path = blueprintPath(home, id)
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
  return mutate(id, 'patch', opts, (current) => applyMergePatch(current, mergePatch))
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
      throw new NotFoundError(`section "${section}" of blueprint "${id}" has no item at index ${index}`)
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
      throw new NotFoundError(`section "${section}" of blueprint "${id}" has no item at index ${index}`)
    }
    arr.splice(index, 1)
    return writeSectionArray(blueprint, section, arr)
  })
}

export async function remove(id: string, opts: MutationOpts = {}): Promise<{ rev: string }> {
  const home = resolveHome()
  return withLock(home, async () => {
    await ensureRepo(home)
    const path = blueprintPath(home, id)
    await currentRev(home, id, path) // throws NotFoundError if it doesn't exist
    await git(home, ['rm', '--quiet', blueprintRelPath(id)])
    await git(home, ['commit', '-m', commitMessage('remove', id, opts.actor)])
    const rev = (await git(home, ['rev-parse', 'HEAD'])).trim()
    return { rev }
  })
}

export async function history(id: string, limit = 50): Promise<Commit[]> {
  const home = resolveHome()
  await ensureRepo(home)
  const rel = blueprintRelPath(id)

  let out: string
  try {
    out = await git(home, ['log', `-n${limit}`, `--format=%H${FIELD_SEP}%cI${FIELD_SEP}%s`, '--', rel])
  } catch (error) {
    if (error instanceof GitError) return []
    throw error
  }

  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [rev, date, message] = line.split(FIELD_SEP)
      return { rev, date, message }
    })
}

export async function diff(id: string, revA: string, revB?: string): Promise<string> {
  const home = resolveHome()
  await ensureRepo(home)
  const path = blueprintPath(home, id)
  const rel = blueprintRelPath(id)
  const targetB = revB ?? (await currentRev(home, id, path))
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
  const home = resolveHome()
  return withLock(home, async () => {
    await ensureRepo(home)
    const path = blueprintPath(home, id)
    const rel = blueprintRelPath(id)

    let raw: string
    try {
      raw = await git(home, ['show', `${rev}:${rel}`])
    } catch (error) {
      if (error instanceof GitError) {
        throw new NotFoundError(`revision "${rev}" of blueprint "${id}" not found`)
      }
      throw error
    }

    const parsed = parseBlueprint(JSON.parse(raw))
    await writeFile(path, serialize(parsed), 'utf8')
    return commitFile(home, id, commitMessage('revert', id, opts.actor))
  })
}
