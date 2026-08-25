import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as store from '../dist/index.js'
import {
  ConflictError,
  NotFoundError,
  InvalidRevError,
  AlreadyExistsError,
  InvalidActorError
} from '../dist/index.js'
import { renderBlueprint } from '@resume-blueprint/core'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'resume-blueprint-store-test-'))
  process.env.RESUME_BLUEPRINT_HOME = dir
})

afterEach(async () => {
  delete process.env.RESUME_BLUEPRINT_HOME
  await rm(dir, { recursive: true, force: true })
})

describe('create + get', () => {
  test('round-trips an identical blueprint', async () => {
    const blueprint = {
      basics: { name: 'Ada Lovelace', email: 'ada@example.com' },
      selectedTemplate: 1
    }

    const { rev: createRev } = await store.create('default', blueprint)
    assert.ok(createRev)

    const { blueprint: fetched, rev } = await store.get('default')
    assert.equal(rev, createRev)
    assert.equal(fetched.basics?.name, 'Ada Lovelace')
    assert.equal(fetched.basics?.email, 'ada@example.com')
    assert.equal(fetched.selectedTemplate, 1)
  })
})

describe('patch', () => {
  test('merges nested objects and null deletes a key', async () => {
    await store.create('default', {
      basics: {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        label: 'Engineer'
      },
      selectedTemplate: 1
    })

    await store.patch('default', {
      basics: { email: 'ada@newmail.com', label: null }
    })

    const { blueprint } = await store.get('default')
    assert.equal(
      blueprint.basics?.name,
      'Ada Lovelace',
      'untouched sibling key preserved'
    )
    assert.equal(
      blueprint.basics?.email,
      'ada@newmail.com',
      'patched key updated'
    )
    assert.ok(
      !('label' in (blueprint.basics ?? {})),
      'null in patch deletes the key'
    )
  })
})

describe('section helpers', () => {
  test('sectionAppend, sectionUpdate, sectionRemove operate on work', async () => {
    await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })

    await store.sectionAppend('default', 'work', {
      name: 'Analytical Engines Ltd',
      position: 'Engineer'
    })
    let { blueprint } = await store.get('default')
    assert.equal(blueprint.work?.length, 1)
    assert.equal(blueprint.work?.[0]?.name, 'Analytical Engines Ltd')

    await store.sectionAppend('default', 'work', {
      name: 'Second Co',
      position: 'Lead'
    })
    ;({ blueprint } = await store.get('default'))
    assert.equal(blueprint.work?.length, 2)

    await store.sectionUpdate('default', 'work', 0, {
      name: 'Analytical Engines Ltd',
      position: 'Senior Engineer'
    })
    ;({ blueprint } = await store.get('default'))
    assert.equal(blueprint.work?.[0]?.position, 'Senior Engineer')
    assert.equal(
      blueprint.work?.length,
      2,
      'update does not change array length'
    )

    await store.sectionRemove('default', 'work', 0)
    ;({ blueprint } = await store.get('default'))
    assert.equal(blueprint.work?.length, 1)
    assert.equal(blueprint.work?.[0]?.name, 'Second Co')
  })
})

describe('optimistic concurrency', () => {
  test('a stale expectedRev throws ConflictError and leaves the file untouched', async () => {
    const { rev: staleRev } = await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })

    await store.patch('default', { basics: { name: 'Ada Byron' } })
    const { blueprint: before } = await store.get('default')

    await assert.rejects(
      store.patch(
        'default',
        { basics: { name: 'Should not land' } },
        { expectedRev: staleRev }
      ),
      ConflictError
    )

    const { blueprint: after } = await store.get('default')
    assert.deepEqual(
      after,
      before,
      'file content unchanged by the rejected patch'
    )
  })
})

describe('history + revert', () => {
  test('history is newest-first and revert restores prior content as a new commit', async () => {
    const { rev: rev1 } = await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })
    const { rev: rev2 } = await store.patch('default', {
      basics: { name: 'Ada Byron' }
    })
    const { rev: rev3 } = await store.patch('default', {
      basics: { name: 'Ada Lovelace' }
    })

    const commits = await store.history('default')
    assert.equal(commits.length, 3)
    assert.deepEqual(
      commits.map((c) => c.rev),
      [rev3, rev2, rev1],
      'newest first'
    )

    const { rev: revertRev } = await store.revert('default', rev1)
    assert.notEqual(
      revertRev,
      rev1,
      'revert creates a new commit rather than moving back to rev1'
    )

    const { blueprint } = await store.get('default')
    assert.equal(
      blueprint.basics?.name,
      'Ada',
      'content restored to rev1 state'
    )

    const afterHistory = await store.history('default')
    assert.equal(
      afterHistory.length,
      4,
      'history was appended to, never rewritten'
    )
    assert.equal(afterHistory[0]?.rev, revertRev)
    assert.deepEqual(
      afterHistory.map((c) => c.rev).slice(1),
      [rev3, rev2, rev1],
      'prior history preserved unchanged'
    )
  })
})

