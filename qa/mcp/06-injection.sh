#!/usr/bin/env bash
# contract: C5, C19
# CLAUDE.md requires every blueprint-accepting surface to be exercised against
# fixtures/injection.json. This is MCP's, and it also pins invariant 1 at the
# store boundary: what goes in raw comes back raw, and only the .tex is escaped.
. "$(dirname "$0")/../lib/assert.sh"
qa_init

rm -f /tmp/pwned

out="$QA_WORK/06.jsonl"
mcp_run "$(dirname "$0")/06-injection.jsonl" "$out"
if [ $? -ne 0 ]; then
  fail C5 "the injection session completes" "$(head -30 "$out.err")"
  qa_done
fi

check_tool_ok C5 "the injection fixture is stored" "$out" 2
check_tool_ok C5 "the injection fixture is readable back" "$out" 3
check_tool_ok C5 "the injection fixture converts to TeX" "$out" 4
check_tool_ok C5 "the injection fixture renders" "$out" 5

# C19 -- stored raw. `\input{...}` must survive the round trip unescaped.
mcp_pick "$out" 3.result.structuredContent.blueprint >"$QA_WORK/06-stored.json"

# Byte for byte: sanitize would render this as "\textbackslash{}input\{...\}",
# so equality is what proves the store holds raw user text.
check C19 "the store keeps basics.name raw (invariant 1)" \
  '\input{/etc/passwd}' \
  "$(json_path "$QA_WORK/06-stored.json" basics.name)"
check C19 "the store keeps LaTeX specials unescaped" \
  '100% \& more #1 ~tilde ^caret _under' \
  "$(json_path "$QA_WORK/06-stored.json" basics.phone)"

# ...and escaped on the way out to the engine, in the same session.
tex="$(mcp_pick "$out" 4.result.structuredContent.texDoc)"
case "$tex" in
  *textbackslash*) pass C5 "the generated .tex escapes the payload" ;;
  *) fail C5 "the generated .tex escapes the payload" "no \\textbackslash in the .tex" ;;
esac
case "$tex" in
  *'\\write18'*) fail C5 "no live \\write18 survives into the .tex" "found a live \\write18" ;;
  *) pass C5 "no live \\write18 survives into the .tex" ;;
esac

path="$(mcp_pick "$out" 5.result.structuredContent.path)"
check_pdf C5 "the injection fixture produces a PDF" "$path"

if [ -e /tmp/pwned ]; then
  fail C5 "shell-escape stays disabled (--untrusted)" "/tmp/pwned exists after the render"
  rm -f /tmp/pwned
else
  pass C5 "shell-escape stays disabled (--untrusted)"
fi

qa_done
