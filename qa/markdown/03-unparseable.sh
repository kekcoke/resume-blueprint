#!/usr/bin/env bash
# contract: C20
# Markdown with no recognisable resume structure is the user's document being
# wrong, not the tool being broken, so it gets its own message rather than a
# stack trace.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

printf '# Shopping list\n\n- milk\n- bread\n' >"$QA_WORK/not-a-resume.md"

node "$CLI" import "$QA_WORK/not-a-resume.md" >/dev/null 2>"$QA_WORK/03.err"
check C20 "unparseable markdown exits 1" 1 "$?"
check_contains C20 "unparseable markdown says 'could not parse the profile'" "could not parse the profile" "$(cat "$QA_WORK/03.err")"
check_contains C20 "the message names the sections it looked for" "Candidate Metadata" "$(cat "$QA_WORK/03.err")"

# An empty document takes the same path.
: >"$QA_WORK/empty.md"
node "$CLI" import "$QA_WORK/empty.md" >/dev/null 2>"$QA_WORK/03b.err"
check C20 "an empty document exits 1" 1 "$?"

qa_done
