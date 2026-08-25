/**
 * Preflight: everything the harness assumes about the machine, checked once
 * and reported together rather than surfacing as a confusing failure three
 * suites in.
 */
import { execFile } from 'node:child_process'
import { stat, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

/** Resolves to the binary's version line, or null if it is not on PATH. */
export async function probeBinary(name, args = ['--version']) {
  try {
    const { stdout, stderr } = await run(name, args)
    return `${stdout}${stderr}`.trim().split('\n')[0]
  } catch {
    return null
  }
}

function nodeAtLeast(major, minor) {
  const [maj, min] = process.versions.node.split('.').map(Number)
  return maj > major || (maj === major && min >= minor)
}

/** Newest mtime under a directory tree, or 0 if it does not exist. */
async function newestMtime(dir) {
  let newest = 0
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      newest = Math.max(newest, await newestMtime(path))
    } else {
      const s = await stat(path)
      newest = Math.max(newest, s.mtimeMs)
    }
  }
  return newest
}

const PACKAGES = ['core', 'store', 'mcp', 'cli', 'http']

/**
 * Checks each package's `dist/` is present and no older than its `src/`.
 *
 * This is the harness equivalent of MCP's `CORE_BUILD` stamp: every suite
 * drives `dist/`, never `src/`, so a stale build produces failures that
 * describe code no longer on disk. Cheaper to catch here than to debug there.
 */
export async function checkBuildFreshness() {
  const stale = []
  const missing = []
  for (const pkg of PACKAGES) {
    const dist = join(REPO_ROOT, 'packages', pkg, 'dist')
    const src = join(REPO_ROOT, 'packages', pkg, 'src')
    const distTime = await newestMtime(dist)
    if (!distTime) {
      missing.push(pkg)
      continue
    }
    if ((await newestMtime(src)) > distTime) stale.push(pkg)
  }
  return { stale, missing }
}

/**
 * Runs every preflight check. Returns `{ checks, fatal }` — `fatal` is true
 * when something the harness cannot work around is wrong. `pdftotext` is
 * explicitly NOT fatal: it gates only the parse-fidelity assertions, which
 * skip without it, matching how `packages/core/test/ats.test.ts` gates itself.
 */
export async function preflight() {
  const checks = []
  const add = (name, ok, detail, fatal = false) =>
    checks.push({ name, ok, detail, fatal })

  add(
    'node >= 22.6',
    nodeAtLeast(22, 6),
    `found ${process.versions.node}`,
    true
  )

  const tectonic = await probeBinary('tectonic')
  add(
    'tectonic on PATH',
    Boolean(tectonic),
    tectonic ?? 'not found — every render row will fail',
    true
  )

  const pdftotext = await probeBinary('pdftotext', ['-v'])
  add(
    'pdftotext on PATH',
    Boolean(pdftotext),
    pdftotext ?? 'not found — parse-fidelity rows will skip',
    false
  )

  const curl = await probeBinary('curl')
  add(
    'curl on PATH',
    Boolean(curl),
    curl ?? 'not found — the http suite cannot run',
    true
  )

  const { stale, missing } = await checkBuildFreshness()
  add(
    'dist/ built',
    missing.length === 0,
    missing.length
      ? `never built: ${missing.join(', ')} — run npm run build`
      : 'all five packages',
    true
  )
  add(
    'dist/ current',
    stale.length === 0,
    stale.length
      ? `src newer than dist: ${stale.join(', ')} — run npm run build`
      : 'no package has src newer than dist',
    true
  )

  return { checks, fatal: checks.some((c) => !c.ok && c.fatal) }
}

export function printPreflight({ checks }) {
  process.stdout.write('preflight\n')
  for (const c of checks) {
    const mark = c.ok ? 'ok  ' : c.fatal ? 'FAIL' : 'warn'
    process.stdout.write(`  ${mark}  ${c.name.padEnd(18)} ${c.detail}\n`)
  }
}
