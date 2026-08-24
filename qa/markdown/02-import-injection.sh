#!/usr/bin/env bash
# contract: C19
# CLAUDE.md invariant 1, on the markdown path: the importer stores RAW user
# text. It must NOT sanitize, because sanitizeBlueprint is not idempotent and
# an escaped-at-import blueprint would be escaped again at render --
# "R&D" -> "R\&D" -> "R\textbackslash{}\&D", corroding a little on every edit.
#
# So this row asserts the opposite of what a security check usually asserts:
# the payload MUST still be raw here, and must only get escaped on the way to
# the TeX engine.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

node "$CLI" import "$FIXTURES/profile-injection.md" >"$QA_WORK/inj-imported.json" 2>"$QA_WORK/02.err"
check C19 "adversarial profile imports without error" 0 "$?"

# Byte for byte, not "contains". The fixture itself contains the literal text
# "\textbackslash{}", so a substring search for it would find a match whether
# or not sanitize ever ran -- only equality tells raw from escaped.
check C19 "basics.name survives import unescaped" \
  '\input{/etc/passwd}' \
  "$(json_path "$QA_WORK/inj-imported.json" basics.name)"

# Had sanitize run at import time this would read "100\% ... R\&D", with the
# backslash itself already turned into "\textbackslash{}".
check C19 "% and & survive import unescaped" \
  'Summary containing \write18{id} and 100% coverage of R&D spend.' \
  "$(json_path "$QA_WORK/inj-imported.json" basics.summary)"

# Now the render path, which is where escaping belongs.
node "$CLI" tex "$QA_WORK/inj-imported.json" -o "$QA_WORK/inj.tex" >/dev/null 2>&1
check C19 "the imported blueprint converts to TeX" 0 "$?"

if grep -q 'textbackslash' "$QA_WORK/inj.tex"; then
  pass C19 "escaping happens at render time"
else
  fail C19 "escaping happens at render time" "no \\textbackslash in the generated .tex -- the payload was not escaped"
fi

if grep -q '\\write18' "$QA_WORK/inj.tex"; then
  fail C19 "no live \\write18 in the generated .tex" "$(grep -n '\\write18' "$QA_WORK/inj.tex" | head -3)"
else
  pass C19 "no live \\write18 in the generated .tex"
fi

node "$CLI" render "$QA_WORK/inj-imported.json" -o "$QA_WORK/inj.pdf" >/dev/null 2>"$QA_WORK/02b.err"
check_pdf C19 "the adversarial profile renders to a PDF" "$QA_WORK/inj.pdf"

qa_done
