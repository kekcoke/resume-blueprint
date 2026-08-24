#!/usr/bin/env node
/**
 * Resolver for the G1–G15 phase graph.
 *
 *   node qa/plan/next.mjs --ready              # what can be started right now
 *   node qa/plan/next.mjs --ready --json
 *   node qa/plan/next.mjs --all                # every node, with why it is withheld
 *   node qa/plan/next.mjs --claim G7           # take the node and its mutexes
 *   node qa/plan/next.mjs --release G7 [--done|--abandoned]
 *   node qa/plan/next.mjs --brief G7           # render docs/prompts/node.md for it
 *   node qa/plan/next.mjs --model G7           # just the --model alias, for a launcher
 *   node qa/plan/next.mjs --escalate G7 "why" # A7's escalate-in-place, recorded
 *   node qa/plan/next.mjs --conflicts          # the register, DERIVED from the graph
 *   node qa/plan/next.mjs --graph              # mermaid
 *   node qa/plan/next.mjs --check              # graph integrity
 *   node qa/plan/next.mjs --where              # which claims dir is in effect
 *
 * `docs/orchestration.md` Part B is the explanation of this graph; `graph.json`
 * is the source of truth. Part A3 is why a mutex is a FIELD here and not an
 * edge: modelling exclusion as an edge invents false ordering and loses the
 * parallelism the lanes exist for.
 *
 * Node builtins only — `qa/` declares no dependencies and this keeps it that way.
 */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLAN_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(PLAN_DIR, '..', '..')

/**
 * Claims live in the git COMMON dir, not in the working tree.
 *
 * This is load-bearing for the lanes. `git worktree` gives each lane its own
 * checkout, so a claim written under `qa/plan/` would be invisible to every
 * other lane — and the mutex that exists to stop two lanes editing one file
 * would silently stop working exactly when three lanes are open, which is the
 * only time it matters.
 *
 * Every worktree of a clone shares one common dir (`git rev-parse
 * --git-common-dir` resolves to the same path from all of them), so a claim
 * written here is visible to all of them immediately, with no commit.
 *
 * That also says what a claim IS: ephemeral coordination state, like a lock
 * file. It is not a reviewable artifact and does not belong in a commit.
 * Durable state is the node's PR and, once merged, its `done` claim.
 */
function resolveClaimsDir() {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    const root = isAbsolute(common) ? common : join(REPO_ROOT, common)
    return join(root, 'qa-plan-claims')
  } catch {
    // Not a git checkout, or no git on PATH. Degrade to the working tree
    // rather than refusing to run; a single-checkout user loses nothing.
    return join(PLAN_DIR, 'claims')
  }
}

const CLAIMS_DIR = resolveClaimsDir()

/** Statuses that mean the node is finished and no longer holds anything. */
const TERMINAL = new Set(['done', 'abandoned'])
/** Statuses that mean the node is in flight and DOES hold its mutexes. */
const ACTIVE = new Set(['claimed', 'wip', 'blocked'])

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const positional = argv.filter((a) => !a.startsWith('--'))

async function loadGraph() {
  return JSON.parse(await readFile(join(PLAN_DIR, 'graph.json'), 'utf8'))
}

/**
 * One file per node, never one shared state file.
 *
 * A single state.json would be exactly the shared mutable artifact A4 warns
 * about: an interface between lanes rather than the product of one, with the
 * last writer silently winning. Three worktrees writing three different paths
 * cannot collide.
 */
async function loadClaims() {
  const claims = {}
  let entries = []
  try {
    entries = await readdir(CLAIMS_DIR)
  } catch {
    return claims
  }
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const claim = JSON.parse(await readFile(join(CLAIMS_DIR, name), 'utf8'))
    claims[claim.id] = claim
  }
  return claims
}

const statusOf = (id, claims) => claims[id]?.status ?? 'todo'

/**
 * Every reason this node cannot be started, in the order they are worth
 * hearing. An empty array means ready.
 */
