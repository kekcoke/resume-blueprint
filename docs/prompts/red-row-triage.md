Use the qa-runner agent.

qa/contract.md row {{row}} is failing. Reproduce it standalone — every script in
qa/ runs by itself — then answer the only question that matters:

  is this a regression, or a stale contract row?

A regression means the code moved and the contract did not: fix the code.
A stale row means the behaviour changed deliberately and the table did not
follow: fix the table, in the same change, and say so.

Do not edit qa/contract.md without stating which of the two it was. The
guard-contract hook enforces this by requiring CONTRACT_CHANGE=regression or
CONTRACT_CHANGE=stale in the environment; setting it without having decided is
the same failure with an extra step.

Check qa/plan/evidence.json before you start. If this row has never been
observed red, its first red is information: it may be the assertion that was
never testing anything.
