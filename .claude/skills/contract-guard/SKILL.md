---
name: contract-guard
description: Checklist for adding or changing a caller surface — invariants, contract row, injection test, and sample invocable.
---

# contract-guard

Run through this before adding a route, a tool, a CLI command, or changing what
an existing one returns. It is short because the repo's invariants are few and
each one is expensive to break quietly.

## When to Use

- Adding an HTTP route, an MCP tool, or a CLI subcommand.
- Changing the response shape, status code, exit code, or error message of one
  that exists — those are the interface, not implementation detail.
- Adding any surface that accepts a blueprint from outside.
- Adding a limit: a timeout, a size cap, a depth guard, a concurrency cap.

## How It Works

**1. The three invariants in CLAUDE.md.** Walk them explicitly; do not assume.

- *Store raw, sanitize only at render time.* `sanitizeBlueprint` is **not
  idempotent** — `R&D` → `R\&D` → `R\textbackslash{}\&D`. Any surface that
  writes to storage must write raw user text. If your change moves data toward
  persistence, this is the invariant it is most likely to break, and the damage
  compounds silently on every later edit.
- *MCP never writes to stdout, and never returns PDF bytes.* stdout **is** the
  JSON-RPC transport; one `console.log` corrupts the stream and fails
  confusingly. Diagnostics go to stderr. PDFs are returned as
  `{path, pageCount, byteSize}`.
- *Core stays free of adapter and UI concerns.* `packages/core` knows nothing
  about MCP, HTTP or argv and performs no I/O it was not handed. Its runtime
  dependencies are `zod` and `common-tags`; a third needs a real justification.

**2. Add the contract row first.** In `qa/contract.md`, with the exact
observable outcome for **every** surface the scenario touches — not just the one
you are changing. If a surface has no way to express it, write **no surface** and
open a finding in `qa/findings.md`. Writing `—` for a gap is how G3 became
invisible for as long as it did.

**3. Test against the injection fixture.** CLAUDE.md requires it: *any* new
surface that accepts blueprints must route through the same sanitize path and be
tested against `fixtures/injection.json`. Add the assertion to the relevant
`qa/<suite>/*.sh` — and note that `fixtures/injection-document.json` is the
other half, where hostile input must be **rejected by the schema** rather than
escaped, because those fields are enums and clamped numbers rather than free
text.

**4. Add the sample invocable.** One for each caller the change affects:
`qa/cli/*.sh`, `qa/http/*.sh`, `qa/mcp/*.jsonl` + `*.sh`, `qa/markdown/*.sh`.
Tag it with the contract id in its `# contract:` header so a crash is attributed
to the right row. If you touched HTTP, regenerate the Postman collection with
`npm run qa:collection` in the same commit.

**5. Check the symmetry.** The question that catches the most: *does the other
adapter do this too, and if not, why not?* Most findings in `qa/findings.md` are
one surface having a guard, a limit or a capability another lacks. A new limit
on one adapter is a decision about all of them.

**6. Unit test as well.** The `qa/` harness proves the surfaces agree; it is not
a replacement for a test in `packages/*/test/`. Those import from `../dist/`, not
`../src/` — Node's type stripping does not remap `.js` specifiers to `.ts`, and
importing the build is what exercises what actually ships.

## Examples

Adding `POST /blueprints/:id/validate` to close part of finding G3:

1. Invariants — read-only, stores nothing, returns JSON. Clean on all three.
2. `qa/contract.md` C3: fill in the HTTP cell, which currently reads `400`
   only for the render path.
3. Add `fixtures/injection.json` and `fixtures/injection-document.json` cases to
   `qa/http/02-render-invalid.sh` or a new script.
4. New `qa/http/09-validate.sh`, `# contract: C3, C17`; run
   `npm run qa:collection`.
5. Symmetry — MCP has `resume_validate`, the CLI has `resume validate`. This
   closes a gap rather than opening one. Note whether the citation `warnings[]`
   come across too, since that is the specific loss G3 describes.
6. Unit test in `packages/http/test/`.
