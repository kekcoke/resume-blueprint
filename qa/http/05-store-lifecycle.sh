#!/usr/bin/env bash
# contract: C9, C10, C11, C12
# The stateful half: create, read, patch under optimistic concurrency, delete,
# and the four ways that goes wrong. Each failure gets a distinct status, which
# is what lets a workflow engine branch without parsing prose.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

id="qa-lifecycle-$$"

# Create.
body="$(qa_curl -X POST "$BASE_URL/blueprints" -H 'content-type: application/json' \
  -d "{\"id\":\"$id\",\"blueprint\":{\"basics\":{\"name\":\"Ada Lovelace\"}}}" -w '\n%{http_code}')"
code="$(printf '%s' "$body" | tail -1)"
json="$(printf '%s' "$body" | sed '$d')"
check C12 "POST /blueprints returns 201" 201 "$code"
rev="$(printf '%s' "$json" | json_field rev)"
if [ -n "$rev" ]; then
  pass C12 "create returns a revision"
else
  fail C12 "create returns a revision" "no rev in: $json"
fi

# C12 -- creating the same id twice is a collision, not a bad request.
code="$(qa_curl -X POST "$BASE_URL/blueprints" -H 'content-type: application/json' \
  -d "{\"id\":\"$id\"}" -o "$QA_WORK/dup.out" -w '%{http_code}')"
check C12 "duplicate create returns 409" 409 "$code"

# Read back.
body="$(qa_curl "$BASE_URL/blueprints/$id" -w '\n%{http_code}')"
code="$(printf '%s' "$body" | tail -1)"
check C9 "GET /blueprints/:id returns 200" 200 "$code"
check_contains C9 "the stored blueprint round-trips" "Ada Lovelace" "$(printf '%s' "$body" | sed '$d')"

# C9 -- an id that does not exist.
code="$(qa_curl "$BASE_URL/blueprints/qa-does-not-exist" -o "$QA_WORK/404.out" -w '%{http_code}')"
check C9 "an unknown id returns 404" 404 "$code"

# C10 -- ID_PATTERN doubles as path-traversal protection: ids become filenames
# and `git show <rev>:blueprints/<id>.json` fragments.
code="$(qa_curl "$BASE_URL/blueprints/..%2Fetc" -o "$QA_WORK/trav.out" -w '%{http_code}')"
check C10 "a traversal id returns 400" 400 "$code"
check_contains C10 "the traversal rejection names the id rule" "invalid blueprint id" "$(cat "$QA_WORK/trav.out")"

# Patch with the current rev succeeds.
body="$(qa_curl -X PATCH "$BASE_URL/blueprints/$id" -H 'content-type: application/json' \
  -d "{\"patch\":{\"basics\":{\"label\":\"Principal Engineer\"}},\"expectedRev\":\"$rev\"}" -w '\n%{http_code}')"
code="$(printf '%s' "$body" | tail -1)"
newrev="$(printf '%s' "$body" | sed '$d' | json_field rev)"
check C11 "PATCH with the current rev returns 200" 200 "$code"

# C11 -- the same rev a second time is stale: someone else moved HEAD.
code="$(qa_curl -X PATCH "$BASE_URL/blueprints/$id" -H 'content-type: application/json' \
  -d "{\"patch\":{\"basics\":{\"label\":\"Staff Engineer\"}},\"expectedRev\":\"$rev\"}" \
  -o "$QA_WORK/conflict.out" -w '%{http_code}')"
check C11 "PATCH with a stale rev returns 409" 409 "$code"

# A merge patch's null deletes a key (RFC 7386), and the delete is a new commit.
qa_curl -X PATCH "$BASE_URL/blueprints/$id" -H 'content-type: application/json' \
  -d '{"patch":{"basics":{"label":null}}}' -o /dev/null -w '' 2>/dev/null
after="$(qa_curl "$BASE_URL/blueprints/$id")"
if printf '%s' "$after" | grep -q '"label"'; then
  fail C11 "a null value deletes the key (RFC 7386)" "label survived the patch"
else
  pass C11 "a null value deletes the key (RFC 7386)"
fi

# Render what is stored.
code="$(qa_curl -X POST "$BASE_URL/blueprints/$id/render" -o "$QA_WORK/stored.pdf" -w '%{http_code}')"
check C9 "POST /blueprints/:id/render returns 200" 200 "$code"
check_pdf C9 "the stored blueprint renders" "$QA_WORK/stored.pdf"

# And rendering an id that does not exist is a 404, not a render failure.
code="$(qa_curl -X POST "$BASE_URL/blueprints/qa-does-not-exist/render" -o /dev/null -w '%{http_code}')"
check C9 "rendering an unknown id returns 404" 404 "$code"

# Delete, then confirm it is gone.
code="$(qa_curl -X DELETE "$BASE_URL/blueprints/$id" -o /dev/null -w '%{http_code}')"
check C12 "DELETE /blueprints/:id returns 200" 200 "$code"
code="$(qa_curl "$BASE_URL/blueprints/$id" -o /dev/null -w '%{http_code}')"
check C12 "the deleted blueprint is gone" 404 "$code"

qa_done
