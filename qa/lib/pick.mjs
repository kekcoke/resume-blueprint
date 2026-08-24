#!/usr/bin/env node
/**
 * Reads a file of JSON-RPC response lines (mcp-pipe's output) and prints one
 * value from it.
 *
 *   node qa/lib/pick.mjs out.jsonl 4.result.structuredContent.pageCount
 *
 * The first path segment is the JSON-RPC message ID, not a line number.
 * Responses do NOT arrive in request order: the server handles calls
 * concurrently, so two renders issued back to back come back in whichever
 * order they finish. (That is itself finding G2 — MCP has no render cap —
 * observable right here in the transcript.) Addressing by id is the only
 * stable way to reference a response, and it also makes the assertions read
 * against the ids written in the .jsonl session.
 *
 * Prints an empty string for a missing path, so a shell `check` reports
 * "expected X, actual (empty)" rather than dying on an unbound variable.
 * Objects and arrays print as compact JSON so they can be grepped.
 */
import { readFileSync } from 'node:fs'

const [file, path] = process.argv.slice(2)
if (!file || !path) {
  process.stderr.write('usage: node qa/lib/pick.mjs <responses.jsonl> <id.dotted.path>\n')
  process.exit(2)
}

const messages = readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line))

const [rawId, ...rest] = path.split('.')
const wanted = Number(rawId)
let value = messages.find((m) => m.id === (Number.isNaN(wanted) ? rawId : wanted))

for (const segment of rest) {
  if (value === undefined || value === null) break
  value = value[segment]
}

if (value === undefined || value === null) process.stdout.write('')
else if (typeof value === 'object') process.stdout.write(JSON.stringify(value))
else process.stdout.write(String(value))
