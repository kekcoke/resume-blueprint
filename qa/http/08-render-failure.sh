#!/usr/bin/env bash
# contract: C22
# A blueprint that passes the schema but breaks the TeX engine is a
# CLIENT-content problem, so it is 422 -- deliberately not 500. That is what
# lets a caller like n8n tell "retrying will not help" from "the server is
# having a bad day".
#
# Provoked by starting a server with tectonic absent from PATH, which is the
# one reliably reproducible engine failure. qa/run.mjs starts that server and
# passes NOTEX_BASE_URL; standalone:
#
#   PATH=/nonexistent RESUME_BLUEPRINT_PORT=8789 node packages/http/dist/index.js
#   NOTEX_BASE_URL=http://127.0.0.1:8789 bash qa/http/08-render-failure.sh
. "$(dirname "$0")/../lib/assert.sh"
qa_init

if [ -z "${NOTEX_BASE_URL:-}" ]; then
  skip C22 "render failure maps to 422" "NOTEX_BASE_URL not set (see the header of this script)"
  qa_done
fi

body="$(curl -sS -X POST "$NOTEX_BASE_URL/render" -H 'content-type: application/json' \
  --data-binary "@$FIXTURES/sample.json" -w '\n%{http_code}')"
code="$(printf '%s' "$body" | tail -1)"
json="$(printf '%s' "$body" | sed '$d')"

check C22 "a render failure returns 422, not 500" 422 "$code"
check_contains C22 "the 422 explains what is missing" "tectonic not found on PATH" "$json"

# The server is still healthy -- a failed render is not a failed process.
check_contains C22 "the server survives a render failure" '"status":"ok"' "$(curl -sS "$NOTEX_BASE_URL/healthz")"

qa_done
