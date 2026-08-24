#!/usr/bin/env node
/**
 * Driver for the QA harness.
 *
 *   node qa/run.mjs                 # every suite
 *   node qa/run.mjs http mcp        # named suites
 *   node qa/run.mjs --preflight     # environment only, run nothing
 *   node qa/run.mjs --emit-collection
 *   node qa/run.mjs --json[=path]   # results as JSON, for an orchestrator
 *   node qa/run.mjs --emit-baseline # record the expected status of every row
 *   node qa/run.mjs --check-baseline# run, then report only the rows that FLIPPED
 *
 * Every suite is a directory of standalone `.sh` sample invocables. This
 * driver adds three things they cannot do for themselves: a preflight, an
 * isolated store per script, and the servers the http suite needs. It parses
 * their `RESULT <contract-id> PASS|FAIL|SKIP <label>` lines into the contract
 * matrix — which is the only coupling in either direction. Any script here
 * runs by hand with no driver at all.
 */
import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { REPO_ROOT, preflight, printPreflight } from './lib/env.mjs'
import { Report } from './lib/report.mjs'
import { makeScratchHome, assertIsolated } from './lib/scratch.mjs'
import { startHttpServer } from './lib/http.mjs'

const SUITES = ['cli', 'markdown', 'http', 'mcp']

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.split('=')[0]))
const requested = argv.filter((a) => !a.startsWith('--'))

/** The value of `--name=value`, or `fallback`. */
function flagValue(name, fallback) {
  const hit = argv.find((a) => a.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : fallback
}

const PLAN_DIR = join(REPO_ROOT, 'qa', 'plan')
const BASELINE = join(PLAN_DIR, 'baseline.json')

for (const name of requested) {
  if (!SUITES.includes(name)) {
    process.stderr.write(`unknown suite "${name}" — expected one of: ${SUITES.join(', ')}\n`)
    process.exit(2)
  }
}
const suites = requested.length ? requested : SUITES

/** Contract ids a script claims in its `# contract:` header. */
async function declaredRows(path) {
  const text = await readFile(path, 'utf8')
  const match = text.match(/^#\s*contract:\s*(.+)$/m)
  return match ? match[1].split(/[,\s]+/).filter(Boolean) : []
}

async function scriptsIn(suite) {
  const dir = join(REPO_ROOT, 'qa', suite)
  const entries = await readdir(dir)
  return entries
    .filter((name) => name.endsWith('.sh'))
    .sort()
    .map((name) => join(dir, name))
}

/**
 * Runs one script and folds its RESULT lines into the report.
 *
 * A script that exits non-zero without emitting a RESULT line (a crash, a
 * missing binary, a syntax error) is recorded as a failure on every row it
 * declared — silence must never read as success.
 */
function runScript(path, env, report, suite, rows) {
  return new Promise((resolve) => {
    const child = spawn('bash', [path], { env, cwd: REPO_ROOT })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => (stdout += c))
    child.stderr.on('data', (c) => (stderr += c))

    child.on('close', (code) => {
      const lines = stdout.split('\n')
      let emitted = 0

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^RESULT\s+(\S+)\s+(PASS|FAIL|SKIP)\s+(.*)$/)
        if (!match) continue
        emitted++
        const [, id, status, label] = match
        if (status === 'PASS') report.pass(suite, id, label)
        else if (status === 'SKIP') report.skip(suite, id, label)
        else report.fail(suite, id, label, detailAfter(lines, i))
      }

      if (!emitted) {
        const why =
          code === 0
            ? 'the script emitted no RESULT lines'
            : `the script exited ${code} without emitting any RESULT line`
        const rowsToBlame = rows.length ? rows : ['C?']
        for (const id of rowsToBlame) {
          report.fail(suite, id, `${path.replace(`${REPO_ROOT}/`, '')} did not run`, `${why}\n${stderr.trim()}`)
        }
      }
      resolve()
    })
  })
}

/** The indented `       | ` lines a `fail` writes immediately after its RESULT line. */
function detailAfter(lines, index) {
  const detail = []
  for (let i = index + 1; i < lines.length; i++) {
    if (!lines[i].startsWith('       | ')) break
    detail.push(lines[i].slice(9))
  }
  return detail.join('\n')
}

