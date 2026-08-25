import { stripIndent, source } from 'common-tags'
import { WHITESPACE } from './constants.js'
import { breakableUrl, profileLinks, joinContactInfo } from './profiles.js'
import { certificateLine, defaultCertificatesSection } from './certificates.js'
import { nfssFontPreamble } from './fonts.js'
import type {
  FormValues,
  GeneratorWithSummary,
  ResolvedDocumentConfig
} from '../types.js'

const generator: GeneratorWithSummary = {
  profileSection(basics) {
    if (!basics) {
      return ''
    }

    const { name } = basics

    // Only the name goes in the header. res.cls typesets each \address in an
    // \hbox that does not wrap and accepts at most two of them, which is not
    // enough for an email, a phone, a location, a site, and a couple of profile
    // links — the tail crossed the right margin and vanished. Everything else
    // moves to summarySection, which renders in the body where text wraps.
    return stripIndent`
      \\name{{\\LARGE ${name || ''}}}
    `
  },

  // Name / title / contacts / summary, in that order: it is the order a reader
  // and a parser both expect, and it keeps the contact details adjacent to the
  // name rather than stranded at the bottom of the header.
  summarySection(basics, config) {
    if (!basics) {
      return ''
    }

    const {
      label,
      summary,
      email,
      phone,
      location = {},
      website,
      profiles
    } = basics
    const websiteLine = website
      ? `\\href{${website}}{${breakableUrl(website)}}`
      : ''

    const contacts = joinContactInfo(
      [email, phone, location.address, websiteLine, ...profileLinks(profiles)],
      config.contactLayout,
      ' | '
    )

    if (!label && !summary && !contacts) {
      return ''
    }

    return stripIndent`
      ${label ? `{\\large \\sl ${label}}\\\\[2pt]` : ''}
      ${contacts ? `${contacts}\\\\[2pt]` : ''}
      ${summary || ''}
      \\vspace{2mm}
    `
  },

  educationSection(education, heading, config) {
    if (!education) {
      return ''
    }

    const lastSchoolIndex = education.length - 1

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'EDUCATION'}}
      ${education.map((school, i) => {
        const {
          institution,
          location,
          studyType = '',
          area = '',
          score,
          startDate,
          endDate = ''
        } = school

        let schoolLine = ''
        let degreeLine = ''

        if (institution) {
          schoolLine += `\\textbf{${institution}}, `
        }

        if (studyType && area) {
          degreeLine = `${studyType} in ${area}`
        } else if (studyType || area) {
          degreeLine = studyType || area
        }

        if (degreeLine) {
          schoolLine += `{\\sl ${degreeLine}} `
        }

        if (score) {
          schoolLine += `GPA: ${score}`
        }

        let dateRange = ''

        if (startDate && endDate) {
          dateRange = `${startDate} | ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} | Present`
        } else {
          dateRange = endDate
        }

        if (dateRange) {
          schoolLine += `\\hfill ${dateRange}`
        }

        if (schoolLine) {
          schoolLine += '\\\\'
        }

        if (location) {
          schoolLine += `${location}`
        }

        if (i !== lastSchoolIndex) {
          schoolLine += '\\\\\\\\'
        }

        return schoolLine
      })}
    `
  },

  workSection(work, heading, config) {
    if (!work) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'EXPERIENCE'}}
      ${work.map((job) => {
        const {
          name,
          position,
          location,
          startDate,
          endDate = '',
          summary,
          highlights
        } = job

        let jobLine = ''
        let dateRange = ''

        if (name) {
          jobLine += `\\textbf{${name}}, `
        }

        if (position) {
          jobLine += `{\\sl ${position}}`
        }

        if (startDate && endDate) {
          dateRange = `${startDate} | ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} | Present`
        } else {
          dateRange = endDate
        }

        if (dateRange) {
          jobLine += `\\hfill ${dateRange}`
        }

        if (jobLine) {
          jobLine += '\\\\'
        }

        if (location) {
          jobLine += `${location}\\\\`
        }

        if (summary) {
          jobLine += `${summary}\\\\`
        }

        if (highlights?.length) {
          jobLine += source`
            \\begin{itemize} \\itemsep ${config.bulletSpacing}pt
            ${highlights.map((highlight) => `\\item ${highlight}`)}
            \\end{itemize}
          `
        }

        return jobLine
      })}
    `
  },

  skillsSection(skills, heading, config) {
    if (!skills) {
      return ''
    }

    // One row per category, category and keywords in the same run of text —
    // the previous two-column `tabular` put the label and its values in
    // separate cells, which a parser reads as two unrelated fragments (F5).
    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'SKILLS'}}
      ${skills.map((skill) => {
        const { name, keywords = [] } = skill
        return `\\textbf{${name || ''}}: ${keywords.join(', ') || ''}\\\\`
      })}
    `
  },

  projectsSection(projects, heading, config) {
    if (!projects) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'PROJECTS'}}
      ${projects.map((project) => {
        const { name, description, keywords = [], url } = project

        let projectLine = ''

        if (name) {
          projectLine += `\\textbf{${name}}`
        }

        if (keywords) {
          projectLine += `, {\\sl ${keywords.join(', ')}}`
        }

        if (description) {
          projectLine += projectLine ? `\\\\ ${description}` : description
        }

        if (url) {
          const urlLine = url ? `\\href{${url}}{${url}}` : ''
          projectLine += projectLine ? `\\\\ ${urlLine}` : urlLine
        }

        if (projectLine) {
          projectLine += '\\\\\\\\'
        }

        return projectLine
      })}
    `
  },

  awardsSection(awards, heading, config) {
    if (!awards) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'AWARDS'}}
      ${awards.map((award) => {
        const { title, summary, date, awarder } = award

        return stripIndent`
            \\textbf{${title || ''}}, {\\sl ${awarder || ''}} \\hfill ${
              date || ''
            } \\\\
            ${summary || ''} \\\\\\\\
        `
      })}
    `
  },

  certificatesSection(certificates, heading, config) {
    if (!certificates) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'CERTIFICATES'}}
      ${certificates.map((cert) => {
        const line = certificateLine(cert)
        return line ? `${line} \\\\\\\\` : ''
      })}
    `
  },

  // res.cls's `[line,margin]` class options are semantic flags (margin
  // notes for dates/locations), not lengths — nothing here touches them.
  // Page margin and paper size are unknown-native (res.cls owns its own
  // layout) and are wired additively in the outer `template5()` function
  // instead, where the raw `document` input is available to gate on.
  resumeHeader(config) {
    return [
      config.lineSpacing !== 1.0
        ? `\\linespread{${config.lineSpacing}}\\selectfont`
        : '',
      config.linkStyle === 'colored'
        ? '\\hypersetup{colorlinks=true,allcolors=blue}'
        : '',
      nfssFontPreamble(5, config)
    ]
      .filter(Boolean)
      .join('\n')
  }
}

