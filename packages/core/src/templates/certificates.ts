import type { Certificate, ResolvedDocumentConfig } from '../types.js'

/**
 * "Name | Issuer (Date) | URL" — the flat single-line record shape F6 exists
 * to produce. Shared by every template's own certificatesSection and the
 * fallback below, so the extracted text is identical in shape across all
 * nine. The URL renders as visible text (matching projectsSection's
 * `\href{url}{url}` idiom in every template) rather than hiding behind
 * `name`, so it stays in the plain-text extraction layer.
 */
export function certificateLine({
  name,
  issuer,
  date,
  url
}: Certificate): string {
  const meta = [issuer, date ? `(${date})` : ''].filter(Boolean).join(' ')
  const link = url ? `\\href{${url}}{${url}}` : ''
  return [name, meta, link].filter(Boolean).join(' | ')
}

/**
 * Used only when a Generator omits certificatesSection — never by any of the
 * nine templates here (all nine implement it), only by a future template
 * that forgets to. Bare LaTeX only (\section*, itemize), no template-specific
 * macro, so it's maximally likely to compile under a class this code has
 * never seen.
 */
export function defaultCertificatesSection(
  certificates: Array<Certificate> | undefined,
  heading: string | undefined,
  config: ResolvedDocumentConfig
): string {
  if (!certificates?.length) return ''
  const items = certificates.map(certificateLine).filter(Boolean)
  if (!items.length) return ''

  return [
    `\\vspace{${config.sectionSpacing}pt}`,
    `\\section*{${heading || 'Certificates'}}`,
    '\\begin{itemize}',
    `\\setlength\\itemsep{${config.bulletSpacing}pt}`,
    ...items.map((line) => `\\item ${line}`),
    '\\end{itemize}'
  ].join('\n')
}
