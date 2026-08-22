#!/usr/bin/env bash
# contract: C18, C19, C20
# The markdown caller over MCP. resume_import stores nothing -- it returns the
# blueprint and its warnings and leaves the decision to the agent, which is
# why the warnings have to be legible rather than a count.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

out="$QA_WORK/05.jsonl"
mcp_run "$(dirname "$0")/05-import.jsonl" "$out"
if [ $? -ne 0 ]; then
  fail C18 "the import session completes" "$(head -30 "$out.err")"
  qa_done
fi

check_tool_ok C18 "resume_import parses the master profile" "$out" 2
blueprint="$(mcp_pick "$out" 2.result.structuredContent.blueprint)"
check_contains C18 "the imported blueprint carries the candidate name" "Ada Lovelace" "$blueprint"
check_contains C18 "citation removal is reported as a warning" "citation artifact" "$(mcp_pick "$out" 2.result.structuredContent.warnings)"

case "$blueprint" in
  *'[cite'*) fail C18 "citation markers are stripped from the blueprint" "found a [cite marker in the imported blueprint" ;;
  *) pass C18 "citation markers are stripped from the blueprint" ;;
esac

# resume_import returns, it does not store. Nothing may appear in the store as
# a side effect of importing.
if [ -d "$RESUME_BLUEPRINT_HOME/blueprints" ] && ls "$RESUME_BLUEPRINT_HOME/blueprints" 2>/dev/null | grep -q .; then
  fail C18 "resume_import stores nothing" "$(ls "$RESUME_BLUEPRINT_HOME/blueprints")"
else
  pass C18 "resume_import stores nothing"
fi

# C19 -- invariant 1: what comes back is RAW. Escaping belongs at render time,
# and doing it here would compound on every later edit.
check_tool_ok C19 "the adversarial profile imports" "$out" 3
mcp_pick "$out" 3.result.structuredContent.blueprint >"$QA_WORK/05-inj.json"

# Byte for byte. The fixture contains the literal text "\textbackslash{}", so
# searching for that string cannot tell raw input from sanitized output.
check C19 "basics.name comes back raw" \
  '\input{/etc/passwd}' \
  "$(json_path "$QA_WORK/05-inj.json" basics.name)"
check C19 "% and & come back unescaped" \
  'Summary containing \write18{id} and 100% coverage of R&D spend.' \
  "$(json_path "$QA_WORK/05-inj.json" basics.summary)"

# C20 -- a document with no resume structure is the user's document being
# wrong, so it gets its own message rather than a stack trace labelled
# "Unexpected error".
check_tool_error C20 "unparseable markdown is reported as such" "$out" 4 "Could not parse the profile"

qa_done
