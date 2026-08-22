#!/usr/bin/env bash
# Shared harness for every qa/**/*.sh sample invocable.
#
# Two jobs. First, isolation: `packages/store/src/paths.ts:resolveHome()` falls
# back to ~/.resume-blueprint, so a script run by hand with the env var unset
# would commit fixtures into the user's real store. `qa_init` refuses to let
# that happen and mints a throwaway home instead.
#
# Second, reporting: scripts emit `RESULT <contract-id> PASS|FAIL|SKIP <label>`
# lines. A human reads them directly; qa/run.mjs parses them into the contract
# matrix. That is the only coupling between the two — a script needs nothing
# from the driver to be useful on its own.

set -uo pipefail

QA_FAILURES=0
QA_OWNS_HOME=0
QA_OWNS_WORK=0

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
export REPO_ROOT

CLI="${CLI:-$REPO_ROOT/packages/cli/dist/index.js}"
FIXTURES="${FIXTURES:-$REPO_ROOT/fixtures}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
TOKEN="${TOKEN:-}"

# Somewhere to drop PDFs and scratch JSON. Distinct from the store home.
QA_WORK="${QA_WORK:-}"

qa_init() {
  local real_home="$HOME/.resume-blueprint"

  if [ -z "${RESUME_BLUEPRINT_HOME:-}" ]; then
    RESUME_BLUEPRINT_HOME="$(mktemp -d "${TMPDIR:-/tmp}/resume-blueprint-qa-XXXXXX")"
    export RESUME_BLUEPRINT_HOME
    QA_OWNS_HOME=1
  fi

  if [ "$RESUME_BLUEPRINT_HOME" = "$real_home" ]; then
    echo "refusing to run: RESUME_BLUEPRINT_HOME points at your real store ($real_home)" >&2
    exit 2
  fi

  if [ -z "$QA_WORK" ]; then
    QA_WORK="$(mktemp -d "${TMPDIR:-/tmp}/resume-blueprint-qa-work-XXXXXX")"
    export QA_WORK
    QA_OWNS_WORK=1
  fi

  trap qa_cleanup EXIT
}

# Removes only what this script created. A home or work dir handed in by the
# caller (qa/run.mjs, or a human debugging one row) belongs to them.
#
# QA_WORK holds the PDFs, .tex and captured output a script produced, so
# QA_KEEP_SCRATCH=1 is the flag to reach for when a row fails and you want to
# look at what it actually wrote.
qa_cleanup() {
  if [ -n "${QA_KEEP_SCRATCH:-}" ]; then
    [ "$QA_OWNS_WORK" = "1" ] && echo "[qa] QA_KEEP_SCRATCH set -- leaving $QA_WORK" >&2
    return
  fi
  if [ "$QA_OWNS_HOME" = "1" ] && [ -n "${RESUME_BLUEPRINT_HOME:-}" ]; then
    rm -rf "$RESUME_BLUEPRINT_HOME"
  fi
  if [ "$QA_OWNS_WORK" = "1" ] && [ -n "${QA_WORK:-}" ]; then
    rm -rf "$QA_WORK"
  fi
}

pass() { printf 'RESULT %s PASS %s\n' "$1" "$2"; }

fail() {
  QA_FAILURES=$((QA_FAILURES + 1))
  printf 'RESULT %s FAIL %s\n' "$1" "$2"
  if [ $# -ge 3 ] && [ -n "$3" ]; then
    printf '%s\n' "$3" | sed 's/^/       | /'
  fi
}

skip() { printf 'RESULT %s SKIP %s -- %s\n' "$1" "$2" "${3:-no reason given}"; }

# check <id> <label> <expected> <actual>
check() {
  if [ "$3" = "$4" ]; then
    pass "$1" "$2"
  else
    fail "$1" "$2" "expected: $3
actual:   $4"
  fi
}

# check_contains <id> <label> <needle> <haystack>
check_contains() {
  case "$4" in
    *"$3"*) pass "$1" "$2" ;;
    *) fail "$1" "$2" "expected to contain: $3
actual:               $(printf '%s' "$4" | head -c 400)" ;;
  esac
}

