# Findings

Fifteen issues surfaced while building the harness and reading the four caller
surfaces against each other. **Nothing in `packages/` was changed to address
them.** The QA layer lands reviewable on its own; these get triaged separately.

Severity is impact on a production-grade MVP, not on the code as a local tool.
Several are deliberate local-first decisions that stop being adequate the
moment a second caller or a second machine is involved — those are marked as
such rather than described as bugs.

Where a finding is observable, the harness asserts **current** behaviour and
says so in a comment, so that fixing it turns the row red and forces
`qa/contract.md` to be updated in the same change. G4 and G11 are pinned that
way today.

| # | Finding | Severity |
|---|---|---|
| [G1](#g1) | CLI collapses every failure to exit 1 | medium |
| [G2](#g2) | MCP has no render concurrency cap | medium |
| [G3](#g3) | HTTP exposes 8 routes against MCP's 18 tools | **high** |
| [G4](#g4) | `--timeout` is the one unvalidated numeric CLI flag | low |
| [G5](#g5) | Four different render-timeout ceilings, no shared constant | medium |
| [G6](#g6) | HTTP 503 carries two unrelated meanings | medium |
| [G7](#g7) | No `tectonic` presence check in the test suite | medium |
| [G8](#g8) | Tests are never typechecked | medium |
| [G9](#g9) | No linter or formatter | low |
| [G10](#g10) | CI fetches the Tectonic bundle per run | **high** |
| [G11](#g11) | The depth guard is applied asymmetrically | medium |
| [G12](#g12) | README drift | low |
| [G13](#g13) | `store.list()` silently drops unreadable blueprints | low |
| [G14](#g14) | `renderStored` reads the store before acquiring a render slot | low |
| [G15](#g15) | F12 residue still open | low |

---

## G1
### CLI collapses every failure to exit 1 — medium

**Evidence.** `packages/cli/src/index.ts:360` — the top-level catch branches
five ways to produce five different *messages*, then every branch ends
`process.exit(1)`.

A calling script therefore cannot distinguish a typo in a flag, a schema
failure, a missing TeX engine and a transient compile timeout. HTTP separates
that same taxonomy into seven statuses; the information exists, it is just
discarded on the way out. `qa/cli/07-render-failure-modes.sh` shows the two
render failures and the schema failure all exiting 1.

**Proposed fix.** Keep 1 as the catch-all and add: `2` usage/flag error,
`3` validation, `4` render, `5` busy/transient. Exit codes are an interface, so
this is a breaking change for anything already branching on 1 — worth doing
before an MVP freezes it.

**Size.** Small — one function, plus the contract rows.

## G2
### MCP has no render concurrency cap — medium

**Evidence.** `packages/mcp/src/tools.ts:411` runs `renderBlueprint` **outside**
`withRenderLock`, which starts at `:421` and wraps only the file write and the
prune. The lock is keyed by blueprint id and exists to stop `pruneOldRenders`
racing its own `readdir → stat → unlink`; it was never a concurrency cap and
does not act as one.

HTTP caps at 4 (`packages/http/src/renderLimit.ts`) precisely because each
render is a real subprocess with real CPU cost. MCP has the same cost and no
cap: N parallel `resume_render` calls spawn N `tectonic` processes.

This is *observable in the harness transcript*: in `qa/mcp/01-render.jsonl` the
response to id 5 arrives before the response to id 4, because both renders are
in flight at once. `qa/mcp/08-concurrency.sh` deliberately uses 20 rather than
200 for exactly this reason.

**Counter-argument, stated fairly.** MCP has one stdio client, and an agent
issuing 200 simultaneous renders is not a realistic threat the way an open port
is. That is why this is medium and not high.

**Proposed fix.** Reuse `renderLimit.ts` from a shared location, or add the
equivalent to `packages/mcp/src/render.ts`. Unlike HTTP, MCP should probably
*queue* rather than reject — an agent has no sensible retry behaviour for
"busy".

**Size.** Small, once the shared-module question is settled.

## G3
### HTTP exposes 8 routes against MCP's 18 tools — high

**Evidence.** `packages/http/src/server.ts:26-35` lists eight routes.
`packages/mcp/src/tools.ts` registers eighteen. HTTP has no equivalent of
`resume_validate`, `resume_tex`, `resume_text`, `resume_target`,
`resume_history`, `resume_diff`, `resume_revert`, `resume_import`, or any of
the three `resume_section_*` tools.

The consequence is not just "fewer endpoints". n8n — the caller HTTP exists for
— structurally cannot do what a local agent can. Two concrete losses:

- **No citation-warning surface at all.** CLI writes warnings to stderr; MCP
  returns `warnings[]` in `structuredContent`. HTTP returns PDF bytes and has
  nowhere to put them, so an automated pipeline renders a resume with
  `[cite: 1, 2]` typeset into it and never finds out. Already noted in F8's
  addendum; rows C17 and C18 in `qa/contract.md` record it as **no surface**.
- **No import route**, so the markdown path — the way a profile actually enters
  the system — is unavailable to the automation caller.

**Proposed fix.** Not "add ten routes". Decide first whether HTTP is a
deliberate subset (in which case say so in the README and close the citation
gap specifically), or an incomplete adapter (in which case fill it in). The
current state reads as the second by accident.

**Size.** Medium to large, and the decision matters more than the code.

## G4
### `--timeout` is the one unvalidated numeric CLI flag — low

**Evidence.** `packages/cli/src/index.ts:345` —
`values.timeout ? Number(values.timeout) : undefined`. Every other numeric flag
(`--font-size`, `--line-spacing`, `--max-terms`) goes through `parseNumberFlag`,
which exists specifically to reject non-finite input with a `CliError`.

`--timeout abc` therefore becomes `NaN`, and the run dies with
`Tectonic timed out after NaNms` — a message describing a timeout that never
happened. Pinned as current behaviour in
`qa/cli/07-render-failure-modes.sh`.

**Proposed fix.** Route it through `parseNumberFlag` like its three siblings.

**Size.** One line, plus flipping the contract row.

## G5
### Four different render-timeout ceilings, no shared constant — medium

**Evidence.**

| Surface | Budget | Caller-settable |
|---|---|---|
| core default | 60 s | via option |
| CLI | whatever `--timeout` says (unvalidated, see G4) | yes |
| HTTP | 180 s, hardcoded at `packages/http/src/routes.ts` | no |
| MCP | caller's `timeoutMs`, capped at 300 s in `schemas.ts` | yes |

Each is individually justified in a comment — and the four justifications were
written independently, so the same document can take 60 s, 180 s or 300 s
depending only on which door it came through. There is no single place to look
up "how long may a render take", and nothing fails if the four drift further.

**Proposed fix.** One exported constant in core for the default and one for the
hard ceiling; adapters express their policy as a clamp against those rather
than as a literal.

**Size.** Small.

## G6
### HTTP 503 carries two unrelated meanings — medium

**Evidence.** `packages/http/src/routes.ts` returns 503 with
`Retry-After: 5` for render-cap rejection. `packages/http/src/errors.ts` maps
`LockTimeoutError` to 503 **without** `Retry-After`. Only the message string
separates "busy, try again in five seconds" from "another process has held the
store lock for 35 seconds and something is probably wedged".

The second is an operational incident; the first is normal load. A caller
retrying identically on both will hammer a wedged store.

**Proposed fix.** Cheapest correct step: set `Retry-After` on both, with very
different values, and keep the messages distinct. Better: give the lock timeout
its own status (`409` or a 5xx that is not 503) so the two are branchable.

**Size.** Small.

## G7
### No `tectonic` presence check in the test suite — medium

**Evidence.** `packages/core/test/ats.test.ts:75-84` defines `hasBinary` and
gates the poppler-dependent assertions on it, so a machine without
`pdftotext` skips them cleanly. `render.test.ts:330` does the same. Nothing
does this for `tectonic` — it is simply assumed, and its absence surfaces as a
wall of render failures rather than "the engine is not installed".

**Proposed fix.** Reuse the existing `hasBinary` and fail *once*, early, with
the install hint core already knows how to print. Note that CI deliberately
treats a missing poppler as a hard failure — that intent should be preserved,
not flattened into a skip.

**Size.** Small. `qa/lib/env.mjs` does this for the QA layer already and can be
the model.

## G8
### Tests are never typechecked — medium

**Evidence.** All five `packages/*/tsconfig.json` set
`"include": ["src/**/*.ts"]`. Tests live in `packages/*/test/` and run through
Node's type stripping, which **erases** types without checking them. A test can
assert against a property that does not exist, or pass an argument of the wrong
type, and both build and test stay green.

**Proposed fix.** A second `tsconfig.test.json` per package including `test/`
with `noEmit`, run in the `build` or `test` script. It cannot simply be added
to the main `include` — that would emit the tests into `dist/`.

**Size.** Small, but expect it to surface real errors on first run.

## G9
### No linter or formatter — low

**Evidence.** No ESLint or Prettier config anywhere in the repo, and no
`lint` script. CLAUDE.md nonetheless prescribes an exact style ("no semicolons,
single quotes, no trailing commas"), which is currently enforced only by
whoever is reading the diff.

**Proposed fix.** Prettier with that config plus a `lint` script. ESLint is a
larger conversation; Prettier alone removes the ambiguity CLAUDE.md creates.

**Size.** Small.

## G10
### CI fetches the Tectonic bundle per run — high

**Evidence.** `.github/workflows/ci.yml` caches `~/.cache/Tectonic` and pins
the 0.17.0 binary, but the TeX **package bundle** is still fetched from
`relay.fullyjustified.net` on any cache miss. The workflow documents its own
failure signatures in a comment at lines 29-40: exit 1 with `429 Too Many
Requests` on a moving subset of templates, and exit 101 — a Rust panic —
within 350 ms on all ten. It also records that `max-parallel: 1` did **not**
fix it, and names the durable fix:

> The real dependency is `relay.fullyjustified.net` being reachable and
> unthrottled from the runner, and the durable fix is to stop fetching
> per-run: pin the bundle and pass `--bundle <path>`.

That fix is unimplemented. The cache key includes `hashFiles(...templates/*.ts,
...assets/**)`, so **every template edit invalidates it** — precisely the change
most likely to be under test.

This is the single largest stability risk in the repo: CI's green depends on a
third-party host's mood, and the failure mode looks like a code failure.

**Proposed fix.** Vendor or release-pin the bundle, commit its checksum, and
pass `--bundle`. Separate the bundle cache key from the template hash so a
template edit does not force a refetch.

**Size.** Medium. Mostly the bundle-hosting decision.

## G11
### The depth guard is applied asymmetrically — medium

**Evidence.** `assertReasonableDepth` exists twice — `packages/mcp/src/validate.ts`
and `packages/http/src/body.ts` — and both copies document the duplication as
deliberate (a shared package for one 8-line helper being disproportionate).
Fine. The problem is where it is *called*:

| Entry point | Guarded |
|---|---|
| `POST /blueprints` (`body.blueprint`) | yes |
| `PATCH /blueprints/:id` (`body.patch`) | yes |
| `resume_patch` (`patch`) | yes |
| **`POST /render`** (whole body) | **no** |
| **`resume_create`** (`blueprint`) | **no** |

The guard's stated purpose is protecting store's `applyMergePatch` from
unbounded recursion, and `resume_create` reaches the store. `POST /render` does
not, but it does hand an arbitrarily nested object to zod. Pinned as current
behaviour in `qa/http/04-limits.sh`.

**Proposed fix.** Apply it at both remaining entry points. If `POST /render` is
deliberately exempt, say so in a comment — the other three all explain
themselves and this silence reads as an oversight.

**Size.** Two lines, plus flipping the contract row.

## G12
### README drift — low

**Evidence.**

- The CLI section documents `--template` and `--output` but omits `--timeout`,
  `--keep-temp`, `--font`, `--font-size`, `--margin`, `--line-spacing`, `--jd`,
  `--max-terms`, `--json` and `--strict`. `resume --help` lists all of them.
- Nothing documents the 4-render cap, the 5 MiB body limit, the 413/422/503
  statuses, or `Retry-After` — all of which a caller integrating against HTTP
  needs before they need anything else on that page. The new `qa/` section
  points at `qa/contract.md`, which now states all of it, but the HTTP section
  itself still does not.

Two items from this finding were fixed while adding the `qa/` section, since
both were single-token corrections in a file already being edited: the
architecture mermaid said "9 templates" against ten (`README.md:295`), and the
test count read 579 against the 584 `npm test` reports.

**Proposed fix.** Regenerate the flag list from `USAGE`, and add a short
response-contract section to the HTTP docs.

**Size.** Small.

## G13
### `store.list()` silently drops unreadable blueprints — low

**Evidence.** `packages/store/src/index.ts:216-228` — the per-file `try` ends in
a bare `catch { continue }`, with the comment "One malformed file shouldn't take
down the whole listing." The intent is right; the execution loses the event
entirely. A blueprint that fails to parse does not appear in `list()` and
nothing anywhere says why, so from the caller's side it has simply ceased to
exist.

**Proposed fix.** Keep skipping, but `console.error` the id and reason (stderr
only — invariant 2), or return the id with an `error` field so a UI can show
"1 blueprint could not be read".

**Size.** Small.

## G14
### `renderStored` reads the store before acquiring a render slot — low

**Evidence.** `packages/http/src/routes.ts:183` — `store.get(params.id)` runs,
then `withRenderLimit` decides whether there was ever a slot. A request destined
for 503 still pays a store-lock acquisition and a file read. `postRender` has
the same ordering but it costs only a body parse.

Not a correctness bug; the cap still holds. It is a fairness one: under exactly
the load the cap exists for, rejected requests contend for the store lock with
the ones being served.

**Proposed fix.** Acquire the slot first, then read.

**Size.** A few lines. Note the ordering is *load-bearing* for the 404: a
missing id must still 404 rather than 503, so the fix has to keep that.

## G15
### F12 residue still open — low

Carried forward from `docs/next-features.md`, unchanged and still true:

- `basics.profiles[].username` renders as unlinked text even when a `url` is
  present.
- `packages/core/src/templates/template4.ts:374,393` — vendored upstream
  `% TODO:` and `% Known Issues:` comments ship into every generated `.tex`.
- template7's `\moderncvstyle{banking}` change (commit `46bf555`) was never
  visually reviewed.

**Size.** Small each; the third is a look, not a change.
