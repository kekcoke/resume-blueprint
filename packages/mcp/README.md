# @resume-blueprint/mcp

An MCP server exposing `@resume-blueprint/store` (and, through it,
`@resume-blueprint/core`) as tools for local agents: create/patch/render
resume blueprints, browse history, diff and revert revisions.

Transport is stdio (`StdioServerTransport`). Run it with:

```bash
node dist/index.js
```

`RESUME_BLUEPRINT_HOME` selects the store's home directory (defaults to
`~/.resume-blueprint`), same convention as the store package. Store writes
are safe across concurrent processes — a cross-process file lock in
`packages/store/src/lock.ts` serializes this server against a concurrent CLI
or HTTP adapter invocation hitting the same `$RESUME_BLUEPRINT_HOME`.
