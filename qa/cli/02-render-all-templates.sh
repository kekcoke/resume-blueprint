#!/usr/bin/env bash
# contract: C2
# Every template compiles. This is the row that catches a template edit that
# typesets fine in isolation and breaks a document class somewhere else.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

for t in 1 2 3 4 5 6 7 8 9 10; do
  out="$QA_WORK/t$t.pdf"
  if node "$CLI" render "$FIXTURES/sample.json" -t "$t" -o "$out" >/dev/null 2>"$QA_WORK/t$t.err"; then
    check_pdf C2 "template $t renders" "$out"
  else
    fail C2 "template $t renders" "$(tail -20 "$QA_WORK/t$t.err")"
  fi
done

qa_done
