/**
 * Global in-flight-render cap, shared across BOTH render routes (`postRender`
 * and `renderStored`). Each `tectonic` invocation is a real subprocess with
 * real CPU/memory cost; without a cap, a burst of concurrent render requests
 * spawns one subprocess per request with no throttling — cheap to trigger
 * over HTTP, which (unlike MCP's single stdio client) has no natural
 * per-session identity to lock against.
 *
 * A local-first tool should fail fast under load rather than queue requests
 * indefinitely, so this is a hard cap with an immediate rejection
 * (`tryAcquire` returns `false`), not a queue/semaphore that makes callers
 * wait.
 */
export const MAX_CONCURRENT_RENDERS = 4

let inFlight = 0

/** Attempts to reserve a render slot. Returns `false` if the cap is already reached. */
export function tryAcquire(): boolean {
  if (inFlight >= MAX_CONCURRENT_RENDERS) return false
  inFlight++
  return true
}

/** Releases a render slot acquired via `tryAcquire`. */
export function release(): void {
  inFlight--
}
