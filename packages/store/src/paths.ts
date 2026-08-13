import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { InvalidIdError, InvalidRevError } from './errors.js'

/**
 * Ids are used both as filenames and as `git show <rev>:blueprints/<id>.json`
 * path fragments, so the pattern also doubles as path-traversal protection —
 * no `/`, no `..`, no leading dot.
 */
const ID_PATTERN = /^[a-z0-9-]+$/

/**
 * Revision-like arguments (`diff`'s `revA`/`revB`, `revert`'s `rev`) only
 * ever originate from this store's own `rev-parse HEAD` / `log` output, so a
 * full or abbreviated hex SHA or `HEAD`/`HEAD~N` covers every legitimate
 * value. Anything else is rejected before it reaches `git` argv: a value
 * like `--output=/tmp/x` would otherwise be parsed by git itself as a flag
 * rather than a revision.
 */
const REV_PATTERN = /^[0-9a-fA-F]{4,40}$|^HEAD(~[0-9]+)?$/

/**
 * Resolves `$RESUME_BLUEPRINT_HOME`, read from `process.env` at call time (not
 * cached at import) so tests can point it at a fresh temp dir per case.
 */
export function resolveHome(): string {
  const raw = process.env.RESUME_BLUEPRINT_HOME
  return resolve(raw && raw.trim() ? raw : join(homedir(), '.resume-blueprint'))
}

export function assertValidId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new InvalidIdError(
      `invalid blueprint id "${id}": must match ${ID_PATTERN.source} (lowercase letters, digits, hyphens)`
    )
  }
}

/** Validates a revision-like argument before it is forwarded to `git` argv. */
export function assertValidRev(rev: string): void {
  if (!REV_PATTERN.test(rev)) {
    throw new InvalidRevError(
      `invalid revision "${rev}": must match ${REV_PATTERN.source} (a full/abbreviated SHA, or HEAD/HEAD~N)`
    )
  }
}

/** Path to a blueprint's JSON file relative to the repo root, for git subcommands. */
export function blueprintRelPath(id: string): string {
  assertValidId(id)
  return `blueprints/${id}.json`
}

/** Absolute path to a blueprint's JSON file on disk. */
export function blueprintPath(home: string, id: string): string {
  assertValidId(id)
  return join(home, 'blueprints', `${id}.json`)
}
