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
