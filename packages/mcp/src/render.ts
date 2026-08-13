import { mkdir, writeFile, readdir, stat, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { inflateSync } from 'node:zlib'

/**
 * Duplicated from packages/core/test/render.test.ts's countPages(). Core's diff
 * must stay empty through Gate 2 (see docs/phase-2-plan-b.md), so this can't be
 * promoted to a shared export — keep the two in sync by hand if Tectonic's PDF
 * output shape ever changes.
 */
export function countPages(pdf: Buffer): number {
  const haystacks: string[] = [pdf.toString('latin1')]

  const raw = pdf.toString('latin1')
  const streamRe = /stream\r?\n/g
  let match: RegExpExecArray | null

  while ((match = streamRe.exec(raw)) !== null) {
    const start = match.index + match[0].length
    const end = raw.indexOf('endstream', start)
    if (end === -1) continue
    try {
      haystacks.push(inflateSync(pdf.subarray(start, end)).toString('latin1'))
    } catch {
      // Not a zlib stream (fonts, images); nothing to read here.
    }
  }

  const combined = haystacks.join('\n')
  const pages = combined.match(/\/Type\s*\/Page(?![s])/g)
  return pages ? pages.length : 0
}

/** `renders/`, sibling to `blueprints/`, under the store's home directory. */
export function renderDir(home: string): string {
  return join(home, 'renders')
}

/** Filename (not a full path) for a render — join with `renderDir(home)`. */
export function renderPath(id: string, rev: string, template: number): string {
  return `${id}-${rev.slice(0, 7)}-t${template}.pdf`
}

/**
 * Writes PDF bytes to `path`, creating the `renders/` directory (and a
 * `.gitignore` inside it, on first use) if needed. `renders/` sits outside
 * anything the store's git operations touch — store only ever `git add
 * blueprints/<id>.json`, never `-A` — but the `.gitignore` keeps `git status`
 * clean for a human inspecting the store repo by hand.
 */
export async function writeRenderFile(pdf: Buffer, path: string): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })

  const gitignore = join(dir, '.gitignore')
  if (!existsSync(gitignore)) {
    await writeFile(gitignore, '*\n', 'utf8')
  }

  await writeFile(path, pdf)
}

/** Keeps only the `keep` most-recently-modified renders for `id`, deleting the rest. */
export async function pruneOldRenders(home: string, id: string, keep = 10): Promise<void> {
  const dir = renderDir(home)

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }

  const prefix = `${id}-`
  const candidates = entries.filter((entry) => entry.startsWith(prefix) && entry.endsWith('.pdf'))

  const withMtime = await Promise.all(
    candidates.map(async (name) => {
      const path = join(dir, name)
      const stats = await stat(path)
      return { path, mtimeMs: stats.mtimeMs }
    })
  )

  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const stale = withMtime.slice(keep)
  await Promise.all(stale.map((entry) => unlink(entry.path)))
}
