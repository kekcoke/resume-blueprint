#!/usr/bin/env bash
# contract: C15
# Expected load, HTTP-shaped.
#
# MAX_CONCURRENT_RENDERS is 4 (packages/http/src/renderLimit.ts) and it is a
# HARD CAP WITH IMMEDIATE REJECTION, not a queue -- a local-first tool should
# fail fast rather than let callers pile up.
#
# So "exactly 4 succeed" is a race, not a contract: slots free as renders
# finish, and a request arriving a millisecond later gets one. What IS
# guaranteed, and what this asserts:
#
#   * every response is either 200-with-PDF or 503-with-Retry-After
#   * at least 4 succeed        (the cap admits 4 in flight)
#   * at least 1 is rejected    (8 requests land inside one ~600ms compile)
#   * a later render still works (slots were released; no leak)
#
# No timing threshold anywhere -- those make a suite flaky on a loaded laptop.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

n=8
for i in $(seq 1 $n); do
  qa_curl -X POST "$BASE_URL/render" -H 'content-type: application/json' \
    --data-binary "@$FIXTURES/sample.json" \
    -D "$QA_WORK/burst-$i.hdr" -o "$QA_WORK/burst-$i.body" \
    -w '%{http_code}' >"$QA_WORK/burst-$i.code" 2>/dev/null &
done
wait

ok=0
rejected=0
unexpected=""

for i in $(seq 1 $n); do
  code="$(cat "$QA_WORK/burst-$i.code" 2>/dev/null)"
  case "$code" in
    200)
      if is_pdf "$QA_WORK/burst-$i.body"; then
        ok=$((ok + 1))
      else
        unexpected="$unexpected
  request $i: 200 but the body is not a PDF"
      fi
      ;;
    503)
      if grep -qi '^retry-after: 5' "$QA_WORK/burst-$i.hdr"; then
        rejected=$((rejected + 1))
      else
        unexpected="$unexpected
  request $i: 503 without Retry-After: 5"
      fi
      ;;
    *)
      unexpected="$unexpected
  request $i: unexpected status $code"
      ;;
  esac
done

if [ -z "$unexpected" ]; then
  pass C15 "every one of $n concurrent renders is 200+PDF or 503+Retry-After ($ok ok, $rejected rejected)"
else
  fail C15 "every one of $n concurrent renders is 200+PDF or 503+Retry-After" "$unexpected"
fi

if [ "$ok" -ge 4 ]; then
  pass C15 "at least 4 concurrent renders succeeded ($ok)"
else
  fail C15 "at least 4 concurrent renders succeeded" "only $ok of $n returned 200; the cap admits 4 in flight"
fi

if [ "$rejected" -ge 1 ]; then
  pass C15 "the cap rejected at least one request ($rejected)"
else
  fail C15 "the cap rejected at least one request" \
"all $n succeeded, so nothing was capped. Either the machine served 8 renders
without ever holding 5 at once, or MAX_CONCURRENT_RENDERS is no longer 4.
Check packages/http/src/renderLimit.ts before assuming flake."
fi

# The slot accounting has to balance: if `release()` were ever missed, the
# pool would drain permanently and this final request would 503 forever.
code="$(qa_curl -X POST "$BASE_URL/render" -H 'content-type: application/json' \
  --data-binary "@$FIXTURES/sample.json" -o "$QA_WORK/after-burst.pdf" -w '%{http_code}')"
check C15 "a render after the burst returns 200 (no slot leak)" 200 "$code"
check_pdf C15 "the post-burst render is a real PDF" "$QA_WORK/after-burst.pdf"

qa_done
