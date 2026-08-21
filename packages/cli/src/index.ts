#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import {
  BlueprintSchema,
  TEMPLATE_IDS,
  blueprintToTex,
  blueprintToText,
  analyzeCoverage,
  formatValidationError,
  isValidationError,
  renderBlueprint,
  TectonicError,
  TEMPLATE_PROFILES,
  profileToBlueprint,
  ProfileParseError,
  citationWarnings,
  type CoverageReport
} from '@resume-blueprint/core'

const USAGE = `resume — render and validate resume blueprints

Usage:
  resume render <blueprint.json> [options]
  resume validate <blueprint.json>
  resume tex <blueprint.json> [options]
  resume text <blueprint.json> [options]
  resume target <blueprint.json> --jd <job.txt> [options]
  resume import <profile.md> [options]
  resume list-templates

Arguments:
  <blueprint.json>     Path to a JSON Resume blueprint, or "-" to read stdin.
  <profile.md>         Path to a master-profile markdown document, or "-" for stdin.
  <job.txt>            Path to a job description, or "-" to read it from stdin.

Options:
  -t, --template <n>     Template ${TEMPLATE_IDS[0]}-${TEMPLATE_IDS[TEMPLATE_IDS.length - 1]}; overrides the blueprint's selectedTemplate.
  -o, --output <path>    Write to this path. Defaults to stdout.
      --timeout <ms>     Compile timeout in milliseconds (default 60000).
      --keep-temp        Retain the compile directory and print its path.
      --font <name>      template|calibri|arial|helvetica|garamond|georgia. Merges into document.
      --font-size <pt>   10, 11, or 12. Merges into document.
      --margin <length>  e.g. "0.75in", "2cm"; clamped to a 0.5in floor. Merges into document.
      --line-spacing <n> 1.0-1.15; clamped. Merges into document.
      --jd <path>        Job description for "target"; "-" reads stdin.
      --max-terms <n>    Terms to report for "target" (default 40, clamped 1-200).
      --json             Emit the "target" report as JSON instead of a table.
      --strict           exit 1 if anything warned (import, validate, tex, text, render).
  -h, --help             Show this help.

Examples:
  resume render fixtures/sample.json -t 3 -o ada.pdf
  cat blueprint.json | resume render - -o out.pdf
  resume validate fixtures/sample.json
  resume render fixtures/sample.json --font calibri --margin 1in -o ada.pdf
  resume import profile.md | resume validate -
  resume target fixtures/sample.json --jd job.md
`

async function readStdin(): Promise<string> {
  let raw = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) raw += chunk
  return raw
}

/** Reads a path (or stdin for "-") as text. Split out of `readInput` because
 *  `import` takes markdown, and `readInput` unconditionally JSON-parses. */
async function readRaw(path: string): Promise<string> {
  if (path === '-') return readStdin()

  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    throw new CliError(`cannot read ${path}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`)
  }
}

async function readInput(path: string): Promise<unknown> {
  const raw = await readRaw(path)

  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new CliError(`${path === '-' ? 'stdin' : path} is not valid JSON: ${(error as Error).message}`)
  }
}

class CliError extends Error {}

/**
 * Renders a coverage report as a table for a human reading a terminal.
 *
 * `--json` is the machine path; this one optimizes for the question someone
 * actually asks -- what is missing, and where would it go. Suggestions are
 * collapsed to the first, because that is the recommendation; the rest are in
 * the JSON.
 */
function formatCoverage(report: CoverageReport): string {
  const total = report.matched.length + report.missing.length
  if (!total) return `${report.notes.map((note) => `note: ${note}`).join('\n')}\n`

  const lines = [
    `coverage ${Math.round(report.coverage * 100)}%  (${report.matched.length} of ${total} terms present)`,
    ''
  ]

  if (report.missing.length) {
    const width = Math.max(...report.missing.map((t) => t.term.length))
    lines.push('missing, most prominent first:')
    for (const term of report.missing) {
      const where = term.suggestions[0]?.section ?? '-'
      lines.push(`  ${term.term.padEnd(width)}  ${String(term.count).padStart(2)}x  -> ${where}`)
    }
  } else {
    lines.push('every reported term already appears in the resume.')
  }

  if (report.matched.length) {
    lines.push('', 'present:')
    for (const term of report.matched) {
      const as = term.matchedAs ? ` (as "${term.matchedAs}")` : ''
      lines.push(`  ${term.term}${as} -- ${term.sections.join(', ')}`)
    }
  }

  if (report.notes.length) lines.push('', ...report.notes.map((note) => `note: ${note}`))

  return `${lines.join('\n')}\n`
}

