import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { analyzeCoverage } from '../dist/index.js'
import type { CoverageReport, MissingTerm } from '../dist/coverage.js'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures')

/** A blueprint with something in every section the suggestions can name. */
const RESUME = {
  sections: ['profile', 'education', 'work', 'skills', 'projects', 'certificates'],
  basics: { name: 'Ada Lovelace', label: 'Platform Engineer' },
  education: [{ institution: 'MIT', studyType: 'BSc', area: 'Mathematics' }],
  work: [
    {
      name: 'Acme',
      position: 'Engineer',
      highlights: ['Operated distributed systems on Kubernetes', 'Owned the microservice fleet']
    }
  ],
  skills: [{ name: 'Platform', keywords: ['Kubernetes', 'Terraform', 'Go'] }],
  projects: [{ name: 'Analytical Engine', description: 'A mechanical computer.' }],
  certificates: [{ name: 'CKA', issuer: 'CNCF', date: '2024' }]
}

function terms(report: CoverageReport): string[] {
  return [...report.matched, ...report.missing].map((t) => t.term)
}

function missing(report: CoverageReport, term: string): MissingTerm | undefined {
  return report.missing.find((t) => t.term.toLowerCase() === term.toLowerCase())
}

describe('analyzeCoverage — term extraction', () => {
  test('ranks by prominence: repeated and front-loaded outranks a single late mention', () => {
    const jd = [
      'Kubernetes Platform Engineer',
      '',
      'You will run Kubernetes clusters. Kubernetes is the whole job.',
      'Some prose to push the rest of this posting well past the leading slice,',
      'so that position stops helping anything mentioned down here at the bottom.',
      'Nice to have: Terraform.'
    ].join('\n')

    const report = analyzeCoverage({ sections: [] }, jd)
    const ranked = report.missing.map((t) => t.term.toLowerCase())

    assert.ok(ranked.indexOf('kubernetes') < ranked.indexOf('terraform'), ranked.join(', '))
    const kubernetes = missing(report, 'Kubernetes')!
    assert.equal(kubernetes.count, 3)
    assert.equal(kubernetes.firstIndex, 0)
    assert.ok(kubernetes.prominence > missing(report, 'Terraform')!.prominence)
  })

  test('keeps the punctuation-bearing tokens a naive splitter destroys', () => {
    const jd = 'Required: C++, .NET, CI/CD, Node.js, and end-to-end ownership.'
    const found = terms(analyzeCoverage({ sections: [] }, jd)).join(' | ')

    // Substring rather than equality: `end-to-end` is reported inside the
    // phrase `end-to-end ownership`, which is the redundancy rule working. What
    // is being asserted here is that the token survived tokenization intact --
    // a naive [a-z]+ splitter would have shredded every one of these.
    for (const token of ['C++', '.NET', 'CI/CD', 'Node.js', 'end-to-end']) {
      assert.ok(found.includes(token), `expected ${token} in ${found}`)
    }
  })

  test('drops stopwords, JD boilerplate, and bare numbers', () => {
    const jd = 'The ideal candidate has 5 years of experience and strong skills. Responsibilities include Rust.'
    const found = terms(analyzeCoverage({ sections: [] }, jd)).map((t) => t.toLowerCase())

    for (const noise of ['the', 'and', 'candidate', 'experience', 'skills', 'responsibilities', '5', 'years']) {
      assert.ok(!found.includes(noise), `${noise} should not be a term; got ${found.join(', ')}`)
    }
    assert.ok(found.includes('rust'))
  })

  test('never builds a phrase across a conjunction or a comma', () => {
    const jd = 'You will use Kubernetes and Docker, plus Rust or Go.'
    const found = terms(analyzeCoverage({ sections: [] }, jd))

    assert.ok(!found.includes('Kubernetes and Docker'), found.join(' | '))
    assert.ok(!found.includes('Rust or Go'), found.join(' | '))
    assert.ok(!found.includes('Docker, plus Rust'), found.join(' | '))
  })

  test('collapses same-length phrases that restate one stretch of text', () => {
    // Three overlapping trigrams, one occurrence each, identical rank. Only the
    // best-ranked survives -- see dropOverlapping.
    const jd = 'AWS Certified Solutions Architect certification preferred.'
    const trigrams = terms(analyzeCoverage({ sections: [] }, jd)).filter((t) => t.split(' ').length === 3)

    assert.equal(trigrams.length, 1, trigrams.join(' | '))
  })

  test('does not split on an apostrophe', () => {
    const found = terms(analyzeCoverage({ sections: [] }, "Bachelor's degree in Computer Science required."))

    assert.ok(found.includes("Bachelor's degree"), found.join(' | '))
    assert.ok(!found.some((t) => t.startsWith('s ')), `orphaned "s" leaked: ${found.join(' | ')}`)
  })
})

