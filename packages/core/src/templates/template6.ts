import { stripIndent, source } from 'common-tags'
import { WHITESPACE } from './constants.js'
import { breakableUrl, profileLinks, joinContactInfo } from './profiles.js'
import { isFontSupported, georgiaFontspecTarget, georgiaFileBasename } from './fonts.js'
import type { FormValues, Generator, ResolvedDocumentConfig } from '../types.js'

const generator: Generator = {
  profileSection(basics, config) {
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
      ? `\\vspace{2mm}\n{\\fontsize{1.1em}{1.1em}\\fontspec[Path = fonts/]{\\ctitalic} ${label}}\\\\`
      : ''

    const summaryBlock = summary ? `\n\\vspace{2mm}\n${summary}\\par` : ''

    return stripIndent`
      \\begin{center}
      % Personal
      % -----------------------------------------------------
      {\\fontsize{\\sizeone}{\\sizeone}\\fontspec[Path = fonts/,LetterSpace=15]{\\mtregular} ${name.toUpperCase()}}
      ${name && info.length > 1 ? '\\\\' : ''}
      \\vspace{2mm}
      ${labelLine}
      {\\fontsize{1em}{1em}\\fontspec[Path = fonts/]{\\mtlight} ${joinContactInfo(
        info,
        config.contactLayout,
        ' -- '
      )}}
      \\end{center}
      ${summaryBlock}
    `
  },

  educationSection(education, heading, config) {
    if (!education) {
      return ''
    }

    return source`
      % Chapter: Education
      % ------------------

      \\vspace{${config.sectionSpacing}pt}
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
                  \\setlength\\itemsep{${config.bulletSpacing}pt}
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

  workSection(work, heading, config) {
    if (!work) {
      return ''
    }

    return source`
      % Chapter: Work Experience
      % ------------------------
      \\vspace{${config.sectionSpacing}pt}
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
              \\setlength\\itemsep{${config.bulletSpacing}pt}
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

  skillsSection(skills, heading, config) {
    if (!skills) {
      return ''
    }

    return source`
      % Chapter: Skills
      % ------------------------

      \\vspace{${config.sectionSpacing}pt}
      \\chap{${heading ? heading.toUpperCase() : 'SKILLS'}}{
      \\begin{newitemize}
        \\setlength\\itemsep{${config.bulletSpacing}pt}
        ${skills.map((skill) => {
          const { name = '', keywords = [] } = skill
          const keywordsLine = keywords.join(', ')

          const item = name && keywordsLine ? `${name}: ${keywordsLine}` : name || keywordsLine

          return `\\item ${item}`
        })}
      \\end{newitemize}
      }
    `
  },

  projectsSection(projects, heading, config) {
    if (!projects) {
      return ''
    }

    return source`
      % Chapter: Projects
      % ------------------------

      \\vspace{${config.sectionSpacing}pt}
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

  awardsSection(awards, heading, config) {
    if (!awards) {
      return ''
    }

    return source`
      % Chapter: Awards
      % ------------------------

      \\vspace{${config.sectionSpacing}pt}
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
    // minimal-resume.sty (loaded above via \input{minimal-resume-config})
    // builds every visible run of text from named \newfontfamily commands
    // (\montserratfont, \crimsonfont, the main \setmainfont) or one of six
    // indirection macros wrapping a plain \fontspec[Path=fonts/]{...} call
    // — never \rmfamily/\sffamily, so a package-level swap changes nothing.
    // Only `georgia` is achievable (isFontSupported gates the other four —
    // see fonts.ts finding 4). The three named families get a full
    // \renewfontfamily/\setmainfont redeclaration (georgiaFontspecTarget,
    // same mechanism as template 2); the indirection macros get a plain
    // \renewcommand* to a bare file basename (georgiaFileBasename, same
    // mechanism as template 4 — a second `[...]` there would corrupt
    // \renewcommand's own optional-argument syntax). Collapses onto one
    // vendored family regardless of the original Montserrat/CrimsonText
    // weight distinctions — the same trade-off already accepted elsewhere.
    const fontLines =
      config.fontFamily !== 'template' && isFontSupported(6, config.fontFamily)
        ? (() => {
            const target = georgiaFontspecTarget()
            const regular = georgiaFileBasename('regular')
            const bold = georgiaFileBasename('bold')
            return [
              `\\renewfontfamily\\montserratfont${target}`,
              `\\renewfontfamily\\crimsonfont${target}`,
              `\\setmainfont${target}`,
              `\\renewcommand*{\\mtregular}{${regular}}`,
              `\\renewcommand*{\\mtlight}{${regular}}`,
              `\\renewcommand*{\\mtbold}{${bold}}`,
              `\\renewcommand*{\\ctregular}{${regular}}`,
              `\\renewcommand*{\\ctsemibold}{${bold}}`,
              `\\renewcommand*{\\ctitalic}{${regular}}`
            ].join('\n')
          })()
        : ''

    return [
      config.lineSpacing !== 1.0 ? `\\linespread{${config.lineSpacing}}\\selectfont` : '',
      config.linkStyle === 'colored' ? '\\hypersetup{colorlinks=true,allcolors=blue}' : '',
      fontLines
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
