#!/usr/bin/env node
/**
 * Negative control for guard.mjs.
 *
 * Every case asserts BOTH directions: the rule blocks what it claims to block,
 * and allows the adjacent legitimate thing. A guard that denies everything
 * passes a one-sided test and makes the repo unusable, which is the failure
 * this file exists to catch.
 *
 *   node .claude/hooks/guard-selftest.mjs
 */
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const GUARD = join(HERE, 'guard.mjs')
const PROJECT = join(HERE, '..', '..')
const STORE = join(homedir(), '.resume-blueprint')

function ask(event, env = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [GUARD],
      { env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT, ...env } },
      (_error, stdout) => {
        let decision = 'allow'
        try {
          decision = JSON.parse(stdout).hookSpecificOutput?.permissionDecision ?? 'allow'
        } catch {
          decision = 'allow'
        }
        resolve(decision)
      }
    )
    child.stdin.end(JSON.stringify(event))
  })
}

const edit = (file_path, extra = {}) => ({ tool_name: 'Edit', tool_input: { file_path, ...extra } })
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } })

const CASES = [
  // tripwire 1 — the real store
  ['deny', 'write into the real store', edit(join(STORE, 'blueprints/x.json'), { new_string: '{}' }), {}],
  ['allow', 'inspect the real store read-only', bash(`git -C ${STORE} status --porcelain`), {}],
  ['deny', 'commit into the real store', bash(`git -C ${STORE} commit -m wip`), {}],
  ['allow', 'a scratch home is not the real store', edit('/tmp/resume-blueprint-qa-abc/x.json', { new_string: '{}' }), {}],

  // tripwire 2 — golden snapshots
  ['deny', 'hand-edit a golden snapshot', edit(join(PROJECT, 'fixtures/golden/template1.tex'), { new_string: 'x' }), {}],
  ['deny', 're-baseline with no reason given', bash('npm run test:update-golden --workspace @resume-blueprint/core'), {}],
  ['allow', 're-baseline with a reason given', bash('npm run test:update-golden --workspace @resume-blueprint/core'), { GOLDEN_REBASELINE_REASON: 'template4 TODO comments removed, G15' }],
  ['allow', 'an ordinary fixture is not golden', edit(join(PROJECT, 'fixtures/sample.json'), { new_string: '{}' }), {}],

  // tripwire 3 — the contract table
  ['deny', 'edit the contract with no decision', edit(join(PROJECT, 'qa/contract.md'), { new_string: 'x' }), {}],
  ['allow', 'edit the contract, called a regression', edit(join(PROJECT, 'qa/contract.md'), { new_string: 'x' }), { CONTRACT_CHANGE: 'regression' }],
  ['allow', 'edit the contract, called stale', edit(join(PROJECT, 'qa/contract.md'), { new_string: 'x' }), { CONTRACT_CHANGE: 'stale' }],
  ['deny', 'a vague CONTRACT_CHANGE is not a decision', edit(join(PROJECT, 'qa/contract.md'), { new_string: 'x' }), { CONTRACT_CHANGE: 'yes' }],
  ['allow', 'qa/findings.md is not the contract', edit(join(PROJECT, 'qa/findings.md'), { new_string: 'x' }), {}],

  // tripwire 4 — core's dependencies
  ['deny', 'add a third runtime dep to core', edit(join(PROJECT, 'packages/core/package.json'), { new_string: '"lodash": "^4.17.21"' }), {}],
  ['allow', 'bump zod inside core', edit(join(PROJECT, 'packages/core/package.json'), { new_string: '"zod": "^4.4.4"' }), {}],
  ['allow', 'another package may add deps', edit(join(PROJECT, 'packages/http/package.json'), { new_string: '"lodash": "^4.17.21"' }), {}],

  // ordinary work must be untouched
  ['allow', 'an ordinary source edit', edit(join(PROJECT, 'packages/cli/src/index.ts'), { new_string: 'const x = 1' }), {}],
  ['allow', 'an ordinary test run', bash('npm test'), {}]
]

const results = []
for (const [want, label, event, env] of CASES) {
  const got = await ask(event, env)
  results.push([want === got, want, got, label])
}

for (const [ok, want, got, label] of results) {
  process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'}  expected ${want.padEnd(5)} got ${got.padEnd(5)}  ${label}\n`)
}
const failed = results.filter(([ok]) => !ok).length

// A guard that never allows is as broken as one that never denies.
const denies = results.filter(([, want]) => want === 'deny').length
const allows = results.length - denies
process.stdout.write(`\n${results.length - failed}/${results.length} passed  (${denies} deny cases, ${allows} allow cases)\n`)
process.exit(failed ? 1 : 0)