describe('analyzeCoverage — matching', () => {
  test('reports a present term as matched, naming every section it appears in', () => {
    const report = analyzeCoverage(RESUME, 'Kubernetes is required.')
    const kubernetes = report.matched.find((t) => t.term === 'Kubernetes')

    assert.ok(kubernetes, 'Kubernetes should be matched')
    assert.deepEqual(kubernetes.sections, ['work', 'skills'])
    assert.equal(kubernetes.matchedAs, undefined, 'an exact hit needs no alternative wording')
  })

  test('folds plurals, and says so via matchedAs', () => {
    const report = analyzeCoverage(RESUME, 'Microservices, Kubernetes, and Terraform.')
    const term = report.matched.find((t) => t.term === 'Microservices')

    assert.ok(term, `microservices should match "microservice"; missing: ${report.missing.map((m) => m.term)}`)
    assert.deepEqual(term.sections, ['work'])
    assert.equal(term.matchedAs, 'microservice')
  })

  test('matches a phrase only when the resume has it adjacent', () => {
    const present = analyzeCoverage(RESUME, 'Distributed systems at scale.')
    assert.ok(
      present.matched.some((t) => t.term.toLowerCase() === 'distributed systems'),
      'the resume says "distributed systems" verbatim'
    )

    // "Terraform" and "Go" are both in skills, but a comma separates them
    // there, so the pair is never adjacent. Said twice in the posting so the
    // bigram outlives dropRedundant and reaches the report on its own.
    const absent = analyzeCoverage(RESUME, 'Terraform Go tooling. Also Terraform Go pipelines.')
    assert.ok(
      absent.missing.some((t) => t.term === 'Terraform Go'),
      `adjacency is required; matched: ${absent.matched.map((m) => m.term)}`
    )
  })

  test('never matches against a section heading', () => {
    // renderText prints "SKILLS" over every skills block. sectionBodies excludes
    // headings precisely so a posting's "skills" cannot match a label the
    // applicant never wrote -- here proven with a heading override, since the
    // word itself is JD boilerplate.
    const blueprint = { ...RESUME, headings: { skills: 'Terraform' }, skills: [{ name: 'Cloud', keywords: ['AWS'] }] }
    const report = analyzeCoverage(blueprint, 'Terraform is required.')

    assert.ok(missing(report, 'Terraform'), 'the heading must not count as content')
  })

  test('coverage is the share of reported terms already present', () => {
    const report = analyzeCoverage(RESUME, 'Kubernetes and Rust.')

    assert.equal(report.matched.length + report.missing.length, 2)
    assert.equal(report.coverage, 0.5)
  })

  test('counts matches per section', () => {
    const report = analyzeCoverage(RESUME, 'Kubernetes and Terraform.')
    const skills = report.sections.find((s) => s.section === 'skills')

    assert.equal(skills?.matched, 2)
    assert.equal(report.sections.find((s) => s.section === 'projects')?.matched, 0)
  })
})