/** Applies the --template override on top of whatever the blueprint declared. */
function withTemplate(blueprint: unknown, template?: number): unknown {
  if (template === undefined) return blueprint
  return { ...(blueprint as object), selectedTemplate: template }
}

/**
 * Applies --font/--font-size/--margin/--line-spacing on top of whatever
 * `document` block the blueprint already declared.
 *
 * Merged field by field, not replaced wholesale — same reasoning as MCP's
 * `withOverrides` in packages/mcp/src/tools.ts: a blueprint that already set
 * `document.accentColor` should not lose it just because `--font-size` was
 * passed on this one invocation.
 *
 * Values are passed through as strings/numbers rather than validated here —
 * `BlueprintSchema` (via DocumentConfigSchema) is the single source of truth
 * for what's valid, and an invalid value surfaces as the same
 * formatValidationError output any other bad blueprint field would.
 */
function withDocument(blueprint: unknown, override: Record<string, unknown>): unknown {
  if (Object.keys(override).length === 0) return blueprint
  const bp = blueprint as { document?: Record<string, unknown> }
  return { ...(blueprint as object), document: { ...bp.document, ...override } }
}

/** Parses a --font-size/--line-spacing flag, rejecting non-finite input
 * (e.g. `--font-size banana`) with a CliError rather than letting a NaN
 * silently pass DocumentConfigSchema's numeric clamps untouched. */
function parseNumberFlag(name: string, raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new CliError(`${name} must be a number, got "${raw}"`)
  return n
}

/**
 * Citation artifacts that will typeset into the output, as warning lines.
 *
 * Detected on the PARSED blueprint, never on the generated .tex: the two marker
 * families survive escaping differently -- `[cite: 1, 2, 3]` passes through
 * byte-identical while `[cite_start]` becomes `[cite\\_start]` -- so a scan of
 * the output would find only one of them. Re-parsing costs nothing on a
 * document this size and keeps detection on exactly what renders.
 *
 * Returns nothing for input that does not parse; the caller is about to report
 * the validation failure, and a citation warning on top of it is noise.
 */
function citationsIn(blueprint: unknown): string[] {
  const parsed = BlueprintSchema.safeParse(blueprint)
  return parsed.success ? citationWarnings(parsed.data) : []
}

/**
 * Warnings go to stderr, never stdout: stdout is the data channel, and
 * `resume tex x.json > out.tex` must not pick up chatter.
 *
 * The wording is about the BLUEPRINT, not about this particular output file,
 * and the same on every command. A site in an unrendered corner -- a heading
 * override for a section with no content -- does not reach today's PDF but is
 * still contamination waiting for that section to be filled in. Claiming
 * "typeset into this document" would have been false for exactly that case.
 */
function reportCitations(warnings: string[]): void {
  if (!warnings.length) return
  const n = warnings.length
  process.stderr.write(
    `warning: citation artifacts at ${n} site${n === 1 ? '' : 's'}; these typeset as literal text\n`
  )
  for (const warning of warnings) process.stderr.write(`  ${warning}\n`)
}

