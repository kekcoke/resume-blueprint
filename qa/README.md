# `qa/` — the cross-adapter QA harness

Four callers reach the same core: the CLI, the HTTP adapter, the MCP server,
and markdown master-profiles through the importer. Each is well tested in its
own package, and nothing tests them **against each other**. This directory is
that missing layer.

Everything here is a *sample invocable*: a runnable, readable example of how to
drive one surface, which also happens to assert the right answer. That dual
role is deliberate — documentation that is executed cannot rot quietly.

```
qa/
  contract.md     the expectation matrix -- start here
  findings.md     15 issues surfaced while building this; nothing was fixed
  run.mjs         driver: preflight -> isolated store -> suites -> matrix
  lib/            reporter, preflight, scratch home, http boot, MCP pipe
  cli/            *.sh          -- the CLI, driven as a user would
  http/           *.sh + collection.json  -- curl, and a Postman import
  mcp/            *.jsonl + *.sh -- literal JSON-RPC sessions
  markdown/       *.sh          -- the master-profile importer
```

## Running it

```bash
npm run build        # the suites drive dist/, never src/
npm run qa:preflight # environment only -- run this first if anything is odd
npm run qa:all       # everything; ~1 minute, dominated by real Tectonic compiles
npm run qa:cli       # or one suite at a time
npm run qa:http
npm run qa:mcp
npm run qa:md
```

The report ends with a coverage matrix — one row per contract id, one column
per suite — and exits non-zero if anything failed. A `SKIP` is an environment
fact (no `pdfinfo`, say), not a failure, and is always shown.

## Running one script by hand

Every script stands alone. That is the point: when a row goes red you want to
run *that one thing* and watch it, not re-run the suite.

```bash
bash qa/cli/01-render-sample.sh
bash qa/markdown/04-end-to-end.sh

# http needs a server; BASE_URL defaults to http://127.0.0.1:8787
npm run start:http &
bash qa/http/01-render-stateless.sh

# mcp sessions are literal JSON-RPC
RESUME_BLUEPRINT_HOME=$(mktemp -d) node qa/lib/mcp-pipe.mjs qa/mcp/01-render.jsonl
```

Three scripts need something only the driver sets up, and skip with
instructions when it is missing: `http/07-auth.sh` (a token-protected server),
`http/08-render-failure.sh` (a server with no `tectonic` on PATH), and the
`pdfinfo`-gated page-count assertion in `http/01`.

## The store is never your real one

`packages/store/src/paths.ts:resolveHome()` reads `RESUME_BLUEPRINT_HOME` **at
call time** and falls back to `~/.resume-blueprint`. So a harness that forgets
to set it does not fail — it quietly commits fixture junk into your real,
git-backed blueprint store.

That is the worst thing this directory could do, so isolation is enforced
twice: `run.mjs` mints a fresh temp home per script (`lib/scratch.mjs`), and
`assertIsolated()` refuses to start if the variable is unset or points at the
real store. `qa_init` in `lib/assert.sh` does the same for a script run by
hand, minting its own throwaway home. Set `QA_KEEP_SCRATCH=1` to keep them for
inspection.

**Profile fixtures come from `fixtures/`, never `profile_templates/`.** That
directory is gitignored because it holds real personal data — the whole point
of feature F0. `fixtures/profile.md` and `fixtures/profile-injection.md` are
synthetic stand-ins that reproduce the real grammar deliberately.

## No new dependencies

The root `package.json` has no dependencies and this harness keeps it that way.
`run.mjs` and `lib/` are node builtins only; the external tools are `curl` and
the `tectonic`/`poppler` the project already requires. In particular there is no
`jq` (not a declared dependency of this repo) and no MCP client library — the
`.jsonl` sessions are the raw protocol, which is what makes them readable.

## How a script reports

Scripts print `RESULT <contract-id> PASS|FAIL|SKIP <label>` lines. A human reads
them directly; `run.mjs` parses them into the matrix. That is the *only*
coupling between the two, in one direction, which is why every script still
works with no driver at all.

A script that exits non-zero without emitting a single `RESULT` line is recorded
as a failure on every row named in its `# contract:` header. Silence never reads
as success.

## The Postman collection

`qa/http/collection.json` is **generated**, not hand-maintained:

```bash
node qa/run.mjs --emit-collection
```

It is extracted from the `curl` invocations in `qa/http/*.sh`, with fixture
bodies inlined so the import is self-contained. Generating rather than curating
is what stops the collection and the tests drifting apart. Regenerate it in the
same commit as any HTTP script change. Set `{{baseUrl}}`, and `{{token}}` only
if the server has `RESUME_BLUEPRINT_TOKEN` set.

Three requests are deliberately absent — the 6 MiB oversize probe and the
40-deep nesting probes build their bodies at run time, and there is nothing
useful to inline. The collection's description says so rather than dropping them
silently.

## Adding a row

See the end of `contract.md`. Briefly: the contract changes first, the scripts
follow, and if a surface cannot express the scenario that is a finding, not a
`—`.
