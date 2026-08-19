import { stripIndent, source } from 'common-tags'
import { WHITESPACE } from './constants.js'
import { breakableUrl, profileLinks } from './profiles.js'
import type { FormValues, Generator, ResolvedDocumentConfig } from '../types.js'

const generator: Generator = {
  profileSection(basics) {
    if (!basics) {
      return ''
    }

    const {
      name = '',
      label,
      summary,
      email,
      phone,
      location = {},
      website,
      profiles
    } = basics
    const websiteLine = website ? `\\href{${website}}{${breakableUrl(website)}}` : ''

    const info = [
      email,
      phone,
      location.address,
      websiteLine,
      ...profileLinks(profiles)
    ].filter(Boolean)

    const labelLine = label
      ? `\\vspace{2mm}\n{\\fontsize{1.1em}{1.1em}\\fontspec[Path = fonts/]{CrimsonText-Italic} ${label}}\\\\`
      : ''

    const summaryBlock = summary ? `\n\\vspace{2mm}\n${summary}\\par` : ''

    return stripIndent`
      \\begin{center}
      % Personal
      % -----------------------------------------------------
      {\\fontsize{\\sizeone}{\\sizeone}\\fontspec[Path = fonts/,LetterSpace=15]{Montserrat-Regular} ${name.toUpperCase()}}
      ${name && info.length > 1 ? '\\\\' : ''}
      \\vspace{2mm}
      ${labelLine}
      {\\fontsize{1em}{1em}\\fontspec[Path = fonts/]{Montserrat-Light} ${info.join(
        ' -- '
      )}}
      \\end{center}
      ${summaryBlock}
    `
  },

  educationSection(education, heading) {
    if (!education) {
      return ''
    }

    return source`
      % Chapter: Education
      % ------------------

      \\chap{${heading ? heading.toUpperCase() : 'EDUCATION'}}{

      ${education.map((school) => {
        const {
          institution = '',
          location = '',
          area = '',
          studyType = '',
          score = '',
          startDate = '',
          endDate = ''
        } = school

        const degreeLine = [studyType, area].filter(Boolean).join(' ')
        let dateRange = ''

        if (startDate && endDate) {
          dateRange = `${startDate} – ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} – Present`
        } else {
          dateRange = endDate
        }

        return stripIndent`
            \\school
              {${institution}}
              {${dateRange}}
              {${degreeLine}}
              {${location}}
              {${
                score
                  ? `\\begin{newitemize}
                  \\item ${score ? `GPA: ${score}` : ''}
                \\end{newitemize}`
                  : ''
              }
          }
        `
      })}
      }
    `
  },

  workSection(work, heading) {
    if (!work) {
      return ''
    }

    return source`
      % Chapter: Work Experience
      % ------------------------
      \\chap{${heading ? heading.toUpperCase() : 'EXPERIENCE'}}{

      ${work.map((job) => {
        const {
          name = '',
          position = '',
          location = '',
          startDate = '',
          endDate = '',
          summary = '',
          highlights = []
        } = job

        let dateRange = ''
        let dutyLines = ''

        if (startDate && endDate) {
          dateRange = `${startDate} – ${endDate}`
        } else if (startDate) {
          dateRange = `${startDate} – Present`
        } else {
          dateRange = endDate
        }

        // `highlights` is destructured with a `[]` default above, so a truthiness
        // check is always true: a job with no highlights opened an empty
        // `newitemize`, which is a hard LaTeX error rather than a layout defect.
        if (highlights.length) {
          dutyLines = source`
            \\begin{newitemize}
              ${highlights.map((duty) => `\\item {${duty}}`)}
            \\end{newitemize}
            `
        }

        return stripIndent`
          \\job
            {${name}}
            {${dateRange}}
            {${position}}
            {${location}}
            {${summary ? `\\par ${summary}` : ''}${dutyLines}}
        `
      })}
    }
    `
  },

  skillsSection(skills, heading) {
    if (!skills) {
      return ''
    }

    return source`
      % Chapter: Skills
      % ------------------------

      \\chap{${heading ? heading.toUpperCase() : 'SKILLS'}}{
      \\begin{newitemize}
        ${skills.map((skill) => {
          const { name = '', keywords = [] } = skill

          let item = ''

          if (name) {
            item += `${name}: `
          }

          if (keywords.length > 0) {
            item += keywords.join(', ')
          }

          return `\\item ${item}`
        })}
      \\end{newitemize}
      }
    `
  },

  projectsSection(projects, heading) {
    if (!projects) {
      return ''
    }

    return source`
      % Chapter: Projects
      % ------------------------

      \\chap{${heading ? heading.toUpperCase() : 'PROJECTS'}}{

        ${projects.map((project) => {
          const {
            name = '',
            description = '',
            keywords = [],
            url = ''
          } = project

          const descriptionWithNewline = description
            ? `${description}\\\\`
            : description
          const urlLine = url ? `\\href{${url}}{${url}}` : ''

          return stripIndent`
            \\project
              {${name}}
              {${keywords.join(', ')}}
              {${urlLine}}
              {${descriptionWithNewline}}
          `
        })}
      }
    `
  },

  awardsSection(awards, heading) {
    if (!awards) {
      return ''
    }

    return source`
      % Chapter: Awards
      % ------------------------

      \\chap{${heading ? heading.toUpperCase() : 'AWARDS'}}{

        ${awards.map((award) => {
          const { title = '', summary = '', awarder = '', date = '' } = award

          return stripIndent`
            \\award
              {${title}}
              {${date}}
              {${summary}}
              {${awarder}}
          `
        })}
      }
    `
  },

  // Page margin is unknown-native — set inside \input{minimal-resume-config}
  // — so it's wired additively in the outer `template6()` function, gated
  // on the raw `document` input rather than compared here.
  resumeHeader(config) {
    return [
      config.lineSpacing !== 1.0 ? `\\linespread{${config.lineSpacing}}\\selectfont` : '',
      config.linkStyle === 'colored' ? '\\hypersetup{colorlinks=true,allcolors=blue}' : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
}

function template6(values: FormValues, config: ResolvedDocumentConfig) {
  const { headings = {} } = values

  // TEMPLATE_DEFAULTS[6] is {paper: 'letter', fontSize: 10}, matching this
  // class line's current literal '[10pt]' (no page-size option today means
  // letterpaper, article's own default).
  const paperOption = config.paper === 'a4' ? 'a4paper,' : ''
  const sizeOption = config.fontSize === 10 ? '10pt' : `${config.fontSize}pt`
  const classLine = `\\documentclass[${paperOption}${sizeOption}]{article}`

  // `\usepackage{geometry}` (no options) plus `\geometry{...}` rather than a
  // second options-bearing `\usepackage[...]{geometry}` — minimal-resume-config
  // (vendored, not read per CLAUDE.md) may already load geometry; see
  // template4's comment for the confirmed "Option clash" this avoids.
  const geometryLines =
    values.document.margin !== undefined
      ? ['\\usepackage{geometry}', `\\geometry{margin=${config.margin}}`]
      : []
  // Combined with \input{minimal-resume-config} via filter(Boolean): the
  // original has no blank line before \begin{document}.
  const preambleTail = [
    '\\input{minimal-resume-config}',
    ...geometryLines,
    generator.resumeHeader(config)
  ]
    .filter(Boolean)
    .join('\n')

  return stripIndent`
    ${classLine}
    \\usepackage[english]{babel}
    \\usepackage[hidelinks]{hyperref}
    ${preambleTail}
    \\begin{document}
    ${values.sections
      .map((section) => {
        switch (section) {
          case 'profile':
            return generator.profileSection(values.basics)

          case 'education':
            return generator.educationSection(
              values.education,
              headings.education
            )

          case 'work':
            return generator.workSection(values.work, headings.work)

          case 'skills':
            return generator.skillsSection(values.skills, headings.skills)

          case 'projects':
            return generator.projectsSection(values.projects, headings.projects)

          case 'awards':
            return generator.awardsSection(values.awards, headings.awards)

          default:
            return ''
        }
      })
      .join('\n')}
    ${WHITESPACE}
    \\end{document}
  `
}

export default template6
