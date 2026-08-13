import type { IncomingMessage } from 'node:http'

/** Tag shape `toHttpError` looks for first, ahead of any other error check. */
interface HttpTaggedError extends Error {
  httpStatus: number
}

function taggedError(message: string, httpStatus: number): HttpTaggedError {
  const error = new Error(message) as HttpTaggedError
  error.httpStatus = httpStatus
  return error
}

/**
 * Accumulates the request body and parses it as JSON. An empty body (no
 * bytes at all) resolves to `undefined` rather than throwing, since several
 * routes (`GET`, `DELETE`) have an optional or absent body.
 *
 * Enforces `maxBytes` while streaming, not after buffering the whole thing,
 * so an oversized body is never held in memory in full: once `total`
 * crosses `maxBytes` we stop pushing chunks onto `chunks`, but we still
 * drain the async iterator to the end (rather than throwing immediately
 * and abandoning it) so the request reaches a clean 'end' instead of being
 * left mid-body — `routes.ts`'s `writeJson` separately forces the socket
 * closed on the 413 response this produces, which is the piece that
 * actually keeps that connection from lingering.
 */
export async function readJsonBody(req: IncomingMessage, maxBytes = 5 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  let exceeded = false

  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) {
      exceeded = true
      continue
    }
    chunks.push(chunk as Buffer)
  }

  if (exceeded) {
    throw taggedError(`request body exceeds ${maxBytes} bytes`, 413)
  }

  if (total === 0) return undefined

  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(raw)
  } catch {
    throw taggedError('malformed JSON in request body', 400)
  }
}

/**
 * Duplicated (not imported) from packages/mcp/src/validate.ts. It guards
 * against unbounded recursion in store's `applyMergePatch`
 * (packages/store/src/mergePatch.ts), which recurses to the depth of the
 * caller-supplied patch/blueprint object with no cap of its own, and runs
 * BEFORE `parseBlueprint` validates anything. `packages/store` is out of
 * scope for this gate, so — same as Gate 2 — the guard is applied at the
 * adapter boundary instead. A shared package for one 8-line helper is
 * disproportionate machinery (same reasoning as `countPages`'s duplication
 * in packages/mcp/src/render.ts), so it's copied by hand into each adapter.
 *
 * The one deliberate adaptation from the MCP original: the thrown error is
 * tagged with `.httpStatus = 400` so it's picked up by the *first* check in
 * `toHttpError` rather than falling through to the generic 500 case — the
 * MCP version didn't need this because its caller formats every caught
 * error into a `CallToolResult` uniformly.
 */
export function assertReasonableDepth(value: unknown, maxDepth = 32): void {
  const walk = (node: unknown, depth: number): void => {
    if (depth > maxDepth) {
      throw taggedError('input is nested too deeply', 400)
    }
    if (node !== null && typeof node === 'object') {
      for (const child of Object.values(node as Record<string, unknown>)) {
        walk(child, depth + 1)
      }
    }
  }
  walk(value, 0)
}
