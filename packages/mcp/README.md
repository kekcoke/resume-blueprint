# @resume-blueprint/mcp

An MCP server exposing `@resume-blueprint/store` (and, through it,
`@resume-blueprint/core`) as tools for local agents: create/patch/render
resume blueprints, browse history, diff and revert revisions.

Transport is stdio (`StdioServerTransport`). Run it with:

```bash
node dist/index.js
```

`RESUME_BLUEPRINT_HOME` selects the store's home directory (defaults to
`~/.resume-blueprint`), same convention as the store package.

## Known limitations

- **Cross-process store lock gap.** `packages/store/src/lock.ts`'s own doc
  comment already flags this: its `withLock` is a per-key, **in-process**
  FIFO mutex. It only serializes calls made from within a single Node
  process. Running this MCP server is exactly the case that comment calls
  out as deferred: a long-lived server process, started alongside — say — a
  future CLI or HTTP adapter invocation against the *same*
  `$RESUME_BLUEPRINT_HOME`, has no protection against both processes racing
  a read-modify-write cycle against the same blueprint. Two processes can
  both read the same starting revision, both pass their own `expectedRev`
  check (each has no visibility into the other's in-flight write), and one
  commit can silently clobber the other's.

  This is **not fixed** in Gate 2 — fixing it would mean adding real
  filesystem-level locking (e.g. relying on git's own `index.lock`, or a
  flock-based mutex) to `packages/store`, which is out of scope for this
  gate. Until then: don't run this MCP server concurrently with another
  process writing to the same `$RESUME_BLUEPRINT_HOME`.