async function emit(data: Buffer | string, output?: string): Promise<void> {
  if (output) {
    await writeFile(output, data)
    process.stderr.write(`wrote ${output}\n`)
  } else {
    process.stdout.write(data)
  }
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      template: { type: 'string', short: 't' },
      output: { type: 'string', short: 'o' },
      timeout: { type: 'string' },
      'keep-temp': { type: 'boolean' },
      font: { type: 'string' },
      'font-size': { type: 'string' },
      margin: { type: 'string' },
      'line-spacing': { type: 'string' },
      jd: { type: 'string' },
      'max-terms': { type: 'string' },
      json: { type: 'boolean' },
      strict: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  })

  const [command, path] = positionals

  if (values.help || !command || command === 'help') {
    process.stdout.write(USAGE)
    // Asking for help is a request that succeeded; only a bare invocation with
    // nothing to act on is a usage error. Keying this off `command` alone
    // conflated the two and made `resume --help` exit 1.
    return values.help || command === 'help' ? 0 : 1
  }

  if (command === 'list-templates') {
    // A bare list of numbers gives a caller nothing to choose on. The ATS flag
    // is measured, not asserted — see packages/core/src/templates/catalog.ts.
    const width = Math.max(...TEMPLATE_PROFILES.map((t) => t.name.length))

    for (const { id, name, atsGrade } of TEMPLATE_PROFILES) {
      const note = atsGrade ? 'ATS-grade' : 'icon-labeled contacts'
      process.stdout.write(`${id}  ${name.padEnd(width)}  ${note}\n`)
    }
    return 0
  }

  if (!path) throw new CliError(`${command} needs a ${command === 'import' ? 'profile' : 'blueprint'} path (or "-" for stdin)`)

  // Handled before the JSON read below: this one takes markdown.
  if (command === 'import') {
    const { blueprint, warnings } = profileToBlueprint(await readRaw(path))

    // Blueprint to stdout, warnings to stderr, so the happy path pipes into
    // `resume validate -` while the warnings stay visible to a human.
    await emit(`${JSON.stringify(blueprint, null, 2)}\n`, values.output)
    for (const warning of warnings) process.stderr.write(`${warning}\n`)

    return values.strict && warnings.length ? 1 : 0
  }

  const template = values.template === undefined ? undefined : Number(values.template)
  if (template !== undefined && !TEMPLATE_IDS.includes(template as never)) {
    throw new CliError(`--template must be one of ${TEMPLATE_IDS.join(', ')}`)
  }

  const documentOverride: Record<string, unknown> = {}
  if (values.font !== undefined) documentOverride.fontFamily = values.font
  if (values['font-size'] !== undefined) {
    documentOverride.fontSize = parseNumberFlag('--font-size', values['font-size'])
  }
  if (values.margin !== undefined) documentOverride.margin = values.margin
  if (values['line-spacing'] !== undefined) {
    documentOverride.lineSpacing = parseNumberFlag('--line-spacing', values['line-spacing'])
  }

  const blueprint = withDocument(withTemplate(await readInput(path), template), documentOverride)

  switch (command) {
    case 'validate': {
      const result = BlueprintSchema.safeParse(blueprint)
      if (!result.success) {
        process.stderr.write(`invalid blueprint:\n${formatValidationError(result.error)}\n`)
        return 1
      }
      process.stderr.write('blueprint is valid\n')

      // Not a validation failure -- a citation artifact is legal content that
      // happens to be a leftover placeholder, so `valid` stands and this is a
      // warning. --strict is what turns it into a gate.
      const warnings = citationWarnings(result.data)
      reportCitations(warnings)
      return values.strict && warnings.length ? 1 : 0
    }

    case 'tex': {
      const { texDoc } = blueprintToTex(blueprint)
      await emit(texDoc, values.output)

      const warnings = citationsIn(blueprint)
      reportCitations(warnings)
      return values.strict && warnings.length ? 1 : 0
    }

    case 'text': {
      const text = blueprintToText(blueprint)
      await emit(text, values.output)

      const warnings = citationsIn(blueprint)
      reportCitations(warnings)
      return values.strict && warnings.length ? 1 : 0
    }

    case 'target': {
      if (!values.jd) throw new CliError('target needs --jd <path> (or "-" to read the posting from stdin)')
      // Only one of the two can be stdin, and silently picking a winner would
      // hand the analysis half a document.
      if (values.jd === '-' && path === '-') {
        throw new CliError('only one of <blueprint.json> and --jd can be "-"')
      }

      const maxTerms = values['max-terms'] === undefined
        ? undefined
        : parseNumberFlag('--max-terms', values['max-terms'])

      const report = analyzeCoverage(blueprint, await readRaw(values.jd), { maxTerms })
      await emit(values.json ? `${JSON.stringify(report, null, 2)}\n` : formatCoverage(report), values.output)

      const warnings = citationsIn(blueprint)
      reportCitations(warnings)
      return values.strict && warnings.length ? 1 : 0
    }

    case 'render': {
      const pdf = await renderBlueprint(blueprint, {
        timeoutMs: values.timeout ? Number(values.timeout) : undefined,
        keepTempDir: values['keep-temp']
      })
      await emit(pdf, values.output)

      const warnings = citationsIn(blueprint)
      reportCitations(warnings)
      return values.strict && warnings.length ? 1 : 0
    }

    default:
      throw new CliError(`unknown command "${command}"\n\n${USAGE}`)
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (isValidationError(error)) {
      process.stderr.write(`invalid blueprint:\n${formatValidationError(error)}\n`)
    } else if (error instanceof TectonicError) {
      process.stderr.write(`compilation failed: ${error.message}\n`)
      const relevant = error.log
        .split('\n')
        .filter((line) => /^!|^error|Error:/.test(line))
        .slice(0, 10)
      if (relevant.length) process.stderr.write(`${relevant.join('\n')}\n`)
    } else if (error instanceof ProfileParseError) {
      // Expected user error -- their document, not our bug. Same reasoning as
      // the ProfileParseError case in packages/mcp/src/errors.ts.
      process.stderr.write(`could not parse the profile: ${error.message}\n`)
    } else if (error instanceof CliError) {
      process.stderr.write(`${error.message}\n`)
    } else {
      process.stderr.write(`${(error as Error).message}\n`)
    }
    process.exit(1)
  })
