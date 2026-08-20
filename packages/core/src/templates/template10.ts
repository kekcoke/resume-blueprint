import { stripIndent, source } from 'common-tags'
import { WHITESPACE } from './constants.js'
import { breakableUrl, profileLinks, joinContactInfo } from './profiles.js'
import { certificateLine, defaultCertificatesSection } from './certificates.js'
import { nfssFontPreamble } from './fonts.js'
import { FormValues, Generator, ResolvedDocumentConfig } from '../types.js'

/**
 * F7 — the Word-alike ATS preset. Plain `article`, no vendored class, and
 * deliberately none of the decorative choices that forced templates 1 and 4
 * above their literal margin (small-caps headers, negative-`\vspace`/
 * `\hspace` pulls under the header rule — see C4 in docs/next-features.md):
 * the declared `geometry` margin here is the real text box, not an
 * approximation of it.
 *
 * What actually makes this "Word-alike" is `TEMPLATE_DEFAULTS[10]`
 * (documentConfig.ts) — Calibri, 11pt, 0.75in margins, 1.15 line spacing,
 * one horizontal contact row — the external feedback's universal rules
 * shipped as this template's defaults rather than options an agent has to
 * know to ask for.
 */
const generator: Generator = {
  profileSection(basics, config) {
    if (!basics) {
      return ''
    }

    const { name, label, summary, email, phone, location, website, profiles } =
      basics
    const address = location?.address || ''
    const websiteLine = website ? `\\href{${website}}{${breakableUrl(website)}}` : ''

    const lines = [
      name ? `{\\Large \\bfseries ${name}}` : '',
      label || '',
      joinContactInfo(
        [address, email, phone, websiteLine, ...profileLinks(profiles)],
        config.contactLayout,
        ' | '
      )
    ].filter(Boolean)

    const header = lines.join('\\\\\n  ')

    const summaryBlock = summary
      ? stripIndent`
          \\vspace{4pt}
          ${summary}
        `
      : ''

    return stripIndent`
      %==== Profile ====%
      \\begin{center}
        ${header}
      \\end{center}
      ${summaryBlock}
    `
  },

  educationSection(education, heading) {
    if (!education) {
      return ''
    }

    return source`
      %==== Education ====%
      \\header{${heading || 'Education'}}
      ${education.map((school) => {
        const {
          institution,
          location,
          studyType,
          area,
          score,
          startDate,
          endDate
        } = school

        let line1 = ''
        let line2 = ''

        if (institution) {
          line1 += `\\textbf{${institution}}`
        }

        if (location) {
          line1 += `\\hfill ${location}`
        }

        if (studyType) {
          line2 += studyType
        }

        if (area) {
          line2 += studyType ? ` ${area}` : `Degree in ${area}`
        }

        if (score) {
          line2 += ` \\textit{GPA: ${score}}`
        }

        if (startDate || endDate) {
          const gradLine = `${startDate || ''} - ${endDate || ''}`
          line2 += line2 ? ` \\hfill ${gradLine}` : gradLine
        }

        if (line1) {
          line1 += '\\\\'
        }

        if (line2) {
          line2 += '\\\\'
        }

        return stripIndent`
          ${line1}
          ${line2.trim()}
          \\vspace{2mm}
        `
      })}
    `
  },

  workSection(work, heading, config) {
    if (!work) {
      return ''
    }

    return source`
      %==== Experience ====%
      \\header{${heading || 'Experience'}}

      ${work.map((job) => {
        const { name, position, location, startDate, endDate, summary, highlights } =
          job

        let line1 = ''
        let line2 = ''
        let summaryLine = ''
        let highlightLines = ''

        if (name) {
          line1 += `\\textbf{${name}}`
        }

        if (location) {
          line1 += ` \\hfill ${location}`
        }

        if (position) {
          line2 += `\\textit{${position}}`
        }

        if (startDate && endDate) {
          line2 += ` \\hfill ${startDate} - ${endDate}`
        } else if (startDate) {
          line2 += ` \\hfill ${startDate} - Present`
        } else if (endDate) {
          line2 += ` \\hfill ${endDate}`
        }

        if (line1) line1 += '\\\\'
        if (line2) line2 += '\\\\'

        if (summary) {
          summaryLine = `${summary}\\\\`
        }

        if (highlights?.length) {
          highlightLines = source`
              \\begin{itemize} \\itemsep ${config.bulletSpacing}pt
                ${highlights.map((highlight) => `\\item ${highlight}`)}
              \\end{itemize}
            `
        }

        return stripIndent`
          ${line1}
          ${line2}
          ${summaryLine}
          ${highlightLines}
        `
      })}
    `
  },

  skillsSection(skills, heading) {
    if (!skills) {
      return ''
    }

    // One row per category, category and keywords in the same run of text —
    // matches every other template's F5-converted single-column shape.
    return source`
      \\header{${heading || 'Skills'}}
      ${skills.map((skill) => {
        const { name = 'Misc', keywords = [] } = skill
        return `\\textbf{${name}:} ${keywords.join(', ')} \\\\`
      })}
      \\vspace{2mm}
    `
  },

  projectsSection(projects, heading) {
    if (!projects) {
      return ''
    }

    return source`
      \\header{${heading || 'Projects'}}
      ${projects.map((project) => {
        if (Object.keys(project).length === 0) {
          return ''
        }

        const { name, description, keywords, url } = project

        let line1 = ''
        let line2 = description || ''

        if (name) {
          line1 += `{\\textbf{${name}}}`
        }

        if (keywords) {
          line1 += ` {\\sl ${keywords.join(', ')}} `
        }

        if (url) {
          line1 += `\\hfill \\href{${url}}{${url}}`
        }

        if (line1) {
          line1 += '\\\\'
        }

        if (line2) {
          line2 += '\\\\'
        }

        return stripIndent`
          ${line1}
          ${line2}
          \\vspace*{2mm}
        `
      })}
    `
  },

  awardsSection(awards, heading) {
    if (!awards) {
      return ''
    }

    return source`
      \\header{${heading || 'Awards'}}
      ${awards.map((award) => {
        const { title, summary, date, awarder } = award

        let line1 = ''
        let line2 = summary || ''

        if (title) {
          line1 += `\\textbf{${title}}`
        }

        if (awarder) {
          line1 += ` \\hfill ${awarder}`
        }

        if (date) {
          line2 += ` \\hfill ${date}`
        }

        if (line1) line1 += '\\\\'
        if (line2) line2 += '\\\\'

        return stripIndent`
          ${line1}
          ${line2}
          \\vspace*{2mm}
        `
      })}
    `
  },

  certificatesSection(certificates, heading) {
    if (!certificates) {
      return ''
    }

    return source`
      \\header{${heading || 'Certificates'}}
      ${certificates.map((cert) => {
        const line = certificateLine(cert)
        return line ? `${line}\\\\` : ''
      })}
    `
  },

  resumeHeader(config) {
    // No `\hspace*{-Npt}` pull and no small-caps — a plain bold heading with
    // a full-width rule under it, the Word "Heading 2 with bottom border"
    // look, sitting entirely inside the declared margin.
    return stripIndent`
      \\newcommand{\\header} [1] {
          \\vspace{${config.sectionSpacing}pt}
          \\noindent{\\large \\bfseries #1}\\\\
          \\noindent\\hrulefill\\\\
      }
    `
  }
}

