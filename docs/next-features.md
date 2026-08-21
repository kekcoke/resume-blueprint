# Next Features

Scoped and ordered. Each feature below is one session's work with its own implementation
plan written at the time; this document is the ordering, the rationale, and the conflict
register that keeps those sessions from colliding.

**Status when written:** Phase 1 and Phase 2 complete — core, CLI, store, MCP (15 tools),
HTTP (8 routes), 187 tests. `feat/scope-next-features` at parity with `main`.
*(As of F13: MCP is 18 tools and the suite is 584 tests.)*

---

## What drove this ordering

Three inputs:

1. **External feedback** (`external_feedback.md`, untracked at repo root) grades two real
   rendered resumes. ATS-friendliness scores `A-`/`A` — but **spacing/formatting is the
   weakest axis at `B`/`B+`, and the parse-fidelity harness measures none of it.** Its
   concrete asks: flat certifications list, single-column `Category: Skills` rows, one
   horizontal contact row, margins ≥ 0.5in, section padding 2–3pt, line spacing 1.0–1.15.
2. **Outstanding PR items.** No GitHub issues exist and no PR carries a single review or
   review-thread comment — all residual work lives in the "Outstanding — not addressed
   here" sections of PR #4 and PR #5. Everything PR #4 listed is closed by PR #5; do not
   re-open those. What remains is folded into the features below.
3. **New fonts** — Calibri, Arial, Helvetica, Garamond, Georgia, exposed as default
   template configuration with identified variables.

The load-bearing discovery: **there is no template configuration surface at all.**
`BlueprintSchema` exposes only `selectedTemplate`, `sections`, and `headings`. Every
appearance decision is hardcoded across nine template string literals and the vendored
`.cls`/`.sty` files. `Generator.resumeHeader: () => string` takes no arguments, and
`blueprintToTex(input: unknown)` takes no options.

That absence is why the font request and the external-feedback layout request are the
**same feature underneath**, and why the config surface has to land before either. Shipping
fonts as five more hardcoded templates would mean rewriting all of them the moment margins
and spacing became configurable.

---

## Verified findings this plan rests on

Probe documents compiled through the installed Tectonic (0.17.0) with `--untrusted`, then
extracted with `pdftotext`:

| Requested font | Free equivalent | CTAN package | In Tectonic bundle | Extracts clean |
|---|---|---|---|---|
| Calibri | Carlito (metric-compatible) | `carlito` | yes | yes |
| Arial | Arimo (metric-compatible) | `arimo` | yes | yes |
| Helvetica | TeX Gyre Heros (URW Nimbus Sans) | `tgheros` | yes | yes |
| Garamond | EB Garamond | `ebgaramond` | yes | yes |
| Georgia | **Gelasio** (metric-compatible) | `gelasio` | **NO — `gelasio.sty` not found** | n/a |

Four of the five need **no vendored assets and no licensing exposure** — they resolve from
Tectonic's bundle. Georgia is the exception: Gelasio is vendored as OFL TTFs, matching the
existing precedent in `assets/templates/template{2,4,6}/fonts/`.

Also confirmed, and load-bearing for the sequencing:

- **`LaTeXOpts.cmd` is never read.** `compileTex` always spawns one binary and Tectonic is
  XeTeX-derived, so `fontspec` is available in *every* template, not only the four that
  currently use it. (`packages/core/src/types.ts`, `packages/core/src/render/tectonic.ts`)
- **`--untrusted` disables `-Z search-path`.** Fonts reach a document only via bundle
  packages, or via `opts.fonts` staged into `<tmpdir>/fonts/` and referenced `Path=fonts/`.
  No system-font lookup exists. This is precisely why the bundle-package route is the safe
  one and why "just use the installed Calibri" is not an option.
- **`assets/templates/template8/mcdowellcv.cls` already declares a `calibri` class option
  and `\def\mainfontface{...}` that nothing ever uses** — there is no `\setmainfont` in
  the class, so template8 silently falls back to Latin Modern. Dead code today; the
  natural attach point for F4.
- **`TEMPLATE10` is declared in `templates/constants.ts` but unregistered** — F7's slot
  already exists.
- Latent bug: `packages/core/src/templates/template4.ts:56` emits
  `\fontspec[Path = fonts/raleway/]{Raleway-Medium}`, a directory that does not exist.
  Only reachable on the no-`name` branch of `profileSection`. Folded into F4.

---

## Ordering

