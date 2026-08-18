#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'
import { CORE_BUILD } from './buildStamp.js'

async function main(): Promise<void> {
  const server = createServer()

  // Announced on every start so a stale server is visible before it renders
  // anything misleading. stderr, never stdout — see below.
  console.error(`[resume-blueprint-mcp] ready (${CORE_BUILD})`)
  // stdout is the JSON-RPC transport itself — no diagnostics may go there.
  // Anything logged from this process, here or in a tool handler, must go to
  // stderr (see CLAUDE.md invariant 2).
  await server.connect(new StdioServerTransport())
}

main().catch((error: unknown) => {
  console.error('[resume-blueprint-mcp] fatal:', error)
  process.exit(1)
})
