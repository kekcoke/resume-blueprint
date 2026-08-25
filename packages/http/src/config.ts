export interface Config {
  port: number
  bind: string
  token: string | undefined
}

/**
 * Reads server configuration from `process.env`. Kept inside this function
 * (never read inline elsewhere) so tests can mutate `process.env` and call
 * this fresh per case rather than fighting a cached value.
 */
export function loadConfig(): Config {
  const port = process.env.RESUME_BLUEPRINT_PORT
    ? Number(process.env.RESUME_BLUEPRINT_PORT)
    : 8787
  // Loopback by default. Binding 0.0.0.0 (or any other host) is an explicit
  // opt-in via env — this is a local-first tool, not a service meant to sit
  // on a network interface by default.
  const bind = process.env.RESUME_BLUEPRINT_BIND ?? '127.0.0.1'
  const token = process.env.RESUME_BLUEPRINT_TOKEN
  return { port, bind, token }
}
