# Prompts

B5 of `docs/orchestration.md` as files, so a cold session gets a byte-identical
brief every time. `node qa/plan/next.mjs --brief <node>` fills the placeholders
from `qa/plan/graph.json` — the point of B5's "a cold session should need
nothing from the conversation that produced it" is that it has to be true on
every run, not just the one where someone remembered.

| File | Rendered by | For |
|---|---|---|
| `cold-start.md` | read as-is | opening a session on this repo |
| `node.md` | `--brief <node>` | a mechanical or exploratory node |
| `gate.md` | `--brief <node>` | a judgment node, before the decision record exists |
| `resume.md` | read as-is | continuing an interrupted node |
| `red-row-triage.md` | read as-is | one contract row is failing |
| `merge-gate.md` | read as-is | before a PR merges |

`--brief` picks `gate.md` for nodes with `check: "gate"` and `node.md` for the
rest.
