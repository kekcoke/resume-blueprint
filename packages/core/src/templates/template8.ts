import { stripIndent, source } from 'common-tags'
import { WHITESPACE } from './constants.js'
import { breakableUrl, profileLinks } from './profiles.js'
import { nfssFontPreamble } from './fonts.js'
import type { FormValues, GeneratorWithSummary, ResolvedDocumentConfig } from '../types.js'

const generator: GeneratorWithSummary = {
  profileSection(basics, config) {
    if (!basics) {
      return ''
    }

    const { name, email, phone = '', location = {}, website, profiles } = basics
    const websiteLine = website ? `\\href{${website}}{${breakableUrl(website)}}` : ''

    // mcdowellcv's \address/\contacts macros take one free-text argument
    // each — the class doesn't stack the lines itself, this template's own
    // `\linebreak` joins do. 'stacked' (the recorded default) keeps that;
    // an explicit 'row' override switches the join separator instead.
    const itemSeparator = config.contactLayout === 'row' ? ' | ' : ' \\linebreak '

    let addressLine = ''
    let contactsLine = ''

    if (location.address && phone) {
      addressLine = `\\address{${location.address}${itemSeparator}${phone}}`
    } else if (location.address || phone) {
      addressLine = `\\address{${location.address || phone}}`
    }

    const contacts = [email, websiteLine, ...profileLinks(profiles)].filter(Boolean)

    if (contacts.length) {
      contactsLine = `\\contacts{${contacts.join(itemSeparator)}}`
    }

    return `
      % Set applicant's personal data for header
      \\name{${name || ''}}
      ${addressLine}
      ${contactsLine}
    `
  },

  // mcdowellcv's header is built from \name, \address, and \contacts in the
  // preamble and has no slot for a job title, so both render as the first block
  // of the body, directly under \makeheader.
  summarySection(basics) {
    const { label, summary } = basics || {}

    if (!label && !summary) {
      return ''
    }

    return `
      ${label ? `{\\large \\textit{${label}}}\\par\\vspace{4pt}` : ''}
      ${summary || ''}
      \\vspace{6pt}
    `
  },

  educationSection(education, heading, config) {
    if (!education) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\begin{cvsection}{${heading || 'Education'}}
      ${education.map((school) => {
        const {
          institution,
          studyType = '',
          area = '',
          score,
          location,
          startDate,
          endDate = ''
        } = school

        let degreeLine = ''

        if (studyType && area) {
          degreeLine = `${studyType} in ${area}.`
        } else if (studyType || area) {
          degreeLine = (studyType || area) + '.'
        }

        let dateRange = ''

        if (startDate && endDate) {
          dateRange = `${startDate} | ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} | Present`
        } else {
          dateRange = endDate
        }

        if (score) {
          degreeLine += ` GPA: ${score}`
        }

        // An entry with no studyType/area/score has an empty degreeLine —
        // guarded here so `\item` is never emitted with nothing after it
        // (fixtures/sparse.json's case; F5's orphan-bullet fix).
        const degreeBlock = degreeLine
          ? source`
              \\begin{itemize}
                \\setlength\\itemsep{${config.bulletSpacing}pt}
                \\item ${degreeLine}
              \\end{itemize}
            `
          : ''

        return stripIndent`
          \\begin{cvsubsection}{${location || ''}}{${institution || ''}}{${
          dateRange || ''
        }}
            ${degreeBlock}
          \\end{cvsubsection}
        `
      })}
      \\end{cvsection}
    `
  },

  workSection(work, heading, config) {
    if (!work) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\begin{cvsection}{${heading || 'Experience'}}
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

        let dateRange = ''
        let highlightLines = ''

        if (startDate && endDate) {
          dateRange = `${startDate} -- ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} -- Present`
        } else {
          dateRange = endDate
        }

        if (highlights?.length) {
          highlightLines = source`
            \\begin{itemize}%
              \\setlength\\itemsep{${config.bulletSpacing}pt}
              ${highlights.map((highlight) => `\\item ${highlight}`)}
            \\end{itemize}
            `
        }

        return stripIndent`
          \\begin{cvsubsection}{${position || ''}}{${name || ''}}{${
          dateRange || ''
        }}
            ${location || ''}
            ${summary ? `\\par ${summary}` : ''}
            ${highlightLines || ''}
          \\end{cvsubsection}
        `
      })}
      \\end{cvsection}
    `
  },

  skillsSection(skills, heading, config) {
    if (!skills) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\begin{cvsection}{${heading || 'Skills'}}
      \\begin{cvsubsection}{}{}{}
      \\begin{itemize}
      \\setlength\\itemsep{${config.bulletSpacing}pt}
      ${skills.map((skill) => {
        const { name, keywords = [] } = skill
        return `\\item ${name ? `${name}: ` : ''} ${keywords.join(', ') || ''}`
      })}
      \\end{itemize}
      \\end{cvsubsection}
      \\end{cvsection}
    `
  },

  projectsSection(projects, heading, config) {
    if (!projects) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\begin{cvsection}{${heading || 'Projects'}}
      \\begin{cvsubsection}{}{}{}
      \\begin{itemize}
      \\setlength\\itemsep{${config.bulletSpacing}pt}
      ${projects.map((project) => {
        const { name, description, keywords = [], url } = project

        let line = ''

        if (name) {
          line += `\\textbf{${name}} `
        }

        if (url) {
          const urlLine = url ? `\\href{${url}}{${url}}` : ''
          line += `(${urlLine}) `
        }

        if (description) {
          line += ` ${description}`
        }

        if (keywords) {
          line += ` ${keywords.join(', ')}`
        }

        return `\\item ${line}`
      })}
      \\end{itemize}
      \\end{cvsubsection}
      \\end{cvsection}
    `
  },

  awardsSection(awards, heading, config) {
    if (!awards) {
      return ''
    }

    return source`
      \\vspace{${config.sectionSpacing}pt}
      \\begin{cvsection}{${heading || 'Awards'}}
      \\begin{cvsubsection}{}{}{}
      \\begin{itemize}
      \\setlength\\itemsep{${config.bulletSpacing}pt}
      ${awards.map((award) => {
        const { title, summary, date, awarder } = award

        let line = ''

        if (title) {
          line += `\\textbf{${title}} `
        }

        if (awarder) {
          line += `(${awarder}) `
        }

        if (summary) {
          line += ` ${summary}`
        }

        if (date) {
          line += ` ${date}`
        }

        return `\\item ${line}`
      })}
      \\end{itemize}
      \\end{cvsubsection}
      \\end{cvsection}
    `
  },

  resumeHeader() {
    return stripIndent`
      %% The MIT License (MIT)
      %%
      %% Copyright (c) 2015 Daniil Belyakov
      %%
      %% Permission is hereby granted, free of charge, to any person obtaining a copy
      %% of this software and associated documentation files (the "Software"), to deal
      %% in the Software without restriction, including without limitation the rights
      %% to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
      %% copies of the Software, and to permit persons to whom the Software is
      %% furnished to do so, subject to the following conditions:
      %%
      %% The above copyright notice and this permission notice shall be included in all
      %% copies or substantial portions of the Software.
      %%
      %% THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
      %% IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
      %% FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
      %% AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
      %% LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
      %% OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
      %% SOFTWARE.
    `
  }
}

