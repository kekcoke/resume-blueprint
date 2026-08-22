#!/usr/bin/env bash
# contract: C5
# CLAUDE.md requires every blueprint-accepting surface to be tested against
# fixtures/injection.json. This is HTTP's half.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

rm -f /tmp/pwned

out="$QA_WORK/http-injection.pdf"
code="$(qa_curl -X POST "$BASE_URL/render" -H 'content-type: application/json' \
  --data-binary "@$FIXTURES/injection.json" -o "$out" -w '%{http_code}')"

check C5 "POST /render accepts the injection fixture" 200 "$code"
check_pdf C5 "the injection fixture renders over HTTP" "$out"

if [ -e /tmp/pwned ]; then
  fail C5 "shell-escape stays disabled over HTTP" "/tmp/pwned exists after the request"
  rm -f /tmp/pwned
else
  pass C5 "shell-escape stays disabled over HTTP"
fi

qa_done
