import type { IncomingMessage, ServerResponse } from 'node:http'
import * as store from '@resume-blueprint/store'
import { renderBlueprint } from '@resume-blueprint/core'

import { readJsonBody, assertReasonableDepth } from './body.js'
import { toHttpError } from './errors.js'
import { tryAcquire, release } from './renderLimit.js'

/** Actor recorded on every commit this adapter makes. */
const ACTOR = 'http'

/**
 * Fixed render timeout, not caller-configurable. 5x core's bare 60s default
 * to absorb a cold-cache first Tectonic compile (it fetches packages over
 * the network the first time a document class is used); matches the ceiling
 * approved for Gate 2's `resume_render`. Exposing this as a request
 * parameter would let a caller hang a render thread for arbitrarily long.
 */
const RENDER_TIMEOUT_MS = 180_000

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
) => Promise<void>

/**
 * Writes a JSON response. When `closeConnection` is true, the socket is
 * destroyed right after the response finishes flushing instead of being
 * offered back for keep-alive reuse.
 *
 * Used for the request-body-too-large (413) path: `readJsonBody` (body.ts)
 * rejects an oversized body as soon as it crosses the cap. Empirically,
 * the request/response exchange itself completes in milliseconds either
 * way, but a client's keep-alive pool can end up treating that connection
 * as still-reusable and hold it open rather than promptly closing or
 * recycling it — leaving it to the server's default ~5s keepAliveTimeout
 * to reclaim. Since 413 already means "no keep-alive for you" in spirit
 * (the client sent more than the server is willing to buffer), closing
 * server-side is both correct and removes the wait, and it's cheap to do
 * unconditionally on that one path.
 */
export function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  closeConnection = false
): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text)
  })
  if (closeConnection) {
    const socket = res.socket
    res.once('finish', () => socket?.destroy())
  }
  res.end(text)
}

function writePdf(res: ServerResponse, pdf: Buffer): void {
  res.writeHead(200, {
    'content-type': 'application/pdf',
    'content-length': pdf.length
  })
  res.end(pdf)
}

/** Wraps a handler body: catches anything thrown and writes the mapped error response. */
async function guarded(res: ServerResponse, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    const { status, body } = toHttpError(error)
    writeJson(res, status, body, status === 413)
  }
}

function writeTooManyRenders(res: ServerResponse): void {
  res.setHeader('Retry-After', '5')
  writeJson(res, 503, { error: 'too many concurrent renders, try again shortly' })
}

/**
 * Runs `fn` (a render) under the global concurrency cap (`renderLimit.ts`).
 * Rejects immediately with 503 rather than queuing when the cap is already
 * reached — see `renderLimit.ts` for why this fails fast instead of waiting.
 */
async function withRenderLimit(res: ServerResponse, fn: () => Promise<void>): Promise<void> {
  if (!tryAcquire()) {
    writeTooManyRenders(res)
    return
  }
  try {
    await fn()
  } finally {
    release()
  }
}

export function postRender(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return guarded(res, async () => {
    const blueprint = await readJsonBody(req)
    await withRenderLimit(res, async () => {
      const pdf = await renderBlueprint(blueprint, { timeoutMs: RENDER_TIMEOUT_MS })
      writePdf(res, pdf)
    })
  })
}

export function listBlueprints(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  return guarded(res, async () => {
    const summaries = await store.list()
    writeJson(res, 200, summaries)
  })
}

export function getBlueprint(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  return guarded(res, async () => {
    const { blueprint, rev } = await store.get(params.id)
    writeJson(res, 200, { blueprint, rev })
  })
}

export function createBlueprint(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return guarded(res, async () => {
    const body = (await readJsonBody(req)) as { id?: string; blueprint?: object } | undefined
    if (!body || typeof body.id !== 'string') {
      writeJson(res, 400, { error: 'request body must include a string "id"' })
      return
    }
    if (body.blueprint !== undefined) {
      assertReasonableDepth(body.blueprint)
    }
    const { rev } = await store.create(body.id, body.blueprint ?? {}, { actor: ACTOR })
    res.setHeader('Location', `/blueprints/${body.id}`)
    writeJson(res, 201, { id: body.id, rev })
  })
}

export function patchBlueprint(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  return guarded(res, async () => {
    const body = (await readJsonBody(req)) as { patch?: object; expectedRev?: string } | undefined
    if (!body || typeof body.patch !== 'object' || body.patch === null) {
      writeJson(res, 400, { error: 'request body must include a "patch" object' })
      return
    }
    assertReasonableDepth(body.patch)
    const { rev } = await store.patch(params.id, body.patch, {
      actor: ACTOR,
      expectedRev: body.expectedRev
    })
    writeJson(res, 200, { id: params.id, rev })
  })
}

export function deleteBlueprint(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  return guarded(res, async () => {
    const body = (await readJsonBody(req)) as { expectedRev?: string } | undefined
    const { rev } = await store.remove(params.id, { actor: ACTOR, expectedRev: body?.expectedRev })
    writeJson(res, 200, { id: params.id, rev })
  })
}

export function renderStored(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): Promise<void> {
  return guarded(res, async () => {
    const { blueprint } = await store.get(params.id)
    await withRenderLimit(res, async () => {
      const pdf = await renderBlueprint(blueprint, { timeoutMs: RENDER_TIMEOUT_MS })
      writePdf(res, pdf)
    })
  })
}

export function healthz(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  return guarded(res, async () => {
    writeJson(res, 200, { status: 'ok' })
  })
}
