import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { stat, readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TEMPLATE_IDS, TEMPLATE_PROFILES } from '@resume-blueprint/core'

/**
 * CLI smoke tests.
 *
 * The CLI is the one package that shipped with no tests, and the one where the
 * bugs are not in the logic but in the packaging: PR #4 found that the declared
 * bin was never `chmod +x`, so `npm i -g` installed a command that could not
 * run. Nothing in a unit test of `main()` would have caught that — only spawning
 * the built artifact the way a user's shell does.
 *
 * So these tests exercise `dist/index.js` as a subprocess, never the source, and
 * one of them executes it directly rather than through `node` so the shebang and
 * the executable bit are both on the hook.
 *
 * Deliberately no `render` case: it needs Tectonic and seconds per template, and
 * packages/core already compiles all nine. This file stays fast enough that
 * there is never a reason to skip it.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = resolve(HERE, '..', 'dist', 'index.js')
const FIXTURES = resolve(HERE, '..', '..', '..', 'fixtures')
const SAMPLE = resolve(FIXTURES, 'sample.json')
const PROFILE = resolve(FIXTURES, 'profile.md')

interface Run {
  code: number
  stdout: string
  stderr: string
}

/**
 * execFile rejects on a non-zero exit, but a non-zero exit is the assertion in
 * half these tests. Normalize both outcomes into the same shape.
 */
function invoke(command: string, args: string[], stdin?: string): Promise<Run> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = execFile(command, args, { maxBuffer: 8 << 20 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') return rejectPromise(error)
      resolvePromise({ code: error ? (error.code as number) : 0, stdout, stderr })
    })

    if (stdin !== undefined) {
      child.stdin?.end(stdin)
    } else {
      // Without this, a command that reads stdin (`-`) would hang the suite.
      child.stdin?.end()
    }
  })
}

/** Through `node`, as `npm run` and most CI invocations do. */
const cli = (...args: string[]): Promise<Run> => invoke(process.execPath, [BIN, ...args])

/** Directly, as a shell does after `npm i -g`. Needs shebang + executable bit. */
const cliDirect = (...args: string[]): Promise<Run> => invoke(BIN, [...args])

describe('the built bin is executable', () => {
  test('dist/index.js has the executable bit set', async () => {
    const info = await stat(BIN)

    assert.ok(
      info.mode & 0o111,
      'dist/index.js is not executable — `npm i -g` would install a command that cannot run. The `chmod +x` in the cli build script is what sets this (see PR #4).'
    )
  })

  test('the shebang survived compilation', async () => {
    const firstLine = (await readFile(BIN, 'utf8')).split('\n')[0]

    assert.equal(firstLine, '#!/usr/bin/env node')
  })

  test('running it directly, without `node`, works', async () => {
    const { code, stdout } = await cliDirect('list-templates')

    assert.equal(code, 0)
    assert.match(stdout, /Classic/)
  })
})

describe('usage and exit codes', () => {
  test('`help` prints usage and succeeds', async () => {
    const { code, stdout } = await cli('help')

    assert.equal(code, 0)
    assert.match(stdout, /^resume — render and validate resume blueprints/)
  })

  // `resume --help` is a request that succeeded. Exiting non-zero breaks
  // `resume --help && ...` and makes packaging checks report a broken install.
  for (const flag of ['--help', '-h']) {
    test(`\`${flag}\` prints usage and succeeds`, async () => {
      const { code, stdout } = await cli(flag)

      assert.equal(code, 0, `${flag} exited ${code}; asking for help is not an error`)
      assert.match(stdout, /Usage:/)
    })
  }

  test('no arguments at all prints usage and fails', async () => {
    const { code, stdout } = await cli()

    assert.equal(code, 1, 'a bare invocation is a usage error, not a help request')
    assert.match(stdout, /Usage:/)
  })

  test('an unknown command fails and names itself', async () => {
    // The missing-path check runs before the command switch, so reaching the
    // "unknown command" branch requires supplying a path.
    const { code, stderr } = await cli('bogus', SAMPLE)

    assert.equal(code, 1)
    assert.match(stderr, /unknown command "bogus"/)
  })

  test('a command with no blueprint path fails', async () => {
    const { code, stderr } = await cli('validate')

    assert.equal(code, 1)
    assert.match(stderr, /needs a blueprint path/)
  })
})

