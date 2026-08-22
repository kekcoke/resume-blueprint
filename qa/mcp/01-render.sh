#!/usr/bin/env bash
# contract: C1, C16
# The baseline MCP render, plus the two invariants that make MCP different
# from the other adapters:
#
#   * it returns {path, pageCount, byteSize, coreBuild} -- never PDF bytes.
#     A 24KB PDF is ~32K characters of base64 spent conveying a document the
#     agent cannot read.
#   * stdout carries JSON-RPC and nothing else. mcp-pipe fails the run if any
#     non-protocol line appears there.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

out="$QA_WORK/01.jsonl"
mcp_run "$(dirname "$0")/01-render.jsonl" "$out"
code=$?
if [ "$code" -ne 0 ]; then
  fail C1 "the MCP session completes" "$(cat "$out.err" | head -30)"
  qa_done
fi
pass C1 "the MCP session completes (stdout carried only JSON-RPC)"

tools="$(mcp_pick "$out" 2.result.tools | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>process.stdout.write(String(JSON.parse(r||"[]").length)))')"
if [ "${tools:-0}" -ge 1 ]; then
  pass C1 "tools/list advertises $tools tools"
else
  fail C1 "tools/list advertises tools" "got: $tools"
fi

check_tool_ok C1 "resume_create stores the sample blueprint" "$out" 3
check_tool_ok C1 "resume_render succeeds" "$out" 4

path="$(mcp_pick "$out" 4.result.structuredContent.path)"
pages="$(mcp_pick "$out" 4.result.structuredContent.pageCount)"
bytes="$(mcp_pick "$out" 4.result.structuredContent.byteSize)"
build="$(mcp_pick "$out" 4.result.structuredContent.coreBuild)"

check_pdf C1 "resume_render writes a real PDF to disk" "$path"
check C1 "the sample renders to one page" 1 "$pages"

if [ "${bytes:-0}" -gt 1000 ]; then
  pass C1 "resume_render reports a plausible byteSize ($bytes)"
else
  fail C1 "resume_render reports a plausible byteSize" "got: ${bytes:-empty}"
fi

check_contains C1 "resume_render stamps the core build it used" "core built" "$build"

# Invariant 2's second half: no PDF bytes may cross the wire.
if grep -q '%PDF' "$out"; then
  fail C1 "no PDF bytes cross the MCP wire" "found %PDF in the response stream"
else
  pass C1 "no PDF bytes cross the MCP wire"
fi

# The render lands under $RESUME_BLUEPRINT_HOME/renders, which is where the
# 10-deep prune and the store's .gitignore both expect it.
case "$path" in
  "$RESUME_BLUEPRINT_HOME"/renders/*) pass C1 "the render lands under \$RESUME_BLUEPRINT_HOME/renders" ;;
  *) fail C1 "the render lands under \$RESUME_BLUEPRINT_HOME/renders" "got: $path" ;;
esac

# C16 -- a longer blueprint really is longer.
check_tool_ok C16 "the multipage fixture renders" "$out" 6
mpages="$(mcp_pick "$out" 6.result.structuredContent.pageCount)"
if [ "${mpages:-0}" -ge 2 ]; then
  pass C16 "the multipage fixture is $mpages pages"
else
  fail C16 "the multipage fixture spans 2+ pages" "pageCount was ${mpages:-empty}"
fi

qa_done
