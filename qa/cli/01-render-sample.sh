#!/usr/bin/env bash
# contract: C1
# The baseline invocable: a known-good blueprint in, a real PDF out.
#
#   bash qa/cli/01-render-sample.sh
#
. "$(dirname "$0")/../lib/assert.sh"
qa_init

out="$QA_WORK/sample.pdf"

node "$CLI" render "$FIXTURES/sample.json" -o "$out" >"$QA_WORK/01.out" 2>"$QA_WORK/01.err"
code=$?

check C1 "cli render exits 0" 0 "$code"
check_pdf C1 "cli render writes a PDF" "$out"

# --output goes to the file; the "wrote <path>" receipt goes to stderr, so
# stdout stays clean for `resume render - | ...`.
check C1 "cli render keeps stdout empty when -o is given" "" "$(cat "$QA_WORK/01.out")"
check_contains C1 "cli render reports the written path on stderr" "wrote $out" "$(cat "$QA_WORK/01.err")"

# The same render with no -o must put the PDF bytes on stdout instead.
node "$CLI" render "$FIXTURES/sample.json" >"$QA_WORK/sample-stdout.pdf" 2>/dev/null
check_pdf C1 "cli render streams a PDF to stdout without -o" "$QA_WORK/sample-stdout.pdf"

qa_done
