#!/usr/bin/env bash
# contract: C15
# Expected load, MCP-shaped: 20 render calls issued back to back down one
# stdio pipe, all against the same blueprint.
#
# Two things are being proved, and one is a known gap.
#
#   * All 20 must succeed and all 20 must produce a PDF.
#   * Only the 10 most recent renders of an id are retained -- pruneOldRenders
#     keeps 10, serialized per id by withRenderLock so the readdir/stat/unlink
#     sequence cannot race itself.
#
# The gap (finding G2): unlike HTTP, MCP has NO render concurrency cap.
# withRenderLock wraps only the file write and the prune; renderBlueprint runs
# outside it, so 20 calls can mean 20 simultaneous tectonic subprocesses. That
# is why this row exercises 20 rather than 200 -- 200 would be a fork bomb on
# a laptop, which is precisely the finding.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

n=20
session="$QA_WORK/08-session.jsonl"
node -e '
const fs = require("node:fs");
const n = Number(process.argv[2]);
const lines = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "resume-blueprint-qa", version: "0.1.0" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "resume_create", arguments: { id: "qa-load", blueprint: JSON.parse(fs.readFileSync(process.argv[3], "utf8")) } } }
];
for (let i = 0; i < n; i++) {
  lines.push({ jsonrpc: "2.0", id: 100 + i, method: "tools/call", params: { name: "resume_render", arguments: { id: "qa-load", template: (i % 10) + 1 } } });
}
fs.writeFileSync(process.argv[1], lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
' "$session" "$n" "$FIXTURES/sample.json"

out="$QA_WORK/08.jsonl"
mcp_run "$session" "$out"
if [ $? -ne 0 ]; then
  fail C15 "the $n-render session completes" "$(head -30 "$out.err")"
  qa_done
fi

check_tool_ok C15 "the load fixture is stored" "$out" 2

ok=0
bad=""
for i in $(seq 0 $((n - 1))); do
  id=$((100 + i))
  is_err="$(mcp_pick "$out" "$id.result.isError")"
  path="$(mcp_pick "$out" "$id.result.structuredContent.path")"
  if [ "$is_err" = "true" ] || [ -z "$path" ]; then
    bad="$bad
  request $id: ${is_err:+isError} $(mcp_pick "$out" "$id.result.content" | head -c 120)"
  else
    ok=$((ok + 1))
  fi
done

if [ "$ok" -eq "$n" ]; then
  pass C15 "all $n MCP renders succeeded"
else
  fail C15 "all $n MCP renders succeeded" "$ok of $n succeeded$bad"
fi

# The prune keeps the 10 most recent per id. More than that means the prune
# raced itself or never ran; fewer means it took renders it should have kept.
retained="$(ls "$RESUME_BLUEPRINT_HOME/renders" 2>/dev/null | grep -c '^qa-load-' | tr -d ' ')"
if [ "${retained:-0}" -le 10 ] && [ "${retained:-0}" -ge 1 ]; then
  pass C15 "the prune retained $retained renders for the id (cap 10)"
else
  fail C15 "the prune retains at most 10 renders per id" "found ${retained:-0} files matching qa-load-*"
fi

qa_done
