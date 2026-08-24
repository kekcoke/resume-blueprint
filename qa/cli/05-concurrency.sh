#!/usr/bin/env bash
# contract: C15
# Expected load, CLI-shaped: ten independent processes each compiling at once.
#
# The CLI has no concurrency cap and needs none -- each invocation is its own
# process with its own tectonic subprocess, and nothing is shared. All ten
# must produce a PDF. (HTTP is the surface that caps; see qa/http/06.)
. "$(dirname "$0")/../lib/assert.sh"
qa_init

n=10
pids=""
for i in $(seq 1 $n); do
  node "$CLI" render "$FIXTURES/sample.json" -t $(( (i % 10) + 1 )) -o "$QA_WORK/par-$i.pdf" \
    >/dev/null 2>"$QA_WORK/par-$i.err" &
  pids="$pids $!"
done

failed=0
for pid in $pids; do
  wait "$pid" || failed=$((failed + 1))
done

check C15 "all $n parallel cli renders exit 0" 0 "$failed"

ok=0
for i in $(seq 1 $n); do
  is_pdf "$QA_WORK/par-$i.pdf" && ok=$((ok + 1))
done
check C15 "all $n parallel cli renders produced a PDF" "$n" "$ok"

qa_done
