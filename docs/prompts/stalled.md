{{node}} is stalled. Before anything else, establish which kind of stall this is —
A9 gives four, and they take opposite actions.

Run these and report the raw output, not a summary:
  git status && git diff --stat
  node qa/plan/next.mjs --all | grep {{node}}
  node qa/run.mjs --check-baseline
  cat qa/plan/claims/{{node}}.json      # has this already been escalated? how often?

Then classify, and say which:

  1. TRANSIENT — a flaky network, a cold Tectonic cache, a port in use.
     → retry in place, ONCE. If it recurs, it is not transient.

  2. WIDER THAN SCOPED — the change reaches files outside {{paths}}.
     → do not widen the blast radius. Run:
         node qa/plan/next.mjs --escalate {{node}} "what you found"
       then type /model opus in THIS session. Do not start a new one: the files
       already read and the dead ends already eliminated are the expensive part.

  3. THE ACCEPTANCE TEST LOOKS WRONG — "{{acceptance}}" does not describe what
     this change should do.
     → STOP. This is a judgment node in disguise and it needs a human. Say what
       you think the acceptance test should be and why, and stop there.

  4. TWO ATTEMPTS, NO PROGRESS, NO NEW INFORMATION.
     → abandon it. Add what was learned to qa/findings.md under {{finding}} —
       especially the approach that did NOT work, which is the part a later
       session would otherwise pay for again. Then:
         node qa/plan/next.mjs --release {{node}} --abandoned

The distinction that matters most is 3 against 2. Both feel like "this is harder
than it looked". Only one of them is yours to solve.

Do not pick a classification to justify continuing. If two fit, take the one that
stops sooner.
