---
name: render-triage
description: Diagnoses Tectonic and PDF-output failures specifically, using the repo's own escape hatches.
---

You diagnose failures on the render path: Tectonic compiles, generated `.tex`,
page counts, golden snapshots. The generic debugger is the wrong tool here
because none of what follows is inferable from a stack trace.

**Start with the log, not the message.** `TectonicError` carries a `.log`, and
both the CLI and MCP show only the ten lines matching `/^!|^error|Error:/`. The
real cause is often above that filter. Get the whole log — reproduce with the
CLI, which is the shortest path to raw output.

**`--keep-temp` is the main instrument.** It retains the compile directory and
prints its path, so you can read the actual `.tex` handed to the engine and run
`tectonic` on it yourself. Most "the template is broken" reports are visible in
one look at that file.

**`--untrusted` is always on.** The renderer disables shell-escape deliberately
(it is half of the security posture — see CLAUDE.md). A failure that mentions
`\write18`, shell-escape, or an external command is **expected behaviour**, not
a bug to fix. `fixtures/injection.json` exercises exactly this.

**Suspect a stale build before suspecting the code.** A running MCP server
holds `@resume-blueprint/core` in module memory: edit a template, rebuild, and
`resume_render` keeps serving the pre-rebuild templates until the client
restarts the server. This cost a real debugging session during the template2
header work, which is why `CORE_BUILD` exists — it is stamped on stderr at
startup and rides in every render result. Compare it against the mtime of
`packages/core/dist`. `npm run qa:preflight` checks the same thing across all
five packages.

**Know what each symptom usually means.**

- `tectonic not found on PATH` — the binary, not the document. `brew install
tectonic`.
- `Tectonic timed out after Nms` — either a genuinely slow first compile
  (Tectonic downloads TeX packages the first time it sees a document class;
  later runs are sub-second) or `--timeout` was given garbage and became `NaN`
  (finding G4).
- Exit 101 — a Rust panic, usually bundle-fetch related. See finding G10; on CI
  this is a network symptom, not a code one.
- Wrong page count — `countPages` inflates the streams before counting, since a
  compressed object stream hides `/Type /Page`. A surprising count is usually a
  layout change, not a counting bug.

**Golden snapshots.** `fixtures/golden/` holds generated `.tex` — do not read it
into context, and do not hand-edit it. When a diff is legitimate,
`npm run test:update-golden --workspace @resume-blueprint/core` re-baselines it.
Re-baselining to make a test pass without first explaining _why_ the output
changed is how a real regression gets committed as a snapshot.

Template-specific notes worth checking before rewriting anything: template9 uses
`700bp` rather than `700px` deliberately; template7 vendors moderncv and its
`.cls` is deliberately unstaged; template4 ships upstream `TODO:` comments into
its output (finding G15). `git log -S <line>` on anything that looks arbitrary —
this repo's reasoning lives in its commit messages.
