# The cross-adapter contract

This is the load-bearing artifact of the QA layer. Everything in `qa/` exists to
execute or maintain it.

The repo has 584 tests, and every one of them tests a package in isolation.
Nothing anywhere states what *the same blueprint* should do across CLI, HTTP,
MCP and the markdown importer — so the four have drifted, and the drift is
invisible because no test spans them. This table is that missing statement.

Each row is one scenario. Each cell is the **exact observable outcome** on that
surface, taken from the implementation rather than the README. `qa/<suite>/*.sh`
executes them and reports by row id, so a red run names the row, not a file.

`—` means the scenario does not apply to that surface. **no surface** means it
*should* apply and does not; those are findings, not exemptions.

| # | Scenario | CLI | HTTP | MCP |
|---|---|---|---|---|
| C1 | Render `fixtures/sample.json` | exit 0, file begins `%PDF`; `-o` writes the file and the receipt goes to stderr | 200 `application/pdf` | `{path, pageCount, byteSize, coreBuild}` — never PDF bytes |
| C2 | Templates 1–10 | exit 0 ×10 | — (covered on CLI/MCP) | ×10; template 99 rejected by the input schema |
| C3 | Schema-invalid blueprint | exit 1, stderr `invalid blueprint:` + the failing path | 400, `{"error"}` naming the path | `resume_validate` → `valid:false`, **`isError:false`** |
| C4 | Malformed JSON | exit 1, `is not valid JSON` (`stdin` when piped) | 400 `malformed JSON in request body` | — (framing is the transport's job) |
| C5 | `fixtures/injection.json` | exit 0 + PDF; no live `\write18` or `\input{/etc/passwd}` in the `.tex`; no `/tmp/pwned` | 200 + PDF; no `/tmp/pwned` | stores, tex, renders; `.tex` escaped; no `/tmp/pwned` |
| C6 | `fixtures/injection-document.json` | exit 1 — the schema **rejects**, it does not escape | 400 | `valid:false` |
| C7 | Body > 5 MiB | — | 413 `exceeds 5242880 bytes`, socket destroyed, server survives | — |
| C8 | Nesting > 32 | — | 400 `input is nested too deeply` on `PATCH`; **`POST /render` ungated (G11)** | `isError`, `patch is nested too deeply` |
| C9 | Unknown id | — | 404 | `isError`, `NotFoundError` |
| C10 | Traversal id (`../etc`) | — | 400, `invalid blueprint id` | `isError`, `InvalidIdError` |
| C11 | Stale `expectedRev` | — | 409 | `isError`, `ConflictError` |
| C12 | Duplicate create | — | 409 | `isError`, `AlreadyExistsError` |
| C13 | Auth off / valid / wrong / absent / non-Bearer | — | 200 / 200 / 401 / 401 / 401; `/healthz` always 200 | — (stdio has no auth surface) |
| C14 | Unknown route, no token | — | **401, not 404** — auth precedes routing | — |
| C15 | Expected load | 10 parallel processes → 10 PDFs | 8 concurrent → each is 200+PDF or 503+`Retry-After: 5`; ≥4 succeed; ≥1 rejected; a later render still 200 | 20 calls → 20 PDFs; ≤10 retained per id. **No cap (G2)** |
| C16 | `fixtures/multipage.json` | — | 200; `pdfinfo` reports ≥2 pages (skips without poppler) | `pageCount ≥ 2` |
| C17 | Citation artifacts | stderr warning, exit 0; `--strict` → exit 1; warning never on stdout | **no surface (G3)** | `valid:true` **plus** `warnings[]` |
| C18 | Import `fixtures/profile.md` | blueprint→stdout, warnings→stderr; markers stripped; output validates | **no route (G3)** | `{blueprint, warnings}`; stores nothing |
| C19 | `fixtures/profile-injection.md` | imports **raw** — `basics.name` is byte-for-byte `\input{/etc/passwd}`; escaping happens only at render | — | same, and the store round-trips it raw |
| C20 | Unparseable markdown | exit 1, `could not parse the profile`, names the sections it looked for | — | `isError`, `Could not parse the profile` |
| C21 | md → import → validate → render | `%PDF`, as a pipeline | — | import → create → render |
| C22 | `tectonic` absent from PATH | exit 1, `tectonic not found on PATH` + install hint | **422**, not 500 | `isError`, `Render failed: tectonic not found on PATH`; `resume_tex` still works |
| C23 | Render timeout | `--timeout 1` → exit 1, `Tectonic timed out after 1ms` | — (fixed 180 s, not caller-settable) | `timeoutMs:1` → `isError`; `0` and `600000` rejected at the schema |

## Two rows that need their reasoning stated

**C15, HTTP.** `MAX_CONCURRENT_RENDERS` is 4 (`packages/http/src/renderLimit.ts`)
and it is a hard cap with immediate rejection, not a queue — a local-first tool
should fail fast rather than let callers pile up. Slots free as renders finish,
so *"exactly 4 succeed"* is a race, not a contract: a request arriving a
millisecond later legitimately gets a freed slot. The four assertions above are
what remains true regardless of scheduling, and none of them is a timing
threshold. A run that reports `4 ok, 4 rejected` and one that reports `6 ok,
2 rejected` are both green, and both correct.

**C24 is deliberately absent.** `LockTimeoutError → 503` needs another process
to hold the store lock for 35 s (`packages/store/src/lock.ts`). It is already
covered by `packages/store/test/lock.test.ts` through the
`__configureLockTimingForTests` hook, which can compress the wait; this harness
cannot, and 35 s of dead time on every QA run buys nothing the unit test does
not already have. Recorded here so its absence is a decision rather than an
oversight.

## Adding a row

1. Add it to this table first, with the exact outcome for every surface it
   touches. If a surface has no way to express the scenario, write **no
   surface** and open a finding — do not quietly write `—`.
2. Add the assertions to the relevant `qa/<suite>/*.sh`, tagged with the row id
   in the `# contract:` header so the driver can attribute a crash to it.
3. For a new HTTP request, regenerate the collection:
   `node qa/run.mjs --emit-collection`.

## When a row goes red

It is one of two things, and the difference matters:

- **a regression** — the code changed and the contract did not. Fix the code.
- **a stale row** — the contract changed deliberately and this table did not.
  Fix the table, in the same commit as the code change, and say so in the
  message.

Editing this file to make a run go green, without deciding which of the two it
was, is the one thing that turns the harness into decoration.