describe('list-templates', () => {
  test('prints one row per template profile', async () => {
    const { code, stdout } = await cli('list-templates')
    const rows = stdout.trimEnd().split('\n')

    assert.equal(code, 0)
    assert.equal(rows.length, TEMPLATE_PROFILES.length)

    for (const [index, profile] of TEMPLATE_PROFILES.entries()) {
      assert.match(rows[index], new RegExp(`^${profile.id}\\s+${profile.name.replace(/[.()]/g, '\\$&')}\\s`))
    }
  })

  test('labels each template with its measured ATS standing', async () => {
    const { stdout } = await cli('list-templates')

    for (const profile of TEMPLATE_PROFILES) {
      const row = stdout.split('\n').find((line) => line.startsWith(`${profile.id} `))
      assert.ok(row, `no row for template${profile.id}`)
      assert.match(row, profile.atsGrade ? /ATS-grade$/ : /icon-labeled contacts$/)
    }
  })
})

describe('validate', () => {
  test('a valid blueprint succeeds, reporting on stderr', async () => {
    const { code, stdout, stderr } = await cli('validate', SAMPLE)

    assert.equal(code, 0)
    assert.match(stderr, /blueprint is valid/)
    // stdout is the data channel: `resume tex x.json > out.tex` must not pick up
    // status chatter, so nothing but requested output ever goes there.
    assert.equal(stdout, '')
  })

  test('a schema-invalid blueprint fails with a formatted error', async () => {
    const { code, stderr } = await invoke(
      process.execPath,
      [BIN, 'validate', '-'],
      JSON.stringify({ basics: { name: 123 } })
    )

    assert.equal(code, 1)
    assert.match(stderr, /invalid blueprint:/)
  })

  test('malformed JSON fails with a parse error naming the source', async () => {
    const { code, stderr } = await invoke(process.execPath, [BIN, 'validate', '-'], 'not json')

    assert.equal(code, 1)
    assert.match(stderr, /stdin is not valid JSON/)
  })

  test('a missing file fails without a stack trace', async () => {
    const { code, stderr } = await cli('validate', resolve(FIXTURES, 'does-not-exist.json'))

    assert.equal(code, 1)
    assert.doesNotMatch(stderr, /at \w+ \(/, 'a missing file is a user error, not a crash')
  })

  test('reading a blueprint from stdin works', async () => {
    const raw = await readFile(SAMPLE, 'utf8')
    const { code, stderr } = await invoke(process.execPath, [BIN, 'validate', '-'], raw)

    assert.equal(code, 0)
    assert.match(stderr, /blueprint is valid/)
  })
})

describe('tex', () => {
  test('emits a LaTeX document on stdout', async () => {
    const { code, stdout } = await cli('tex', SAMPLE)

    assert.equal(code, 0)
    assert.match(stdout, /^\\documentclass/)
  })

  test('--template overrides the blueprint’s own selection', async () => {
    const fromBlueprint = await cli('tex', SAMPLE)
    const overridden = await cli('tex', SAMPLE, '-t', '3')

    assert.equal(overridden.code, 0)
    assert.notEqual(
      overridden.stdout,
      fromBlueprint.stdout,
      '-t 3 produced the same document as the blueprint’s selectedTemplate; the override did not take'
    )
  })

  test('--output writes to the given path and keeps stdout clean', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'resume-blueprint-cli-test-'))
    try {
      const out = join(dir, 'resume.tex')
      const { code, stdout, stderr } = await cli('tex', SAMPLE, '-o', out)

      assert.equal(code, 0)
      assert.equal(stdout, '')
      assert.match(stderr, /wrote /)
      assert.match(await readFile(out, 'utf8'), /^\\documentclass/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('an out-of-range --template is rejected before any work happens', async () => {
    const { code, stderr } = await cli('tex', SAMPLE, '-t', '99')

    assert.equal(code, 1)
    assert.match(stderr, new RegExp(`--template must be one of ${TEMPLATE_IDS.join(', ')}`))
  })
})

describe('document flags', () => {
  test('--font-size merges into document and reaches the TeX source', async () => {
    const { code, stdout } = await cli('tex', SAMPLE, '-t', '3', '--font-size', '12')

    assert.equal(code, 0)
    assert.match(stdout, /\\documentclass\[12pt\]\{article\}/)
  })

  test('--line-spacing merges into document and reaches the TeX source', async () => {
    const { code, stdout } = await cli('tex', SAMPLE, '-t', '1', '--line-spacing', '1.1')

    assert.equal(code, 0)
    assert.match(stdout, /\\linespread\{1\.1\}\\selectfont/)
  })

  test('--margin below the 0.5in floor is clamped, not rejected', async () => {
    const { code, stdout } = await cli('tex', SAMPLE, '-t', '1', '--margin', '0.1in')

    assert.equal(code, 0)
    assert.match(stdout, /left=0\.5in,right=0\.5in,bottom=0\.5in,top=0\.5in/)
  })

  test('an out-of-enum --font-size fails with a formatted validation error, not a crash', async () => {
    const { code, stderr } = await cli('tex', SAMPLE, '-t', '1', '--font-size', '99')

    assert.equal(code, 1)
    assert.match(stderr, /invalid blueprint/)
    assert.match(stderr, /document\.fontSize/)
  })

  test('a non-numeric --font-size is rejected before any work happens', async () => {
    const { code, stderr } = await cli('tex', SAMPLE, '-t', '1', '--font-size', 'banana')

    assert.equal(code, 1)
    assert.match(stderr, /--font-size must be a number/)
  })
})

describe('import', () => {
  test('writes a blueprint to stdout and warnings to stderr', async () => {
    // The split is what makes `resume import p.md | resume validate -` work
    // while a human still sees what the parser had to assume.
    const { code, stdout, stderr } = await cli('import', PROFILE)

    assert.equal(code, 0)
    const blueprint = JSON.parse(stdout)
    assert.equal(blueprint.basics.name, 'Ada Lovelace')
    assert.match(stderr, /removed \d+ citation artifacts/)
  })

  test('the output round-trips through validate', async () => {
    // The importer returns BlueprintInput, not Blueprint -- this is what
    // asserts that the un-defaulted shape is still valid input.
    const { stdout } = await cli('import', PROFILE)
    const validated = await invoke(process.execPath, [BIN, 'validate', '-'], stdout)

    assert.equal(validated.code, 0)
    assert.match(validated.stderr, /blueprint is valid/)
  })

  test('leaves no citation artifact in the emitted blueprint', async () => {
    const { stdout } = await cli('import', PROFILE)
    assert.ok(!stdout.includes('[cite'))
  })

  test('reads markdown from stdin', async () => {
    const markdown = await readFile(PROFILE, 'utf8')
    const { code, stdout } = await invoke(process.execPath, [BIN, 'import', '-'], markdown)

    assert.equal(code, 0)
    assert.equal(JSON.parse(stdout).basics.name, 'Ada Lovelace')
  })

  test('--strict turns warnings into a non-zero exit', async () => {
    const lenient = await cli('import', PROFILE)
    const strict = await cli('import', PROFILE, '--strict')

    assert.equal(lenient.code, 0)
    assert.equal(strict.code, 1)
    // The blueprint is still emitted -- --strict is a gate on the caller, not
    // a reason to withhold the parse.
    assert.equal(JSON.parse(strict.stdout).basics.name, 'Ada Lovelace')
  })

  test('an unreadable path fails with the errno, not a stack trace', async () => {
    const { code, stdout, stderr } = await cli('import', resolve(FIXTURES, 'does-not-exist.md'))

    assert.equal(code, 1)
    assert.equal(stdout, '')
    assert.match(stderr, /cannot read .*does-not-exist\.md: ENOENT/)
  })

  test('markdown that is not a profile is a readable error', async () => {
    const { code, stdout, stderr } = await invoke(
      process.execPath,
      [BIN, 'import', '-'],
      'just some prose with no headings'
    )

    assert.equal(code, 1)
    assert.equal(stdout, '')
    assert.match(stderr, /could not parse the profile/)
  })

  test('import appears in the usage text', async () => {
    const { stdout } = await cli('--help')
    assert.match(stdout, /resume import <profile\.md>/)
  })
})