function withheldReasons(node, graph, claims) {
  const reasons = []
  const status = statusOf(node.id, claims)

  if (TERMINAL.has(status)) return [`already ${status}`]
  if (ACTIVE.has(status)) return [`already ${status}${claims[node.id]?.worktree ? ` in ${claims[node.id].worktree}` : ''}`]

  // 1. Phase gating. B1's phases are serial with respect to each other; the
  //    within-phase ordering is carried by blockedBy.
  const earlierOpen = graph.nodes
    .filter((n) => n.phase < node.phase)
    .filter((n) => !TERMINAL.has(statusOf(n.id, claims)))
  if (earlierOpen.length) {
    // Name only the LOWEST open phase. Listing every open node across every
    // earlier phase under one phase number reads as a bug in the graph.
    const lowest = Math.min(...earlierOpen.map((n) => n.phase))
    const blocking = earlierOpen.filter((n) => n.phase === lowest).map((n) => n.id)
    reasons.push(`phase ${node.phase} is not open — phase ${lowest} still has ${blocking.join(', ')}`)
  }

  // 2. Blocking edges.
  const blockers = (node.blockedBy ?? []).filter((id) => !TERMINAL.has(statusOf(id, claims)))
  if (blockers.length) reasons.push(`blocked by ${blockers.join(', ')}`)

  // 3. Mutexes. NOT edges — this is the check that keeps Lane B serial and
  //    stops G2 and G11 reaching across lanes into the same file.
  for (const holder of graph.nodes) {
    if (holder.id === node.id) continue
    if (!ACTIVE.has(statusOf(holder.id, claims))) continue
    for (const token of overlap(node.mutex ?? [], holder.mutex ?? [])) {
      reasons.push(`mutex "${token}" held by ${holder.id}`)
    }
  }

  // 4. Gates are files. This is the entire human-in-the-loop mechanism: a
  //    judgment node cannot be claimed until someone has written the decision
  //    down. A5 — gates go where a wrong answer is expensive AND cannot be
  //    detected automatically.
  if (node.check === 'gate') {
    const record = node.acceptance?.decision
    if (!record) reasons.push('marked as a gate but names no decision record')
    else if (!existsSync(join(REPO_ROOT, record))) reasons.push(`gate: ${record} does not exist yet`)
  }

  return reasons
}

/** Shared mutex tokens between two nodes. `**` (G9's repo-wide run) hits everything. */
function overlap(a, b) {
  if (a.includes('**') && b.length) return b
  if (b.includes('**') && a.length) return a
  return a.filter((token) => b.includes(token))
}

function resolve(graph, claims) {
  return graph.nodes.map((node) => ({
    node,
    status: statusOf(node.id, claims),
    reasons: withheldReasons(node, graph, claims)
  }))
}

// --- commands ---------------------------------------------------------------

async function cmdReady(graph, claims) {
  const ready = resolve(graph, claims).filter((r) => !r.reasons.length)

  if (flags.has('--json')) {
    process.stdout.write(`${JSON.stringify(ready.map((r) => r.node), null, 2)}\n`)
    return 0
  }

  if (!ready.length) {
    process.stdout.write('nothing is ready.\n\n')
    return cmdAll(graph, claims)
  }

  process.stdout.write(`${ready.length} ready\n\n`)
  for (const { node } of ready) {
    process.stdout.write(`  ${node.id.padEnd(6)} ${node.model.padEnd(7)} ${node.kind.padEnd(12)} lane ${node.lane}  ${node.title}\n`)
    process.stdout.write(`         paths: ${(node.paths ?? []).join(', ') || '—'}\n`)
    if (node.rows?.length) process.stdout.write(`         rows:  ${node.rows.join(', ')}\n`)
    if (node.mutex?.length) process.stdout.write(`         mutex: ${node.mutex.join(', ')}\n`)
    process.stdout.write('\n')
  }
  process.stdout.write(`claim one:  node qa/plan/next.mjs --claim ${ready[0].node.id}\n`)
  return 0
}

