Continuing {{node}} — {{title}} — after an escalation to opus.

You are NOT starting over. A previous pass at {{model}} did real work; the point
of escalating in place is to keep it.

First, recover what is actually true — do not trust any summary of it:
  cat qa/plan/claims/{{node}}.json     # every escalation, with its reason
  git status && git diff
  node qa/run.mjs --check-baseline

Then say, in one paragraph each:
  - what the previous pass established, including what it ruled OUT
  - why the lower model's scope was wrong: which files, and how far past
    {{paths}} the real change reaches
  - whether this is still one node, or whether it should be split and the
    graph edited

That last question is the one you were escalated for. A node that has grown past
its blast radius is often two nodes, and splitting it is a better answer than
one large diff nobody can review — B2 splits G10 for exactly this reason.

If the change now touches a path held by another node's mutex, stop and say so:
  node qa/plan/next.mjs --conflicts

Acceptance test, unchanged: {{acceptance}}
Hard stops, unchanged: the real store, unexplained golden re-baselining, editing
the contract to go green, a third core dependency, anything on MCP's stdout.
