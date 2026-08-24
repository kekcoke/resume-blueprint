#!/usr/bin/env bash
# contract: C18
# The fourth caller: a master-profile markdown document.
#
# fixtures/profile.md is the synthetic stand-in for the real thing.
# profile_templates/ holds actual documents with actual personal data and is
# gitignored for exactly that reason (feature F0) -- no QA script may read it.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

node "$CLI" import "$FIXTURES/profile.md" >"$QA_WORK/imported.json" 2>"$QA_WORK/01.err"
check C18 "import exits 0" 0 "$?"

# Blueprint to stdout, warnings to stderr: that split is what makes
# `resume import p.md | resume validate -` work at all.
name="$(json_field basics <"$QA_WORK/imported.json")"
if [ -s "$QA_WORK/imported.json" ]; then
  pass C18 "import writes the blueprint to stdout"
else
  fail C18 "import writes the blueprint to stdout" "stdout was empty"
fi

check_contains C18 "the imported blueprint carries the candidate name" "Ada Lovelace" "$(cat "$QA_WORK/imported.json")"
check_contains C18 "citation artifacts are reported as warnings on stderr" "citation artifact" "$(cat "$QA_WORK/01.err")"

# The importer strips "[cite: ...]" markers; none may survive into the blueprint.
if grep -q '\[cite' "$QA_WORK/imported.json"; then
  fail C18 "citation markers are stripped from the blueprint" "$(grep -n '\[cite' "$QA_WORK/imported.json" | head -3)"
else
  pass C18 "citation markers are stripped from the blueprint"
fi

# Structure actually landed, not just basics.
work_count="$(node -e 'const b=require("node:fs").readFileSync(0,"utf8");process.stdout.write(String((JSON.parse(b).work||[]).length))' <"$QA_WORK/imported.json")"
if [ "${work_count:-0}" -ge 1 ]; then
  pass C18 "import extracted $work_count work entries"
else
  fail C18 "import extracted work entries" "found none"
fi

# And the output is a blueprint the rest of the system accepts.
node "$CLI" validate "$QA_WORK/imported.json" >/dev/null 2>&1
check C18 "the imported blueprint validates" 0 "$?"

qa_done
