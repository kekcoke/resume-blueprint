# `qa/plan/` — the phase graph, as data

`docs/orchestration.md` Part B designed the G1–G15 phase. This directory is that
design in a form something other than a human can read.

```
qa/plan/
  graph.json       16 nodes: deps, mutexes, blast radius, acceptance predicates
  next.mjs         the resolver -- what is ready, what holds what, brief a node
  baseline.json    expected status per contract row per suite
  mutations.json   the negative control, as a registry
  negative-control.mjs   break it, prove the row goes red, revert
  evidence.json    rows ever observed FAIL -- the answer to Track 4's question
  last-run.json    most recent `qa/run.mjs --json` (generated)
```

## The loop

```bash
node qa/plan/next.mjs --ready              # what can start now, and why not otherwise
node qa/plan/next.mjs --claim G12
claude -w lane-c-g12 --model sonnet --permission-mode acceptEdits \
  -p "$(node qa/plan/next.mjs --brief G12)"
node qa/run.mjs --check-baseline           # flips only
node qa/plan/next.mjs --release G12 --done
```

## Three design points worth stating

**A mutex is a field, not an edge.** A3 says modelling exclusion as an edge
invents false ordering and loses parallelism. `blockedBy` constrains order;
`mutex` constrains concurrency; they are checked separately and mean different
things. `next.mjs --conflicts` derives the register from the mutex fields rather
than restating it, for the same reason `qa/http/collection.json` is generated:
B3's own warning is that a register written from memory is worse than none,
because it is trusted.

**A gate is a missing file.** A node with `check: "gate"` is unreachable until
`docs/decisions/<id>.md` exists. See `docs/decisions/README.md`.

**One claim file per node, in the git common dir.** Two separate points.

*One file per node* — a single `state.json` would be exactly the shared mutable
artifact A4 warns about: an interface between lanes, with the last writer
silently winning. Three worktrees writing three paths cannot collide.

*In the common dir, not the working tree* — load-bearing, and wrong in the first
cut of this directory. `git worktree` gives each lane its own checkout, so a
claim written under `qa/plan/claims/` is invisible to every other lane: the
mutex would stop working precisely when three lanes are open, which is the only
time it does anything. Every worktree of a clone shares one
`git rev-parse --git-common-dir`, so claims live in
`<common-dir>/qa-plan-claims/` and are visible everywhere instantly, no commit
required.

That also settles what a claim *is*: ephemeral coordination state, like a lock
file. Not a reviewable artifact, and not something to commit. `--where` prints
the directory in effect.

**Run `--ready` and `--claim` from anywhere in the clone.** Because claims are
shared, the primary checkout on `main` and any lane worktree give the same
answer. Do the *work* on a branch; the coordination call is
location-independent.

## What transcribing the graph found

B3's conflict register was written from a `grep -l` + `comm -12` pass, and K9
records a collision that pass caught. Encoding the same information as data,
with `next.mjs --check` looking for the K9 *shape* rather than for K9 itself,
found four more — all of them cross-lane, all of them in the lanes B3 calls
"non-conflicting by construction":

| | Collision | Consequence |
|---|---|---|
| K10 | G2 (lane A) edits `qa/contract.md`, which K1 reserves for lane B | its own acceptance test says "C15's MCP row updated" |
| K11 | G11 (lane B) edits `packages/http/src/routes.ts` | K9 caught G6/G14 on this file and moved G14; it did not look at G11 |
| K12 | G2 and G11 both edit `packages/mcp/src/tools.ts` | different lanes, same file |
| K13 | G5, G4 and G1 all rewrite regions of `packages/cli/src/index.ts` | G5 is lane A; G4 and G1 are lane B |

Together these say something the prose graph could not: **Phase 2's three-lane
parallelism does not survive contact with the file sets.** G5 alone holds
`routes.ts` and the CLI entry point, so while it is open, G4, G6, G11, G14 and
G1 are all withheld. The practical shape is G5 first and alone, with lane C
running beside it, and the lanes opening behind it.

The resolver enforces that without anyone having to redraw the graph — which is
the argument for making it data in the first place.
