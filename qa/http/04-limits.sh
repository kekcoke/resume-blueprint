#!/usr/bin/env bash
# contract: C7, C8
# The two input-size guards. Both exist because this adapter, unlike MCP, has
# no trusted single client -- anything that can reach the port can send
# anything.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

# C7 -- body over the 5 MiB cap. readJsonBody enforces it WHILE streaming, so
# the oversized body is never buffered in full, and routes.ts then destroys
# the socket rather than offering it back for keep-alive reuse.
big="$QA_WORK/big.json"
node -e '
const fs = require("node:fs");
const filler = "x".repeat(6 * 1024 * 1024);
fs.writeFileSync(process.argv[1], JSON.stringify({ basics: { name: "Ada", summary: filler } }));
' "$big"

code="$(qa_curl -X POST "$BASE_URL/render" -H 'content-type: application/json' \
  --data-binary "@$big" -o "$QA_WORK/big.out" -w '%{http_code}')"
check C7 "a 6 MiB body returns 413" 413 "$code"
check_contains C7 "the 413 names the cap" "exceeds 5242880 bytes" "$(cat "$QA_WORK/big.out")"

# The server must still be alive afterwards -- destroying that socket must not
# take the process with it.
check_contains C7 "the server survives an oversized body" '"status":"ok"' "$(curl -sS "$BASE_URL/healthz")"

# C8 -- depth guard. store's applyMergePatch recurses to the depth of the
# caller-supplied patch with no cap of its own and runs BEFORE validation, so
# the guard sits here at the adapter boundary.
deep="$QA_WORK/deep.json"
node -e '
const fs = require("node:fs");
let node = "leaf";
for (let i = 0; i < 40; i++) node = { nested: node };
fs.writeFileSync(process.argv[1], JSON.stringify({ patch: node }));
' "$deep"

qa_curl -X POST "$BASE_URL/blueprints" -H 'content-type: application/json' \
  -d '{"id":"qa-depth"}' -o /dev/null -w '' 2>/dev/null

body="$(qa_curl -X PATCH "$BASE_URL/blueprints/qa-depth" -H 'content-type: application/json' \
  --data-binary "@$deep" -w '\n%{http_code}')"
code="$(printf '%s' "$body" | tail -1)"
json="$(printf '%s' "$body" | sed '$d')"
check C8 "a 40-deep patch returns 400" 400 "$code"
check_contains C8 "the depth guard has its own message" "input is nested too deeply" "$json"

# Finding G11, asserted rather than described: the same guard is NOT applied to
# POST /render's body. Recorded as current behaviour so a future fix shows up
# here as a red row rather than passing silently.
deeprender="$QA_WORK/deep-render.json"
node -e '
const fs = require("node:fs");
let node = "leaf";
for (let i = 0; i < 40; i++) node = { nested: node };
fs.writeFileSync(process.argv[1], JSON.stringify({ basics: { name: "Ada" }, extra: node }));
' "$deeprender"

body="$(qa_curl -X POST "$BASE_URL/render" -H 'content-type: application/json' \
  --data-binary "@$deeprender" -o "$QA_WORK/deep-render.out" -w '%{http_code}')"
if grep -q "input is nested too deeply" "$QA_WORK/deep-render.out" 2>/dev/null; then
  fail C8 "G11: POST /render is still ungated (known gap)" "the depth guard now applies to /render -- update qa/contract.md and close G11"
else
  pass C8 "G11: POST /render is still ungated (known gap)"
fi

qa_done
