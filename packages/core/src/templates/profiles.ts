import type { Basics } from '../types.js'

/**
 * Renders `basics.profiles` into the contact run as linked, readable text.
 *
 * The visible text is the URL with its scheme stripped, not the network name.
 * `\href{https://linkedin.com/in/x}{LinkedIn}` looks tidy and is useless: a
 * parser reads the text layer, not the link annotation, so the address reaches
 * neither an ATS nor a printed copy. Showing the address puts it in both.
 *
 * The network name is prefixed only when the host does not already say it, so a
 * LinkedIn URL does not read "LinkedIn: linkedin.com/in/x".
 *
 * Values arrive sanitized: `url` has been through `sanitizeUrl` (unsafe
 * protocols already rejected, LaTeX specials escaped), `network` and `username`
 * through `escapeLatex`. Nothing here re-escapes or unescapes.
 */
/**
 * Marks the separators in a URL as line-break opportunities.
 *
 * TeX treats a URL as one unbreakable word, so a long one sets straight past the
 * right margin and its tail is simply gone from the page. This is only ever
 * applied to the visible text — never to the \href target, which must stay
 * byte-for-byte what sanitizeUrl produced.
 */
export function breakableUrl(text: string): string {
  // The scheme is left alone: breaking "https://" across a line is legible to
  // nothing and looks like a typo.
  const scheme = text.match(/^[a-z][a-z0-9+.-]*:\/\//i)?.[0] ?? ''

  return (
    scheme + text.slice(scheme.length).replace(/([/\-.?=&])/g, '$1\\allowbreak{}')
  )
}

export function profileLinks(profiles: Basics['profiles'] = []): string[] {
  return profiles.flatMap(({ network, username, url }) => {
    if (!url) {
      // sanitizeUrl drops anything it cannot vouch for, so a profile can reach
      // here with a network and username and no link. Emitting the text keeps
      // it from vanishing the way basics.profiles did before this existed.
      const text = [network, username].filter(Boolean).join(': ')
      return text ? [text] : []
    }

    const shown = url.replace(/^(?:https?:\/\/|mailto:)/i, '').replace(/\/$/, '')
    const host = shown.split('/')[0]
    const key = alphanumeric(network)

    const label = key && !alphanumeric(host).includes(key) ? `${network}: ` : ''

    return [`\\href{${url}}{${label}${breakableUrl(shown)}}`]
  })
}

function alphanumeric(text?: string): string {
  return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}
