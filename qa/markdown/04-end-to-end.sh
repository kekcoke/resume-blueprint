#!/usr/bin/env bash
# contract: C21
# The whole markdown-to-PDF pipeline as a caller would actually write it:
# import, validate, render, three processes joined by a pipe.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

# Piped, not via temp files -- this is the invocation the CLI's own --help
# advertises, so it is the one worth proving.
node "$CLI" import "$FIXTURES/profile.md" 2>/dev/null | node "$CLI" validate - >/dev/null 2>&1
check C21 "import | validate exits 0" 0 "$?"

node "$CLI" import "$FIXTURES/profile.md" 2>/dev/null \
  | node "$CLI" render - -o "$QA_WORK/e2e.pdf" >/dev/null 2>"$QA_WORK/04.err"
check C21 "import | render exits 0" 0 "$?"
check_pdf C21 "import | render produces a PDF" "$QA_WORK/e2e.pdf"

# The same pipeline with a template override, since that is the flag a caller
# reaches for first.
node "$CLI" import "$FIXTURES/profile.md" 2>/dev/null \
  | node "$CLI" render - -t 3 -o "$QA_WORK/e2e-t3.pdf" >/dev/null 2>&1
check_pdf C21 "import | render -t 3 produces a PDF" "$QA_WORK/e2e-t3.pdf"

qa_done
