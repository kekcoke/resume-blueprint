import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as store from '../dist/index.js'
import { ConflictError } from '../dist/index.js'
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
      basics: { name: 'Ada Lovelace', email: 'ada@example.com', label: 'Engineer' },
      selectedTemplate: 1
    })

    await store.patch('default', { basics: { email: 'ada@newmail.com', label: null } })

    const { blueprint } = await store.get('default')
    assert.equal(blueprint.basics?.name, 'Ada Lovelace', 'untouched sibling key preserved')
    assert.equal(blueprint.basics?.email, 'ada@newmail.com', 'patched key updated')
    assert.ok(!('label' in (blueprint.basics ?? {})), 'null in patch deletes the key')
  })
})

describe('section helpers', () => {
  test('sectionAppend, sectionUpdate, sectionRemove operate on work', async () => {
    await store.create('default', { basics: { name: 'Ada' }, selectedTemplate: 1 })

    await store.sectionAppend('default', 'work', { name: 'Analytical Engines Ltd', position: 'Engineer' })
    let { blueprint } = await store.get('default')
    assert.equal(blueprint.work?.length, 1)
    assert.equal(blueprint.work?.[0]?.name, 'Analytical Engines Ltd')

    await store.sectionAppend('default', 'work', { name: 'Second Co', position: 'Lead' })
    ;({ blueprint } = await store.get('default'))
    assert.equal(blueprint.work?.length, 2)

    await store.sectionUpdate('default', 'work', 0, { name: 'Analytical Engines Ltd', position: 'Senior Engineer' })
    ;({ blueprint } = await store.get('default'))
    assert.equal(blueprint.work?.[0]?.position, 'Senior Engineer')
    assert.equal(blueprint.work?.length, 2, 'update does not change array length')

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
      store.patch('default', { basics: { name: 'Should not land' } }, { expectedRev: staleRev }),
      ConflictError
    )

    const { blueprint: after } = await store.get('default')
    assert.deepEqual(after, before, 'file content unchanged by the rejected patch')
  })
})

describe('history + revert', () => {
  test('history is newest-first and revert restores prior content as a new commit', async () => {
    const { rev: rev1 } = await store.create('default', {
      basics: { name: 'Ada' },
      selectedTemplate: 1
    })
    const { rev: rev2 } = await store.patch('default', { basics: { name: 'Ada Byron' } })
    const { rev: rev3 } = await store.patch('default', { basics: { name: 'Ada Lovelace' } })

    const commits = await store.history('default')
    assert.equal(commits.length, 3)
    assert.deepEqual(commits.map((c) => c.rev), [rev3, rev2, rev1], 'newest first')

    const { rev: revertRev } = await store.revert('default', rev1)
    assert.notEqual(revertRev, rev1, 'revert creates a new commit rather than moving back to rev1')

    const { blueprint } = await store.get('default')
    assert.equal(blueprint.basics?.name, 'Ada', 'content restored to rev1 state')

    const afterHistory = await store.history('default')
    assert.equal(afterHistory.length, 4, 'history was appended to, never rewritten')
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
    assert.equal(commits.length, 1, 'the invalid patch left no trace in history')
  })
})

// CLAUDE.md invariant 1: `sanitizeBlueprint` escapes LaTeX specials and is NOT
// idempotent. If sanitized output is ever written back to storage, re-editing
// and re-rendering escapes it again ("R&D" -> "R\&D" -> "R\textbackslash{}\&D").
// The store must persist only raw user text and never call sanitize on its way
// to disk. This is that regression guard.
describe('idempotency guard (invariant 1)', () => {
  test('patching, rendering, then patching again never double-escapes stored text', async () => {
    await store.create('default', { basics: { name: 'Placeholder' }, selectedTemplate: 1 })

    await store.patch('default', { basics: { name: 'R&D Lead' } })
    let { blueprint } = await store.get('default')
    assert.equal(blueprint.basics?.name, 'R&D Lead', 'stored value is raw, unescaped')

    // Rendering sanitizes on the way to the engine; it must never write back.
    const pdf = await renderBlueprint(blueprint)
    assert.ok(pdf.length > 0)

    ;({ blueprint } = await store.get('default'))
    assert.equal(blueprint.basics?.name, 'R&D Lead', 'render did not mutate stored content')

    // Patch again, touching an unrelated field, to prove a second write cycle
    // doesn't compound any escaping.
    await store.patch('default', { basics: { label: 'Engineer' } })
    ;({ blueprint } = await store.get('default'))
    assert.equal(blueprint.basics?.name, 'R&D Lead', 'still exactly R&D Lead, never R\\&D Lead')
  })
})

describe('concurrent patches', () => {
  test('of two concurrent patches sharing one expectedRev, exactly one wins', async () => {
    await store.create('default', { basics: { name: 'Ada' }, selectedTemplate: 1 })
    const { rev: baseRev } = await store.get('default')

    const results = await Promise.allSettled([
      store.patch('default', { basics: { name: 'Patch A' } }, { expectedRev: baseRev }),
      store.patch('default', { basics: { name: 'Patch B' } }, { expectedRev: baseRev })
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    assert.equal(fulfilled.length, 1, 'exactly one patch succeeds')
    assert.equal(rejected.length, 1, 'exactly one patch conflicts')
    assert.ok(
      rejected[0].status === 'rejected' && rejected[0].reason instanceof ConflictError,
      'the losing patch throws ConflictError'
    )

    const { blueprint } = await store.get('default')
    assert.ok(
      blueprint.basics?.name === 'Patch A' || blueprint.basics?.name === 'Patch B',
      'the file holds exactly one of the two patches, not a corrupted merge of both'
    )

    const commits = await store.history('default')
    assert.equal(commits.length, 2, 'create + exactly one successful patch')
  })
})
