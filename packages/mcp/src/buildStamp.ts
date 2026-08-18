import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Identifies the `@resume-blueprint/core` build this process has loaded.
 *
 * A running MCP server holds core in module memory. Edit a template, rebuild,
 * and `resume_render` keeps serving the templates from before the rebuild until
 * the client restarts the server — which looks exactly like the fix not working,
 * and cost a real debugging session during the template2 header work.
 *
 * Nothing can reload an ESM graph in place, and spawning the CLI per render to
 * dodge that would trade a documentation problem for a latency-and-architecture
 * one. So the staleness is made visible instead: this goes to stderr at startup
 * and rides along in every render result, where an agent that gets a surprising
 * PDF has the evidence in hand.
 *
 * Computed once, at module load, because that is exactly the moment the answer
 * stops being able to change.
 */
export const CORE_BUILD = resolveCoreBuild()

function resolveCoreBuild(): string {
  try {
    const entry = fileURLToPath(import.meta.resolve('@resume-blueprint/core'))
    return `core built ${statSync(entry).mtime.toISOString()}`
  } catch {
    // Never let a diagnostic take the server down.
    return 'core build unknown'
  }
}
