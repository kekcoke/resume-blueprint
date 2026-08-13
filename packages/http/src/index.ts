#!/usr/bin/env node
import { loadConfig } from './config.js'
import { createServer } from './server.js'

const config = loadConfig()
const server = createServer(config)

server.listen(config.port, config.bind, () => {
  // stdout is left free for whatever a caller pipes this process's output
  // into; diagnostics go to stderr, same convention as the MCP server.
  console.error(`[resume-blueprint-http] listening on http://${config.bind}:${config.port}`)
})