```
F0  PII containment ─────────────────────────► minutes; blocks nothing, unblocks safety
F1  CI ──────────────────────────────────────► guards every change after it
F2  Parse-fidelity harness v2 ───────────────► the instrument that measures F5/F6
F3  `document` config surface ───────────────► FOUNDATIONAL — F4/F5/F7 all consume it
      ├─► F4  Font families
      ├─► F5  ATS layout fixes
      │     └─► F6  `certificates` section
      │           └─► F7  Template 10 (Word-alike preset)
      └─
F8  Master-profile importer ─────────────────► needs schema stable after F6
F9  `blueprintToText` ───────────────────────► enables F10
F10 JD keyword targeting

PARALLEL TRACK — packages/store and repo meta only, never collides with templates:
F11 Cross-process store lock
F12 Doc drift + small cleanups
F13 zod 4 migration ─────────────────────────► needed F8 landed first; done alone
```

**The single hard rule: F3 before F4, F5, and F7.**

---

## F0 — Contain the PII · P0 · minutes

**Why.** `external_feedback.md` sits untracked at the repo root and is **not** covered by
`.gitignore`. It contains a full name, phone number, email, and LinkedIn URL. One
`git add -A` publishes real PII to a public remote. `profile_templates/` was gitignored for
exactly this reason (commit `53fbea6`); this file was missed.

**Scope.** Add `external_feedback.md` plus a `*_feedback.md` glob to `.gitignore`. Confirm
no PII already reached history (`git log -S '<phone fragment>' --all`).

**Files.** `.gitignore`

**Conflicts.** None.

**Exit criteria.** `git check-ignore -v external_feedback.md` matches a rule;
`git add -A && git status` stages nothing new.

---

## F1 — CI · P0 · small

**Why.** No `.github/` directory exists at all. The 187-test suite — including the
parse-fidelity gates that are this project's core quality claim — runs only when a human
remembers to. Worse: `packages/core/test/ats.test.ts` guards six `describe` blocks with
`{ skip: !PDFTOTEXT }`, so on a machine without poppler **the suite goes green having
verified none of the ATS claims.** Every feature after this one changes template output.
CI is what makes those changes reviewable.

**Scope.**
- `.github/workflows/ci.yml` — Node 20 and 22, install Tectonic and poppler, `npm ci`,
  `npm run build`, `npm test`. Cache the Tectonic bundle; the first compile of each
  template downloads packages and is slow.
- Make the ATS gates **fail rather than skip** when `CI=true`. A silent skip in CI is worse
  than no CI. Keep the local skip for contributors without poppler.
- Add a `packages/cli` smoke test — it is the one package with no `test/` directory, and
  PR #4 found its declared bins were never `chmod +x`, exactly the bug class a smoke test
  catches.

**Files.** `.github/workflows/ci.yml`, `packages/core/test/ats.test.ts`, new
`packages/cli/test/cli.test.ts`, root `package.json`.

**Conflicts.** None. Land before F2 so the new gates are enforced from birth.

**Exit criteria.** A PR that deliberately clips a template fails CI.

---

## F2 — Parse-fidelity harness v2 · P1 · medium

**Why.** The entire ATS tier is measured against **one fixture at one density**
(`fixtures/dense.json`) and checks only four things: nothing clipped, critical fields
present, section order preserved, contact block contiguous.

The external feedback's two concrete defects — a certifications grid whose dates and
providers break onto separate parsed lines, and skill categories that merge in parallel
columns — are **invisible to all four gates.** So is every spacing and margin complaint,
which is the lowest-scoring axis in the review. Fix the instrument before trusting it to
grade F5 and F6.

**Scope.**
- New fixtures beside `fixtures/dense.json`:
  - `fixtures/multipage.json` — 8 jobs, 400-character summary; probes page-break clipping.
  - `fixtures/grid.json` — many short awards and many skill categories; reproduces both
    reported column defects.
  - `fixtures/sparse.json` — near-empty; probes orphaned bullets.
- New gates:
  - **Column-merge** — a skill category label and its values must land on the same
    extracted line; two different categories must not.
  - **Record-cohesion** — for each award/certificate, name + issuer + date must fall within
    one extraction window. Generalizes the existing 400-character contact-block check.
  - **Geometry** — read page size from `pdfinfo` and the text bounding box from
    `pdftotext -bbox`; assert effective margin ≥ 0.5in on every template. This is what
    turns the external feedback's margin rule from aspiration into a gate.
  - **Orphan-bullet** — no extracted line consisting solely of a bullet glyph.
