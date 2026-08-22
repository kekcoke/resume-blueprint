#!/usr/bin/env bash
# contract: C8, C9, C10, C11, C12
# Every store refusal, as an isError result carrying the error class by name.
# The class name is the part a caller can branch on -- the message is prose.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

out="$QA_WORK/04.jsonl"
mcp_run "$(dirname "$0")/04-store-errors.jsonl" "$out"
if [ $? -ne 0 ]; then
  fail C9 "the store-errors session completes" "$(head -30 "$out.err")"
  qa_done
fi

check_tool_error C9 "an unknown id is a NotFoundError" "$out" 2 "NotFoundError"
check_tool_error C10 "a traversal id is an InvalidIdError" "$out" 3 "InvalidIdError"
check_tool_ok C12 "resume_create succeeds the first time" "$out" 4
check_tool_error C12 "a duplicate create is an AlreadyExistsError" "$out" 5 "AlreadyExistsError"
check_tool_error C11 "a stale expectedRev is a ConflictError" "$out" 6 "ConflictError"
check_tool_ok C11 "a patch with no expectedRev succeeds" "$out" 7
check_tool_ok C9 "resume_history lists revisions" "$out" 8
check_tool_ok C12 "resume_remove deletes the blueprint" "$out" 9
check_tool_error C12 "the removed blueprint is gone" "$out" 10 "NotFoundError"

# C8 -- the depth guard. Generated rather than committed: 40 levels of nesting
# is not something to hand-write into a .jsonl and still be able to read it.
deep="$QA_WORK/04-deep.jsonl"
node -e '
const fs = require("node:fs");
let patch = "leaf";
for (let i = 0; i < 40; i++) patch = { nested: patch };
const lines = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "resume-blueprint-qa", version: "0.1.0" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "resume_create", arguments: { id: "qa-deep", blueprint: { basics: { name: "Ada Lovelace" } } } } },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "resume_patch", arguments: { id: "qa-deep", patch } } }
];
fs.writeFileSync(process.argv[1], lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
' "$deep"

deepout="$QA_WORK/04-deep-out.jsonl"
mcp_run "$deep" "$deepout"
check_tool_ok C8 "the depth-guard fixture blueprint is created" "$deepout" 2
check_tool_error C8 "a 40-deep patch is refused before it reaches the store" "$deepout" 3 "nested too deeply"

qa_done
