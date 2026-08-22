#!/usr/bin/env bash
# contract: C3, C4
# The two ways input can be wrong, and the two different messages they get.
# A caller must be able to tell "your JSON is broken" from "your resume is".
. "$(dirname "$0")/../lib/assert.sh"
qa_init

# C3 -- structurally fine JSON, schema-invalid content.
echo '{"basics":{"name":42}}' >"$QA_WORK/bad-schema.json"
node "$CLI" validate "$QA_WORK/bad-schema.json" >/dev/null 2>"$QA_WORK/03a.err"
check C3 "schema-invalid blueprint exits 1" 1 "$?"
check_contains C3 "schema failure says 'invalid blueprint:'" "invalid blueprint:" "$(cat "$QA_WORK/03a.err")"
check_contains C3 "schema failure names the offending path" "basics.name" "$(cat "$QA_WORK/03a.err")"

# C4 -- not JSON at all.
printf '{ this is not json' >"$QA_WORK/bad-json.json"
node "$CLI" validate "$QA_WORK/bad-json.json" >/dev/null 2>"$QA_WORK/03b.err"
check C4 "malformed JSON exits 1" 1 "$?"
check_contains C4 "malformed JSON says 'is not valid JSON'" "is not valid JSON" "$(cat "$QA_WORK/03b.err")"

# The same failure through stdin names "stdin", not a path that does not exist.
printf '{ nope' | node "$CLI" validate - >/dev/null 2>"$QA_WORK/03c.err"
check_contains C4 "malformed JSON on stdin is labelled 'stdin'" "stdin is not valid JSON" "$(cat "$QA_WORK/03c.err")"

# A valid blueprint still passes -- guards against a suite that only ever
# proves things fail.
node "$CLI" validate "$FIXTURES/sample.json" >/dev/null 2>&1
check C3 "a valid blueprint still exits 0" 0 "$?"

qa_done