async function runPlainSuite(suite, report, extraEnv = {}) {
  process.stdout.write(`\n${suite}\n`)
  for (const script of await scriptsIn(suite)) {
    // A fresh store per script. Scripts assert on store contents (mcp/05
    // checks that resume_import stored nothing), so leftovers from an earlier
    // script would make those rows lie.
    const scratch = await makeScratchHome()
    try {
      const env = { ...process.env, RESUME_BLUEPRINT_HOME: scratch.home, REPO_ROOT, ...extraEnv }
      assertIsolated(env)
      await runScript(script, env, report, suite, await declaredRows(script))
    } finally {
      await scratch.cleanup()
    }
  }
}

/**
 * The http suite shares one store and one set of servers across its scripts,
 * because the servers own the store — a per-script home would mean restarting
 * three processes per script for no benefit.
 *
 * Three servers, because three of the contract rows are about server
 * configuration rather than request content: auth off (the default), auth on
 * (C13/C14), and an engine-less PATH (C22).
 */
async function runHttpSuite(report) {
  process.stdout.write('\nhttp\n')
  const scratch = await makeScratchHome()
  const token = `qa-token-${Math.random().toString(36).slice(2)}`
  const servers = []

  try {
    assertIsolated({ RESUME_BLUEPRINT_HOME: scratch.home })

    const open = await startHttpServer({ home: scratch.home })
    servers.push(open)

    const authed = await startHttpServer({
      home: join(scratch.home, 'auth'),
      env: { RESUME_BLUEPRINT_TOKEN: token }
    })
    servers.push(authed)

    // PATH stripped to a directory that does not exist, so spawning tectonic
    // fails with ENOENT and core raises the TectonicError this row is about.
    const notex = await startHttpServer({
      home: join(scratch.home, 'notex'),
      env: { PATH: join(scratch.home, 'no-such-bin') }
    })
    servers.push(notex)

    const env = {
      ...process.env,
      RESUME_BLUEPRINT_HOME: scratch.home,
      REPO_ROOT,
      BASE_URL: open.baseUrl,
      TOKEN: '',
      AUTH_BASE_URL: authed.baseUrl,
      AUTH_TOKEN: token,
      NOTEX_BASE_URL: notex.baseUrl
    }

    for (const script of await scriptsIn('http')) {
      await runScript(script, env, report, 'http', await declaredRows(script))
    }

    // Invariant check, free of charge: the server logs to stderr and leaves
    // stdout to whatever a caller pipes it into.
    if (open.stdout.trim()) {
      report.fail('http', 'C1', 'the server writes nothing to stdout', open.stdout.slice(0, 400))
    } else {
      report.pass('http', 'C1', 'the server writes nothing to stdout')
    }
  } finally {
    await Promise.all(servers.map((s) => s.stop()))
    await scratch.cleanup()
  }
}

// --- Postman/Insomnia collection -------------------------------------------
//
// Generated from the http scripts rather than hand-maintained, so the two
// cannot drift: the scripts stay the source of truth and the collection is a
// build artifact that happens to be committed for convenience.
//
// The extractor understands the shapes these scripts actually use — `qa_curl`
// or `curl -sS`, an optional `-X METHOD`, a $BASE_URL/$AUTH_BASE_URL/
// $NOTEX_BASE_URL path, `-H` headers, and `-d`/`--data-binary` bodies with
// line continuations joined. It is not a general curl parser; a script that
// needs something more exotic should say so in a comment and be added here.

