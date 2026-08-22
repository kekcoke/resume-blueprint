#!/usr/bin/env bash
# contract: C3, C6, C17
# resume_validate is the deliberate exception to toToolError: reporting
# "invalid" is its SUCCESSFUL outcome, so isError stays false either way and
# the verdict rides in structuredContent.valid. An agent that treated
# isError as "the blueprint is bad" would be wrong about this one tool.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

out="$QA_WORK/03.jsonl"
mcp_run "$(dirname "$0")/03-validate.jsonl" "$out"
if [ $? -ne 0 ]; then
  fail C3 "the validate session completes" "$(head -30 "$out.err")"
  qa_done
fi

# Valid.
check_tool_ok C3 "a valid blueprint validates" "$out" 2
check C3 "a valid blueprint reports valid:true" "true" "$(mcp_pick "$out" 2.result.structuredContent.valid)"

# C3 -- invalid, but NOT a tool error.
check C3 "an invalid blueprint reports valid:false" "false" "$(mcp_pick "$out" 3.result.structuredContent.valid)"
# Explicitly false, not merely absent: the handler sets it that way on purpose,
# and an agent branching on isError must not read "invalid" as "tool broke".
check C3 "reporting 'invalid' is not a tool failure" "false" "$(mcp_pick "$out" 3.result.isError)"
check_contains C3 "the errors name the offending path" "basics.name" "$(mcp_pick "$out" 3.result.structuredContent.errors)"

# C6 -- hostile document config is a schema rejection.
check C6 "hostile document config reports valid:false" "false" "$(mcp_pick "$out" 4.result.structuredContent.valid)"

# C17 -- a citation artifact is legal content, so `valid` stands and the
# leftover placeholder is reported alongside the pass, not instead of it.
check C17 "a blueprint with citation artifacts is still valid" "true" "$(mcp_pick "$out" 5.result.structuredContent.valid)"
warnings="$(mcp_pick "$out" 5.result.structuredContent.warnings)"
check_contains C17 "citation artifacts come back as warnings" "citation artifact" "$warnings"
check_contains C17 "the warning names the site" "basics.summary" "$warnings"

# A clean blueprint must carry no warnings, or the row above proves nothing.
check C17 "a clean blueprint has no warnings" "" "$(mcp_pick "$out" 2.result.structuredContent.warnings)"

# The discovery surface an agent needs before spending a render on an override
# that would silently do nothing.
check_tool_ok C3 "resume_templates answers" "$out" 6
check_contains C3 "resume_templates reports what each template honours" "honours" "$(mcp_pick "$out" 6.result.structuredContent.templates)"

qa_done
