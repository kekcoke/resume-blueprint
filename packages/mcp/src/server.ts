import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools } from './tools.js'

export function createServer(): McpServer {
  const server = new McpServer({ name: 'resume-blueprint', version: '0.1.0' })
  registerTools(server)
  return server
}