- Parametrize the existing four gates over all fixtures, not just `dense.json`.

**Files.** `packages/core/test/ats.test.ts` (extend `extract`/`readings`/`classify`;
memoize per fixture × template rather than per template), `fixtures/*.json`.

**Conflicts.** Expect some templates to **fail the new gates on arrival** — that is the
point, and it is the evidence base for F5. Record failures in `TEMPLATE_PROFILES`; fixing
them is F5's job, not this one. Flag any template that fails the geometry gate at its
*current* hardcoded margin, because F3 then needs a per-template default that clears 0.5in.

**Exit criteria.** New gates run over 4 fixtures × 9 templates; the catalog assertion still
holds; failures are recorded, not silenced.

---

## F3 — `document` configuration surface · P1 · medium-large · **FOUNDATIONAL**

**Why.** What every subsequent visual feature needs, and what "expose that as default
template configuration along with identified variables" actually requires. Without it, F4
and F5 each become nine more hardcoded preambles.

**Scope.** An optional `document` block on `BlueprintSchema`, resolved against per-template
defaults into a `ResolvedDocumentConfig` and threaded into each template's preamble.

### Identified variables

| Variable | Type | Global default | Range / values | Applies to |
|---|---|---|---|---|
| `fontFamily` | enum | `template` | `template` \| `calibri` \| `arial` \| `helvetica` \| `garamond` \| `georgia` | all (F4) |
| `fontSize` | enum (pt) | per-template | `10` \| `10.5` \| `11` \| `11.5` \| `12` | all |
| `paper` | enum | `letter` | `letter` \| `a4` | all |
| `margin` | length string | `0.75in` | **clamped, hard floor `0.5in`** | all |
| `lineSpacing` | number | `1.0` | clamped `1.0`–`1.15` | all |
| `sectionSpacing` | number (pt) | `3` | `0`–`12` | all |
| `bulletSpacing` | number (pt) | `2` | `0`–`12` | all |
| `accentColor` | hex string | per-template | `#RRGGBB`, validated | 2, 3, 7, 9 |
| `contactLayout` | enum | `row` | `row` \| `stacked` | all |
| `linkStyle` | enum | `hidden` | `hidden` \| `colored` | all |

The `margin` floor and the `lineSpacing` ceiling encode the external feedback's universal
rules **in the schema**, so an agent physically cannot shrink margins to 0.4in to force a
one-pager. Clamp silently and report the resolved values rather than erroring — an agent
tuning for length should not get a validation failure it cannot interpret.

### API changes

- `schema.ts` — `DocumentConfigSchema`, and `document: DocumentConfigSchema.default({})`
  on `BlueprintSchema`. **`document` must be excluded from the ATS harness's
  `collectLeaves()`** alongside `sections`/`headings`/`selectedTemplate`, or every config
  value gets hunted for in the PDF text layer.
- `types.ts` — `Generator.resumeHeader: (config: ResolvedDocumentConfig) => string`.
  A required parameter, not optional: all nine templates implement it, and an optional
  parameter would let a future template silently ignore config — the same bug class that
  lost `basics.label` and `work[].summary`.
- New `templates/documentConfig.ts` — `TEMPLATE_DEFAULTS: Record<TemplateId, Partial<DocumentConfig>>`
  and `resolveDocumentConfig(templateId, config)`. Per-template defaults are each
  template's *current* hardcoded values, so **golden output must not change when
  `document` is omitted.** That is this feature's regression guard.
- `templates/index.ts` — resolve once, pass to `templateN(data, config)`.

### Security

`document` values are enums, clamped numbers, and a validated hex string — **none are free
text, so nothing here may take the free-text escape path.** Assert that the `#RRGGBB`
validator rejects `}\input{/etc/passwd}%` outright rather than leaning on `escapeLatex`.
This is a new surface interpolating into TeX, so per CLAUDE.md it must be tested against
`fixtures/injection.json` plus a `document`-specific adversarial case.

### Adapter surface

- **MCP** — `document` passes through `resume_create`/`resume_patch` as blueprint content,
  no tool signature change. Add an optional `document` override to `ResumeRenderInput` and
  `ResumeTexInput`, using the shallow-spread pattern already used for `template`. Extend
  `resume_templates` output with each template's resolved defaults and which variables it
  honours, so an agent can discover the surface instead of guessing.
