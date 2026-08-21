import { isValidationError, formatValidationError, TectonicError } from '@resume-blueprint/core'
import {
  ConflictError,
  NotFoundError,
  InvalidIdError,
  InvalidRevError,
  AlreadyExistsError,
  InvalidActorError,
  LockTimeoutError,
  GitError
} from '@resume-blueprint/store'

export interface HttpError {
  status: number
  body: { error: string }
}

/**
 * Maps any error a route handler's try/catch can see to an HTTP status and
 * the flat `{error}` JSON envelope every non-2xx response uses. Checks are
 * ordered most-specific first.
 */
export function toHttpError(error: unknown): HttpError {
  // Body-parse / body-size errors tagged by readJsonBody / assertReasonableDepth.
  if (typeof (error as { httpStatus?: unknown })?.httpStatus === 'number') {
    const status = (error as { httpStatus: number }).httpStatus
    const message = error instanceof Error ? error.message : String(error)
    return { status, body: { error: message } }
  }

  if (isValidationError(error)) {
    return { status: 400, body: { error: formatValidationError(error) } }
  }

  if (error instanceof TectonicError) {
    // The blueprint passed schema validation but broke the TeX engine —
    // a client-content problem, not a server problem. 422 (not 500) lets a
    // caller like n8n distinguish "retrying won't help" from a real fault.
    return { status: 422, body: { error: error.message } }
  }

  if (error instanceof ConflictError) {
    return { status: 409, body: { error: error.message } }
  }

  if (error instanceof NotFoundError) {
    return { status: 404, body: { error: error.message } }
  }

  if (error instanceof AlreadyExistsError) {
    // Same family as ConflictError (a collision, not a bad request), so it
    // gets the REST-conventional 409 rather than 400.
    return { status: 409, body: { error: error.message } }
  }

  if (
    error instanceof InvalidIdError ||
    error instanceof InvalidRevError ||
    error instanceof InvalidActorError
  ) {
    return { status: 400, body: { error: error.message } }
  }

  if (error instanceof LockTimeoutError) {
    // Another process is holding the store lock — not a bad request or a
    // permanent conflict, just busy. 503 lets a caller distinguish
    // "retry shortly" from the 409 it would get for a real content conflict.
    return { status: 503, body: { error: error.message } }
  }

  if (error instanceof GitError) {
    console.error('[resume-blueprint-http] git error:', error, error.stderr)
    return { status: 500, body: { error: 'internal error' } }
  }

  console.error('[resume-blueprint-http] unexpected error:', error)
  return { status: 500, body: { error: 'internal error' } }
}
