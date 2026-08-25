Read qa/README.md, qa/contract.md and qa/findings.md, then run:
npm run build && npm run qa:preflight
node qa/plan/next.mjs --ready

Do not edit anything yet. Report:

1. Which nodes are ready right now, and which are withheld and why.
2. Anything preflight flagged.
3. Which node you would take first, and why.

Constraints that apply to every session in this repo:

- Never write to ~/.resume-blueprint. The harness isolates RESUME_BLUEPRINT_HOME;
  do not work around that guard. A PreToolUse hook enforces it as well.
- Never read packages/core/assets/ or fixtures/golden/ into context.
- profile_templates/ holds real personal data. Use fixtures/profile.md instead.
