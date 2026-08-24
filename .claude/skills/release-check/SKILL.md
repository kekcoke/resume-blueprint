---
name: release-check
description: Full local-stability gate before cutting a build — build, unit tests, contract harness, golden drift, and store isolation.
---

# release-check

The gate to run before tagging or cutting a build. Everything below has to be
green, and the last two checks are the ones people forget.

## When to Use

- Before cutting an MVP build or tagging a release.
- Before merging a branch that touched more than one package.
- After a dependency bump — particularly `zod` or
  `@modelcontextprotocol/sdk`, where the compat surface between them is
  load-bearing (the SDK at ^1.30.0 accepts either zod major; core and mcp are on
  zod ^4.4.3).

## How It Works

Run in order, and stop at the first failure rather than collecting them:

1. **Clean build.** `npm run build`. Build order matters — core before the
   adapters — and the root script already encodes it.
2. **Unit tests.** `npm test`. Currently 584 tests, zero failures. A dropped
   count is as much a signal as a red one: it means a file stopped being
   collected.
3. **Preflight.** `npm run qa:preflight`. Confirms `tectonic` and `poppler` are
   present and that no package's `src/` is newer than its `dist/`.
4. **Contract harness.** `npm run qa:all`. Every row in `qa/contract.md`, across
   all four callers.
5. **Golden drift.** `git status --porcelain fixtures/golden/` must be empty
   after the test run. A dirty golden directory means the generated `.tex`
   changed and nobody decided whether that was intended. Do not re-baseline to
   clear it — explain the diff first.
6. **Store isolation.** `git -C ~/.resume-blueprint log --oneline | head` must
   show no commits from the run, and `git -C ~/.resume-blueprint status` must be
   clean. The harness mints a temp `RESUME_BLUEPRINT_HOME` per script and refuses
   to start without one, but this is the check that proves it worked. If the real
   store *did* pick up commits, stop and report it — that is a harness defect
   with real consequences for the user's data.
7. **Collection freshness.** If `qa/http/*.sh` changed, `npm run qa:collection`
   and confirm `qa/http/collection.json` has no uncommitted diff. It is generated
   from the scripts precisely so the two cannot drift.

## Examples

```bash
npm run build && npm test
npm run qa:preflight && npm run qa:all
git status --porcelain fixtures/golden/          # must be empty
git -C ~/.resume-blueprint status --porcelain    # must be empty
```

Report the outcome plainly: what passed, what failed with its output, and
anything skipped and why. If a step was skipped for lack of a binary, say so —
a release gate that silently degrades to a subset is worse than no gate.

Known gaps that are **not** release blockers, and should not be re-litigated
here, are catalogued in `qa/findings.md`. Two of them (G4, G11) are pinned as
current behaviour in the assertions, so fixing either turns a row red on purpose.
