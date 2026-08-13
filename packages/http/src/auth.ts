import type { IncomingMessage } from 'node:http'

/**
 * Checks the request's bearer token against `RESUME_BLUEPRINT_TOKEN`. If the
 * env var is unset, auth is disabled entirely (local-first default). If set,
 * every route except `/healthz` (checked by the caller, not here) must carry
 * a matching `Authorization: Bearer <token>` header.
 */
export function isAuthorized(req: IncomingMessage): boolean {
  const token = process.env.RESUME_BLUEPRINT_TOKEN
  if (!token) return true

  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return false

  // Plain string comparison, not constant-time. This tool's threat model is
  // a local operator on a loopback-by-default bind, not a remote attacker
  // positioned to exploit a timing side-channel over the network.
  return header.slice('Bearer '.length) === token
}
