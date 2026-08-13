# Phase 2 — Store, MCP, and HTTP adapters

## Context

Phase 1 is complete and committed (`4029f2d`..`2e7fd8e`, 44/44 tests green).
`@resume-blueprint/core` turns a validated JSON Resume blueprint into a typeset PDF via
Tectonic with LaTeX injection sanitization, and `@resume-blueprint/cli` wraps it.

What does not exist yet is the thing the project is actually for: **local agents (Claude
Code, Hermes) and workflow tools (n8n) creating and updating a resume blueprint over
time.** Phase 1 renders a blueprint you hand it; it has nowhere to keep one, no way to
edit one incrementally, and no agent-native interface.

Phase 2 adds three packages over the unchanged core: a versioned store, an MCP server, and
an HTTP adapter. The rule that keeps this productizable is that **core knows nothing about
MCP, HTTP, or argv** — every interface is a thin adapter over the same call path.

**Decisions already made:**

| Decision | Choice |
|---|---|
| MCP SDK | `@modelcontextprotocol/server` v2, **core migrates to zod 4** for one zod version workspace-wide |
| Store backend | Git-backed JSON files |
| Edit API | JSON Merge Patch + typed array helpers |
| Sequencing | Store → MCP → HTTP, gated, **one session per gate** |

The MCP V1 SDK (`@modelcontextprotocol/sdk`, 51.7M weekly downloads) was considered and
rejected: it accepts zod 3 or 4, but pulls express, hono, cors, jose, ajv, eventsource and
more into what is a stdio-only server. V2 has two dependencies.

---

## Two invariants that must not be violated

Also recorded in `CLAUDE.md`, because these are the failure modes most likely to be
introduced by a session that lacks the original design context.

### 1. The store persists RAW blueprints. Sanitization happens only at render time.

