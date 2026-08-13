import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'

import type { Config } from './config.js'
import { isAuthorized } from './auth.js'
import {
  postRender,
  listBlueprints,
  getBlueprint,
  createBlueprint,
  patchBlueprint,
  deleteBlueprint,
  renderStored,
  healthz,
  writeJson,
  type RouteHandler
} from './routes.js'

interface Route {
  method: string
  segments: string[]
  handler: RouteHandler
}

const routes: Route[] = [
  { method: 'POST', segments: ['render'], handler: postRender },
  { method: 'GET', segments: ['blueprints'], handler: listBlueprints },
  { method: 'GET', segments: ['blueprints', ':id'], handler: getBlueprint },
  { method: 'POST', segments: ['blueprints'], handler: createBlueprint },
  { method: 'PATCH', segments: ['blueprints', ':id'], handler: patchBlueprint },
  { method: 'DELETE', segments: ['blueprints', ':id'], handler: deleteBlueprint },
  { method: 'POST', segments: ['blueprints', ':id', 'render'], handler: renderStored },
  { method: 'GET', segments: ['healthz'], handler: healthz }
]

function matchRoute(
  method: string,
  pathSegments: string[]
): { route: Route; params: Record<string, string> } | undefined {
  for (const route of routes) {
    if (route.method !== method) continue
    if (route.segments.length !== pathSegments.length) continue

    const params: Record<string, string> = {}
    let matched = true
    for (let i = 0; i < route.segments.length; i++) {
      const routeSeg = route.segments[i]
      const pathSeg = pathSegments[i]
      if (routeSeg.startsWith(':')) {
        params[routeSeg.slice(1)] = pathSeg
      } else if (routeSeg !== pathSeg) {
        matched = false
        break
      }
    }
    if (matched) return { route, params }
  }
  return undefined
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  const segments = pathname.split('/').filter(Boolean)

  // Cheapest possible rejection: auth before routing, routing before any
  // body read. /healthz is the sole exception, exempted by the same
  // segments computation the router uses below (not a separate string
  // compare) so the two can't disagree about what counts as "/healthz".
  const isHealthz = segments.length === 1 && segments[0] === 'healthz'
  if (!isHealthz && !isAuthorized(req)) {
    writeJson(res, 401, { error: 'unauthorized' })
    return
  }

  const match = matchRoute(req.method ?? 'GET', segments)
  if (!match) {
    writeJson(res, 404, { error: 'not found' })
    return
  }

  await match.route.handler(req, res, match.params)
}

/** Builds the HTTP server. `config` is currently unused here (consumed by index.ts for listen/bind) but kept for signature parity and future request-scoped config. */
export function createServer(_config: Config): Server {
  return createHttpServer((req, res) => {
    // Defensive no-ops: without a listener, an 'error' event on either
    // stream (e.g. a proxy resetting the connection, write-after-destroy on
    // some future Node version) is an uncaught exception that crashes the
    // process. Not real error handling — just insurance.
    req.on('error', () => {})
    res.on('error', () => {})

    handleRequest(req, res).catch((error: unknown) => {
      console.error('[resume-blueprint-http] unhandled error:', error)
      if (!res.headersSent) {
        writeJson(res, 500, { error: 'internal error' })
      } else {
        res.end()
      }
    })
  })
}
