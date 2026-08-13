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

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text)
  })
  res.end(text)
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

  // Cheapest possible rejection: auth before routing, routing before any
  // body read. /healthz is the sole exception, checked by exact path.
  if (pathname !== '/healthz' && !isAuthorized(req)) {
    writeJson(res, 401, { error: 'unauthorized' })
    return
  }

  const segments = pathname.split('/').filter(Boolean)
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