async function cmdAll(graph, claims) {
  const rows = resolve(graph, claims)
  process.stdout.write('node   phase lane status     why not\n')
  for (const { node, status, reasons } of rows) {
    const why = reasons.length ? reasons.join('; ') : 'READY'
    process.stdout.write(`${node.id.padEnd(6)} ${String(node.phase).padEnd(5)} ${node.lane.padEnd(4)} ${status.padEnd(10)} ${why}\n`)
  }
  return 0
}

async function cmdClaim(graph, claims, id) {
  const node = graph.nodes.find((n) => n.id === id)
  if (!node) return fail(`unknown node "${id}"`)

  const reasons = withheldReasons(node, graph, claims)
  if (reasons.length && !flags.has('--force')) {
    process.stderr.write(`${id} is not ready:\n`)
    for (const reason of reasons) process.stderr.write(`  - ${reason}\n`)
    process.stderr.write('\nRefusing to claim. --force overrides, and is how K1 gets violated.\n')
    return 1
  }

  await mkdir(CLAIMS_DIR, { recursive: true })
  const claim = {
    id,
    status: 'claimed',
    claimedAt: new Date().toISOString(),
    branch: process.env.QA_PLAN_BRANCH ?? '',
    worktree: process.env.QA_PLAN_WORKTREE ?? '',
    mutexHeld: node.mutex ?? [],
    notes: ''
  }
  await writeFile(join(CLAIMS_DIR, `${id}.json`), `${JSON.stringify(claim, null, 2)}\n`)
  process.stdout.write(`claimed ${id}${claim.mutexHeld.length ? ` — holding ${claim.mutexHeld.join(', ')}` : ''}\n`)
  return 0
}

async function cmdRelease(graph, claims, id) {
  if (!graph.nodes.some((n) => n.id === id)) return fail(`unknown node "${id}"`)
  const path = join(CLAIMS_DIR, `${id}.json`)
  if (!existsSync(path)) return fail(`${id} is not claimed`)

  const status = flags.has('--abandoned') ? 'abandoned' : flags.has('--done') ? 'done' : 'todo'
  if (status === 'todo') {
    await unlink(path)
    process.stdout.write(`released ${id} back to todo; its mutexes are free\n`)
    return 0
  }
  const claim = JSON.parse(await readFile(path, 'utf8'))
  claim.status = status
  claim.mutexHeld = []
  claim.closedAt = new Date().toISOString()
  await writeFile(path, `${JSON.stringify(claim, null, 2)}\n`)
  process.stdout.write(`${id} marked ${status}\n`)
  return 0
}

/**
 * Renders docs/prompts/node.md for one node.
 *
 * B5's prompts are written so a cold session needs nothing from the
 * conversation that produced it. Filling them from the graph rather than by
 * hand is what makes that actually true, run after run.
 */
async function cmdBrief(graph, id) {
  const node = graph.nodes.find((n) => n.id === id)
  if (!node) return fail(`unknown node "${id}"`)

  const template = node.check === 'gate' ? 'gate.md' : 'node.md'
  const text = await readFile(join(REPO_ROOT, 'docs', 'prompts', template), 'utf8')

  const before = Object.entries(node.acceptance?.before ?? {})
  const rowLine = before.length
    ? before.map(([row, want]) => `${row} should go ${want}`).join('; ')
    : 'no row is pinned for this node — say so rather than inventing one'

  const filled = text
    .replaceAll('{{node}}', node.id)
    .replaceAll('{{finding}}', node.finding)
    .replaceAll('{{title}}', node.title)
    .replaceAll('{{model}}', node.model)
    .replaceAll('{{kind}}', node.kind)
    .replaceAll('{{paths}}', (node.paths ?? []).join(', ') || '(none declared)')
    .replaceAll('{{mutex}}', (node.mutex ?? []).join(', ') || '(none)')
    .replaceAll('{{rows}}', (node.rows ?? []).join(', ') || '(none)')
    .replaceAll('{{acceptance}}', node.acceptance?.statement ?? '(none stated)')
    .replaceAll('{{pinned}}', rowLine)
    .replaceAll('{{commands}}', (node.acceptance?.commands ?? []).join(' && ') || 'npm test')
    .replaceAll('{{decision}}', node.acceptance?.decision ?? '(none)')
    .replaceAll('{{why}}', node.why ?? '')

  process.stdout.write(filled)
  return 0
}

