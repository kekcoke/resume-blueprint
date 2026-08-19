#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import {
  BlueprintSchema,
  TEMPLATE_IDS,
  blueprintToTex,
  formatValidationError,
  isValidationError,
  renderBlueprint,
  TectonicError,
  TEMPLATE_PROFILES
} from '@resume-blueprint/core'

const USAGE = `resume — render and validate resume blueprints

Usage:
  resume render <blueprint.json> [options]
  resume validate <blueprint.json>
  resume tex <blueprint.json> [options]
  resume list-templates

Arguments:
  <blueprint.json>     Path to a JSON Resume blueprint, or "-" to read stdin.

Options:
  -t, --template <n>     Template ${TEMPLATE_IDS[0]}-${TEMPLATE_IDS[TEMPLATE_IDS.length - 1]}; overrides the blueprint's selectedTemplate.
  -o, --output <path>    Write to this path. Defaults to stdout.
      --timeout <ms>     Compile timeout in milliseconds (default 60000).
      --keep-temp        Retain the compile directory and print its path.
      --font <name>      template|calibri|arial|helvetica|garamond|georgia. Merges into document.
      --font-size <pt>   10, 11, or 12. Merges into document.
      --margin <length>  e.g. "0.75in", "2cm"; clamped to a 0.5in floor. Merges into document.
      --line-spacing <n> 1.0-1.15; clamped. Merges into document.
  -h, --help             Show this help.

Examples:
  resume render fixtures/sample.json -t 3 -o ada.pdf
  cat blueprint.json | resume render - -o out.pdf
  resume validate fixtures/sample.json
  resume render fixtures/sample.json --font calibri --margin 1in -o ada.pdf
`

async function readStdin(): Promise<string> {
  let raw = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) raw += chunk
  return raw
}

async function readInput(path: string): Promise<unknown> {
  const raw = path === '-' ? await readStdin() : await readFile(path, 'utf8')

  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new CliError(`${path === '-' ? 'stdin' : path} is not valid JSON: ${(error as Error).message}`)
  }
}

class CliError extends Error {}

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

  if (!path) throw new CliError(`${command} needs a blueprint path (or "-" for stdin)`)

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
      return 0
    }

    case 'tex': {
      const { texDoc } = blueprintToTex(blueprint)
      await emit(texDoc, values.output)
      return 0
    }

    case 'render': {
      const pdf = await renderBlueprint(blueprint, {
        timeoutMs: values.timeout ? Number(values.timeout) : undefined,
        keepTempDir: values['keep-temp']
      })
      await emit(pdf, values.output)
      return 0
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
    } else if (error instanceof CliError) {
      process.stderr.write(`${error.message}\n`)
    } else {
      process.stderr.write(`${(error as Error).message}\n`)
    }
    process.exit(1)
  })
