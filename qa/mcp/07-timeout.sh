#!/usr/bin/env bash
# contract: C23
# The render timeout, and the bounds around it.
#
# MCP is the only adapter that lets the caller set the budget, capped at
# 300_000ms by the input schema -- generous enough for a cold-cache first
# compile, tight enough that a caller cannot pin subprocesses open for days.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

out="$QA_WORK/07.jsonl"
mcp_run "$(dirname "$0")/07-timeout.jsonl" "$out"
if [ $? -ne 0 ]; then
  fail C23 "the timeout session completes" "$(head -30 "$out.err")"
  qa_done
fi

check_tool_ok C23 "the fixture blueprint is stored" "$out" 2

# 1ms cannot finish any real compile.
check_tool_error C23 "a 1ms budget fails the render" "$out" 3 "Render failed"
check_tool_error C23 "the failure names the budget" "$out" 3 "timed out after 1ms"

# 600_000ms is over the schema's 300_000 ceiling -- rejected at the boundary,
# never handed to the engine.
check_tool_error C23 "a budget over the 300s ceiling is rejected" "$out" 4 "timeoutMs"

# 0 is not a positive integer.
check_tool_error C23 "a zero budget is rejected" "$out" 5 "timeoutMs"

qa_done
