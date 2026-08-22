/**
 * PASS/FAIL/SKIP reporter for the QA harness.
 *
 * Every result carries the contract id it proves (C1..C23 in qa/contract.md),
 * so a red run names the row that broke rather than a file that failed. The
 * matrix summary at the end is the artifact a human actually reads.
 */

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code, text) => (useColor ? `${code}${text}${RESET}` : text)

export class Report {
  constructor() {
    /** @type {{id: string, suite: string, status: 'PASS'|'FAIL'|'SKIP', label: string, detail?: string}[]} */
    this.results = []
    this.started = Date.now()
  }

  #record(status, suite, id, label, detail) {
    this.results.push({ id, suite, status, label, detail })
    const tag =
      status === 'PASS' ? paint(GREEN, 'PASS') : status === 'FAIL' ? paint(RED, 'FAIL') : paint(YELLOW, 'SKIP')
    process.stdout.write(`  ${tag}  ${paint(DIM, id.padEnd(5))} ${label}\n`)
    if (detail && status !== 'PASS') {
      for (const line of String(detail).trimEnd().split('\n')) {
        process.stdout.write(`        ${paint(DIM, line)}\n`)
      }
    }
  }

  pass(suite, id, label) {
    this.#record('PASS', suite, id, label)
  }

  fail(suite, id, label, detail) {
    this.#record('FAIL', suite, id, label, detail)
  }

  skip(suite, id, label, reason) {
    this.#record('SKIP', suite, id, label, reason)
  }

  get failed() {
    return this.results.filter((r) => r.status === 'FAIL')
  }

  get skipped() {
    return this.results.filter((r) => r.status === 'SKIP')
  }

  /**
   * Prints the coverage matrix — one row per contract id, one column per
   * suite — then the tally. Returns the process exit code: non-zero if
   * anything failed. A SKIP is not a failure (a missing optional binary is
   * an environment fact, not a regression), but it is always reported.
   */
  summary() {
    const suites = [...new Set(this.results.map((r) => r.suite))]
    const ids = [...new Set(this.results.map((r) => r.id))].sort(byContractId)

    process.stdout.write(`\n${'-'.repeat(60)}\ncontract coverage\n\n`)
    const head = ['row  ', ...suites.map((s) => s.padEnd(9))].join(' ')
    process.stdout.write(`${paint(DIM, head)}\n`)

    for (const id of ids) {
      const cells = suites.map((suite) => {
        const hits = this.results.filter((r) => r.id === id && r.suite === suite)
        if (!hits.length) return '-'.padEnd(9)
        if (hits.some((h) => h.status === 'FAIL')) return paintCell(RED, 'FAIL', hits.length)
        if (hits.every((h) => h.status === 'SKIP')) return paintCell(YELLOW, 'skip', hits.length)
        return paintCell(GREEN, 'ok', hits.length)
      })
      process.stdout.write(`${id.padEnd(5)} ${cells.join(' ')}\n`)
    }

    const seconds = ((Date.now() - this.started) / 1000).toFixed(1)
    const passed = this.results.filter((r) => r.status === 'PASS').length
    process.stdout.write(
      `\n${passed} passed, ${this.failed.length} failed, ${this.skipped.length} skipped  (${seconds}s)\n`
    )

    if (this.failed.length) {
      process.stdout.write(`\n${paint(RED, 'failing contract rows:')}\n`)
      for (const f of this.failed) {
        process.stdout.write(`  ${f.id} [${f.suite}] ${f.label}\n`)
      }
      process.stdout.write('\nEach row is either a real regression or a contract row that has gone\n')
      process.stdout.write('stale. Decide which, and say so — do not edit qa/contract.md to go green.\n')
    }

    return this.failed.length ? 1 : 0
  }
}

function paintCell(color, word, count) {
  const text = count > 1 ? `${word}x${count}` : word
  return paint(color, text.padEnd(9))
}

/** C2 before C10: contract ids sort numerically, not lexically. */
function byContractId(a, b) {
  const na = Number(a.replace(/\D/g, ''))
  const nb = Number(b.replace(/\D/g, ''))
  return na - nb || a.localeCompare(b)
}