/**
 * The conflict register, computed from the graph rather than curated.
 *
 * B3 says a register written from memory is worse than none, because it is
 * trusted. Deriving it is the same argument qa/http/collection.json makes for
 * being generated: the two cannot drift.
 */
/**
 * Just the model alias, so a launcher can route without parsing anything:
 *
 *   claude --model "$(node qa/plan/next.mjs --model G4)" -p "$(... --brief G4)"
 *
 * A7 names a model on every node for a reason; this is what stops that routing
 * being re-derived by hand, or forgotten, at 2am.
 */
async function cmdModel(graph, id) {
  const node = graph.nodes.find((n) => n.id === id)
  if (!node) return fail(`unknown node "${id}"`)
  process.stdout.write(`${node.model}\n`)
  return 0
}

/**
 * A7 says: escalate in place, do not restart — the accumulated context is the
 * expensive part. A session cannot change its own model (`/model` is typed by a
 * human), so the honest mechanism is to make the signal loud and the human's
 * next keystroke obvious.
 *
 * Records the escalation on the claim so a later session knows this node has
 * already been tried at the lower model, and why. That history is what stops
 * the second attempt repeating the first.
 */
async function cmdEscalate(graph, claims, id) {
  const node = graph.nodes.find((n) => n.id === id)
  if (!node) return fail(`unknown node "${id}"`)

  const path = join(CLAIMS_DIR, `${id}.json`)
  if (!existsSync(path)) return fail(`${id} is not claimed — nothing to escalate`)

  const reason = positional.slice(1).join(' ') || '(no reason given)'
  const claim = JSON.parse(await readFile(path, 'utf8'))
  claim.escalations = claim.escalations ?? []
  claim.escalations.push({ from: node.model, to: 'opus', reason, at: new Date().toISOString() })
  claim.status = 'wip'
  await writeFile(path, `${JSON.stringify(claim, null, 2)}\n`)

  process.stdout.write(
    `recorded: ${id} escalated from ${node.model} to opus\n  reason: ${reason}\n\n` +
      'In the SAME session, type:\n\n  /model opus\n\n' +
      'Do not start a new session. The files already read and the dead ends already\n' +
      'eliminated are the expensive part; the tokens are not (A7).\n\n' +
      `If this node has already been escalated ${claim.escalations.length} time(s) with no\n` +
      'progress, that is A9\'s fourth row: abandon it, record what was learned in\n' +
      'qa/findings.md, and release it with --abandoned.\n'
  )
  return 0
}

async function cmdConflicts(graph) {
  const byToken = new Map()
  for (const node of graph.nodes) {
    for (const token of node.mutex ?? []) {
      if (!byToken.has(token)) byToken.set(token, [])
      byToken.get(token).push(node)
    }
  }

  for (const [token, nodes] of [...byToken].sort()) {
    const lanes = [...new Set(nodes.map((n) => n.lane))]
    const crossLane = lanes.length > 1
    process.stdout.write(`\n${token}\n`)
    process.stdout.write(`  held by: ${nodes.map((n) => `${n.id}(lane ${n.lane})`).join(', ')}\n`)
    if (crossLane) {
      process.stdout.write(`  CROSS-LANE — these lanes cannot run concurrently while both are open\n`)
    }
    const note = graph.mutexNotes?.[token]
    if (note) process.stdout.write(`  ${note}\n`)
    else process.stdout.write(`  (no note in graph.json — add one; an unexplained mutex gets ignored)\n`)
  }
  return 0
}

async function cmdGraph(graph) {
  process.stdout.write('```mermaid\nflowchart TD\n')
  for (const node of graph.nodes) {
    const shape = node.check === 'gate' ? `{{"${node.id} ${node.title}"}}` : `["${node.id} ${node.title}"]`
    process.stdout.write(`  ${node.id.replace('-', '_')}${shape}\n`)
  }
  for (const node of graph.nodes) {
    for (const dep of node.blockedBy ?? []) {
      process.stdout.write(`  ${dep.replace('-', '_')} --> ${node.id.replace('-', '_')}\n`)
    }
  }
  process.stdout.write('```\n')
  return 0
}