describe('validation on patch', () => {
  test('a patch producing an invalid blueprint is rejected and nothing is committed', async () => {
    const { rev: createRev } = await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })

    // selectedTemplate must be one of 1..9
    await assert.rejects(store.patch('default', { selectedTemplate: 99 }))

    const { blueprint, rev } = await store.get('default')
    assert.equal(rev, createRev, 'no new commit was made')
    assert.equal(blueprint.selectedTemplate, 1, 'stored content unchanged')

    const commits = await store.history('default')
    assert.equal(
      commits.length,
      1,
      'the invalid patch left no trace in history'
    )
  })
})

// CLAUDE.md invariant 1: `sanitizeBlueprint` escapes LaTeX specials and is NOT
// idempotent. If sanitized output is ever written back to storage, re-editing
// and re-rendering escapes it again ("R&D" -> "R\&D" -> "R\textbackslash{}\&D").
// The store must persist only raw user text and never call sanitize on its way
// to disk. This is that regression guard.
describe('idempotency guard (invariant 1)', () => {
  test('patching, rendering, then patching again never double-escapes stored text', async () => {
    await store.create('default', {
      basics: { name: 'Placeholder' },
      selectedTemplate: 1
    })

    await store.patch('default', { basics: { name: 'R&D Lead' } })
    let { blueprint } = await store.get('default')
    assert.equal(
      blueprint.basics?.name,
      'R&D Lead',
      'stored value is raw, unescaped'
    )

    // Rendering sanitizes on the way to the engine; it must never write back.
    const pdf = await renderBlueprint(blueprint)
    assert.ok(pdf.length > 0)

    ;({ blueprint } = await store.get('default'))
    assert.equal(
      blueprint.basics?.name,
      'R&D Lead',
      'render did not mutate stored content'
    )

    // Patch again, touching an unrelated field, to prove a second write cycle
    // doesn't compound any escaping.
    await store.patch('default', { basics: { label: 'Engineer' } })
    ;({ blueprint } = await store.get('default'))
    assert.equal(
      blueprint.basics?.name,
      'R&D Lead',
      'still exactly R&D Lead, never R\\&D Lead'
    )
  })
})

// Reviewer/security finding #1: revA/revB/rev were forwarded into `git` argv
// unvalidated. A value like `--output=/tmp/pwned.txt` is parsed by git itself
// as an option, not a revision, and can make git write to an attacker-chosen
// path. `diff()`/`revert()` must reject flag-like rev strings before they
// ever reach `spawn`.
describe('rev argument injection (finding #1)', () => {
  test('diff() rejects a flag-like revA and does not invoke git with it', async () => {
    await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })
    const { rev } = await store.get('default')

    const outPath = join('/tmp', `resume-blueprint-pwned-${process.pid}.txt`)
    await rm(outPath, { force: true })

    await assert.rejects(
      store.diff('default', `--output=${outPath}`, rev),
      InvalidRevError
    )

    await assert.rejects(
      readFile(outPath),
      /ENOENT/,
      'git must never have written the injected path'
    )
  })

  test('diff() rejects a flag-like revB', async () => {
    await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })
    const { rev } = await store.get('default')
    await assert.rejects(
      store.diff('default', rev, '--output=/tmp/pwned2.txt'),
      InvalidRevError
    )
  })

  test('revert() rejects a flag-like rev', async () => {
    await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })
    await assert.rejects(
      store.revert('default', '--output=/tmp/pwned3.txt'),
      InvalidRevError
    )
  })
})

// Finding #2: remove()/revert() accepted `MutationOpts` but never checked
// `expectedRev`, so a stale caller's mutation would silently succeed instead
// of conflicting.
describe('expectedRev on remove/revert (finding #2)', () => {
  test('remove() with a stale expectedRev throws ConflictError and leaves the file untouched', async () => {
    const { rev: staleRev } = await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })
    await store.patch('default', { basics: { name: 'Ada Byron' } })

    await assert.rejects(
      store.remove('default', { expectedRev: staleRev }),
      ConflictError
    )

    const { blueprint } = await store.get('default')
    assert.equal(
      blueprint.basics?.name,
      'Ada Byron',
      'blueprint was not removed'
    )
  })

  test('revert() with a stale expectedRev throws ConflictError and leaves history untouched', async () => {
    const { rev: rev1 } = await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })
    await store.patch('default', { basics: { name: 'Ada Byron' } })
    const { rev: staleRev } = await store.get('default') // one behind after the next patch
    await store.patch('default', { basics: { name: 'Ada Lovelace' } })

    await assert.rejects(
      store.revert('default', rev1, { expectedRev: staleRev }),
      ConflictError
    )

    const commitsAfter = await store.history('default')
    assert.equal(commitsAfter.length, 3, 'no revert commit was made')
  })
})