function template8(values: FormValues, config: ResolvedDocumentConfig) {
  const { headings = {} } = values

  // mcdowellcv.cls owns its own geometry; additive-only and gated on the
  // raw `document` input, same reasoning as templates 2 and 5.
  // `\usepackage{geometry}` (no options) plus `\geometry{...}` rather than a
  // second options-bearing `\usepackage[...]{geometry}` — see template4's
  // comment for the confirmed "Option clash" this avoids.
  const geometryOptions = [
    values.document.paper !== undefined ? (config.paper === 'a4' ? 'a4paper' : 'letterpaper') : '',
    values.document.margin !== undefined ? `margin=${config.margin}` : ''
  ].filter(Boolean)
  const geometryLines = geometryOptions.length
    ? ['\\usepackage{geometry}', `\\geometry{${geometryOptions.join(',')}}`]
    : []
  const extraLines = [
    ...geometryLines,
    config.lineSpacing !== 1.0 ? `\\linespread{${config.lineSpacing}}\\selectfont` : '',
    config.linkStyle === 'colored' ? '\\hypersetup{colorlinks=true,allcolors=blue}' : '',
    // mcdowellcv.cls loads `fontspec` but never calls it (its `calibri`
    // class option only ever redefined an unused \mainfontface macro) —
    // confirmed by compiling: re-declaring `fontspec` here and adding
    // `\usepackage{carlito}`/`\setmainfont{Gelasio}` is exactly as safe as
    // on a template that never touched fontspec at all, so this reuses the
    // same NFSS-route helper as templates 1/3/5/7/9 rather than a
    // template-specific override.
    nfssFontPreamble(8, config)
  ]
    .filter(Boolean)
    .join('\n')

  // resumeHeader() (the MIT license comment) moves below \documentclass —
  // see C4/Step 3 in the F3 plan for why this template's golden output is
  // expected to move regardless, and template4's identical relocation.
  const classBlock = [
    "% The font could be set to Windows-specific Calibri by using the 'calibri' option",
    '\\documentclass[]{mcdowellcv}',
    extraLines
  ]
    .filter(Boolean)
    .join('\n')

  return stripIndent`
    ${classBlock}

    ${generator.resumeHeader(config)}

    % For mathematical symbols
    \\usepackage{amsmath}
    \\usepackage[hidelinks]{hyperref}

    ${generator.profileSection(values.basics, config)}

    \\begin{document}
      % Print the header
      \\makeheader
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
              return generator.skillsSection(values.skills, headings.skills, config)

            case 'projects':
              return generator.projectsSection(
                values.projects,
                headings.projects,
                config
              )

            case 'awards':
              return generator.awardsSection(values.awards, headings.awards, config)

            default:
              return ''
          }
        })
        .join('\n')}
      ${WHITESPACE}
    \\end{document}
  `
}

export default template8