/** Integrity: dangling edges, cycles, and mutex tokens with no explanation. */
async function cmdCheck(graph) {
  const ids = new Set(graph.nodes.map((n) => n.id))
  const problems = []

  for (const node of graph.nodes) {
    for (const dep of node.blockedBy ?? []) {
      if (!ids.has(dep)) problems.push(`${node.id}: blockedBy names unknown node "${dep}"`)
    }
    for (const token of node.mutex ?? []) {
      if (!graph.mutexNotes?.[token]) problems.push(`${node.id}: mutex "${token}" has no note in mutexNotes`)
    }
    if (node.check === 'gate' && !node.acceptance?.decision) {
      problems.push(`${node.id}: is a gate but names no decision record — it could never become ready`)
    }
    // A path a node edits but does not hold a mutex on is not automatically a
    // bug — most paths are touched by exactly one node — but a path claimed by
    // two nodes without a mutex is the K9 failure mode exactly.
    for (const other of graph.nodes) {
      if (other.id <= node.id) continue
      const shared = (node.paths ?? []).filter((p) => (other.paths ?? []).includes(p))
      for (const path of shared) {
        const guarded = overlap(node.mutex ?? [], other.mutex ?? []).length > 0
        // Different phases are already serialised by phase gating, so a shared
        // path across them is ordered, not concurrent.
        const ordered =
          node.phase !== other.phase ||
          (other.blockedBy ?? []).includes(node.id) ||
          (node.blockedBy ?? []).includes(other.id)
        if (!guarded && !ordered && path !== '**') {
          problems.push(`${node.id} and ${other.id} both edit "${path}" with no mutex and no ordering — this is the K9 shape`)
        }
      }
    }
  }

  // Cycle detection over blockedBy.
  const seen = new Map()
  const visit = (id, trail) => {
    if (trail.includes(id)) return problems.push(`cycle: ${[...trail, id].join(' -> ')}`)
    if (seen.get(id)) return
    seen.set(id, true)
    const node = graph.nodes.find((n) => n.id === id)
    for (const dep of node?.blockedBy ?? []) visit(dep, [...trail, id])
  }
  for (const node of graph.nodes) visit(node.id, [])

  if (!problems.length) {
    process.stdout.write(`graph ok — ${graph.nodes.length} nodes, no dangling edges, no cycles, every mutex explained\n`)
    return 0
  }
  process.stdout.write(`${problems.length} problem(s):\n`)
  for (const p of problems) process.stdout.write(`  - ${p}\n`)
  return 1
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  return 2
}

// --- main -------------------------------------------------------------------

async function main() {
  const graph = await loadGraph()
  const claims = await loadClaims()

  if (flags.has('--where')) {
    process.stdout.write(`claims: ${CLAIMS_DIR}\n`)
    process.stdout.write('shared by every worktree of this clone.\n')
    return 0
  }
  if (flags.has('--check')) return cmdCheck(graph)
  if (flags.has('--conflicts')) return cmdConflicts(graph)
  if (flags.has('--graph')) return cmdGraph(graph)
  if (flags.has('--claim')) return cmdClaim(graph, claims, positional[0])
  if (flags.has('--release')) return cmdRelease(graph, claims, positional[0])
  if (flags.has('--brief')) return cmdBrief(graph, positional[0])
  if (flags.has('--model')) return cmdModel(graph, positional[0])
  if (flags.has('--escalate')) return cmdEscalate(graph, claims, positional[0])
  if (flags.has('--all')) return cmdAll(graph, claims)
  if (flags.has('--ready') || !argv.length) return cmdReady(graph, claims)

  return fail(`unknown flag. See the header of ${'qa/plan/next.mjs'} for the command list.`)
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`qa/plan/next.mjs failed: ${error?.stack ?? error}\n`)
    process.exit(1)
  })
