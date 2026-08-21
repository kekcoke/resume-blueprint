// Standalone script spawned as a real, separate OS process by
// cross-process-lock.test.ts. Deliberately plain .mjs (not compiled from TS)
// since it only needs to import the already-built package output — the same
// dist/ the parent test process itself imports.
//
// Usage: node child-mutate.mjs <patch|append> <id> <actor> [expectedRev]
//
// Prints one JSON line to stdout describing the outcome and exits 0 on
// success, 1 on a thrown store error — so the parent test can assert on both
// exit code and content without scraping stack traces.
import * as store from '../../dist/index.js'

const [, , mode, id, actor, expectedRev] = process.argv

try {
  let result
  if (mode === 'patch') {
    result = await store.patch(
      id,
      { basics: { name: actor } },
      { actor, expectedRev: expectedRev || undefined }
    )
  } else if (mode === 'append') {
    result = await store.sectionAppend(id, 'work', { name: actor, position: 'Engineer' }, { actor })
  } else {
    throw new Error(`unknown mode "${mode}"`)
  }
  console.log(JSON.stringify({ ok: true, rev: result.rev }))
  process.exit(0)
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.name ?? String(error) }))
  process.exit(1)
}
