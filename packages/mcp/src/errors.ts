import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { isValidationError, formatValidationError, TectonicError } from '@resume-blueprint/core'
import {
  ConflictError,
  NotFoundError,
  InvalidIdError,
  InvalidRevError,
  AlreadyExistsError,
  InvalidActorError,
  GitError
} from '@resume-blueprint/store'

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

/**
 * Maps any error a tool handler's try/catch can see into a structured
 * `CallToolResult`. Checks are ordered most-specific first so, e.g., a
 * `TectonicError` (which is also an `Error`) is never swallowed by the
 * generic fallback.
 *
 * `resume_validate` does NOT go through this — see its handler in tools.ts:
 * reporting "invalid" is that tool's successful outcome, not a tool failure.
 */
export function toToolError(error: unknown): CallToolResult {
  if (isValidationError(error)) {
    return errorResult(`Invalid blueprint:\n${formatValidationError(error)}`)
  }

  if (error instanceof TectonicError) {
    // Same truncation pattern as packages/cli/src/index.ts: only the lines
    // that look like actual TeX engine errors, capped at 10.
    const relevant = error.log
      .split('\n')
      .filter((line) => /^!|^error|Error:/.test(line))
      .slice(0, 10)
    const detail = relevant.length ? `\n${relevant.join('\n')}` : ''
    return errorResult(`Render failed: ${error.message}${detail}`)
  }

  if (
    error instanceof ConflictError ||
    error instanceof NotFoundError ||
    error instanceof InvalidIdError ||
    error instanceof InvalidRevError ||
    error instanceof AlreadyExistsError ||
    error instanceof InvalidActorError ||
    error instanceof GitError
  ) {
    return errorResult(`${error.name}: ${error.message}`)
  }

  // Anything else is unexpected: log the full error to stderr (never
  // stdout — stdout is the JSON-RPC transport, see CLAUDE.md invariant 2)
  // and return only a terse message to the client.
  console.error('[resume-blueprint-mcp] unexpected error:', error)
  const message = (error as Error)?.message ?? String(error)
  return errorResult(`Unexpected error: ${message}`)
}
