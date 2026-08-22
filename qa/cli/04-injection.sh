#!/usr/bin/env bash
# contract: C5, C6
# The security row. fixtures/injection.json is hostile content that must
# TYPESET rather than EXECUTE; fixtures/injection-document.json is hostile
# `document` config, which the schema rejects outright because none of those
# fields is free text in the first place.
#
# CLAUDE.md: any new surface that accepts blueprints must be tested against
# fixtures/injection.json. This is the CLI's half of that.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

rm -f /tmp/pwned

# C5 -- renders, and the payload survives only as literal text.
out="$QA_WORK/injection.pdf"
node "$CLI" render "$FIXTURES/injection.json" -o "$out" >/dev/null 2>"$QA_WORK/04.err"
check C5 "injection fixture renders" 0 "$?"
check_pdf C5 "injection fixture produces a PDF" "$out"

tex="$QA_WORK/injection.tex"
node "$CLI" tex "$FIXTURES/injection.json" -o "$tex" >/dev/null 2>&1

# `\` becomes `\textbackslash{}`, so a live control sequence cannot survive
# sanitize. Asserting on the .tex rather than the PDF because this is where
# an escaping regression is actually visible.
if grep -q '\\write18' "$tex"; then
  fail C5 "no live \\write18 in generated .tex" "$(grep -n '\\write18' "$tex" | head -3)"
else
  pass C5 "no live \\write18 in generated .tex"
fi

if grep -qF '\input{/etc/passwd}' "$tex"; then
  fail C5 "no live \\input{/etc/passwd} in generated .tex" "$(grep -nF '\input{/etc/passwd}' "$tex" | head -3)"
else
  pass C5 "no live \\input{/etc/passwd} in generated .tex"
fi

# The payload's own stated goal. Tectonic runs with --untrusted, so
# shell-escape is off and this file must not appear.
if [ -e /tmp/pwned ]; then
  fail C5 "shell-escape stays disabled (/tmp/pwned not created)" "/tmp/pwned exists after rendering the injection fixture"
  rm -f /tmp/pwned
else
  pass C5 "shell-escape stays disabled (/tmp/pwned not created)"
fi

# C6 -- the `document` block is enums, clamped numbers and regex-checked
# strings, so hostile values are a SCHEMA failure, never an escaping problem.
node "$CLI" render "$FIXTURES/injection-document.json" -o "$QA_WORK/injdoc.pdf" >/dev/null 2>"$QA_WORK/04b.err"
check C6 "hostile document config is rejected, not escaped" 1 "$?"
check_contains C6 "hostile document config fails validation" "invalid blueprint:" "$(cat "$QA_WORK/04b.err")"

qa_done
