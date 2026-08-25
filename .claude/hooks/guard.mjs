#!/usr/bin/env node
/**
 * Tripwires 2, 3 and 4 from docs/orchestration.md A6, promoted from social to
 * mechanical — plus tripwire 1, which is already enforced one layer down by
 * `assertIsolated()` and is worth having at both layers.
 *
 * A6 records that three of the five tripwires are "currently social". Autonomy
 * is precisely the condition under which a social guardrail stops working: the
 * habit lives in the head of whoever is reading the diff, and in a headless
 * session nobody is.
 *
 * PreToolUse contract: stdin carries `{tool_name, tool_input, ...}`; exit 0
 * with a `hookSpecificOutput.permissionDecision` of `deny` blocks the call and
 * shows the reason.
 *
 * Fails OPEN on a parse error (exit 0, complaint to stderr). A guard that
 * bricks every tool call the moment its input shape changes is worse than the
 * risk it covers — and tripwires 1 and 5 both have a second enforcement layer
 * inside the harness that does not depend on this file.
 */
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** Mirrors qa/lib/scratch.mjs REAL_HOME — the two must not disagree. */
const REAL_STORE = resolve(join(homedir(), '.resume-blueprint'))
const PROJECT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()

const deny = (reason) => {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason
      }
    })}\n`
  )
  process.exit(0)
}

const allow = () => process.exit(0)

/** Absolute form of whatever path this tool call is aimed at, or null. */
function targetPath(input) {
  const raw = input?.file_path ?? input?.path ?? input?.notebook_path
  if (typeof raw !== 'string') return null
  return isAbsolute(raw) ? resolve(raw) : resolve(PROJECT, raw)
}

/** The text this call would write, for rules that need to see the content. */
const payload = (input) => `${input?.new_string ?? ''}\n${input?.content ?? ''}`

// --- the four rules ---------------------------------------------------------

/**
 * Tripwire 1 — the real store is written.
 *
 * `resolveHome()` reads RESUME_BLUEPRINT_HOME at CALL time and falls back to
 * ~/.resume-blueprint, so this is a real and easy accident rather than a
 * theoretical one. Read-only inspection of that store is legitimate — the
 * release-check skill does `git -C ~/.resume-blueprint status` on purpose — so
 * only mutating commands are refused.
 */
function realStore(tool, input) {
  const path = targetPath(input)
  if (path && (path === REAL_STORE || path.startsWith(`${REAL_STORE}/`))) {
    deny(
      `${tool} targets your real blueprint store at ${REAL_STORE}. That directory holds ` +
        'real user data under git. Set RESUME_BLUEPRINT_HOME to a scratch directory ' +
        '(qa/lib/scratch.mjs mints one) instead of writing there.'
    )
  }

  if (tool !== 'Bash') return
  const command = String(input?.command ?? '')
  if (!command.includes('.resume-blueprint')) return

  const readOnly =
    /\b(status|log|diff|show|rev-parse|cat-file|ls-files|ls|head|tail|wc|stat)\b/
  if (readOnly.test(command)) return
  deny(
    `this command touches ${REAL_STORE} and is not obviously read-only:\n  ${command}\n` +
      'Inspecting the real store is fine; writing to it is tripwire 1. If this really is ' +
      'read-only, say so and run it yourself.'
  )
}

/**
 * Tripwire 2 — golden snapshots re-baselined without an explanation of the diff.
 *
 * Re-baselining to make a test pass is how a genuine regression gets committed
 * as a snapshot. The escape hatch is deliberately an environment variable: it
 * costs one sentence and it puts the reason somewhere a reviewer can see.
 */
function golden(tool, input) {
  const path = targetPath(input)
  if (path?.includes('/fixtures/golden/')) {
    deny(
      'fixtures/golden/ holds generated .tex snapshots — never hand-edit them. ' +
        'If the output legitimately changed, re-baseline with ' +
        '`npm run test:update-golden --workspace @resume-blueprint/core` and explain the diff.'
    )
  }

  if (tool !== 'Bash') return
  const command = String(input?.command ?? '')
  if (!command.includes('test:update-golden')) return
  if (process.env.GOLDEN_REBASELINE_REASON?.trim()) return
  deny(
    're-baselining golden snapshots requires GOLDEN_REBASELINE_REASON to be set to a ' +
      'one-line explanation of WHY the generated .tex changed. Tripwire 2: re-baselining to ' +
      'make a test pass is how a real regression gets committed as a snapshot. ' +
      'Read the diff first, then: GOLDEN_REBASELINE_REASON="..." npm run test:update-golden ...'
  )
}

/**
 * Tripwire 3 — qa/contract.md edited to make a run go green.
 *
 * contract.md's own closing section says a red row is either a regression or a
 * stale row, and that deciding which is the thing that separates the harness
 * from decoration. This makes that decision a precondition rather than a habit.
 */
function contract(tool, input) {
  const path = targetPath(input)
  if (!path?.endsWith('/qa/contract.md')) return

  const decision = process.env.CONTRACT_CHANGE?.trim()
  if (decision === 'regression' || decision === 'stale') return
  deny(
    'editing qa/contract.md requires CONTRACT_CHANGE to be set to `regression` or `stale`.\n' +
      '  regression — the code moved and the contract did not. Fix the code, not the table.\n' +
      '  stale      — the behaviour changed deliberately and the table did not follow.\n' +
      'Tripwire 3. Decide which it is, then re-run with CONTRACT_CHANGE set, and say so in ' +
      'the commit message. If you cannot tell yet, that is the answer: do not edit the table.'
  )
}

/**
 * Tripwire 4 — packages/core gains a runtime dependency.
 *
 * CLAUDE.md invariant 3: core's runtime deps are zod and common-tags, and a
 * third needs a real justification. This does not judge the justification; it
 * makes the addition impossible to do absent-mindedly.
 */
const CORE_ALLOWED_DEPS = new Set(['zod', 'common-tags'])

function coreDeps(tool, input) {
  const path = targetPath(input)
  if (!path?.endsWith('/packages/core/package.json')) return

  const text = payload(input)
  if (!text.trim()) return

  const added = [
    ...text.matchAll(/"([@a-z0-9][^"]*)"\s*:\s*"[\^~>=<\d*][^"]*"/gi)
  ]
    .map((m) => m[1])
    .filter(
      (name) => !CORE_ALLOWED_DEPS.has(name) && !name.startsWith('@types/')
    )

  if (!added.length) return
  deny(
    `this edit adds ${added.join(', ')} to packages/core/package.json. Core's runtime ` +
      'dependencies are zod and common-tags; a third needs a real justification ' +
      '(CLAUDE.md invariant 3, tripwire 4). If the justification is real, a human should ' +
      'make this edit deliberately.'
  )
}

// --- main -------------------------------------------------------------------

let raw = ''
process.stdin.on('data', (chunk) => (raw += chunk))
process.stdin.on('end', () => {
  let event
  try {
    event = JSON.parse(raw)
  } catch {
    process.stderr.write(
      '[guard] could not parse the hook payload; allowing.\n'
    )
    allow()
    return
  }

  const tool = event.tool_name
  const input = event.tool_input ?? {}

  try {
    realStore(tool, input)
    golden(tool, input)
    contract(tool, input)
    coreDeps(tool, input)
  } catch (error) {
    process.stderr.write(
      `[guard] rule threw, allowing: ${error?.message ?? error}\n`
    )
  }
  allow()
})