async function emitCollection() {
  const items = []
  const skipped = []

  for (const script of await scriptsIn('http')) {
    const name = script.split('/').pop()
    const text = await readFile(script, 'utf8')
    // Join backslash continuations so one logical curl is one line.
    const joined = text.replace(/\\\n\s*/g, ' ')

    for (const line of joined.split('\n')) {
      if (!/\b(qa_curl|curl -sS)\b/.test(line)) continue
      if (line.trim().startsWith('#')) continue

      const url = line.match(/\$\{?(BASE_URL|AUTH_BASE_URL|NOTEX_BASE_URL)\}?(\/[^"'\s]*)/)
      if (!url) continue

      const method = (line.match(/-X\s+([A-Z]+)/) ?? [, 'GET'])[1]

      let body
      const single = line.match(/-d\s+'([^']*)'/)
      const double = line.match(/-d\s+"((?:[^"\\]|\\.)*)"/)
      const fromFixture = line.match(/--data-binary\s+"@\$\{?FIXTURES\}?\/([^"]+)"/)
      const fromScratch = line.match(/--data-binary\s+"@\$\{?(\w+)\}?"/)

      if (single) {
        body = single[1]
      } else if (double) {
        // The scripts write these with \" escapes so the shell interpolates $id.
        body = double[1].replace(/\\"/g, '"')
      } else if (fromFixture) {
        // Inlined so the collection is self-contained — an import into Postman
        // has no $FIXTURES to resolve.
        body = (await readFile(join(REPO_ROOT, 'fixtures', fromFixture[1]), 'utf8')).trim()
      } else if (fromScratch) {
        // A body generated at run time (the 6 MiB oversize probe, the 40-deep
        // patch). There is nothing to inline and a request with the body
        // silently dropped would be worse than no request at all.
        skipped.push(`${name}: ${method} ${url[2]} (body built at run time from $${fromScratch[1]})`)
        continue
      }

      const headers = [...line.matchAll(/-H\s+'([^']+)'|-H\s+"([^"]+)"/g)]
        .map((m) => m[1] ?? m[2])
        .map((h) => {
          const [key, ...rest] = h.split(':')
          return { key: key.trim(), value: rest.join(':').trim() }
        })
        // Authorization is handled by the collection-level auth block below,
        // so a hand-written header here would just shadow the {{token}} var.
        .filter((h) => h.key.toLowerCase() !== 'authorization')

      // Shell variables become Postman variables rather than leaking through
      // as a literal "$id" that 404s the moment someone hits Send.
      const toPostmanVar = (value) =>
        value.replace(/\$\{?id\}?/g, '{{blueprintId}}').replace(/\$\{?rev\}?/g, '{{rev}}')
      const path = toPostmanVar(url[2]).replace(/^\//, '')
      if (body) body = toPostmanVar(body).replace(/\$\$/g, '1')

      items.push({
        name: `${method} /${path}  (${name})`,
        request: {
          method,
          header: headers,
          ...(body ? { body: { mode: 'raw', raw: body, options: { raw: { language: 'json' } } } } : {}),
          url: {
            raw: `{{baseUrl}}/${path}`,
            host: ['{{baseUrl}}'],
            path: path.split('/').filter(Boolean)
          },
          description: `Generated from qa/http/${name}. Edit the script, not this file.`
        }
      })
    }
  }

  // De-duplicate: several scripts hit the same route with different bodies,
  // and a collection with six identical "POST /render" rows is unusable.
  const seen = new Set()
  const unique = items.filter((item) => {
    const key = `${item.request.method} ${item.request.url.raw} ${item.request.body?.raw?.slice(0, 80) ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const collection = {
    info: {
      name: 'resume-blueprint HTTP',
      description:
        'Generated by `node qa/run.mjs --emit-collection` from qa/http/*.sh. Do not hand-edit — ' +
        'regenerate instead. Set {{baseUrl}} to your server (default http://127.0.0.1:8787); set ' +
        '{{token}} only if RESUME_BLUEPRINT_TOKEN is set on the server, since auth is off by ' +
        'default. {{blueprintId}} is the stored blueprint the stateful requests act on — create ' +
        'it with POST /blueprints first, and put the rev it returns in {{rev}}.' +
        (skipped.length
          ? ` Not represented here, because their bodies are generated at run time: ${skipped.join('; ')}.`
          : ''),
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
    variable: [
      { key: 'baseUrl', value: 'http://127.0.0.1:8787' },
      { key: 'token', value: '' },
      { key: 'blueprintId', value: 'qa-lifecycle' },
      { key: 'rev', value: '' }
    ],
    item: unique
  }

  const out = join(REPO_ROOT, 'qa', 'http', 'collection.json')
  await writeFile(out, `${JSON.stringify(collection, null, 2)}\n`)
  process.stdout.write(`wrote ${out} (${unique.length} requests`)
  process.stdout.write(skipped.length ? `, ${skipped.length} skipped as run-time-generated)\n` : ')\n')
}

// --- machine-readable output ------------------------------------------------
//
// The human matrix is what a person reads; this is what an orchestrator reads.
// Both come from `Report.matrix()`, so they cannot disagree.
//
// Note the destination: a FILE, never stdout. `qa/run.mjs` is piped near MCP
// often enough that writing structured output to stdout would be one careless
// redirect away from tripwire 5 (stdout IS the JSON-RPC transport). The path is
// printed; the payload is not.

async function writeJson(report) {
  const path = flagValue('--json', join(PLAN_DIR, 'last-run.json'))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(report.toJSON(), null, 2)}\n`)
  process.stdout.write(`\nwrote ${path.replace(`${REPO_ROOT}/`, '')}\n`)
}

async function emitBaseline(report) {
  await mkdir(PLAN_DIR, { recursive: true })
  const baseline = {
    generated: new Date().toISOString(),
    note:
      'Expected status per contract row per suite. Committed, so a change to it is reviewable. ' +
      'Regenerate deliberately — a baseline refreshed to make --check-baseline quiet is the ' +
      'same failure as editing qa/contract.md to go green.',
    suites: report.suites,
    matrix: report.matrix()
  }
  await writeFile(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`)
  process.stdout.write(`\nwrote ${BASELINE.replace(`${REPO_ROOT}/`, '')} (${Object.keys(baseline.matrix).length} rows)\n`)
}

/**
 * Reports only what MOVED since the baseline.
 *
 * This is the check the node prompt leans on: make the code change, run this,
 * and see which row went red BEFORE touching qa/contract.md. A full green
 * matrix cannot tell you that; a flip list can.
 *
 * Rows the run did not cover are not reported as missing — a scoped run
 * (`node qa/run.mjs cli --check-baseline`) is the normal case while a node is
 * in flight.
 */
async function checkBaseline(report) {
  let baseline
  try {
    baseline = JSON.parse(await readFile(BASELINE, 'utf8'))
  } catch {
    process.stdout.write(`\nno baseline at ${BASELINE.replace(`${REPO_ROOT}/`, '')} — run --emit-baseline on a known-good tree first.\n`)
    return 1
  }

  const current = report.matrix()
  const flips = []
  for (const [id, cells] of Object.entries(current)) {
    for (const [suite, status] of Object.entries(cells)) {
      const was = baseline.matrix?.[id]?.[suite]
      if (was === undefined) flips.push({ id, suite, from: 'NEW', to: status })
      else if (was !== status) flips.push({ id, suite, from: was, to: status })
    }
  }

  process.stdout.write(`\n${'-'.repeat(60)}\nbaseline diff\n\n`)
  if (!flips.length) {
    process.stdout.write('no flips — every row covered by this run matches the baseline.\n')
    return 0
  }
  for (const f of flips) {
    process.stdout.write(`  ${f.id.padEnd(5)} ${f.suite.padEnd(9)} ${f.from} -> ${f.to}\n`)
  }
  process.stdout.write('\nEach flip is either a real regression, a deliberate change whose contract\n')
  process.stdout.write('row has not caught up, or a pinned assertion doing its job. Say which.\n')
  return 1
}

/**
 * Appends every row observed FAIL to qa/plan/evidence.json.
 *
 * Part C Track 4's actual question: which of the 210 assertions have NEVER been
 * seen red? Those are the ones with no evidence behind them. Nothing recorded
 * this before, so the answer was "all of them, as far as anyone could prove".
 */
async function recordEvidence(report) {
  const path = join(PLAN_DIR, 'evidence.json')
  let evidence = { note: 'Rows observed FAIL at least once, and when. A row absent from here has never been seen red — it is not yet known to test anything.', seenRed: {} }
  try {
    evidence = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    // First run; the default above is the file.
  }
  let added = false
  for (const [id, cells] of Object.entries(report.matrix())) {
    for (const [suite, status] of Object.entries(cells)) {
      if (status !== 'FAIL') continue
      const key = `${id}:${suite}`
      if (evidence.seenRed[key]) continue
      evidence.seenRed[key] = new Date().toISOString()
      added = true
    }
  }
  if (added) {
    await mkdir(PLAN_DIR, { recursive: true })
    await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`)
  }
}

// --- main -------------------------------------------------------------------

async function main() {
  const env = await preflight()
  printPreflight(env)

  if (env.fatal) {
    process.stdout.write('\npreflight failed — fix the items marked FAIL above and re-run.\n')
    return 1
  }

  if (flags.has('--preflight')) return 0

  if (flags.has('--emit-collection')) {
    await emitCollection()
    return 0
  }

  const report = new Report()
  for (const suite of suites) {
    if (suite === 'http') await runHttpSuite(report)
    else await runPlainSuite(suite, report)
  }
  const code = report.summary()

  await recordEvidence(report)
  if (flags.has('--json')) await writeJson(report)
  if (flags.has('--emit-baseline')) await emitBaseline(report)
  if (flags.has('--check-baseline')) return (await checkBaseline(report)) || code

  return code
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`\nqa/run.mjs failed: ${error?.stack ?? error}\n`)
    process.exit(1)
  })
