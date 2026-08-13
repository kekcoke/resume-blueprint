import { spawn } from 'node:child_process'

/**
 * Shells out to the `git` CLI rather than depending on a git library
 * (simple-git, isomorphic-git, nodegit): mirrors the project's existing pattern
 * for Tectonic (`packages/core/src/render/tectonic.ts`) of driving a trusted
 * local binary as a subprocess, and avoids taking on a dependency that would
 * itself need to track git's on-disk format.
 */
export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr: string
  ) {
    super(message)
    this.name = 'GitError'
  }
}

/**
 * Runs `git -C <cwd> <args>` and resolves with stdout.
 *
 * @throws {GitError} if git is not on PATH, the process times out, or exits
 *   non-zero, with captured stderr attached.
 */
export function git(cwd: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timer)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        rejectPromise(
          new GitError(
            'git not found on PATH. Install it or ensure it is available in this environment.',
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
        rejectPromise(
          new GitError(`git ${args.join(' ')} timed out after ${timeoutMs}ms`, stderr)
        )
      } else if (code !== 0) {
        rejectPromise(
          new GitError(`git ${args.join(' ')} exited with code ${code}: ${stderr.trim()}`, stderr)
        )
      } else {
        resolvePromise(stdout)
      }
    })
  })
}
