/**
 * Scratch `RESUME_BLUEPRINT_HOME` for a QA run.
 *
 * `packages/store/src/paths.ts:resolveHome()` reads the env var at CALL time
 * and falls back to `~/.resume-blueprint`. A harness that forgets to set it
 * therefore does not fail — it quietly commits fixture junk into the user's
 * real, git-backed blueprint store. That is the single worst thing this
 * harness could do, so isolation is enforced twice: once by creating the temp
 * home here, and once by `assertIsolated()`, which every entry point calls
 * before running anything.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** The path `resolveHome()` returns when the env var is unset. Never write here. */
export const REAL_HOME = resolve(join(homedir(), '.resume-blueprint'))

/**
 * Throws unless `RESUME_BLUEPRINT_HOME` is set to something other than the
 * user's real store. Mirrors `resolveHome()`'s own resolution — including its
 * treatment of a whitespace-only value as unset — so the two cannot disagree.
 */
export function assertIsolated(env = process.env) {
  const raw = env.RESUME_BLUEPRINT_HOME
  if (!raw || !raw.trim()) {
    throw new Error(
      'RESUME_BLUEPRINT_HOME is unset: the store would resolve to your real ' +
        `${REAL_HOME} and this run would commit fixtures into it. Refusing to start.`
    )
  }
  if (resolve(raw) === REAL_HOME) {
    throw new Error(
      `RESUME_BLUEPRINT_HOME points at your real store (${REAL_HOME}). Refusing to start.`
    )
  }
  return resolve(raw)
}

/**
 * Creates a temp home and returns it with its teardown. The caller is
 * responsible for calling `cleanup()` in a `finally` — `run.mjs` does, and
 * also on SIGINT, so an interrupted run does not leave temp stores behind.
 */
export async function makeScratchHome() {
  const home = await mkdtemp(join(tmpdir(), 'resume-blueprint-qa-'))
  return {
    home,
    async cleanup() {
      if (process.env.QA_KEEP_SCRATCH) {
        process.stderr.write(`[qa] QA_KEEP_SCRATCH set — leaving ${home}\n`)
        return
      }
      await rm(home, { recursive: true, force: true })
    }
  }
}
