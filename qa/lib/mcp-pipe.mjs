#!/usr/bin/env node
/**
 * Pipes a newline-delimited JSON-RPC session at the built MCP server and
 * prints every response envelope, one JSON document per line.
 *
 *   node qa/lib/mcp-pipe.mjs qa/mcp/01-render.jsonl
 *
 * The `.jsonl` files are the MCP suite's sample invocables. They contain the
 * literal protocol messages, handshake included, so the session is legible
 * without a client library — and `cat file.jsonl | node packages/mcp/dist/index.js`
 * is a real, working invocation of the same thing.
 *
 * Two conveniences, both expanded before anything is sent, and both visible
 * with QA_TRACE=1 (which echoes the exact lines written to the server):
 *
 *   "@file:fixtures/sample.json"  ->  that file, parsed as JSON
 *   "@text:fixtures/profile.md"   ->  that file, as a string
 *
 * They exist so a row can reuse the committed fixtures instead of inlining a
 * 4KB blueprint on one unreadable line. `--raw` disables both and sends the
 * file byte for byte.
 *
 * stdout here is the harness's data channel, so diagnostics go to stderr —
 * the same rule the server itself lives under (CLAUDE.md invariant 2).
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { REPO_ROOT } from './env.mjs'
import { assertIsolated } from './scratch.mjs'

const args = process.argv.slice(2)
const raw = args.includes('--raw')
const file = args.find((a) => !a.startsWith('--'))

if (!file) {
  process.stderr.write('usage: node qa/lib/mcp-pipe.mjs <session.jsonl> [--raw]\n')
  process.exit(2)
}

// A session that creates blueprints must never land in the user's real store.
assertIsolated()

function expand(value) {
  if (typeof value === 'string') {
    if (value.startsWith('@file:')) {
      return JSON.parse(readFileSync(resolve(REPO_ROOT, value.slice('@file:'.length)), 'utf8'))
    }
    if (value.startsWith('@text:')) {
      return readFileSync(resolve(REPO_ROOT, value.slice('@text:'.length)), 'utf8')
    }
    return value
  }
  if (Array.isArray(value)) return value.map(expand)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v)]))
  }
  return value
}

const lines = readFileSync(resolve(process.cwd(), file), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  // `//` comments are stripped so a session can explain itself. Not legal
  // JSON-RPC, so they never reach the server.
  .filter((line) => line && !line.startsWith('//'))
  .map((line) => (raw ? line : JSON.stringify(expand(JSON.parse(line)))))

const expectedIds = new Set(
  lines.map((line) => JSON.parse(line).id).filter((id) => id !== undefined && id !== null)
)

const child = spawn(process.execPath, [join(REPO_ROOT, 'packages', 'mcp', 'dist', 'index.js')], {
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe']
})

let stderrText = ''
child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => {
  stderrText += chunk
  if (process.env.QA_TRACE) process.stderr.write(chunk)
})

let buffer = ''
const seen = new Set()
const junk = []

child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      // Anything non-JSON on stdout is a violation of invariant 2 — stdout is
      // the transport. Collected and reported rather than swallowed.
      junk.push(line)
      continue
    }
    if (message.id !== undefined && message.id !== null) seen.add(message.id)
    process.stdout.write(`${JSON.stringify(message)}\n`)
    if (expectedIds.size && [...expectedIds].every((id) => seen.has(id))) finish(0)
  }
})

const timeoutMs = Number(process.env.QA_MCP_TIMEOUT_MS ?? 180_000)
const timer = setTimeout(() => {
  process.stderr.write(
    `mcp-pipe: timed out after ${timeoutMs}ms waiting for ids ` +
      `${[...expectedIds].filter((id) => !seen.has(id)).join(', ')}\n--- server stderr ---\n${stderrText}\n`
  )
  finish(1)
}, timeoutMs)

let finished = false
function finish(code) {
  if (finished) return
  finished = true
  clearTimeout(timer)

  if (junk.length) {
    process.stderr.write(
      `mcp-pipe: ${junk.length} non-protocol line(s) on stdout — CLAUDE.md invariant 2 says ` +
        `nothing but JSON-RPC may go there:\n${junk.slice(0, 5).join('\n')}\n`
    )
    code = code || 3
  }

  child.stdin.end()
  child.kill('SIGTERM')
  process.exit(code)
}

child.on('error', (error) => {
  process.stderr.write(`mcp-pipe: failed to start the server: ${error.message}\n`)
  finish(1)
})

child.on('exit', (code) => {
  if (!finished) {
    process.stderr.write(
      `mcp-pipe: server exited early with code ${code}\n--- server stderr ---\n${stderrText}\n`
    )
    finish(1)
  }
})

for (const line of lines) {
  if (process.env.QA_TRACE) process.stderr.write(`>> ${line}\n`)
  child.stdin.write(`${line}\n`)
}
