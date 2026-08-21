import { inflateSync } from 'node:zlib'

/**
 * Counts pages in a PDF.
 *
 * Tectonic writes the page tree into compressed object streams, so the markers
 * are not visible in the raw bytes — every `stream`/`endstream` block has to be
 * inflated before `/Type /Page` can be counted.
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
