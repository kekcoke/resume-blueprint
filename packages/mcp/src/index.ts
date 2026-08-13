#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

async function main(): Promise<void> {
  const server = createServer()
  // stdout is the JSON-RPC transport itself — no diagnostics may go there.
  // Anything logged from this process, here or in a tool handler, must go to
  // stderr (see CLAUDE.md invariant 2).
  await server.connect(new StdioServerTransport())
}

main().catch((error: unknown) => {
  console.error('[resume-blueprint-mcp] fatal:', error)
  process.exit(1)
})
