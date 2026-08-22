#!/usr/bin/env bash
# contract: C13, C14
# Auth is off unless RESUME_BLUEPRINT_TOKEN is set (local-first default), so
# this row needs a SECOND server that has one. qa/run.mjs starts it and passes
# it in; standalone, export the two variables yourself:
#
#   RESUME_BLUEPRINT_TOKEN=s3cret RESUME_BLUEPRINT_PORT=8788 npm run start:http
#   AUTH_BASE_URL=http://127.0.0.1:8788 AUTH_TOKEN=s3cret bash qa/http/07-auth.sh
. "$(dirname "$0")/../lib/assert.sh"
qa_init

if [ -z "${AUTH_BASE_URL:-}" ] || [ -z "${AUTH_TOKEN:-}" ]; then
  skip C13 "bearer token enforcement" "AUTH_BASE_URL/AUTH_TOKEN not set (see the header of this script)"
  skip C14 "auth precedes routing" "AUTH_BASE_URL/AUTH_TOKEN not set"
  qa_done
fi

# Auth disabled on the default server: no header, still served.
code="$(curl -sS -X POST "$BASE_URL/render" -H 'content-type: application/json' \
  --data-binary "@$FIXTURES/sample.json" -o /dev/null -w '%{http_code}')"
check C13 "with no token configured, an unauthenticated request is served" 200 "$code"

# Correct token.
code="$(curl -sS -H "Authorization: Bearer $AUTH_TOKEN" "$AUTH_BASE_URL/blueprints" \
  -o /dev/null -w '%{http_code}')"
check C13 "a correct bearer token is accepted" 200 "$code"

# Wrong token.
code="$(curl -sS -H "Authorization: Bearer wrong-token" "$AUTH_BASE_URL/blueprints" \
  -o "$QA_WORK/401.out" -w '%{http_code}')"
check C13 "a wrong bearer token returns 401" 401 "$code"
check_contains C13 "the 401 body says unauthorized" "unauthorized" "$(cat "$QA_WORK/401.out")"

# No header at all.
code="$(curl -sS "$AUTH_BASE_URL/blueprints" -o /dev/null -w '%{http_code}')"
check C13 "a missing Authorization header returns 401" 401 "$code"

# A non-Bearer scheme is not a partial credit.
code="$(curl -sS -H "Authorization: Basic $AUTH_TOKEN" "$AUTH_BASE_URL/blueprints" \
  -o /dev/null -w '%{http_code}')"
check C13 "a non-Bearer scheme returns 401" 401 "$code"

# /healthz is the deliberate exception: a liveness probe must not need a
# credential, or a supervisor cannot tell "wedged" from "misconfigured".
code="$(curl -sS "$AUTH_BASE_URL/healthz" -o /dev/null -w '%{http_code}')"
check C13 "/healthz stays reachable without a token" 200 "$code"

# C14 -- auth runs BEFORE routing, so an unknown path with no credential is
# 401, not 404. That ordering is deliberate: it is the cheapest possible
# rejection, and it declines to confirm which routes exist to an unauthenticated
# caller.
code="$(curl -sS "$AUTH_BASE_URL/no-such-route" -o /dev/null -w '%{http_code}')"
check C14 "an unknown route without a token returns 401, not 404" 401 "$code"

# With a valid token, the same path is an honest 404.
code="$(curl -sS -H "Authorization: Bearer $AUTH_TOKEN" "$AUTH_BASE_URL/no-such-route" \
  -o /dev/null -w '%{http_code}')"
check C14 "an unknown route with a valid token returns 404" 404 "$code"

qa_done
