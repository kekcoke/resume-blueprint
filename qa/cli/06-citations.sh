#!/usr/bin/env bash
# contract: C17
# A "[cite: 1, 2]" artifact is legal content that happens to be a leftover
# placeholder, so it is a WARNING and the blueprint stays valid. --strict is
# the flag that turns it into a gate. Both halves matter: a caller building
# on this needs the default not to fail, and needs the opt-in to.
#
# The fixture is built here rather than committed: the artifact has to sit in
# a blueprint (that is where citationWarnings looks), and every committed
# blueprint fixture is deliberately clean.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

cited="$QA_WORK/cited.json"
node -e '
const fs = require("node:fs");
const bp = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
bp.basics.summary = bp.basics.summary + "[cite: 1, 2, 3]";
bp.work[0].summary = "[cite_start]" + (bp.work[0].summary ?? "");
fs.writeFileSync(process.argv[2], JSON.stringify(bp, null, 2));
' "$FIXTURES/sample.json" "$cited"

node "$CLI" validate "$cited" >/dev/null 2>"$QA_WORK/06a.err"
check C17 "citation artifacts do not fail validation" 0 "$?"
check_contains C17 "citation artifacts warn on stderr" "citation artifacts at" "$(cat "$QA_WORK/06a.err")"
check_contains C17 "the warning names the site" "basics.summary" "$(cat "$QA_WORK/06a.err")"

node "$CLI" validate "$cited" --strict >/dev/null 2>&1
check C17 "--strict turns the warning into exit 1" 1 "$?"

# The warning must reach stderr and never stdout -- `resume tex x.json > out.tex`
# has to stay uncontaminated.
node "$CLI" tex "$cited" >"$QA_WORK/06.tex" 2>/dev/null
if grep -q "citation artifacts at" "$QA_WORK/06.tex"; then
  fail C17 "warnings stay off stdout" "the warning leaked into the .tex output"
else
  pass C17 "warnings stay off stdout"
fi

# A clean blueprint must not warn -- otherwise this row would pass vacuously.
node "$CLI" validate "$FIXTURES/sample.json" >/dev/null 2>"$QA_WORK/06b.err"
if grep -q "citation artifacts at" "$QA_WORK/06b.err"; then
  fail C17 "a clean blueprint does not warn" "$(cat "$QA_WORK/06b.err")"
else
  pass C17 "a clean blueprint does not warn"
fi

qa_done