function template5(values: FormValues, config: ResolvedDocumentConfig) {
  const { headings = {} } = values

  // Additive-only, and gated on the raw sparse `document` input rather than
  // the resolved `config`: res.cls's own default margin/paper are unknown,
  // so only an explicit caller override should ever add a line here.
  // `\usepackage{geometry}` (no options) plus `\geometry{...}` rather than a
  // second options-bearing `\usepackage[...]{geometry}` — see template4's
  // comment: a vendored class that already loads geometry internally turns
  // the latter into a hard "Option clash" error.
  const geometryOptions = [
    values.document.paper !== undefined
      ? config.paper === 'a4'
        ? 'a4paper'
        : 'letterpaper'
      : '',
    values.document.margin !== undefined ? `margin=${config.margin}` : ''
  ].filter(Boolean)
  const geometryLines = geometryOptions.length
    ? ['\\usepackage{geometry}', `\\geometry{${geometryOptions.join(',')}}`]
    : []
  // Combined with the fixed hyperref line via filter(Boolean), not appended
  // on its own line: the original has no blank line before \begin{document},
  // and an empty addition on its own line would insert one.
  const preambleTail = [
    '\\usepackage[hidelinks]{hyperref}',
    ...geometryLines,
    generator.resumeHeader(config)
  ]
    .filter(Boolean)
    .join('\n')

  return stripIndent`
    \\documentclass[line,margin]{res}
    \\usepackage[none]{hyphenat}
    \\usepackage{textcomp}
    \\usepackage[utf8]{inputenc}
    \\usepackage[T1]{fontenc}
    ${preambleTail}
    \\begin{document}
      ${generator.profileSection(values.basics, config)}
      \\begin{resume}
        \\vspace{-5mm}
        ${generator.summarySection(values.basics, config)}
        ${values.sections
          .map((section) => {
            switch (section) {
              case 'education':
                return generator.educationSection(
                  values.education,
                  headings.education,
                  config
                )

              case 'work':
                return generator.workSection(values.work, headings.work, config)

              case 'skills':
                return generator.skillsSection(
                  values.skills,
                  headings.skills,
                  config
                )

              case 'projects':
                return generator.projectsSection(
                  values.projects,
                  headings.projects,
                  config
                )

              case 'awards':
                return generator.awardsSection(
                  values.awards,
                  headings.awards,
                  config
                )

              case 'certificates':
                return (
                  generator.certificatesSection?.(
                    values.certificates,
                    headings.certificates,
                    config
                  ) ??
                  defaultCertificatesSection(
                    values.certificates,
                    headings.certificates,
                    config
                  )
                )

              default:
                return ''
            }
          })
          .join('\n')}
        ${WHITESPACE}
      \\end{resume}
    \\end{document}
  `
}

export default template5
