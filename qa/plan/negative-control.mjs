#!/usr/bin/env node
/**
 * The negative control, executable.
 *
 *   node qa/plan/negative-control.mjs C15      # one row
 *   node qa/plan/negative-control.mjs --all    # every registered mutation
 *   node qa/plan/negative-control.mjs --list
 *
 * For each mutation: break the behaviour the row claims to check, rebuild, run
 * the scoped suite, and require the row to go RED. Then revert, rebuild, run
 * again, and require it to go GREEN. Both halves matter — a row that goes red
 * and stays red after the revert is testing something other than what it says.
 *
 * "A harness that has never failed has not been shown to work" (B4). This is
 * the part of that sentence that was still a manual habit.
 *
 * Two builds and two suite runs per mutation, so this is minutes, not seconds.
 * It belongs in the merge gate, not in the edit loop.
 */
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const PLAN_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(PLAN_DIR, '..', '..')

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const rows = argv.filter((a) => !a.startsWith('--'))

/** Refuses on a dirty tree: this script edits source in place and reverts it. */
async function assertCleanTree() {
  const { stdout } = await run('git', ['status', '--porcelain'], { cwd: REPO_ROOT })
  const dirty = stdout
    .split('\n')
    .filter(Boolean)
    .filter((line) => !line.startsWith('??'))
  if (dirty.length) {
    throw new Error(
      'the working tree has uncommitted changes:\n' +
        dirty.map((l) => `  ${l}`).join('\n') +
        '\n\nThis script edits source files and reverts them by rewriting the original\n' +
        'bytes. On a dirty tree a crash between the two would be indistinguishable\n' +
        'from your own work. Commit or stash first.'
    )
  }
}

async function shell(command, args) {
  try {
    const { stdout, stderr } = await run(command, args, { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error) }
  }
}

/** Runs the scoped suites and returns the collapsed status of one row. */
async function statusOfRow(row, suites) {
  const out = join(PLAN_DIR, 'negative-control-run.json')
  await shell('node', [join(REPO_ROOT, 'qa', 'run.mjs'), ...suites, `--json=${out}`])
  const report = JSON.parse(await readFile(out, 'utf8'))
  const cells = report.matrix?.[row] ?? {}
  const statuses = Object.values(cells)
  if (!statuses.length) return 'ABSENT'
  if (statuses.includes('FAIL')) return 'FAIL'
  if (statuses.every((s) => s === 'SKIP')) return 'SKIP'
  return 'PASS'
}

async function apply(mutation, direction) {
  const path = join(REPO_ROOT, mutation.file)
  const text = await readFile(path, 'utf8')
  const [from, to] = direction === 'break' ? [mutation.find, mutation.replace] : [mutation.replace, mutation.find]
  if (!text.includes(from)) {
    throw new Error(`${mutation.file} does not contain the ${direction === 'break' ? 'find' : 'replace'} string:\n  ${from}\nThe registry has drifted from the source. Re-grep it.`)
  }
  await writeFile(path, text.replace(from, to))
}

async function proveOne(mutation) {
  const { row, suites } = mutation
  process.stdout.write(`\n${'='.repeat(64)}\n${row} — ${mutation.file}\n${'='.repeat(64)}\n`)
  process.stdout.write(`  ${mutation.note}\n\n`)

  let broken = 'not reached'
  let restored = 'not reached'
  try {
    process.stdout.write('  breaking it, rebuilding, running...\n')
    await apply(mutation, 'break')
    await shell('npm', ['run', 'build'])
    broken = await statusOfRow(row, suites)
    process.stdout.write(`  with the mutation applied: ${row} is ${broken}\n`)
  } finally {
    process.stdout.write('  reverting, rebuilding, running...\n')
    await apply(mutation, 'restore')
    await shell('npm', ['run', 'build'])
    restored = await statusOfRow(row, suites)
    process.stdout.write(`  after revert:              ${row} is ${restored}\n`)
  }

  const ok = broken === 'FAIL' && restored === 'PASS'
  if (ok) {
    process.stdout.write(`\n  PROVEN — ${row} goes red when the behaviour breaks and green when it is restored.\n`)
  } else if (broken !== 'FAIL') {
    process.stdout.write(
      `\n  VACUOUS — ${row} stayed ${broken} with the behaviour deliberately broken.\n` +
        '  This is the valuable failure: the assertion is not testing what the row claims.\n' +
        '  Fix the assertion, not the mutation.\n'
    )
  } else {
    process.stdout.write(
      `\n  DIRTY — ${row} did not return to PASS after the revert (${restored}).\n` +
        '  Either the revert did not fully restore the tree, or the row was already red.\n'
    )
  }
  return ok
}

async function main() {
  const registry = JSON.parse(await readFile(join(PLAN_DIR, 'mutations.json'), 'utf8'))

  if (flags.has('--list')) {
    for (const m of registry.mutations) {
      process.stdout.write(`${m.row.padEnd(5)} ${m.suites.join(',').padEnd(10)} ${m.file}\n`)
    }
    return 0
  }

  const wanted = flags.has('--all')
    ? registry.mutations
    : registry.mutations.filter((m) => rows.includes(m.row))

  if (!wanted.length) {
    process.stderr.write(
      rows.length
        ? `no mutation registered for ${rows.join(', ')}. Registered: ${registry.mutations.map((m) => m.row).join(', ')}\n` +
            'A row with no mutation is a row with no evidence — adding one is the point.\n'
        : 'usage: node qa/plan/negative-control.mjs <row>... | --all | --list\n'
    )
    return 2
  }

  await assertCleanTree()

  const results = []
  for (const mutation of wanted) results.push([mutation.row, await proveOne(mutation)])

  process.stdout.write(`\n${'-'.repeat(64)}\n`)
  for (const [row, ok] of results) process.stdout.write(`  ${ok ? 'PROVEN ' : 'FAILED '} ${row}\n`)
  const failed = results.filter(([, ok]) => !ok).length
  process.stdout.write(`\n${results.length - failed} proven, ${failed} not\n`)
  return failed ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`\nnegative-control failed: ${error?.message ?? error}\n`)
    process.exit(1)
  })
