import { stripIndent, source } from 'common-tags'
import { WHITESPACE } from './constants.js'
import { breakableUrl, profileLinks, joinContactInfo } from './profiles.js'
import { certificateLine, defaultCertificatesSection } from './certificates.js'
import { isFontSupported, georgiaFileBasename } from './fonts.js'
import type { FormValues, Generator, ResolvedDocumentConfig } from '../types.js'

const generator: Generator = {
  profileSection(profile, config) {
    if (!profile) {
      return '\\namesection{Your}{Name}{}'
    }

    const { name, label, summary, email, phone, location = {}, website, profiles } =
      profile

    let nameStart = ''
    let nameEnd = ''

    if (name) {
      const names = name.split(' ')

      if (names.length === 1) {
        nameStart = names[0]
        nameEnd = ''
      } else {
        nameStart = names[0]
        nameEnd = names.slice(1, names.length).join(' ')
      }
    }

    const websiteLine = website ? breakableUrl(website) : ''
    const info = joinContactInfo(
      [email, phone, location.address, websiteLine, ...profileLinks(profiles)],
      config.contactLayout,
      ' | '
    )

    // \namesection's third argument is a centered group, so a `\\` inside it
    // puts the job title on its own line above the contact run.
    const headerInfo = label ? `${label} \\\\ ${info}` : info

    const summaryBlock = summary
      ? `\n\\vspace{-8pt}\n{\\raggedright ${summary}\\par}\n\\sectionsep`
      : ''

    const sectionHeader = stripIndent`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      %
      %     Profile
      %
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    `

    if (!name) {
      return stripIndent`
        ${sectionHeader}
        \\centering{
          \\color{headings}
          \\fontspec[Path = fonts/]{\\rbmedium}
          \\fontsize{11pt}{14pt}
          \\selectfont ${info}
        }
      `
    }

    return stripIndent`
      ${sectionHeader}
      \\namesection{${nameStart}}{${nameEnd}}{${headerInfo}}
      ${summaryBlock}
    `
  },

  educationSection(education, heading, config) {
    if (!education) {
      return ''
    }

    return source`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      %
      %     Education
      %
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'Education'}}
      \\raggedright
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
          line1 += `\\runsubsection{${institution}}`
        }

        if (studyType && area) {
          line1 += `\\descript{| ${studyType} ${area}}`
        } else if (studyType) {
          line1 += `\\descript{| ${studyType}}`
        } else if (area) {
          line1 += `\\descript{| ${area}}`
        }

        let dateRange

        if (startDate && endDate) {
          dateRange = `${startDate} - ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} - Present`
        } else {
          dateRange = endDate
        }

        const locationAndDate = [location, dateRange]
          .filter(Boolean)
          .join(' | ')

        if (locationAndDate) {
          line1 += `\\hfill \\location{${locationAndDate}}`
        }

        if (line1) {
          line1 += '\\\\'
        }

        if (score) {
          line2 += `GPA: ${score}\\\\`
        }

        return `
          ${line1}
          ${line2}
          \\sectionsep
        `
      })}
    `
  },

  workSection(work, heading, config) {
    if (!work) {
      return ''
    }

    return source`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      %
      %     Experience
      %
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'Experience'}}
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

        let line1 = ''
        let dateRange = ''
        let highlightLines = ''

        if (name) {
          line1 += `\\runsubsection{${name}}`
        }

        if (position) {
          line1 += `\\descript{| ${position}}`
        }

        if (startDate && endDate) {
          dateRange = `${startDate} – ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} – Present`
        } else {
          dateRange = endDate
        }

        if (location && dateRange) {
          line1 += `\\hfill \\location{${location} | ${dateRange}}`
        } else if (location) {
          line1 += `\\hfill \\location{${location}}`
        } else if (dateRange) {
          line1 += `\\hfill \\location{${dateRange}}`
        }

        if (highlights?.length) {
          highlightLines = source`
            \\begin{tightemize}
              \\setlength\\itemsep{${config.bulletSpacing}pt}
              ${highlights.map((highlight) => `\\item ${highlight}`)}
            \\end{tightemize}
            `
        }

        return stripIndent`
          ${line1}
          ${summary ? `\\par ${summary}` : ''}
          ${highlightLines}
          \\sectionsep
        `
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
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      %
      %     Skills
      %
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'Skills'}}
      \\raggedright
      ${skills.map((skill) => {
        const { name = '', keywords = [] } = skill
        return `\\descript{${name}:} {\\location{${keywords.join(', ')}}} \\\\`
      })}
      \\sectionsep
    `
  },

  projectsSection(projects, heading, config) {
    if (!projects) {
      return ''
    }

    return source`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      %
      %     Projects
      %
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'Projects'}}
      \\raggedright
      ${projects.map((project) => {
        const { name, description, keywords, url } = project

        let line1 = ''
        let line2 = ''
        let line3 = ''

        if (name) {
          line1 += `\\runsubsection{\\large{${name}}}`
        }

        if (keywords) {
          line2 += `\\descript{| ${keywords.join(', ')}}`
        }

        if (url) {
          line2 += `\\hfill \\location{${url}}`
        }

        if (line2) {
          line2 += '\\\\'
        }

        if (description) {
          line3 += `${description}\\\\`
        }

        return `
          ${line1}
          ${line2}
          ${line3}
          \\sectionsep
        `
      })}
    `
  },

  awardsSection(awards, heading, config) {
    if (!awards) {
      return ''
    }

    return source`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      %
      %     Awards
      %
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'Awards'}}
      ${awards.map((award) => {
        const { title, summary, date, awarder } = award
        const info = [awarder, date].filter(Boolean).join(' | ')

        return stripIndent`
          \\runsubsection{\\large{${title || ''}}} \\descript{${info}} \\\\
          ${summary ? `${summary}\\\\` : ''}
          \\sectionsep
        `
      })}
    `
  },

  certificatesSection(certificates, heading, config) {
    if (!certificates) {
      return ''
    }

    return source`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      %
      %     Certificates
      %
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      \\vspace{${config.sectionSpacing}pt}
      \\section{${heading || 'Certificates'}}
      ${certificates.map((cert) => {
        const line = certificateLine(cert)
        return line ? `${line}\\\\` : ''
      })}
    `
  },

  resumeHeader() {
    return stripIndent`
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      % This is a modified ONE COLUMN version of
      % the following template:
      %
      % Deedy - One Page Two Column Resume
      % LaTeX Template
      % Version 1.1 (30/4/2014)
      %
      % Original author:
      % Debarghya Das (http://debarghyadas.com)
      %
      % Original repository:
      % https://github.com/deedydas/Deedy-Resume
      %
      % IMPORTANT: THIS TEMPLATE NEEDS TO BE COMPILED WITH XeLaTeX
      %
      % This template uses several fonts not included with Windows/Linux by
      % default. If you get compilation errors saying a font is missing, find the line
      % on which the font is used and either change it to a font included with your
      % operating system or comment the line out to use the default font.
      %
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      %
      % TODO:
      % 1. Integrate biber/bibtex for article citation under publications.
      % 2. Figure out a smoother way for the document to flow onto the next page.
      % 3. Add styling information for a "Projects/Hacks" section.
      % 4. Add location/address information
      % 5. Merge OpenFont and MacFonts as a single sty with options.
      %
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      %
      % CHANGELOG:
      % v1.1:
      % 1. Fixed several compilation bugs with \\renewcommand
      % 2. Got Open-source fonts (Windows/Linux support)
      % 3. Added Last Updated
      % 4. Move Title styling into .sty
      % 5. Commented .sty file.
      %
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      %
      % Known Issues:
      % 1. Overflows onto second page if any column's contents are more than the
      % vertical limit
      % 2. Hacky space on the first bullet point on the second column.
      %
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
    `
  }
}