function template10(values: FormValues, config: ResolvedDocumentConfig) {
  const { headings } = values

  // TEMPLATE_DEFAULTS[10] is {fontFamily: 'calibri', fontSize: 11, paper:
  // 'letter', margin: '0.75in', lineSpacing: 1.15, contactLayout: 'row'} —
  // resolved once by getTemplateData and threaded through everything below.
  const paperOption = config.paper === 'a4' ? 'a4paper' : 'letterpaper'
  const sizeOption = config.fontSize === 10 ? '' : `,${config.fontSize}pt`
  const classLine = `\\documentclass[${paperOption}${sizeOption}]{article}`

  const geometryLine = `\\usepackage[margin=${config.margin}]{geometry}`

  const extraLines = [
    // GLOBAL_DEFAULTS.lineSpacing is 1.0; TEMPLATE_DEFAULTS[10].lineSpacing
    // is 1.15, so this line is emitted whenever `document.lineSpacing` is
    // left unset — the external feedback's "1.0-1.15" ask, as a default.
    config.lineSpacing !== 1.0 ? `\\linespread{${config.lineSpacing}}\\selectfont` : '',
    config.linkStyle === 'colored' ? '\\hypersetup{colorlinks=true,allcolors=blue}' : '',
    // fontFamily defaults to 'calibri' here (unlike every other template,
    // where it defaults to 'template'), so this line is not merely reachable
    // but emitted by default: \usepackage[lining]{carlito} +
    // \renewcommand{\familydefault}{\sfdefault}. Every section above builds
    // its text from \textbf/\textit/\bfseries, never a literal \fontspec/
    // \newfontfamily call, so the override actually takes.
    nfssFontPreamble(10, config)
  ]
    .filter(Boolean)
    .join('\n')

  return stripIndent`
    ${classLine}
    \\usepackage{amsmath}
    \\usepackage{amssymb}
    \\usepackage{textcomp}
    \\usepackage[utf8]{inputenc}
    \\usepackage[T1]{fontenc}
    \\pagestyle{empty}
    \\raggedright
    ${geometryLine}
    ${['\\usepackage[hidelinks]{hyperref}', extraLines].filter(Boolean).join('\n')}
    ${generator.resumeHeader(config)}

    \\begin{document}

    ${values.sections
      .map((section) => {
        switch (section) {
          case 'profile':
            return generator.profileSection(values.basics, config)

          case 'education':
            return generator.educationSection(
              values.education,
              headings.education,
              config
            )

          case 'work':
            return generator.workSection(values.work, headings.work, config)

          case 'skills':
            return generator.skillsSection(values.skills, headings.skills, config)

          case 'projects':
            return generator.projectsSection(values.projects, headings.projects, config)

          case 'awards':
            return generator.awardsSection(values.awards, headings.awards, config)

          case 'certificates':
            return (
              generator.certificatesSection?.(
                values.certificates,
                headings.certificates,
                config
              ) ?? defaultCertificatesSection(values.certificates, headings.certificates, config)
            )

          default:
            return ''
        }
      })
      .join('\n\n')}

    ${WHITESPACE}
    \\end{document}
  `
}

export default template10
