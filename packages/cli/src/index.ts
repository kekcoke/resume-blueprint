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
  TectonicError
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
  -t, --template <n>   Template ${TEMPLATE_IDS[0]}-${TEMPLATE_IDS[TEMPLATE_IDS.length - 1]}; overrides the blueprint's selectedTemplate.
  -o, --output <path>  Write to this path. Defaults to stdout.
      --timeout <ms>   Compile timeout in milliseconds (default 60000).
      --keep-temp      Retain the compile directory and print its path.
  -h, --help           Show this help.

Examples:
  resume render fixtures/sample.json -t 3 -o ada.pdf
  cat blueprint.json | resume render - -o out.pdf
  resume validate fixtures/sample.json
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
      help: { type: 'boolean', short: 'h' }
    }
  })

  const [command, path] = positionals

  if (values.help || !command || command === 'help') {
    process.stdout.write(USAGE)
    return command ? 0 : 1
  }

  if (command === 'list-templates') {
    for (const id of TEMPLATE_IDS) process.stdout.write(`${id}\n`)
    return 0
  }

  if (!path) throw new CliError(`${command} needs a blueprint path (or "-" for stdin)`)

  const template = values.template === undefined ? undefined : Number(values.template)
  if (template !== undefined && !TEMPLATE_IDS.includes(template as never)) {
    throw new CliError(`--template must be one of ${TEMPLATE_IDS.join(', ')}`)
  }

  const blueprint = withTemplate(await readInput(path), template)

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
