/**
 * A per-key, in-process FIFO async mutex.
 *
 * Keyed by the resolved `RESUME_BLUEPRINT_HOME` absolute path (not per-blueprint
 * id) because the shared resource being protected is the repo's index/HEAD, not
 * an individual file — two concurrent mutations to *different* blueprint ids
 * still both touch `git add`/`git commit` against the same repo state.
 *
 * This only serializes calls within one Node process. Two separate OS processes
 * (e.g. this store used from both a CLI invocation and a running MCP server)
 * can still race on the same repo — that needs a filesystem-level lock (or
 * relying on git's own `index.lock`), and is an explicit out-of-scope gap for
 * Gate 1, deferred until Gate 2 introduces a long-lived MCP server process.
 */
const queues = new Map<string, Promise<unknown>>()

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const run = previous.then(fn)
  // The queued continuation must never itself be a rejected promise, or every
  // later caller waiting on this key would inherit this call's failure instead
  // of getting its own turn.
  queues.set(
    key,
    run.catch(() => undefined)
  )
  return run
}