- **CLI** — `--font`, `--font-size`, `--margin`, `--line-spacing`.
- **HTTP** — `document` rides in the blueprint body; no route change.

**Files.** `packages/core/src/schema.ts`, `types.ts`, new `templates/documentConfig.ts`,
`templates/index.ts`, all of `templates/template1..9.ts`, `packages/core/test/render.test.ts`,
`packages/mcp/src/schemas.ts` and `tools.ts`, `packages/cli/src/index.ts`,
`fixtures/golden/*.tex`.

**Conflicts — FLAGGED.** See C1, C2, C3, C4, C8 below.

**Exit criteria.** With `document` omitted, every golden `.tex` is byte-identical to before
(except any template flagged under C4). With `document` set, all nine templates compile and
pass F2's gates.

---

## F4 — Font families · P1 · medium

**Why.** The headline request. With F3 in place this is one config axis across nine
templates — 54 combinations — rather than five more fixed templates.

**Scope.**
- New `templates/fonts.ts` — `FONT_FAMILIES`, mapping each value to its LaTeX mechanism.
  - **NFSS route** (templates 1, 3, 5, 7, 9): `\usepackage{carlito|arimo|tgheros|ebgaramond}`,
    plus `\renewcommand{\familydefault}{\sfdefault}` for the three sans families. Load
    `ebgaramond` with initials disabled — the probe showed `EBGaramond-Initials.otf`
    emitting "no space character" warnings.
  - **fontspec route** (templates 2, 4, 6, 8): these `\setmainfont` inside vendored `.cls`
    files, so an override must be emitted **after** `\documentclass` and must re-assert
    `\familydefault`. Template 8 is the easy case — wire its existing dead `calibri` class
    option and `\mainfontface` to a real `\setmainfont`.
  - **georgia**: vendor four OFL Gelasio TTFs to `assets/fonts/gelasio/`, add them to
    `opts.fonts`, load via `\setmainfont[Path=fonts/]{Gelasio-Regular}`. Add the OFL text
    and a credit line to README beside the existing font attributions.
- **Step 1 is a spike, not code.** Compile a probe of each family against each of the nine
  templates and confirm the override actually wins. Package-versus-class load order is the
  one genuine unknown, and it is far cheaper to discover in a throwaway `.tex` than across
  nine generators.
- Fold in the `Path = fonts/raleway/` bug at `template4.ts:56`.

**Files.** New `packages/core/src/templates/fonts.ts`, `templates/index.ts` (extend
`opts.fonts` for `georgia`), `assets/templates/template8/mcdowellcv.cls`,
`assets/fonts/gelasio/*`, `templates/template1..9.ts` preambles, README credits,
`fixtures/golden/*.tex`.

**Conflicts.** Consumes F3's `fontFamily`; cannot start before it. Touches all nine
preambles and all goldens — serialize (C1).

**Exit criteria.** All 54 combinations compile; `pdftotext` extraction stays clean for
every one (no private-use glyphs, no dropped characters); F2's gates pass across the
matrix. Any combination that cannot be made to work is recorded in `TEMPLATE_PROFILES` as
unsupported rather than silently falling back.

---

## F5 — ATS layout fixes from external feedback · P1 · medium

**Why.** The only external signal in the repo, and none of it is actioned. Spacing scored
lowest of the four graded axes on both reviewed resumes.

**Scope.**
- **Single-column `Category: Skills` rows.** Category headers currently sit adjacent to
  skill blocks in parallel columns, which merges text in legacy ATS. Convert
  `skillsSection` to one row per category across all nine templates.
- **One horizontal contact row.** Template 1 already does this; audit the other eight and
  drive the choice from F3's `contactLayout`.
- **Orphaned bullet characters.** Reproduced by F2's sparse fixture and gated there.
- **Spacing defaults** — set `sectionSpacing: 3`, `bulletSpacing: 2`, `lineSpacing: 1.0`
  as F3 resolved defaults, not as new hardcoded values.

**Files.** `templates/template1..9.ts` (`skillsSection`, `profileSection`),
`templates/documentConfig.ts` defaults, `fixtures/golden/*.tex`.

**Conflicts — FLAGGED.** Certifications are deliberately **excluded** here and handled in
F6 — see C5.

**Exit criteria.** F2's column-merge and orphan-bullet gates pass on all nine templates.

---

## F6 — `certificates` section · P2 · medium

