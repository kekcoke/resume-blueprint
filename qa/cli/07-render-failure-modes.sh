#!/usr/bin/env bash
# contract: C22, C23
# The two ways rendering fails for reasons that are not the blueprint's fault:
# the engine is missing, and the engine ran too long. Both surface as a
# TectonicError, which the CLI reports as "compilation failed: <message>".
#
# Both are also the rows that expose finding G1 -- they exit 1, exactly like a
# schema failure and a usage error do, so a calling script cannot tell a
# missing binary from a typo without parsing stderr.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

NODE_BIN="$(command -v node)"

# C22 -- tectonic absent. PATH is emptied to a directory with nothing in it;
# node is invoked by absolute path so the harness itself still runs.
mkdir -p "$QA_WORK/nobin"
PATH="$QA_WORK/nobin" "$NODE_BIN" "$CLI" render "$FIXTURES/sample.json" -o "$QA_WORK/nope.pdf" \
  >/dev/null 2>"$QA_WORK/07a.err"
check C22 "missing tectonic exits 1" 1 "$?"
check_contains C22 "missing tectonic is reported by name" "tectonic not found on PATH" "$(cat "$QA_WORK/07a.err")"
check_contains C22 "missing tectonic suggests an install" "brew install tectonic" "$(cat "$QA_WORK/07a.err")"

# C23 -- a 1ms budget cannot finish any real compile, so this exercises the
# timeout path deterministically without depending on how slow the machine is.
node "$CLI" render "$FIXTURES/sample.json" --timeout 1 -o "$QA_WORK/slow.pdf" \
  >/dev/null 2>"$QA_WORK/07b.err"
check C23 "render timeout exits 1" 1 "$?"
check_contains C23 "render timeout reports the budget" "Tectonic timed out after 1ms" "$(cat "$QA_WORK/07b.err")"

# Finding G4, asserted rather than described: --timeout is the one numeric
# flag that skips parseNumberFlag, so a typo becomes NaN and is reported as a
# timeout that never existed. This row documents CURRENT behaviour; when G4 is
# fixed, this expectation changes to a usage error and contract.md moves with it.
node "$CLI" render "$FIXTURES/sample.json" --timeout abc -o "$QA_WORK/nan.pdf" \
  >/dev/null 2>"$QA_WORK/07c.err"
check_contains C23 "G4: --timeout abc becomes NaN (known gap)" "timed out after NaNms" "$(cat "$QA_WORK/07c.err")"

# The guarded flags behave the way --timeout should.
node "$CLI" render "$FIXTURES/sample.json" --font-size abc -o "$QA_WORK/nan2.pdf" \
  >/dev/null 2>"$QA_WORK/07d.err"
check_contains C23 "--font-size abc is rejected as a usage error" "--font-size must be a number" "$(cat "$QA_WORK/07d.err")"

qa_done