# Is this file a PDF? Checks the magic bytes, not the extension.
is_pdf() { [ -f "$1" ] && [ "$(head -c 4 "$1")" = "%PDF" ]; }

# check_pdf <id> <label> <path>
check_pdf() {
  if is_pdf "$3"; then
    pass "$1" "$2 ($(wc -c <"$3" | tr -d ' ') bytes)"
  else
    fail "$1" "$2" "not a PDF: $3 (first bytes: $(head -c 40 "$3" 2>/dev/null | tr -d '\0'))"
  fi
}

# curl with auth applied when TOKEN is set. Every http script goes through this
# so the auth rows and the rest cannot drift apart.
qa_curl() {
  if [ -n "$TOKEN" ]; then
    curl -sS -H "Authorization: Bearer $TOKEN" "$@"
  else
    curl -sS "$@"
  fi
}

# Reads a top-level field from a JSON document on stdin. node, not jq: jq is
# not a declared dependency of this repo and node is guaranteed by engines.
json_field() { node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try { const v = JSON.parse(raw)[process.argv[1]]; process.stdout.write(v === undefined ? "" : String(v)); }
  catch { process.stdout.write(""); }
});
' "$1"; }

qa_done() {
  if [ "$QA_FAILURES" -gt 0 ]; then
    exit 1
  fi
  exit 0
}

# --- MCP helpers ------------------------------------------------------------
#
# A session is a .jsonl file of literal JSON-RPC messages; mcp-pipe writes the
# response envelopes, one per line, to $2. Responses are addressed by message
# id, never by line number -- the server answers concurrently, so a later
# request can answer first.

# mcp_run <session.jsonl> <responses.jsonl>
mcp_run() {
  node "$REPO_ROOT/qa/lib/mcp-pipe.mjs" "$1" >"$2" 2>"$2.err"
}

# mcp_pick <responses.jsonl> <id.dotted.path>
mcp_pick() { node "$REPO_ROOT/qa/lib/pick.mjs" "$1" "$2"; }

# check_tool_ok <contract-id> <label> <responses.jsonl> <message-id>
# A tool that succeeded has no isError flag. A tool that FAILED still returns a
# normal result with isError:true -- never a JSON-RPC error -- which is the
# distinction packages/mcp/src/errors.ts exists to preserve.
check_tool_ok() {
  local is_err rpc_err
  rpc_err="$(mcp_pick "$3" "$4.error")"
  is_err="$(mcp_pick "$3" "$4.result.isError")"
  if [ -n "$rpc_err" ]; then
    fail "$1" "$2" "got a JSON-RPC protocol error, not a tool result: $rpc_err"
  elif [ "$is_err" = "true" ]; then
    fail "$1" "$2" "$(mcp_pick "$3" "$4.result.content")"
  else
    pass "$1" "$2"
  fi
}

# check_tool_error <contract-id> <label> <responses.jsonl> <message-id> <expected substring>
check_tool_error() {
  local is_err text
  is_err="$(mcp_pick "$3" "$4.result.isError")"
  text="$(mcp_pick "$3" "$4.result.content")"
  if [ "$is_err" != "true" ]; then
    fail "$1" "$2" "expected isError:true, got isError=${is_err:-absent}; content: $(printf '%s' "$text" | head -c 300)"
    return
  fi
  case "$text" in
    *"$5"*) pass "$1" "$2" ;;
    *) fail "$1" "$2" "expected the error to mention: $5
actual: $(printf '%s' "$text" | head -c 300)" ;;
  esac
}

# json_path <file> <dotted.path>
#
# Exact value at a dotted path, for byte-for-byte comparisons. Substring
# checks are the wrong tool for invariant 1: fixtures/profile-injection.md
# contains the literal text "\textbackslash{}", so grepping for it proves
# nothing about whether sanitize ran. Only equality distinguishes raw from
# escaped.
json_path() { node -e '
const fs = require("node:fs");
let value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const key of process.argv[2].split(".")) {
  if (value === undefined || value === null) break;
  value = value[/^\d+$/.test(key) ? Number(key) : key];
}
if (value === undefined || value === null) process.stdout.write("");
else if (typeof value === "object") process.stdout.write(JSON.stringify(value));
else process.stdout.write(String(value));
' "$1" "$2"; }
