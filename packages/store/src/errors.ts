/** Thrown when a mutation's `expectedRev` no longer matches the file's current rev. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

/** Thrown when an operation targets a blueprint id that does not exist. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

/** Thrown when a blueprint id fails slug validation. */
export class InvalidIdError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidIdError'
  }
}

/**
 * Thrown when a revision-like argument (`diff`'s `revA`/`revB`, `revert`'s
 * `rev`) fails validation before being forwarded to `git` argv. This is a
 * security boundary, not just input hygiene: an unvalidated value starting
 * with `-` can be parsed by git as an option (e.g. `--output=...`) rather
 * than a revision.
 */
export class InvalidRevError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRevError'
  }
}

/** Thrown when `create` targets a blueprint id that already exists. */
export class AlreadyExistsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AlreadyExistsError'
  }
}

/** Thrown when `opts.actor` contains control characters that could desync commit-message parsing. */
export class InvalidActorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidActorError'
  }
}

/**
 * Thrown when acquiring the cross-process store lock (`<home>/.store.lock`)
 * times out because another process is holding it. Deliberately no
 * auto-recovery (see lock.ts) — `lockFile` is included so the caller's error
 * message can point a human at the exact file to inspect and, if genuinely
 * stale, delete.
 */
export class LockTimeoutError extends Error {
  constructor(
    message: string,
    readonly lockFile: string
  ) {
    super(message)
    this.name = 'LockTimeoutError'
  }
}
