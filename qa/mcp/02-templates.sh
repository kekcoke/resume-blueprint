#!/usr/bin/env bash
# contract: C2
# All ten templates through MCP, plus the eleventh that must not exist:
# template 99 is rejected by the input schema before any render is attempted.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

out="$QA_WORK/02.jsonl"
mcp_run "$(dirname "$0")/02-templates.jsonl" "$out"
if [ $? -ne 0 ]; then
  fail C2 "the templates session completes" "$(head -30 "$out.err")"
  qa_done
fi

check_tool_ok C2 "resume_create stores the blueprint" "$out" 2

for t in 1 2 3 4 5 6 7 8 9 10; do
  id=$((10 + t))
  check_tool_ok C2 "template $t renders" "$out" "$id"
  p="$(mcp_pick "$out" "$id.result.structuredContent.path")"
  [ -n "$p" ] && check_pdf C2 "template $t writes a PDF" "$p"
done

# An out-of-range template is a schema rejection, not a render attempt.
check_tool_error C2 "template 99 is rejected" "$out" 21 "template must be one of"

qa_done
