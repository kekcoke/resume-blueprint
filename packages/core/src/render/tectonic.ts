import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LaTeXOpts } from '../types.js'

/**
 * Compiles a LaTeX document to PDF using Tectonic.
 *
 * Tectonic is used rather than a full TeX Live install because it is a single
 * ~30MB binary that fetches only the packages a document actually needs, which
 * keeps this service `brew install`-able instead of Docker-only.
 *
 * Note that the first compile of a given document class will reach out to
 * Tectonic's package bundle over the network and populate a local cache;
 * subsequent renders are offline and fast.
 */

const ASSET_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'assets',
  'templates'
)

export class TectonicError extends Error {
  constructor(
    message: string,
    readonly log: string
  ) {
    super(message)
    this.name = 'TectonicError'
  }
}

export interface CompileOptions {
  /** Milliseconds before the engine is killed. Defaults to 60s. */
  timeoutMs?: number
  /** Override the packaged asset root. Mainly for tests. */
  assetRoot?: string
  /** Leave the compile directory on disk and report its path. For debugging. */
  keepTempDir?: boolean
}

/** Where the packaged `.cls` / `.sty` / font assets live. */
export function assetRoot(): string {
  return ASSET_ROOT
}

/**
 * Stages a template's declared assets into a compile directory and runs Tectonic.
 *
 * Assets are staged flat by basename (and fonts under `fonts/`) because that is
 * the layout the document classes expect — the original app did the same thing
 * into an in-memory filesystem.
 *
 * @returns the generated PDF bytes.
 * @throws {TectonicError} if the engine exits non-zero or exceeds the timeout,
 *   with the captured log attached.
 */
export async function compileTex(
  texDoc: string,
  opts: LaTeXOpts,
  options: CompileOptions = {}
): Promise<Buffer> {
  const { timeoutMs = 60_000, assetRoot: root = ASSET_ROOT, keepTempDir = false } = options

  const dir = await mkdtemp(join(tmpdir(), 'resume-blueprint-'))

  try {
    await writeFile(join(dir, 'main.tex'), texDoc, 'utf8')

    for (const input of opts.inputs ?? []) {
      await cp(resolve(root, input), join(dir, basename(input)))
    }

    if (opts.fonts?.length) {
      await mkdir(join(dir, 'fonts'), { recursive: true })
      for (const font of opts.fonts) {
        await cp(resolve(root, font), join(dir, 'fonts', basename(font)))
      }
    }

    const log = await runTectonic(dir, timeoutMs)

    let pdf: Buffer
    try {
      pdf = await readFile(join(dir, 'main.pdf'))
    } catch {
      throw new TectonicError('Tectonic produced no PDF', log)
    }

    return pdf
  } finally {
    if (keepTempDir) {
      // eslint-disable-next-line no-console
      console.error(`[tectonic] compile directory retained at ${dir}`)
    } else {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

function basename(path: string): string {
  return path.split('/').pop() as string
}

function runTectonic(dir: string, timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      'tectonic',
      [
        'main.tex',
        '--outdir',
        '.',
        // Disables shell-escape and other known-insecure engine features. The
        // sanitizer is the primary defense against injected TeX; this is the
        // second line, covering anything that slips through or arrives via a
        // document class.
        '--untrusted',
        '--chatter',
        'minimal',
        '--keep-logs'
      ],
      { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }
    )

    let output = ''
    let timedOut = false

    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timer)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        rejectPromise(
          new TectonicError(
            'tectonic not found on PATH. Install it with `brew install tectonic` ' +
              'or see https://tectonic-typesetting.github.io/en-US/install.html',
            ''
          )
        )
        return
      }
      rejectPromise(error)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        rejectPromise(new TectonicError(`Tectonic timed out after ${timeoutMs}ms`, output))
      } else if (code !== 0) {
        rejectPromise(new TectonicError(`Tectonic exited with code ${code}`, output))
      } else {
        resolvePromise(output)
      }
    })
  })
}