// Finding #3: a mutation that produces byte-identical content made `git
// commit` exit non-zero ("nothing to commit"), which propagated as a raw
// GitError instead of succeeding as a no-op.
describe('no-op mutations (finding #3)', () => {
  test('patching a field to its current value twice in a row succeeds both times', async () => {
    const { rev: createRev } = await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })

    const first = await store.patch('default', { basics: { name: 'Ada' } })
    assert.equal(
      first.rev,
      createRev,
      'no-op patch does not create a new commit'
    )

    const second = await store.patch('default', { basics: { name: 'Ada' } })
    assert.equal(
      second.rev,
      createRev,
      'second no-op patch also succeeds and returns the same rev'
    )

    const commits = await store.history('default')
    assert.equal(commits.length, 1, 'no-op patches left no trace in history')
  })
})

// Finding #4: create() had no existence check, so a second create() for the
// same id silently overwrote the first blueprint.
describe('create is not an overwrite (finding #4)', () => {
  test('creating the same id twice throws AlreadyExistsError and leaves the original untouched', async () => {
    await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })

    await assert.rejects(
      store.create('default', {
        basics: { name: 'Someone Else' },
        selectedTemplate: 2
      }),
      AlreadyExistsError
    )

    const { blueprint } = await store.get('default')
    assert.equal(
      blueprint.basics?.name,
      'Ada',
      'first blueprint content unchanged'
    )
    assert.equal(blueprint.selectedTemplate, 1)
  })
})

// Finding #5: list() ran an unguarded JSON.parse/parseBlueprint per entry, so
// one malformed file on disk took down the entire listing.
describe('list tolerates malformed entries (finding #5)', () => {
  test('a hand-corrupted blueprint file is skipped, not thrown', async () => {
    await store.create('good', { basics: { name: 'Ada' }, selectedTemplate: 1 })

    await writeFile(
      join(dir, 'blueprints', 'bad.json'),
      '{ not valid json',
      'utf8'
    )

    const summaries = await store.list()
    assert.equal(summaries.length, 1)
    assert.equal(summaries[0].id, 'good')
  })
})

// Finding #6: `actor` was interpolated unvalidated into commit messages that
// history() later re-splits on FIELD_SEP ('\x1f'). An actor containing that
// byte (or a newline) could desync history()'s parsing of later commits.
describe('actor validation (finding #6)', () => {
  test('an actor containing the field separator byte is rejected', async () => {
    await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })
    await assert.rejects(
      store.patch(
        'default',
        { basics: { name: 'Ada Byron' } },
        { actor: 'evil\x1factor' }
      ),
      InvalidActorError
    )
  })

  test('an actor containing a newline is rejected', async () => {
    await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })
    await assert.rejects(
      store.patch(
        'default',
        { basics: { name: 'Ada Byron' } },
        { actor: 'evil\nactor' }
      ),
      InvalidActorError
    )

    // and history() parsing is unaffected by the rejected attempt
    const commits = await store.history('default')
    assert.equal(commits.length, 1)
  })
})

// Finding #7: history() returned [] for a never-created id, inconsistent
// with get()'s NotFoundError for the same condition.
describe('history() on a nonexistent id (finding #7)', () => {
  test('throws NotFoundError, matching get()', async () => {
    await assert.rejects(store.history('never-created'), NotFoundError)
  })
})

// See cross-process-lock.test.ts for the process-boundary case this can't
// exercise — this test only proves the in-process queue.
describe('concurrent patches', () => {
  test('of two concurrent patches sharing one expectedRev, exactly one wins', async () => {
    await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })
    const { rev: baseRev } = await store.get('default')

    const results = await Promise.allSettled([
      store.patch(
        'default',
        { basics: { name: 'Patch A' } },
        { expectedRev: baseRev }
      ),
      store.patch(
        'default',
        { basics: { name: 'Patch B' } },
        { expectedRev: baseRev }
      )
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    assert.equal(fulfilled.length, 1, 'exactly one patch succeeds')
    assert.equal(rejected.length, 1, 'exactly one patch conflicts')
    assert.ok(
      rejected[0].status === 'rejected' &&
        rejected[0].reason instanceof ConflictError,
      'the losing patch throws ConflictError'
    )

    const { blueprint } = await store.get('default')
    assert.ok(
      blueprint.basics?.name === 'Patch A' ||
        blueprint.basics?.name === 'Patch B',
      'the file holds exactly one of the two patches, not a corrupted merge of both'
    )

    const commits = await store.history('default')
    assert.equal(commits.length, 2, 'create + exactly one successful patch')
  })
})
