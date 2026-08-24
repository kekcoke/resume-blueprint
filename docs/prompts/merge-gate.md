Use the release-check skill.

Then, because this branch touched qa/: run the negative control.

  node qa/plan/negative-control.mjs {{rows}}

It breaks the behaviour each assertion claims to check, confirms the row goes
red, reverts, and confirms it goes green. Report both outcomes. A harness that
has never failed has not been shown to work.

Finally:
  node qa/run.mjs --check-baseline    # flips only; must be empty or explained
  node qa/plan/next.mjs --all         # is anything still holding a mutex?

Do not commit or push. Report the state and stop.
