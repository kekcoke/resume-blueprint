#!/usr/bin/env bash
# contract: C1, C16
# The stateless render route -- the one an n8n workflow calls. Blueprint in
# the body, PDF bytes in the response, nothing stored.
#
# Standalone use:
#   npm run start:http            # in one shell
#   bash qa/http/01-render-stateless.sh
#
# Override BASE_URL and TOKEN to point it somewhere else.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

out="$QA_WORK/http-sample.pdf"
read -r code ctype <<<"$(qa_curl -X POST "$BASE_URL/render" \
  -H 'content-type: application/json' \
  --data-binary "@$FIXTURES/sample.json" \
  -o "$out" -w '%{http_code} %{content_type}')"

check C1 "POST /render returns 200" 200 "$code"
check C1 "POST /render returns application/pdf" "application/pdf" "$ctype"
check_pdf C1 "POST /render returns real PDF bytes" "$out"

# /healthz is the liveness probe every caller needs and the one route that is
# never behind auth.
health="$(curl -sS "$BASE_URL/healthz")"
check_contains C1 "GET /healthz reports ok" '"status":"ok"' "$health"

# C16 -- a longer blueprint must produce a longer document, not a truncated one.
multi="$QA_WORK/http-multipage.pdf"
code="$(qa_curl -X POST "$BASE_URL/render" \
  -H 'content-type: application/json' \
  --data-binary "@$FIXTURES/multipage.json" \
  -o "$multi" -w '%{http_code}')"
check C16 "POST /render accepts the multipage fixture" 200 "$code"
check_pdf C16 "the multipage fixture renders" "$multi"

if command -v pdfinfo >/dev/null 2>&1; then
  pages="$(pdfinfo "$multi" 2>/dev/null | awk '/^Pages:/ {print $2}')"
  if [ "${pages:-0}" -ge 2 ]; then
    pass C16 "the multipage fixture is $pages pages"
  else
    fail C16 "the multipage fixture spans 2+ pages" "pdfinfo reported ${pages:-no} pages"
  fi
else
  skip C16 "page count" "pdfinfo not on PATH (install poppler)"
fi

qa_done
