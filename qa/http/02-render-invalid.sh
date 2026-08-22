#!/usr/bin/env bash
# contract: C3, C4, C6
# The error taxonomy that makes HTTP the most legible of the three adapters:
# a bad body and bad content get different, machine-readable statuses. Every
# non-2xx response is the same flat {"error": string} envelope.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

# C3 -- schema-invalid.
body="$(qa_curl -X POST "$BASE_URL/render" -H 'content-type: application/json' \
  -d '{"basics":{"name":42}}' -w '\n%{http_code}')"
code="$(printf '%s' "$body" | tail -1)"
json="$(printf '%s' "$body" | sed '$d')"
check C3 "schema-invalid blueprint returns 400" 400 "$code"
check_contains C3 "the 400 body names the offending path" "basics.name" "$json"

# C4 -- not JSON.
body="$(qa_curl -X POST "$BASE_URL/render" -H 'content-type: application/json' \
  -d '{ this is not json' -w '\n%{http_code}')"
code="$(printf '%s' "$body" | tail -1)"
json="$(printf '%s' "$body" | sed '$d')"
check C4 "malformed JSON returns 400" 400 "$code"
check_contains C4 "malformed JSON has its own message" "malformed JSON in request body" "$json"

# C6 -- hostile document config. Rejected by the schema, never escaped.
body="$(qa_curl -X POST "$BASE_URL/render" -H 'content-type: application/json' \
  --data-binary "@$FIXTURES/injection-document.json" -w '\n%{http_code}')"
code="$(printf '%s' "$body" | tail -1)"
check C6 "hostile document config returns 400" 400 "$code"

# Every error response carries the same envelope, so a caller can parse one shape.
err="$(printf '%s' "$body" | sed '$d' | json_field error)"
if [ -n "$err" ]; then
  pass C6 "errors use the flat {\"error\": string} envelope"
else
  fail C6 "errors use the flat {\"error\": string} envelope" "no top-level string \"error\" in: $(printf '%s' "$body" | sed '$d' | head -c 300)"
fi

qa_done