describe('analyzeCoverage — placement suggestions', () => {
  test('sends a credential to certificates and a degree to education', () => {
    const report = analyzeCoverage(RESUME, 'AWS Certified Developer certification. PhD preferred.')

    const credential = report.missing.find((t) => /certified/i.test(t.term))
    assert.equal(credential?.suggestions[0].section, 'certificates')
    assert.ok(credential?.suggestions[0].reason.length)

    const degree = report.missing.find((t) => /phd/i.test(t.term))
    assert.deepEqual(degree?.suggestions.map((s) => s.section), ['education'])
  })

  test('sends a single-token term to skills and a phrase to work', () => {
    const report = analyzeCoverage(RESUME, 'Rust required. Incident response is expected.')

    assert.equal(missing(report, 'Rust')?.suggestions[0].section, 'skills')
    assert.equal(missing(report, 'Incident response')?.suggestions[0].section, 'work')
  })

  test('suggests only sections the blueprint actually renders', () => {
    const trimmed = { ...RESUME, sections: ['profile', 'work'] }
    const report = analyzeCoverage(trimmed, 'AWS Certified Developer certification. Rust required.')

    for (const term of report.missing) {
      for (const suggestion of term.suggestions) {
        assert.ok(['profile', 'work'].includes(suggestion.section), `leaked ${suggestion.section}`)
      }
    }
    // Every suggestion for a credential named certificates or skills, and this
    // blueprint renders neither -- an empty list, not a wrong one.
    assert.deepEqual(report.missing.find((t) => /certified/i.test(t.term))?.suggestions, [])
  })
})

describe('analyzeCoverage — contract', () => {
  test('does not mutate the blueprint it was handed', () => {
    const before = structuredClone(RESUME)
    analyzeCoverage(RESUME, 'Kubernetes, Rust, and a PhD.')

    assert.deepEqual(RESUME, before)
  })

  test('throws a ZodError on an invalid blueprint, same as blueprintToText', () => {
    assert.throws(() => analyzeCoverage({ selectedTemplate: 'not-a-number' }, 'Rust.'))
  })

  test('reports an empty posting rather than throwing', () => {
    const report = analyzeCoverage(RESUME, '   \n\t ')

    assert.equal(report.coverage, 0)
    assert.deepEqual(report.matched, [])
    assert.deepEqual(report.missing, [])
    assert.match(report.notes.join('\n'), /yielded no terms/)
  })

  test('notes a blueprint that renders no text, and reports every term missing', () => {
    const report = analyzeCoverage({ sections: [] }, 'Rust and Kubernetes.')

    assert.match(report.notes.join('\n'), /renders no text/)
    assert.equal(report.coverage, 0)
    assert.ok(report.missing.length >= 2)
  })

  test('maxTerms caps the report and says how much was left out', () => {
    const jd = 'Rust, Elixir, Haskell, Scala, Kafka, Erlang, Clojure, Nim, Zig, Crystal.'
    const report = analyzeCoverage(RESUME, jd, { maxTerms: 3 })

    assert.equal(report.matched.length + report.missing.length, 3)
    assert.match(report.notes.join('\n'), /top 3 of \d+ terms/)
  })

  test('maxTerms is clamped, not rejected', () => {
    // Same reasoning as DocumentConfigSchema's numeric clamps: an agent tuning
    // output size should not get a validation failure it cannot interpret.
    const jd = 'Rust, Elixir, Haskell, Scala, Kafka.'
    assert.equal(analyzeCoverage(RESUME, jd, { maxTerms: 0 }).missing.length, 1)
    assert.equal(analyzeCoverage(RESUME, jd, { maxTerms: 10_000 }).missing.length, 5)
  })

  test('is deterministic across runs', () => {
    const jd = 'Kubernetes, Rust, distributed systems, Terraform, and incident response.'
    assert.deepEqual(analyzeCoverage(RESUME, jd), analyzeCoverage(RESUME, jd))
  })
})

describe('analyzeCoverage — no sanitization on this path', () => {
  test('LaTeX specials in the posting come back exactly as written', () => {
    // The counterpart to text.test.ts's injection case: this report reaches a
    // reader, not a TeX engine, so escapeLatex would corrupt what it shows.
    const report = analyzeCoverage(RESUME, 'Experience with R&D tooling and \\input{/etc/passwd} pipelines.')
    const found = terms(report).join(' ')

    assert.match(found, /R&D/)
    assert.doesNotMatch(found, /textbackslash/)
    assert.doesNotMatch(found, /\\&/)
  })

  test('the adversarial blueprint fixture is analyzed unescaped and unchanged', async () => {
    const raw = await readFile(resolve(FIXTURES, 'injection.json'), 'utf8')
    const injection = JSON.parse(raw)

    const report = analyzeCoverage(injection, 'We need \\textbf{leadership} and R&D depth.')

    assert.equal(JSON.stringify(injection), JSON.stringify(JSON.parse(raw)), 'fixture must not be mutated')
    assert.doesNotMatch(JSON.stringify(report), /textbackslash/)
  })
})
