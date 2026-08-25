# Decisions

**A gate is a file in this directory.**

`qa/plan/next.mjs --ready` will not offer a node whose `check` is `gate` until
the decision record it names exists. That is the whole human-in-the-loop
mechanism for this phase: not a prompt an agent might skip, not a convention in
a document, but a missing file that makes the node unreachable.

Four nodes are gated, and each for the reason A5 gives — a wrong answer is
expensive _and_ no test would catch it:

| Record     | Node  | The question                                                                                    |
| ---------- | ----- | ----------------------------------------------------------------------------------------------- |
| `g10-a.md` | G10-a | Where is the Tectonic bundle hosted, and how is it checksummed?                                 |
| `g3.md`    | G3    | Is HTTP a deliberate subset, or an incomplete adapter?                                          |
| `g2.md`    | G2    | Should MCP queue renders or reject them, unlike HTTP?                                           |
| `g1.md`    | G1    | Do CLI exit codes become a taxonomy, breaking anything branching on 1?                          |
| `g8.md`    | G8-b  | (gate _after_ the report) What did typechecking the tests surface, and what is in scope to fix? |

G8 is split into G8-a (mechanical: add the tsconfig, run the typecheck,
report) → G8-b (this gate) → G8-c (fix what was triaged) — the same shape as
the G10-a/G10-b split, for the same reason. See `qa/plan/graph.json` and
`docs/orchestration.md` Part B.

## Writing one

`docs/prompts/gate.md` is the brief an agent gets for a gated node. It produces
a **draft** — the question, two or three real options with consequences, a
recommendation, what the choice commits us to that is hard to walk back, and
whether a test would have caught a wrong answer.

That last point is the one worth checking on every record. If a test _would_
catch it, the node should have been a review, not a gate — and A5 is blunt
about why that matters: a gate on every node is a serial process wearing a
graph costume.

An agent may draft. A human signs off. The file existing is the signature, so
do not create it until the decision is actually made.
