/**
 * Boots `packages/http/dist/index.js` on an ephemeral port for the duration
 * of a suite, and tears it down afterwards.
 *
 * Runs the real built server as a real subprocess rather than importing
 * `createServer()` in-process: the contract rows include things only a real
 * socket exhibits (the 413 path destroys the socket; auth runs before
 * routing; `MAX_CONCURRENT_RENDERS` is module state shared across requests).
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { REPO_ROOT } from './env.mjs'

/**
 * Asks the OS for a free port and immediately gives it back.
 *
 * Inherently racy — something else could claim it in the gap — but the
 * alternative (having the server report its own bound port) would mean
 * parsing its stderr banner, and the banner is a diagnostic, not an
 * interface. On a loopback QA run the race has no realistic loser.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function waitForHealthz(baseUrl, child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`http server exited early with code ${child.exitCode}`)
    }
    try {
      const res = await fetch(`${baseUrl}/healthz`)
      if (res.ok) return
      lastError = new Error(`/healthz returned ${res.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`http server did not become healthy in ${timeoutMs}ms: ${lastError?.message}`)
}

/**
 * Starts the server and returns `{ baseUrl, stderr, stop }`.
 *
 * `env` is merged over the current environment — callers pass
 * `RESUME_BLUEPRINT_TOKEN` here to exercise the auth rows (C13/C14) against a
 * second, token-protected instance.
 */
export async function startHttpServer({ home, env = {} } = {}) {
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn(process.execPath, [join(REPO_ROOT, 'packages', 'http', 'dist', 'index.js')], {
    env: {
      ...process.env,
      ...(home ? { RESUME_BLUEPRINT_HOME: home } : {}),
      RESUME_BLUEPRINT_PORT: String(port),
      RESUME_BLUEPRINT_BIND: '127.0.0.1',
      // Cleared unless the caller asks for it: inheriting a token from the
      // developer's own shell would turn every unauthenticated row red.
      RESUME_BLUEPRINT_TOKEN: '',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  // The server must never write to stdout except as a caller's own pipe; the
  // banner goes to stderr. Captured so a suite can assert on that if needed.
  let stdout = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })

  try {
    await waitForHealthz(baseUrl, child)
  } catch (error) {
    child.kill('SIGKILL')
    throw new Error(`${error.message}\n--- server stderr ---\n${stderr}`)
  }

  return {
    baseUrl,
    port,
    get stderr() {
      return stderr
    },
    get stdout() {
      return stdout
    },
    async stop() {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 3000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  }
}
