# Orchestration

How sessions are *run*, as distinct from what they build. `docs/next-features.md` was the
what; this is the how.

**Status when written:** the QA layer has shipped (PR #19) — `qa/contract.md`, 210
assertions across four callers, three agents, three skills, and `qa/findings.md` with
fifteen findings deliberately **reported, not fixed**, so `packages/` stayed untouched.
The next phase is closing G1–G15 on the way to a production-grade MVP.

---

## Why this document exists

F0–F13 were executed the way the phase before them was: one long interactive session per
feature, serial, with a human reading every diff. That worked because those features were
sequential by nature — F3 genuinely had to land before F4, F5 and F7.

G1–G15 are not like that. Four of them are one-line changes with a test already pinned to
assert the *wrong* answer on purpose. Three touch every file in the repo. One is a decision
with no code in it at all. Several can honestly run at the same time in separate worktrees.

Running that with no declared boundaries is where an agentic loop goes wrong — and the
failure is rarely bad code. It is a merge nobody can review, or three lanes editing
`qa/contract.md` at once and the last writer silently winning.

Two sections follow. **Part A** is the pattern, written to transfer to another repo.
**Part B** is this phase, concretely. **Part C** is a learning plan for the material
underneath both.

---

# Part A — the pattern

## A1. A graph, not a queue

A backlog is a list. Work is a directed graph. The list format hides the only two facts
that determine throughput:

- what genuinely **blocks** what, and
- what two pieces of work **cannot be touched at the same time**.

Those are different relationships and they need different treatment. Blocking is an edge
in the graph. Mutual exclusion is *not* an edge — it is a mutex, and it belongs in a
conflict register, because two nodes can conflict without either depending on the other.
Modelling a mutex as an edge is how a graph acquires false ordering and loses its
parallelism.

## A2. Node taxonomy

Four kinds, because each routes to a different model, a different checkpoint, and a
different definition of done.

| Kind | Characteristic | Done means | Example |
|---|---|---|---|
| **Mechanical** | bounded edit, mechanical verification, fails loudly | a named test flips | G4, G11 |
| **Judgment** | the code is trivial; deciding what it should do is the work | a written decision | G3 |
| **Exploratory** | blast radius unknown until you start | a report, then a scoped plan | G8 |
| **Verification** | proves other nodes; produces no product change | the check itself passes *and* fails when it should | the negative control |

The distinction that matters most is **judgment vs. mechanical**. A judgment node handed
to an agent as if it were mechanical produces a confident implementation of an undecided
question — the most expensive failure in this taxonomy, because it looks like progress.

## A3. Edge semantics

```
A ──blocks──►  B     B cannot start until A lands
A ──unblocks─► B     B can start, but A releases its value
A ──conflicts─ B     NOT an edge; a mutex. See the conflict register.
```

`blocks` constrains ordering. `unblocks` constrains *value* and is what tells you which
node to do first when several are ready. `conflicts-with` constrains concurrency only.

## A4. The shared mutable artifact

**Every phase has one file that every lane wants to write.** Finding it before starting is
the highest-value single step in this document.

Last phase it was `fixtures/golden/*.tex` — F3, F4, F5, F6 and F7 all rewrote it, which is
why `docs/next-features.md`'s conflict register opens with "strictly serial, one per
session". This phase it is **`qa/contract.md`**: seven of its rows describe CLI exit codes,
and the node that changes exit codes moves all seven.

The tell is always the same: a file that is an *interface between* work items rather than
the product of one. Golden snapshots are the interface between templates. A contract table
is the interface between adapters. Whatever plays that role is the mutex.

## A5. Human-in-the-loop checkpoints

Four kinds, separated by whether they block and when they fire:

| Kind | Blocks | Fires | Use for |
|---|---|---|---|
| **Gate** | yes | before the work | judgment nodes, interface changes, anything touching real user data |
| **Review** | yes | after the work | every PR |
| **Notify** | no | on completion | a lane finished; a background agent exited |
| **Tripwire** | halts immediately | on violation | the hard stops in A6 |

The design point, stated plainly: **a gate on every node is a serial process wearing a
graph costume.** If a human has to approve before each of fifteen nodes, the graph bought
nothing — you have paid the coordination cost of parallelism and kept the latency of
serial work.

Gates go where a wrong answer is expensive *and* cannot be detected automatically. If a
test can catch it, that is a review, not a gate.

## A6. Guardrails, in three layers

Layers, not a list, because each catches what the one above it cannot.

**Layer 1 — permission.** `.claude/settings.local.json` holds the allowlist. It currently
permits `npm test`, `npm run *`, `git add/commit/push/checkout`, `gh pr *`, and
`git check-ignore`.

An allowlist communicates through its *omissions*, so state them: there is no `Bash(rm *)`,
no `Bash(curl *)`, and `--dangerously-skip-permissions` is not used in this repo. A
destructive command therefore stops and asks. That is the intended behaviour, not friction
to be engineered away.

**Layer 2 — blast radius.** Each lane declares the paths it may touch. Anything outside is
stop-and-ask, not a judgment call for the agent. This is what keeps a "fix G13" session
from opportunistically refactoring something adjacent — the change might even be good, but
it lands in a diff reviewed under a different premise.

**Layer 3 — tripwires.** Five hard stops. Each is drawn from an actual invariant in
`CLAUDE.md` or an actual failure mode of this harness, not invented for symmetry:

1. **The real store is written.** `~/.resume-blueprint` gains a commit or goes dirty.
   `resolveHome()` reads `RESUME_BLUEPRINT_HOME` at call time and falls back to that path,
   so this is a real and easy accident.
2. **Golden snapshots re-baselined without an explanation of the diff.** Re-baselining to
   make a test pass is how a genuine regression gets committed as a snapshot.
3. **`qa/contract.md` edited to make a run go green** without stating whether the red row
   was a regression or a stale row.
4. **`packages/core` gains a runtime dependency.** Its deps are `zod` and `common-tags`;
   a third needs a real justification (CLAUDE.md invariant 3).
5. **Anything reaches MCP's stdout.** stdout *is* the JSON-RPC transport (invariant 2).

Tripwires 1 and 5 are already enforced mechanically — by `assertIsolated()` in
`qa/lib/scratch.mjs` and by `mcp-pipe.mjs` collecting non-protocol stdout lines. Tripwires
2, 3 and 4 are currently social. Promoting them to hooks is the Part C, Track 1 exercise.

## A7. Model routing — the rule

> **Sonnet** when the change is bounded, the acceptance test is stateable in one sentence,
> and a wrong answer fails loudly.
>
> **Opus** when the blast radius is unknown, the task is a judgment call rather than an
> edit, it crosses three or more packages, it changes an interface others depend on, or
> the failure mode is silent.

The single most useful heuristic sits inside that: **if you cannot state the acceptance
test in one sentence, it is not a Sonnet task** — not because Sonnet cannot write the code,
but because the task has not been specified well enough for *anything* to verify it, and
that under-specification is precisely what Opus's extra reasoning is spent on.

"Fails loudly" is doing real work in that rule too. G4 is a one-line change on any model;
it routes to Sonnet because contract row C23 already asserts the wrong answer, so a wrong
fix turns a row red immediately. G13 is a similarly small change with **no** test pinning
it — silent failure — which pulls it toward more care despite its size.

**Escalate in place, do not restart.** When a Sonnet run reveals the change is wider than
scoped, switch with `/model opus` in the same session. The accumulated context — files
read, dead ends eliminated — is the expensive part; the tokens are not.

## A8. Cost, latency, and when parallelism pays

The real cost of misrouting is not tokens. It is an unreviewable merge or a silent
regression. A Sonnet run that needs an Opus rescue costs more end-to-end than starting on
Opus, because you pay for the first attempt, the diagnosis that it was wrong, and the
redo — and you pay the second one with a polluted context.

**Parallel lanes pay when** there are three or more genuinely independent nodes, each
taking more than about ten minutes, with disjoint path sets. Below that, the coordination
cost — worktrees, merge order, re-running the suite per lane — exceeds the saving.

**Parallel lanes do not pay when** two nodes touch the same file. That is not slower, it is
*wrong*: you get a merge conflict in the best case and a silent last-writer-wins in the
worst. Lane B in Part B is serial internally for exactly this reason.

**Background agents suit verification far better than authoring.** A background run that
executes `npm run qa:all` and reports is ideal — bounded, no decisions, a clear artifact.
A background run that *writes code* returns a diff nobody watched being made, which
front-loads no work and back-loads all the review.

## A9. Failure and escalation

What a node does when it fails, and the signal that selects each:

| Signal | Response |
|---|---|
| Transient (flaky network, cold Tectonic cache) | retry in place, once |
| The change is wider than scoped | escalate model, same session |
| The acceptance test itself looks wrong | **stop** — this is a judgment node in disguise; escalate to human |
| Two attempts, no progress, no new information | abandon, record what was learned in `qa/findings.md` |

The third row is the one worth internalising. "The test seems wrong" is the moment a
mechanical node reveals itself as a judgment node, and continuing past it means an agent
deciding a specification question alone.

---

# Part B — the G1–G15 phase

## B1. The graph

```
PHASE 0 — serial, alone, in this order. Each touches everything; none may overlap.

G10 CI bundle pin ─────────► every later PR's CI becomes trustworthy
G9  Prettier + lint script ► rewrites every file; alone, or never
G8  typecheck the tests ───► may surface real errors across all five packages

PHASE 1 — decision node. No code.

G3  HTTP surface: deliberate subset, or incomplete adapter?
      └─► gates every future HTTP route, including the citation surface

PHASE 2 — three lanes, separate worktrees, merged in the order the register dictates.

  LANE A  core + adapters
    G5 shared timeout constants ──► G2 MCP render cap
    G6 split the two 503s ────────► G14 renderStored slot ordering
      [G6 and G14 both edit packages/http/src/routes.ts — serial within the lane]

  LANE B  contract-pinned  [SERIAL WITHIN LANE — all three edit qa/contract.md]
    G4 --timeout guard ─► G11 depth-guard symmetry ─► G1 CLI exit codes

  LANE C  low-risk, genuinely disjoint paths
    G7  tectonic presence check      packages/core/test/
    G12 README drift                 README.md
    G13 store.list() error reporting packages/store/src/index.ts

PHASE 3 — serial tail. Touches golden snapshots.

G15 F12 residue
```

**The single hard rule: Lane B is serial.** G1 moves seven contract rows (C3, C4, C6, C17,
C20, C22, C23) and G4's pinned assertion lives in **C23**. They collide on the same row,
not merely the same file.

## B2. Node table

Model, checkpoint and acceptance test per node. `sonnet`/`opus` are the `--model` aliases.

| Node | Work | Lane | Kind | Model | Check | Acceptance test |
|---|---|---|---|---|---|---|
| **G10-a** | Decide where the Tectonic bundle is hosted | 0 | judgment | `opus` | **gate** | A written decision naming the host and the checksum strategy |
| **G10-b** | Pin it, pass `--bundle`, split the cache key off the template hash | 0 | mechanical | `sonnet` | review | CI green twice consecutively with a cold cache |
| **G9** | Prettier config + repo-wide run + `lint` script | 0 | mechanical | `sonnet` | review | `npx prettier --check .` clean; `npm test` unchanged at 584 |
| **G8** | `tsconfig.test.json` × 5, then fix what it surfaces | 0 | exploratory | `opus` | **gate** after the report | Typecheck passes over `test/`; every error triaged, not silenced |
| **G3** | Decide: is HTTP a deliberate subset or an incomplete adapter? | 1 | judgment | `opus` | **gate** | A decision record in `docs/`; `qa/contract.md`'s two "no surface" cells resolve to a plan |
| **G5** | One shared default + one shared ceiling for render timeouts | A | mechanical | `opus` | review | Four packages read one constant; C23's bounds still hold |
| **G2** | Render concurrency cap for MCP | A | judgment | `opus` | **gate** | Queue-vs-reject decided and written; C15's MCP row updated |
| **G6** | Split render-cap 503 from lock-timeout 503 | A | mechanical | `sonnet` | review | The two are distinguishable without reading the message string |
| **G4** | Route `--timeout` through `parseNumberFlag` | B | mechanical | `sonnet` | review | C23's `NaN` assertion **goes red**, then is rewritten to expect a usage error |
| **G11** | Apply the depth guard to `POST /render` and `resume_create` | B | mechanical | `sonnet` | review | C8's "G11 still ungated" assertion **goes red**, then is rewritten |
| **G1** | Exit-code taxonomy: 2 usage / 3 validation / 4 render / 5 busy | B | judgment | `opus` | **gate** | Seven contract rows updated together; the change is called breaking in the commit |
| **G7** | `hasBinary` gate for `tectonic` | C | mechanical | `sonnet` | review | A machine without Tectonic reports it once, not as N render failures |
| **G12** | README flag list + HTTP response-contract section | C | mechanical | `sonnet` | review | Flag list matches `resume --help` exactly |
| **G13** | Report the swallowed error in `store.list()` | C | mechanical | `sonnet` | review | A corrupt blueprint is visible to the caller; stderr only |
| **G14** | Acquire the render slot before reading the store | A | mechanical | `sonnet` | review | C9's "unknown id returns 404" still passes — the ordering is load-bearing |
| **G15** | Three F12 residue items | 3 | mechanical | `sonnet` | review | Golden re-baselined **with** the diff explained |

**The non-obvious routing calls.**

- **G10 splits.** Choosing where to host a TeX bundle has no obvious right answer and real
  consequences; pinning it once chosen is mechanical. Splitting stops an Opus session from
  spending its reasoning on `curl` flags.
- **G8 is Opus purely for blast radius.** Adding a `tsconfig.test.json` is trivial; what
  it *surfaces* across five packages of previously unchecked test code is not.
- **G6 is Sonnet despite "medium" severity.** Severity measures impact, not difficulty.
  C15's contract row already defines done.
- **G5 is Opus despite being a constants change** — it crosses four packages (core, cli,
  http, mcp), which trips the three-package clause. Note that `packages/store`'s
  `LOCK_TIMEOUT_MS` is a *different* concept and must not be folded in.
- **G2 is a judgment node.** Its comment in `findings.md` argues MCP should probably
  *queue* rather than reject, unlike HTTP — an agent should not settle that alone.
- **G1 is Opus and gated** because exit codes are an interface. Anything already branching
  on exit 1 breaks.

## B3. Conflict register

Reviewed before starting. Each row is a real collision, checked against the files.

| # | Conflict | Resolution |
|---|---|---|
| K1 | **G1, G4 and G11 all edit `qa/contract.md`** — and G1 and G4 both edit row **C23** | Lane B is strictly serial, in the order G4 → G11 → G1. This phase's `fixtures/golden/` |
| K2 | G9's repo-wide format run rewrites every file | Phase 0, alone. Any concurrent diff becomes unreviewable. Land it before lanes open, or defer it to the end entirely |
| K3 | G5 and G2 both answer "where do shared adapter constants live" | G5 settles it and G2 consumes the answer. Never concurrent |
| K4 | G8 may surface type errors in test files other lanes are editing | Phase 0 gate. Lanes open only after the typecheck is clean |
| K5 | G15's template4 comment removal rewrites `fixtures/golden/template4*.tex` (3 of 25 files) | Phase 3, serial. Re-baseline at the end, with the diff explained |
| K6 | G14 reorders slot acquisition against the store read | The current ordering is load-bearing: a missing id must still 404, not 503. C9 asserts it |
| K7 | G3's decision gates every new HTTP route | No route work in any lane until G3 is written down |
| K8 | G4 and G11 both turn a deliberately-pinned assertion red | Expected and correct. The commit must update `qa/contract.md` in the same change, per its own closing section |
| K9 | **G6 and G14 both edit `packages/http/src/routes.ts`**; G2 and G14 both touch `renderLimit.ts` | G14 moved out of Lane C into Lane A, serial after G6. Caught by listing the files rather than assuming — it was originally filed as non-conflicting |

**Non-conflicting by construction.** Lane C's three remaining nodes touch genuinely
disjoint paths — `packages/core/test/`, `README.md`, `packages/store/src/index.ts` — with
no overlap between them and none with Lane A or B. Neither rewrites golden snapshots nor
the contract, so Lane C merges freely whenever it finishes.

That list is short because it was *checked*, not asserted: `grep -l` for the symbols each
node touches, then `comm -12` on the two file sets. Doing that is how K9 surfaced. A
conflict register written from memory is worse than none, because it is trusted.

## B4. Command sequences

Every flag below is verified against this build's `claude --help`. Note that `--max-turns`
does **not** exist in this build; do not reach for it.

### Serial node — the default

```bash
git checkout main && git pull
git checkout -b fix/g4-timeout-guard

claude --model sonnet --permission-mode acceptEdits \
  -p "$(cat docs/prompts/node.md)"     # or paste the B5 template inline

npm test && npm run qa:all             # C23 should now be RED — that is the point
# update qa/contract.md, re-run
npm run qa:all

git add -p && git commit
gh pr create --base main --fill
```

The deliberate step is running the suite **before** touching the contract, so the pinned
row goes red and you see it. Fixing code and contract in one pass hides whether the
assertion was ever load-bearing.

### Parallel lanes — one worktree each

```bash
claude -w lane-a-adapters --model opus     --tmux
claude -w lane-b-contract --model sonnet   --tmux
claude -w lane-c-lowrisk  --model sonnet   --tmux
```

`--worktree` gives each lane its own checkout, so three sessions edit three trees.
`--tmux` is optional and only affects pane layout.

Merge order is set by the register, not by finish time: **C → A → B**. Lane C is disjoint
and merges freely; Lane A settles the shared-constants question; Lane B rewrites the
contract last, so it rebases onto whatever the other two changed.

### Background fan-out — verification, not authoring

```bash
claude --bg --model sonnet -p 'Run npm run qa:all and report only failing contract rows.'
claude agents --json          # poll; add --all to include completed sessions
```

Use this for the sweep across lanes, or for a long Tectonic-bound run. Do not use it to
write code — see A8.

### Merge gate

```bash
# in the session, once per PR:
/release-check
```

Which runs build → test → preflight → `qa:all` → golden drift → store isolation →
collection freshness. Plus, whenever anything under `qa/` changed, the negative control:
temporarily break the thing an assertion claims to check, confirm the row goes red, revert.
A harness that has never failed has not been shown to work.

### Model switching mid-session

```
/model opus       # escalate in place; keeps the context
/model sonnet     # de-escalate once the exploratory part is done
```

## B5. Kickstarter and continuation prompts

Five reusable blocks. Each is written to stand alone — a cold session should need nothing
from the conversation that produced it.

### Cold start

```
Read qa/README.md, qa/contract.md and qa/findings.md, then run:
  npm run build && npm run qa:preflight

Do not edit anything yet. Report:
  1. Which findings are unblocked right now, per docs/orchestration.md's graph.
  2. Anything preflight flagged.
  3. Which node you would take first, and why.

Constraints that apply to every session in this repo:
  - Never write to ~/.resume-blueprint. The harness isolates RESUME_BLUEPRINT_HOME;
    do not work around that guard.
  - Never read packages/core/assets/ or fixtures/golden/ into context.
  - profile_templates/ holds real personal data. Use fixtures/profile.md instead.
```

### Node execution

```
Close finding {{finding}} from qa/findings.md.

Read that finding first — it carries the evidence, the proposed fix and the size.

Blast radius: you may edit {{paths}} and qa/contract.md. Anything else, stop and ask.

Acceptance test: {{acceptance}}

Sequence, in this order:
  1. Make the code change.
  2. Run `npm test && npm run qa:all` BEFORE touching qa/contract.md.
     {{finding}} is pinned as current behaviour, so a row should go RED. Report which.
  3. Update that row to describe the new behaviour, and say in the commit message
     whether it was a regression or a deliberate change.
  4. Re-run both suites.

Hard stops — halt and report rather than proceeding:
  - the real ~/.resume-blueprint is touched
  - fixtures/golden/ needs re-baselining and you cannot explain the diff
  - you find yourself editing qa/contract.md to make a run go green
  - packages/core would gain a runtime dependency
  - anything would be written to MCP's stdout

If the acceptance test itself looks wrong, stop. That means this is a judgment call,
not a mechanical change, and it needs a human.
```

### Continuation

```
claude -c          # continue the most recent session in this directory
claude --resume    # or pick one
```

```
Resuming {{finding}}. Do not trust the previous session's summary of state — verify:
  1. `git status` and `git diff` — what is actually changed?
  2. `npm run qa:all` — which rows are red right now?
  3. Does qa/contract.md still describe the old behaviour?

Then report what remains before this is mergeable, and continue from there.
```

### Red-row triage

```
Use the qa-runner agent.

qa/contract.md row {{row}} is failing. Reproduce it standalone — every script in qa/
runs by itself — then answer the only question that matters:

  is this a regression, or a stale contract row?

A regression means the code moved and the contract did not: fix the code.
A stale row means the behaviour changed deliberately and the table did not follow:
fix the table, in the same change, and say so.

Do not edit qa/contract.md without stating which of the two it was.
```

### Merge gate

```
Use the release-check skill.

Then, because this branch touched qa/: run the negative control. Temporarily break
the behaviour an assertion claims to check, confirm the row goes red, revert, confirm
it goes green. Report both outcomes.

Do not commit or push. Report the state and stop.
```

---

# Part C — learning plan

Four tracks, roughly a week each, ordered so each one makes the next legible. Every track
has an exercise grounded in this repo, because the material only sticks against something
real.

> **Verify the links.** These were correct at time of writing. Documentation sites move
> and reorganise; treat a live docs site as authoritative over this file, and treat any
> 404 here as this document being stale rather than the resource being gone.

## Track 1 — Claude Code orchestration (week 1)

*Why first:* it is the layer you are already standing on. Everything in Part B is
expressible with these primitives, and knowing them turns the command blocks from
incantations into choices.

- Overview and CLI reference — <https://docs.claude.com/en/docs/claude-code/overview>
- Subagents — <https://docs.claude.com/en/docs/claude-code/sub-agents>
- Skills — <https://docs.claude.com/en/docs/claude-code/skills>
- Hooks — <https://docs.claude.com/en/docs/claude-code/hooks>
- Settings and permissions — <https://docs.claude.com/en/docs/claude-code/settings>
- Headless / programmatic use — <https://docs.claude.com/en/docs/claude-code/headless>
- MCP — <https://docs.claude.com/en/docs/claude-code/mcp>
- *Claude Code best practices*, Anthropic Engineering —
  <https://www.anthropic.com/engineering/claude-code-best-practices>

**Exercise.** Promote one social tripwire from A6 to a mechanical one. A `PreToolUse` hook
that refuses any `Write`/`Edit` whose path resolves inside `~/.resume-blueprint` is the
best first choice: small, unambiguous, and it protects real user data. Compare what you
write against `qa/lib/scratch.mjs`'s `assertIsolated()`, which solves the same problem one
layer up.

## Track 2 — Graph engineering for agents (week 2)

*Why second:* Part B's graph is hand-drawn ASCII. This track is about what changes when the
graph becomes a runtime object — with state, checkpoints, and resumption.

- *Building effective agents*, Anthropic Engineering —
  <https://www.anthropic.com/engineering/building-effective-agents>
  — the workflows-vs-agents distinction underpinning this whole document. Read it first.
- *How we built our multi-agent research system*, Anthropic Engineering —
  <https://www.anthropic.com/engineering/multi-agent-research-system>
- LangGraph — <https://langchain-ai.github.io/langgraph/>
- LangGraph persistence and checkpointing —
  <https://langchain-ai.github.io/langgraph/concepts/persistence/>
- Temporal, for durable execution as a contrast —
  <https://docs.temporal.io/evaluate/understanding-temporal>

**Exercise.** Express Phase 2's three lanes as a LangGraph graph. The interesting part is
not the happy path — it is where you put K1, the `qa/contract.md` mutex. A graph edge is
the wrong shape for it, and finding that out by trying is the point of the exercise.

## Track 3 — Human-in-the-loop patterns (week 3)

*Why third:* once the graph can pause and resume, *where* to pause becomes the design
question, and it is mostly a judgment question rather than a technical one.

- LangGraph human-in-the-loop —
  <https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/>
- Interrupt and resume patterns —
  <https://langchain-ai.github.io/langgraph/how-tos/human_in_the_loop/add-human-in-the-loop/>
- Claude Code permission modes (the same idea, already implemented) —
  <https://docs.claude.com/en/docs/claude-code/iam>
- Tool-use and orchestration in the API —
  <https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview>

**Exercise.** Take B2's node table and defend it. For every node marked **review** rather
than **gate**, write the sentence explaining why a human does not need to see it first. If
you cannot write that sentence, the node needs a gate — or it needs a better test.

## Track 4 — Evals and reliability (week 4)

*Why last:* it is the track that tells you whether any of the previous three worked. It
also has the most direct payoff here, because this repo already contains an eval harness
that most projects lack.

- Anthropic testing and evaluation docs —
  <https://docs.claude.com/en/docs/test-and-evaluate/develop-tests>
- Anthropic cookbook — <https://github.com/anthropics/anthropic-cookbook>
- promptfoo, for eval-as-config — <https://www.promptfoo.dev/docs/intro/>

**Exercise.** None to build — one to *recognise*. `qa/` is already an eval harness: a
declared expectation table, executable assertions, per-row attribution, and a matrix
report. The technique this track formalises is the one already used on it — raising
`MAX_CONCURRENT_RENDERS` from 4 to 99, confirming row C15 went red, and reverting. An
assertion that has never been observed to fail has not been shown to test anything.

Write down which of the 210 assertions have *never* been seen red. Those are the ones with
no evidence behind them, and they are where the next real bug will hide.

---

## Related documents

| File | What it holds |
|---|---|
| `CLAUDE.md` | The three invariants every guardrail here derives from |
| `qa/contract.md` | The expectation matrix; this phase's shared mutable artifact |
| `qa/findings.md` | G1–G15 with evidence, proposed fix and size |
| `qa/README.md` | Running the harness; adding a row |
| `docs/next-features.md` | F0–F13, complete. The ordering-graph and conflict-register pattern this document borrows |

---

# Part D — running it

Parts A–C were written before any of this was executable. They are still the
explanation; what follows is the machinery, and where the two disagree the
machinery is right — it is checked on every run and the prose is not.

## D1. The graph is `qa/plan/graph.json`

Part B1's ASCII, B2's node table and B3's conflict register are now one file,
with a resolver over it. See `qa/plan/README.md`.

```bash
node qa/plan/next.mjs --ready        # what can start now — and why not, otherwise
node qa/plan/next.mjs --all          # every node, with its withholding reason
node qa/plan/next.mjs --conflicts    # the register, DERIVED from the mutex fields
node qa/plan/next.mjs --check        # dangling edges, cycles, unexplained mutexes
```

`--check` looks for the *shape* of K9 — two nodes editing one path with neither
a mutex nor an ordering between them — rather than for K9 itself. Run it after
any edit to the graph.

## D2. What the graph found that the prose did not

B3 closes by saying its register is short because it was *checked*, and that a
register written from memory is worse than none because it is trusted. That
holds, and the same method applied mechanically found four more collisions, all
cross-lane, all inside the set B3 calls "non-conflicting by construction":

- **K10** — G2 edits `qa/contract.md`. Its own acceptance test in B2 says so
  ("C15's MCP row updated"), and K1 reserves that file for Lane B.
- **K11** — G11 edits `packages/http/src/routes.ts`, at `postRender`. K9 caught
  G6 and G14 on that file and moved G14 into Lane A; G11 was not re-checked.
- **K12** — G2 and G11 both edit `packages/mcp/src/tools.ts`.
- **K13** — G5, G4 and G1 all rewrite regions of `packages/cli/src/index.ts`.

The conclusion is not that the lanes were drawn carelessly. It is that **Phase
2's three-lane parallelism does not survive contact with the file sets**: G5
alone holds `routes.ts` and the CLI entry point, so while it is open, G4, G6,
G11, G14 and G1 are all withheld. A8's own rule already says this — *parallel
lanes do not pay when two nodes touch the same file; that is not slower, it is
wrong* — it was simply not visible until the paths were data.

The practical shape is G5 first and alone, Lane C beside it, and the lanes
opening behind it. Nobody has to redraw anything: the resolver withholds the
collisions on its own.

## D2b. Where to run the resolver

Anywhere in the clone. `--ready` and `--claim` read and write
`<git-common-dir>/qa-plan-claims/`, which every worktree shares, so the primary
checkout on `main` and a lane worktree give the same answer.

```bash
node qa/plan/next.mjs --where     # prints the claims dir in effect
```

The usual shape is: claim from wherever you are, then branch or `-w` for the
work itself. Coordination and editing are different acts, and only the second
one needs its own tree.

This was wrong in the first cut of G0 — claims lived under `qa/plan/claims/`,
inside the working tree, so a claim made in one lane was invisible to the
others and the mutex silently stopped working at exactly the moment three lanes
were open. Recorded rather than quietly fixed: it is the same class of bug as
K9, found the same way, by checking instead of assuming.

## D3. Gates are files

A node whose `check` is `gate` is unreachable until `docs/decisions/<id>.md`
exists. That is A5's gate, made mechanical — an agent cannot skip it, because
`--ready` never offers the node. `docs/prompts/gate.md` briefs a session to
*draft* the decision; a human signs off by creating the file.

## D4. Flips, not matrices

```bash
node qa/run.mjs --json[=path]      # results to a FILE (never stdout — invariant 2)
node qa/run.mjs --emit-baseline    # record the expected status of every row
node qa/run.mjs --check-baseline   # run, then print only what MOVED
```

This is what makes B4's deliberate step — run the suite *before* touching the
contract, so the pinned row goes red and you see it — checkable rather than
habitual. A full green matrix cannot tell you a row flipped; a flip list can.

`qa/plan/evidence.json` accumulates every row ever observed FAIL. Part C, Track
4 asks which of the 210 assertions have never been seen red; that file is the
answer, and it starts almost empty, which is the honest starting position.

## D5. Tripwires 2, 3 and 4 are no longer social

A6 recorded that three of the five tripwires were enforced by habit.
`.claude/hooks/guard.mjs`, registered from a checked-in `.claude/settings.json`,
now enforces all four of the file-level ones:

| Tripwire | Enforcement |
|---|---|
| 1 — the real store is written | denied outright; read-only inspection still allowed |
| 2 — golden re-baselined unexplained | `GOLDEN_REBASELINE_REASON` must be set |
| 3 — contract edited to go green | `CONTRACT_CHANGE=regression\|stale` must be set |
| 4 — core gains a runtime dependency | denied unless it is `zod` or `common-tags` |
| 5 — anything reaches MCP's stdout | already mechanical, in `mcp-pipe.mjs` |

`node .claude/hooks/guard-selftest.mjs` proves each rule in **both** directions.
That second direction is the point: a guard that denies everything passes a
one-sided test and makes the repo unusable.

## D6. The negative control, executable

```bash
node qa/plan/negative-control.mjs --list
node qa/plan/negative-control.mjs C15      # break it, prove C15 goes red, revert
node qa/plan/negative-control.mjs --all
```

`qa/plan/mutations.json` is the registry. The interesting outcome is not
`PROVEN` — it is **`VACUOUS`**, a row that stays green with the behaviour it
describes deliberately broken. That is an assertion that was never testing
anything, and finding one is worth more than the run that finds none.

Two builds and two suite runs per mutation, so this belongs in the merge gate,
not the edit loop.

## D7. One node, end to end

```bash
git checkout main && git pull
node qa/plan/next.mjs --ready
node qa/plan/next.mjs --claim G12

git checkout -b fix/g12-readme-drift
claude --model sonnet --permission-mode acceptEdits \
  -p "$(node qa/plan/next.mjs --brief G12)"

npm test && node qa/run.mjs --check-baseline
git add -p && git commit
gh pr create --base main --fill

node qa/plan/next.mjs --release G12 --done
```

For a lane rather than a node, `claude -w lane-c-lowrisk --model sonnet --tmux`
still applies, and B4's flag notes still hold — including that `--max-turns`
does not exist in this build.

## D7b. Model routing, and what "escalate in place" can and cannot be

A7 names a model on every node. Two of the three ways to act on that are
automatable; the third is not, and it is worth being exact about which.

**At a node boundary — fully automatic.** The graph holds the routing, so a
launcher never re-derives it:

```bash
node qa/plan/next.mjs --model G4        # -> sonnet
claude --model "$(node qa/plan/next.mjs --model G4)" \
       -p "$(node qa/plan/next.mjs --brief G4)"
```

**Mid-node, in the same session — NOT automatic.** `/model` is a command a human
types. A running session has no tool that changes its own model, so an agent
cannot perform A7's "escalate in place" on itself. What it can do is make the
signal unmissable and the next keystroke obvious:

```bash
node qa/plan/next.mjs --escalate G4 "the timeout literal is also read by http"
# records the escalation on the claim, then prints: type /model opus
```

The record on the claim is the part that matters. It tells a later session that
this node has already been attempted at the lower model and why, which is what
stops attempt two repeating attempt one — and after two escalations with no
progress it is A9's fourth row, not a third try.

**By delegation — automatic, but it is a different thing.** A subagent can be
spawned on another model. That is a genuine autonomous switch, and it is the
wrong tool for escalation: the subagent starts cold, which is exactly the
restart A7 says not to do. Use it for a bounded read-only question ("audit these
three files"), not to rescue a node in flight.

The honest summary: **the graph decides the model, the human changes it
mid-flight, and the claim file remembers that it happened.**

## D8. What is still not mechanical

Stated plainly, because a substrate that overstates its own coverage is worse
than none:

- **`qa/plan/` has no contract row and cannot go red.** Nothing in `qa/` proves
  the resolver is correct; `--check` and the guard self-test are its only tests,
  and neither runs in `npm test`. If it earns its keep over the first few nodes
  it deserves a real one.
- **`graph.json`'s `paths` are hand-verified, not derived.** They were grepped
  against the tree once, on 2026-08-24. A node that turns out to touch a fifth
  file introduces a collision nothing will catch until the merge conflict.
- **Acceptance predicates cover rows, not behaviour.** `before/after` proves a
  row moved; it does not prove it moved for the right reason. That judgment is
  still B5's red-row triage, and still a human's.
- **The `--force` escape on `--claim` exists**, and is how K1 gets violated.
- **Hooks guard the agent's tools, not its subprocesses.** `guard.mjs` sees
  `Write`, `Edit` and `Bash` calls. A script the agent *runs* — including
  `qa/plan/negative-control.mjs`, which edits source in place on purpose — writes
  through the hook layer untouched. That is inherent to where hooks sit, and it
  is why tripwire 1 is enforced a second time by `assertIsolated()` inside the
  harness rather than by the hook alone.