`sanitizeBlueprint` escapes LaTeX specials: `&` → `\&`, `\` → `\textbackslash{}`. That
transformation is **not idempotent**. If sanitized output is ever written back to the
store, the next patch-and-render cycle escapes it again — `R&D` becomes `R\&D`, then
`R\textbackslash{}\&D` — and user data corrodes on every edit.

`store.get()` returns raw user text. `blueprintToTex` / `renderBlueprint` sanitize on the
way to the engine and never write back. Gate 1 has a regression test for this.

### 2. The MCP server never writes to stdout, and never returns PDF bytes.

**stdout is the JSON-RPC transport.** A single stray `console.log` — including one added
later while debugging — corrupts the stream and breaks the server confusingly. All
diagnostics go to stderr. Gate 2 asserts stdout contains nothing but JSON-RPC frames.

**PDFs are returned as a path plus metadata, never base64.** A 24KB PDF is roughly 32K
characters of base64, spent conveying a document the agent cannot read. Return
`{ path, pageCount, byteSize }`.

---

## Gate 0 — Migrate core to zod 4

Prerequisite for the V2 MCP SDK, which requires `zod ^4.2.0` (current 4.4.3). Core is on
zod 3.25.76.

**Files**: `packages/core/src/schema.ts`, `packages/core/package.json`

Three confirmed breaking changes hit this schema:

1. **`z.record()` now enforces exhaustiveness.** `z.record(SectionSchema, z.string())`
   currently types `headings` as partial; zod 4 demands every section key be present.
   Change to **`z.partialRecord(SectionSchema, z.string())`**.
2. **Error customization renamed.** `.refine(fn, { message })` on `selectedTemplate`
   becomes `{ error }`.
3. **`.default()` must be assignable to the output type** and short-circuits parsing.
   Verify `.refine(...).default(1)` still behaves — `1` is valid so it should, but the
   short-circuit means the default is not re-validated.

Also verify, since the adapters depend on them: `isValidationError` (uses `instanceof
z.ZodError`) and `formatValidationError` (uses `issue.path` and `issue.message` — both
survive in zod 4).

**Exit criteria**: `npm test` → 44/44 green, **unchanged**. No test may be edited to
accommodate the migration. If a test needs changing, the migration changed behavior, and
that is a decision to surface — not a test to edit.

---

## Gate 1 — `@resume-blueprint/store`

Versioned, git-backed blueprint persistence. This is what makes it safe to let an agent
write: every mutation is a commit, so diff and revert are free and a bad agent edit is
always recoverable.

**Layout**

```
$RESUME_BLUEPRINT_HOME (default ~/.resume-blueprint)
├─ .git/                    auto-init on first use
└─ blueprints/<id>.json     id is a slug: "default", "acme-backend-role"
```

**API** (`packages/store/src/index.ts`)

```ts
list(): Promise<BlueprintSummary[]>
get(id): Promise<{ blueprint: Blueprint; rev: string }>
create(id, blueprint?): Promise<{ rev }>
patch(id, mergePatch, opts?: { expectedRev }): Promise<{ rev }>
sectionAppend(id, section, item, opts?): Promise<{ rev }>
sectionUpdate(id, section, index, item, opts?): Promise<{ rev }>
sectionRemove(id, section, index, opts?): Promise<{ rev }>
remove(id): Promise<{ rev }>
history(id, limit?): Promise<Commit[]>
diff(id, revA, revB?): Promise<string>
revert(id, rev): Promise<{ rev }>
```

- `rev` is the git commit SHA. `expectedRev` gives optimistic concurrency: a mismatch
  throws `ConflictError` rather than silently clobbering a concurrent agent's write.
- Merge patch is RFC 7386 (`null` deletes a key). Roughly 30 lines; no dependency.
- Every mutation validates with `parseBlueprint` **after** applying the patch, and refuses
  to commit an invalid result.
- Commit messages record operation and caller: `patch(default) via mcp`.

**TDD sequence** — write the test, watch it fail for the right reason, then implement:

1. `create` then `get` round-trips an identical blueprint
2. `patch` merges nested objects; `null` deletes a key
3. `sectionAppend` / `sectionUpdate` / `sectionRemove` on `work`
4. `patch` with a stale `expectedRev` throws `ConflictError` and leaves the file untouched
5. `history` returns commits newest-first; `revert` restores prior content as a **new**
   commit (never rewrites history)
6. `patch` producing an invalid blueprint is rejected and nothing is committed
7. **Idempotency guard**: patch `basics.name` to `R&D Lead`, render, patch again, `get` —
   the stored value must still be exactly `R&D Lead`, never `R\&D Lead`. This is the
   invariant-1 regression test.
8. Two concurrent `patch` calls do not corrupt the file (one wins, one conflicts)

**Exit criteria**: store tests green; core's 44 still green; `packages/core` gained no
dependency; a real `~/.resume-blueprint` git log is inspectable by hand.

---

## Gate 2 — `@resume-blueprint/mcp`

stdio MCP server on `@modelcontextprotocol/server` v2.

| Tool | Purpose |
|---|---|
| `resume_list` | List blueprints with id, name, last modified |
| `resume_get` | Full blueprint + rev |
| `resume_create` | New blueprint, optionally seeded |
| `resume_patch` | Merge patch |
| `resume_section_append` / `_update` / `_remove` | Array-aware section edits |
| `resume_validate` | Validate without writing; readable errors |
| `resume_render` | Render to PDF → `{ path, pageCount, byteSize }` |
| `resume_tex` | LaTeX source (text is legitimately useful to an agent) |
| `resume_history` / `resume_diff` / `resume_revert` | Version control |
| `resume_templates` | List the nine template IDs |

Tool input schemas are zod 4, validated by the SDK before handlers run. Handlers stay
thin: parse args → call store or core → format a compact result.

**TDD sequence**

1. Spawn the built server as a child process; complete a real `initialize` handshake
2. `tools/list` returns every tool above with non-empty descriptions
3. `tools/call` for `resume_create` → `resume_patch` → `resume_get` round-trips
4. **stdout purity**: capture the full stdout stream across a session; assert every line
   parses as a JSON-RPC frame and nothing else appears
5. `resume_render` returns a path and metadata; assert the response contains **no** base64
   payload and that a file exists at the returned path
6. Invalid tool args produce a structured error, not a crash
7. **Security**: drive `fixtures/injection.json` in through `resume_create`, render, and
   assert the payloads are neutralized exactly as in Phase 1

**Exit criteria**: all green; the server registers via `claude mcp add` and a manual
`resume_list` succeeds from a real Claude Code session.

---

## Gate 3 — `@resume-blueprint/http`

REST adapter, primarily so n8n's HTTP Request node can reach the service — MCP and the CLI
do not cover it.

```
POST   /render                 body = blueprint → application/pdf   (stateless; n8n's main path)
GET    /blueprints
GET    /blueprints/:id
POST   /blueprints
PATCH  /blueprints/:id
POST   /blueprints/:id/render  → application/pdf
GET    /healthz
```

- Built on `node:http` — no express. Keeps dependencies at zero and the surface small.
- **Binds `127.0.0.1` by default.** Binding `0.0.0.0` requires an explicit env opt-in.
- Optional bearer token via `RESUME_BLUEPRINT_TOKEN`; when set, every route except
  `/healthz` requires it.

**TDD sequence**

1. `POST /render` with `fixtures/sample.json` returns `application/pdf` with PDF magic bytes
2. CRUD round-trip against a temp store
3. Malformed JSON and invalid blueprints return 400 with readable messages, not 500
4. With `RESUME_BLUEPRINT_TOKEN` set, an unauthenticated request gets 401; `/healthz` still 200
5. Default bind is loopback — assert the listening address
6. **Security**: `POST /render` with `fixtures/injection.json` produces a PDF and creates
   no files on disk

**Exit criteria**: all green; a real `curl` renders a PDF; an n8n HTTP Request node hits
`POST /render` successfully.

---

## Validation gates

Run before every commit, at every gate:

```bash
npm run build          # typecheck + emit, core before cli
npm test               # all packages, all prior gates included
git status --short     # must be clean after commit
```

Per-gate checklist:

- [ ] Tests were written **before** the implementation and observed failing for the right reason
- [ ] No new dependency in core — `npm ls --workspace @resume-blueprint/core --omit=dev`
- [ ] Prior gates' tests pass **unmodified**; a changed old test means changed behavior, which needs a decision
- [ ] The injection fixture is exercised through the new surface
- [ ] Manual smoke test performed (real MCP client / real curl), not just unit tests
- [ ] Committed with a conventional-commit message explaining *why*

---

## Working across sessions

Phase 2 is designed to be built in three sessions, one per gate. Each gate's exit criteria
are written so a session with no prior context can verify them.

**Start each session from this directory** (`~/Desktop/tools/resume-blueprint`), not its
parent. The retired upstream clone sits beside it at `~/Desktop/tools/resumake.io`;
starting from the parent puts two near-identical template sets in scope and invites
confusion between the vendored originals and the fixed copies.

**Open narrowly.** *"Read CLAUDE.md and docs/phase-2-plan.md, then start Gate 1"* beats
"look at the project", which invites an expensive crawl through 4.5MB of font binaries.

**Commit at each gate**, so any session can be abandoned without losing work.

**Recover context from `git log`, not from re-reading source.** Phase 1's commit messages
were written to carry rationale forward; `git log -S<line>` finds why a specific line
exists. Note that Claude Code's memory is keyed by directory and does not follow the repo
— `CLAUDE.md` is the mechanism that travels with the code.

---

## Verification (end of Phase 2)

```bash
cd ~/Desktop/tools/resume-blueprint
npm run build && npm test

# store — agent edits are visible as ordinary git commits
git -C ~/.resume-blueprint log --oneline

# mcp — from a real Claude Code session
claude mcp add resume-blueprint -- node ~/Desktop/tools/resume-blueprint/packages/mcp/dist/index.js
# then: resume_create → resume_section_append → resume_render, confirm a real PDF path

# http
curl -sS -X POST localhost:8787/render -H 'content-type: application/json' \
  --data @fixtures/sample.json -o /tmp/b.pdf && head -c5 /tmp/b.pdf   # %PDF-
```

Open `/tmp/b.pdf` and confirm employer names render — the same end-to-end check that
caught the Phase 1 defect.