**Why.** The external feedback's first concrete ask: the certifications grid breaks
`Amazon Web Services` and `2025` onto lines separate from `AWS Certified Cloud
Practitioner`. The requested shape is a flat horizontal list — `Name | Issuer (Year)`.

Certifications have no home in the schema today, so they are being forced into `awards`,
whose `title`/`awarder`/`date` carry neither an expiry nor a credential ID.

**Scope.** Add `certificates` to `SECTION_NAMES` and `BlueprintSchema` using JSON Resume's
standard shape (`name`, `issuer`, `date`, `url`). Implement `certificatesSection` across
all nine generators as a flat single-column list. Make it optional on `Generator` with a
shared default so a future template cannot silently drop it.

**Files.** `packages/core/src/schema.ts`, `types.ts`, `templates/template1..9.ts`,
`packages/mcp/src/schemas.ts` (`SectionEnum` derives from `SECTION_NAMES`, so it follows
automatically), `fixtures/*.json`, `fixtures/golden/*.tex`.

**Conflicts — FLAGGED.** Second schema change after F3; see C2. Adding a `SECTION_NAMES`
member changes the `sections` default array, so every stored blueprint's resolved order
shifts. Decide explicitly that `certificates` **appends at the end** (recommended — no
migration needed) and assert it in the store tests.

**Exit criteria.** F2's record-cohesion gate passes: name, issuer, and date extract within
one window on all nine templates.

---

## F7 — Template 10: Word-alike ATS preset · P2 · small

**Why.** After F3–F6 this is nearly free, and it is what most applicants actually want — a
resume that looks like the Word document a recruiter expects. `TEMPLATE10` is already
declared in `constants.ts` and unregistered.

**Scope.** A single-column `article`-based template whose `TEMPLATE_DEFAULTS` are
`fontFamily: 'calibri'`, `fontSize: 11`, `margin: '0.75in'`, `lineSpacing: 1.15`,
`contactLayout: 'row'` — the external feedback's universal rules as a shipped preset.
Register in `TEMPLATE_IDS`, `TEMPLATES`, `TEMPLATE_PROFILES`, and the `getTemplateData`
switch.

**Files.** New `templates/template10.ts`, `schema.ts` (`TEMPLATE_IDS`),
`templates/constants.ts`, `catalog.ts`, `templates/index.ts`,
`fixtures/golden/template10.tex`.

**Conflicts.** `TEMPLATE_IDS` widening ripples outward — see C6. Every F2 gate loops over
`TEMPLATE_IDS`, so the new template is graded automatically; no gate changes needed.

**Exit criteria.** Template 10 is `atsGrade: true` **by measurement, not assertion.**

---

## F8 — Master-profile importer · P2 · medium

**Why.** `profile_templates/*.md` holds three master profiles and a skills list, and there
is **no ingestion code anywhere** in `packages/`. They also carry 92 occurrences of
`[cite: 1, 2, 3]` / `[cite_start]` markers. Those are plain text, so the sanitizer will
faithfully escape and typeset them into the PDF — a correct sanitizer producing a wrong
document. `external_feedback.md` carries the same artifacts, so whatever generates them is
a recurring source.

**Scope.** `profileToBlueprint(markdown): BlueprintInput` in core — no I/O, since core stays
free of it and the adapter reads the file. The citation-artifact stripper is an explicit,
separately tested pass. Surface as a `resume_import` MCP tool and a `resume import` CLI
command.

**The stripper runs before validation, never after sanitization.** It is a content
normalizer, not an escape step, and must not violate invariant 1.

**Files.** New `packages/core/src/import/profile.ts` and its test,
`packages/mcp/src/tools.ts`, `packages/cli/src/index.ts`.

**Conflicts.** Needs the schema stable — run after F6. Otherwise isolated.

**Addendum, written while implementing.** Two corrections to the paragraph above, from
measuring the corpus rather than trusting this note: it is **98** `[cite: …]` markers
across the three profiles, not 92 (that was a line count), and **`[cite_start]` appears
in none of them** — only in `external_feedback.md`. Refs also include hyphenated ranges
(`[cite: 121, 127-129, 137-139]`). Both marker families are handled regardless, since the
files share an upstream generator.

The stripper guards **only the import path**, by design — stripping is content
normalization, not escaping, and doing it at render time would make the PDF silently
disagree with the stored blueprint. So a blueprint that acquires markers another way (an
agent assembling JSON by hand rather than calling `resume_import`) typesets them
verbatim. `findCitations`/`citationWarnings` is the guard for that: `validate`, `render`,
and `tex` report the sites on both CLI and MCP, and never rewrite anything.

