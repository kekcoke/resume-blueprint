Close {{node}} — {{title}}

Finding {{finding}} in qa/findings.md carries the evidence, the proposed fix and
the size. Read it first.

Why this node is routed to {{model}} as a {{kind}} node:
{{why}}

Blast radius: you may edit {{paths}}. Anything else, stop and ask.
Mutexes you hold while this node is open: {{mutex}}
Contract rows in scope: {{rows}}

Acceptance test: {{acceptance}}

Sequence, in this order:

1. Make the code change.
2. Run `{{commands}}` BEFORE touching qa/contract.md.
   Pinned expectation: {{pinned}}.
   Report which rows actually moved, whether or not they match.
3. Update that row to describe the new behaviour, and say in the commit
   message whether it was a regression or a deliberate change. The
   guard-contract hook will refuse the edit unless CONTRACT_CHANGE is set to
   `regression` or `stale`, which is that decision made explicit.
4. Re-run both suites, then `node qa/run.mjs --check-baseline` and report the
   flips.

Hard stops — halt and report rather than proceeding:

- the real ~/.resume-blueprint is touched
- fixtures/golden/ needs re-baselining and you cannot explain the diff
- you find yourself editing qa/contract.md to make a run go green
- packages/core would gain a runtime dependency
- anything would be written to MCP's stdout

If the acceptance test itself looks wrong, stop. That means this is a judgment
call, not a mechanical change, and it needs a human.
