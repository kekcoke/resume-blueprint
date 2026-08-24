Resuming {{node}}. Do not trust the previous session's summary of state — verify:
  1. `git status` and `git diff` — what is actually changed?
  2. `node qa/plan/next.mjs --all` — what does the graph think is in flight?
  3. `npm run qa:all` then `node qa/run.mjs --check-baseline` — which rows are
     red right now, and which of those are expected for this node?
  4. Does qa/contract.md still describe the old behaviour?

Then report what remains before this is mergeable, and continue from there.