function template4(values: FormValues, config: ResolvedDocumentConfig) {
  const { headings = {} } = values

  // resumeHeader() is pure `%` comments here — nothing about relocating it
  // is a LaTeX hazard on its own — but the config-driven lines below it
  // (\usepackage, \linespread, \hypersetup) are not comments, and those are
  // real code that must follow \documentclass. Moving the whole call is
  // what keeps this preamble in one readable block instead of splitting
  // "header" across two positions; see C4/Step 3 in the F3 plan for why
  // this template's golden output is expected to move either way.
  //
  // Always-on, not gated: TEMPLATE_DEFAULTS[4].margin ('1.05in') is C4's
  // fix for a margin the F2 harness measured under the 0.5in floor.
  // deedy-resume-openfont.cls turns out to load `geometry` itself (confirmed
  // by compiling this template: a second `\usepackage[margin=...]{geometry}`
  // is a hard "Option clash" error under Tectonic) — so this reconfigures
  // through `\geometry{...}` instead, which is safe regardless of whether
  // the class already loaded the package, plus a bare `\usepackage{geometry}`
  // first for the case where it did not.
  // deedy-resume-openfont.cls hardcodes its font names as literal strings
  // inside ~10 macro bodies, not through \rmfamily/\sffamily — F4 replaced
  // each with one of three indirection macros (\rbextralight/\rbregular/
  // \rbmedium, defined in the .cls) that a \renewcommand* here can retarget
  // in one place. Each macro holds a bare font-file name, referenced inside
  // an already-bracketed `\fontspec[Path=fonts/]{...}` call at every use
  // site, so the override is a plain brace body (georgiaFileBasename), not
  // georgiaFontspecTarget's bracket-plus-brace form — that would corrupt
  // \renewcommand's own [n] optional-argument syntax. Only `georgia` is
  // achievable (isFontSupported gates the other four — see fonts.ts finding
  // 4); \rbmedium maps to Gelasio's bold file to keep some of the visual
  // weight contrast the ExtraLight/Regular/Medium naming implied.
  const fontLines =
    config.fontFamily !== 'template' && isFontSupported(4, config.fontFamily)
      ? [
          `\\renewcommand*{\\rbextralight}{${georgiaFileBasename('regular')}}`,
          `\\renewcommand*{\\rbregular}{${georgiaFileBasename('regular')}}`,
          `\\renewcommand*{\\rbmedium}{${georgiaFileBasename('bold')}}`
        ].join('\n')
      : ''

  const extraLines = [
    '\\usepackage{geometry}',
    `\\geometry{margin=${config.margin}}`,
    config.lineSpacing !== 1.0 ? `\\linespread{${config.lineSpacing}}\\selectfont` : '',
    config.linkStyle === 'colored' ? '\\hypersetup{colorlinks=true,allcolors=blue}' : '',
    fontLines
  ]
    .filter(Boolean)
    .join('\n')

  return stripIndent`
    \\documentclass[]{deedy-resume-openfont}
    ${extraLines}

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
      .join('\n')}
    ${WHITESPACE}
    \\end{document}
  `
}

export default template4
