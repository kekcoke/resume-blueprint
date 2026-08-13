import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { git } from './git.js'

/**
 * Ensures `home` exists, `home/blueprints` exists, and `home` is a git repo
 * with a local (repo-scoped) commit identity.
 *
 * The `.git` check is a cheap stat, so this is a no-op subprocess-free
 * fast path on every call after the first. Local identity is set
 * unconditionally on init — never relying on global git config — so this
 * works in CI or sandboxes with no global git identity configured at all.
 */
export async function ensureRepo(home: string): Promise<void> {
  await mkdir(home, { recursive: true })
  await mkdir(join(home, 'blueprints'), { recursive: true })

  try {
    await stat(join(home, '.git'))
    return
  } catch {
    // Not yet a repo; fall through to init.
  }

  await git(home, ['init', '-b', 'main'])
  await git(home, ['config', 'user.name', 'resume-blueprint'])
  await git(home, ['config', 'user.email', 'resume-blueprint@localhost'])
}
