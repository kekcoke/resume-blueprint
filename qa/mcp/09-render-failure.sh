#!/usr/bin/env bash
# contract: C22
# The engine is missing. On MCP this is an isError result reading
# "Render failed: tectonic not found on PATH..." -- the same underlying
# TectonicError the CLI reports as exit 1 and HTTP reports as 422.
#
# Three surfaces, one cause, three shapes. That is the whole reason
# qa/contract.md exists as one table rather than three test files.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

NODE_BIN="$(command -v node)"

# A PATH with git but no tectonic. Emptying PATH outright would also hide git,
# and the store shells out to it for every commit -- the run would fail with a
# GitError long before any render was attempted, proving nothing about the
# engine. So the sandbox bin directory gets exactly one symlink.
mkdir -p "$QA_WORK/nobin"
ln -sf "$(command -v git)" "$QA_WORK/nobin/git"

session="$QA_WORK/09-session.jsonl"
cat >"$session" <<'JSONL'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"resume-blueprint-qa","version":"0.1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"resume_create","arguments":{"id":"qa-notex","blueprint":"@file:fixtures/sample.json"}}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"resume_render","arguments":{"id":"qa-notex"}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"resume_tex","arguments":{"id":"qa-notex"}}}
JSONL

out="$QA_WORK/09.jsonl"
PATH="$QA_WORK/nobin" "$NODE_BIN" "$REPO_ROOT/qa/lib/mcp-pipe.mjs" "$session" >"$out" 2>"$out.err"
if [ $? -ne 0 ]; then
  fail C22 "the no-tectonic session completes" "$(head -30 "$out.err")"
  qa_done
fi

check_tool_ok C22 "storing a blueprint does not need tectonic" "$out" 2
check_tool_error C22 "a missing engine is reported as a render failure" "$out" 3 "Render failed"
check_tool_error C22 "the failure names the missing binary" "$out" 3 "tectonic not found on PATH"

# resume_tex never invokes the engine, so it must still work. If this ever
# fails, the .tex path has grown a dependency on the binary.
check_tool_ok C22 "resume_tex still works without tectonic" "$out" 4

qa_done