Detection runs on the blueprint, never on generated TeX — `[cite: 1, 2, 3]` survives
`escapeLatex` byte-identical but `[cite_start]` becomes `[cite\_start]`, so a scan of the
output would find only one family. `packages/http` has no guard: it has no validate route
and both render routes return raw PDF bytes with no slot for a warning.

---

## F9 — `blueprintToText` · P3 · small

**Why.** Some portals demand a pasted plain-text resume, and it is the cleanest input for
F10's keyword analysis. The natural sibling of `blueprintToTex`, at the same seam.

**Scope.** `blueprintToText(input: unknown): string` in `packages/core/src/index.ts`,
honouring `sections` and `headings`. **No sanitization** — plain text is not TeX, and
running `escapeLatex` over it would emit `\&` to a human reader.

**Conflicts.** None; adds a path rather than changing one.

---

## F10 — Job-description keyword targeting · P3 · medium

**Why.** The highest-leverage *resume* feature, and entirely greenfield: "ATS" in this repo
currently means parse fidelity only, with nothing about content match. The feedback's
praise for "keyword density" was a human judgement with no tooling behind it.

**Scope.** `analyzeCoverage(blueprint, jobDescription)` returning matched terms, missing
terms ranked by prominence in the JD, and per-section placement suggestions.

**Report only — it must never rewrite the blueprint.** Surfaced as a read-only
`resume_target` MCP tool, so the agent decides what to change and the change flows through
the normal validated `patch` path, keeping every mutation in git history.

**Conflicts.** None with F0–F9. Depends on F9 for its text view.

---

## Parallel track — safe on a separate branch at any time

### F11 — Cross-process store lock · P1 · small

`packages/store/src/lock.ts:9-14` is a per-key **in-process** mutex. Two OS processes — a
long-lived MCP server plus a CLI or HTTP call — against the same `$RESUME_BLUEPRINT_HOME`
can both read the same rev, both pass their own `expectedRev` check, and one commit
silently clobbers the other.

