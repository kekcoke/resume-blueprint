---
name: qa-sweep
description: Run the cross-adapter contract harness in qa/, whole or scoped to one surface, and report by contract row.
---

# qa-sweep

Runs the `qa/` harness and reports the result as a contract matrix, naming each
failing row by its id.

## When to Use

- After changing anything in `packages/cli`, `packages/http`, `packages/mcp`, or
  `packages/core`'s render path — the unit tests will not notice a *cross*-adapter
  regression, because none of them spans two adapters.
- Before opening a PR that touches a caller surface.
- When something works through one caller and not another. That gap is the exact
  thing this harness exists to localise.
- Scoped (`/qa-sweep http`) while iterating on one adapter — the full sweep is
  about a minute, a single suite is seconds.

Not a substitute for `npm test`. The 584 unit tests are faster and finer-grained;
this proves the four surfaces still agree.

## How It Works

1. **Build first.** `npm run build`. The suites drive `dist/`, never `src/`, so a
   stale build produces failures that describe code no longer on disk.
2. **Preflight.** `npm run qa:preflight` — node version, `tectonic`, `pdftotext`,
   `curl`, and whether any package's `src/` is newer than its `dist/`. It also
   refuses to run if `RESUME_BLUEPRINT_HOME` would resolve to the user's real
   `~/.resume-blueprint`.
3. **Run.** `npm run qa:all`, or the suite named in the argument:
   `qa:cli`, `qa:http`, `qa:mcp`, `qa:md`.
4. **Report.** Give the matrix, then for each failing row: the contract id, what
   `qa/contract.md` says should happen, what happened, and — the part that
   matters — **whether it is a regression or a stale contract row.**

A regression means the code moved and the contract did not: fix the code. A stale
row means the behaviour changed deliberately and the table did not follow: fix the
table, in the same change, and say so. Never edit `qa/contract.md` to go green
without stating which it was.

A `SKIP` is an environment fact (no `pdfinfo`; no auth server when a script is run
by hand), not a failure. Report it and move on.

## Examples

```
/qa-sweep              # every suite
/qa-sweep http         # just the HTTP contract rows
/qa-sweep mcp          # just the MCP session rows
```

Reproducing one failing row without the driver:

```bash
bash qa/cli/07-render-failure-modes.sh
QA_TRACE=1 node qa/lib/mcp-pipe.mjs qa/mcp/04-store-errors.jsonl
QA_KEEP_SCRATCH=1 npm run qa:mcp     # keep the temp store to inspect
```

If the failure is a Tectonic compile rather than a contract mismatch, hand it to
the `render-triage` agent — it knows `--keep-temp`, the `CORE_BUILD` staleness
stamp, and which failures are `--untrusted` working as intended.