`packages/mcp/README.md:16-33` documents this as "not fixed", deferred "until Gate 2
introduces a long-lived MCP server process" — **Gate 2 shipped in PR #2, so the stated
trigger has already fired.** This is the only unmitigated correctness bug outstanding.
Needs filesystem-level locking (git's `index.lock`, or `flock`). Touches only
`packages/store`; no template or schema overlap.

**Addendum, written while implementing.** Neither literal candidate mechanism named
above was used. `flock` is a Linux util-linux CLI tool, not present on macOS (confirmed
absent on the dev machine), and `flock(2)` has no Node binding without a native addon.
Reusing git's actual `.git/index.lock` was also rejected — `commitFile()`'s own `git
add`/`git commit` calls already touch that exact path, so locking there would race
git's internal locking rather than avoid it. The mechanism actually used is the same
*primitive* git's `index.lock` is built on: an atomic exclusive-create,
`open(path, 'wx')` (`O_CREAT|O_EXCL`), against a distinct file, `<home>/.store.lock`.

`withLock` (`packages/store/src/lock.ts`) now composes two layers: the original
in-process FIFO queue, unchanged, plus this cross-process file lock underneath it.
Every existing call site — `mutate`, `create`, `remove`, `revert`, `get`,
`ensureRepoLocked` — already went through `withLock`, so the upgrade needed no changes
to `index.ts`'s logic.

Contention waits with capped exponential backoff (20ms → 200ms) up to a 35s timeout
(chosen with ~5s margin over `git.ts`'s own 30s per-subprocess timeout), then throws
the new `LockTimeoutError`, mapped to HTTP 503 and reported by name over MCP. Stale-lock
recovery is deliberately fail-fast with no auto-recovery — no PID-liveness check, no
mtime-based steal — matching git's own `index.lock` UX exactly: a lock orphaned by a
killed process makes every later caller wait out the timeout and then get a clear error
naming the file to inspect and delete. A best-effort `process.on('exit', ...)` hook
covers graceful termination (e.g. Ctrl-C mid-commit) but not `SIGKILL` or a crash.

Proven with a real cross-process test (`packages/store/test/cross-process-lock.test.ts`),
not just an in-process one: two genuinely separate OS processes racing a conflicting
patch resolve to exactly one winner, and eight processes racing unconstrained appends
(no `expectedRev` at all) land all eight with zero losses — the case that actually
distinguishes real serialization from processes that happened not to overlap. Test
count 571 → 579.

### F12 — Doc drift and small cleanups · P2 · small

- `CLAUDE.md:6-18` still says Phase 1 is complete and instructs the reader to stop and
  confirm which of two mutually exclusive Phase 2 plans is in play. Phase 2 is done and
  **Plan B was taken** — core and mcp are both on zod 3, with
  `@modelcontextprotocol/sdk ^1.30.0`. A new session is being told to ask a question that
  was settled two PRs ago.
- `CLAUDE.md:84` says README documents "known gaps" — README has no such section.
- `countPages` is duplicated (`packages/mcp/src/render.ts:6-11` vs
  `packages/core/test/render.test.ts:46`), with a comment citing a core-diff freeze that
  ended at Gate 2. Promote it to a core export and delete the stale rationale.
- `basics.profiles[].username` never renders on its own (PR #5 item 3). Nothing is lost —
  it rides along in the link text — but a profile with a username and no valid URL renders
  as unlinked text.
- `createServer(_config)` takes an unused parameter (`packages/http/src/server.ts:83`).
- Template 7's `\moderncvstyle{classic}` → `{banking}` change (commit `46bf555`) was never
  eyeballed. Correct trade, but an unreviewed visual regression.
- Vendored upstream `TODO:` / `Known Issues:` comments ship into every generated `.tex`
  (`templates/template4.ts:342-393`, inside `resumeHeader()`). Upstream inheritance rather
  than this project's debt, but the column-overflow note (`:386-389`) is a live constraint
  worth surfacing properly.

### F13 — zod 4 migration · DONE

`docs/phase-2-plan-b.md:87-88` explicitly deferred it, designating Plan A as the migration
path later. `schema.ts:136` still uses `z.record(SectionSchema, z.string()).default({})` —
the exact construct Plan A's Gate 0 rewrites. **Conflicts with F3, F6, and F8, i.e. every
schema-touching feature.** Do not attempt until F8 lands, then do it alone.

**Addendum, written while implementing.** Four corrections to the paragraph above, and two
hazards no plan document anticipated.

The line reference is stale — the `z.record` construct had moved to `schema.ts:192` by the
time this ran, having been pushed down by F3's `document` block and F6's `certificates`.
The conflict note is also spent: F3, F6 and F8 have all landed, so C7 resolved itself by
waiting rather than by coordination.

**The migration was never coupled to the MCP SDK.** Both plan documents treat zod 4 as a
prerequisite for moving to the V2 SDK, and Plan B's entire premise is that declining zod 4
means staying on V1. Neither holds. The already-installed
`@modelcontextprotocol/sdk@1.30.0` declares `peerDependencies: { zod: "^3.25 || ^4.0" }`
and ships a genuine dual-major compat layer — `server/zod-compat.js` detects v4 schemas by
the presence of `_zod` and branches `safeParse`/`getObjectShape`/`normalizeObjectSchema`,
while `server/zod-json-schema-compat.js` routes v4 to zod's own `toJSONSchema` and v3 to
the vendored `zod-to-json-schema`. zod@4.4.3 still exports the `./v3`, `./v4-mini` and
`./v4/core` subpaths that layer imports, so nothing breaks on load. **The SDK stayed at
`^1.30.0` and was not touched.**

**Plan A's Gate 0 could not be executed literally**, for a second reason beyond its wrong
premise: it scopes itself to `packages/core/src/schema.ts` and `packages/core/package.json`,
because it predates `packages/mcp/src/schemas.ts`. That file holds seven single-argument
`z.record(z.unknown())` calls — a hard removal in v4 — and it cannot be split from core
into a separate commit. `mcp/src/schemas.ts:2` imports core's `DocumentConfigSchema` and
nests it inside its own `z.object()`; a mixed-major tree there is not merely untyped, the
SDK's `objectFromShape` throws `Mixed Zod versions detected in object shape.` outright.
Core and mcp migrate atomically or not at all.

**Hazard 1 — `.default()` now returns a shared instance.** Under v3, `.default(v)` re-parses
the default, so `parse({}).sections !== parse({}).sections`. v4 short-circuits and hands
back the very object it was given, so the two are identical — and `store/src/index.ts:199`
persists exactly what `parseBlueprint` returns. Nothing in the repo mutates `sections`,
`headings` or `document` today, so this was latent rather than live, but the faithful port
is a factory default (`.default(() => [...SECTION_NAMES])`), not a literal. Guarded by a
`notStrictEqual` assertion written before the migration.

**Hazard 2 — `.refine()` no longer narrows.** v4's signature is
`refine(check: (arg) => unknown, params?): this`. It returns `this`, so the type predicate
on `selectedTemplate` stopped narrowing and the exported `Blueprint['selectedTemplate']`
would have silently widened from `1|...|10` to `number` — a public type regression with no
runtime symptom and no failing test. Replaced with `z.literal(TEMPLATE_IDS, { error })`,
which keeps the literal union and the custom message, still rejects fractional ids, and
improves what MCP clients see from `{"type":"integer"}` to
`{"type":"number","enum":[1,...,10]}`.

**What turned out to be a non-event.** The transform-bearing `DocumentConfigSchema` — the
piece most at risk, since `.regex().transform().optional()` inside a `.partial()` object is
fed straight to the SDK's JSON Schema converter — survives intact: the SDK passes
`io: 'input'`, so `margin` publishes with its `LENGTH_PATTERN` and clamping still works.
`{ message: ... }` is still honoured in v4 as a deprecated alias, so Plan A's "breaking
change 2" was a cleanup. `isValidationError` and `formatValidationError` needed no change
at all — `instanceof z.ZodError`, `error.issues`, `issue.path` and `issue.message` all
survive, which is why store, cli and http needed no change despite carrying every
user-facing validation message. And the repo has zero exposure to v4's biggest break, the
top-level string-format move, because every text field is a bare `z.string()` by design.

**One user-visible change**: zod reworded its default messages, so validation output now
reads `Invalid input: expected string, received number` where it read `Expected string,
received number`. Issue *paths* are unchanged, which is why no assertion needed editing.

584 tests, none edited to accommodate the migration — the exit criterion Plan A's Gate 0
set, and the one part of it that transferred cleanly.

---

## Conflict register

Reviewed before starting. Each row is a real collision, not a hypothetical.

| # | Conflict | Resolution |
|---|---|---|
| C1 | F3, F4, F5, F6, F7 all rewrite `fixtures/golden/*.tex` | Strictly serial, one per session; re-baseline at the end of each |
| C2 | F3 and F6 both change `BlueprintSchema` | Never concurrent, never on parallel branches; F3 first |
| C3 | F3 changes the `Generator.resumeHeader` signature | Breaking for any in-flight template work. Land F3 before touching a template for any other reason |
| C4 | F2's 0.5in geometry gate vs. templates whose current hardcoded margin is smaller | Record failures in F2, decide per-template in F3's `TEMPLATE_DEFAULTS`. **Golden output will change for those templates** — the one place F3's byte-identical guarantee is knowingly broken |
| C5 | F5's certifications fix vs. F6's `certificates` schema | Certifications excluded from F5 by design; all of it lands in F6. Doing it twice is the waste this ordering exists to prevent |
| C6 | F7 widens `TEMPLATE_IDS` | Ripples to `packages/mcp/src/schemas.ts` `TemplateId` and the README template table |
| C7 | F13 (zod 4) vs. every schema feature | ~~Deferred until after F8, then done alone~~ **Resolved** — F13 landed after F8 with the tree otherwise quiet, exactly as this row prescribed |
| C8 | F3's `document` block vs. the ATS harness's `collectLeaves()` | Exclude `document` alongside `sections`/`headings`/`selectedTemplate`, or config values get hunted for in the PDF text layer |

**Non-conflicting by construction.** F0, F1, F11, and F12 touch no template file and no
schema. F9 and F10 add new paths rather than changing existing ones.

---

## Invariant compliance

Checked against CLAUDE.md, because three of these features add TeX-interpolating surfaces.

1. **Store raw, sanitize at render.** F3's `document` block is enums, clamped numbers, and
   a validated hex string — no free text, so nothing new enters the non-idempotent escape
   path. F8's citation stripper runs *before* validation, never after sanitization.
2. **MCP never writes stdout, never returns PDF bytes.** F8's `resume_import` and F10's
   `resume_target` return structured data only.
3. **Core stays free of adapter and UI concerns.** F8's parser takes a string, not a path —
   the adapter reads the file. No new runtime dependency is proposed for core in any
   feature; F2's `pdfinfo` / `pdftotext -bbox` usage is test-only, matching the existing
   harness.
